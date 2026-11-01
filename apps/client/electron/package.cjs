const fs = require("node:fs");
const path = require("node:path");
const { packager } = require("@electron/packager");

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
  JSON.stringify({ name: "marchlands", productName: "Marchlands", version: "0.1.0", main: "electron/main.cjs" }, null, 2),
);

const icon = path.join(root, "build", "icon.ico");

packager({
  dir: stage,
  name: "Marchlands",
  platform: "win32",
  arch: "x64",
  out: path.resolve(root, "..", "..", "release"),
  overwrite: true,
  appVersion: "0.1.0",
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
