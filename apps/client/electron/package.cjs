const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { packager } = require("@electron/packager");

function findElectronZip(version) {
  const fileName = `electron-v${version}-win32-x64.zip`;
  const roots = [
    process.env.ELECTRON_CACHE,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "electron", "Cache"),
    path.join(os.homedir(), ".cache", "electron"),
    path.join(os.homedir(), ".electron"),
  ].filter(Boolean);

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isFile() && entry.name === fileName) return directory;
      if (entry.isDirectory()) {
        const found = walk(full);
        if (found) return found;
      }
    }
    return null;
  }

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const found = walk(root);
    if (found) return found;
  }
  return null;
}

const root = path.resolve(__dirname, "..");
const stage = path.join(root, ".package");

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, "electron"), { recursive: true });
fs.cpSync(path.join(root, "dist"), path.join(stage, "dist"), { recursive: true });
for (const file of ["main.cjs", "preload.cjs"]) {
  fs.copyFileSync(path.join(root, "electron", file), path.join(stage, "electron", file));
}
fs.writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({ name: "marchlands", productName: "Marchlands", version: "0.2.3", main: "electron/main.cjs" }, null, 2),
);

const icon = path.join(root, "build", "icon.ico");
const electronVersion = require("electron/package.json").version;
const electronZipDir = findElectronZip(electronVersion);
if (electronZipDir) console.log(`using local Electron zip: ${electronZipDir}`);

packager({
  dir: stage,
  name: "Marchlands",
  platform: "win32",
  arch: "x64",
  out: path.resolve(root, "..", "..", "release"),
  overwrite: true,
  appVersion: "0.2.3",
  ...(electronZipDir ? { electronZipDir } : {}),
  ...(fs.existsSync(icon) ? { icon } : {}),
  win32metadata: {
    CompanyName: "Marchlands",
    FileDescription: "Marchlands",
    ProductName: "Marchlands",
    OriginalFilename: "Marchlands.exe",
  },
}).then((paths) => {
  console.log(paths.join("\n"));
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
