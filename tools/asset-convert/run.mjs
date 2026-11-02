import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const outRoot = path.join(root, "release", "converted-models");
const castleRoot = path.join(root, "apps", "client", "src", "assets", "kenney", "castle-glb");
const url = process.env.CONVERT_URL ?? "http://127.0.0.1:5188/?scene=convert";

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outRoot, { recursive: true });
fs.mkdirSync(castleRoot, { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("pageerror", (error) => console.error("[pageerror]", error.message));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.__convertReady === true || window.__convertError, null, {
  timeout: 240_000,
});
const error = await page.evaluate(() => window.__convertError);
if (error) throw new Error(error);

const manifest = await page.evaluate(() => window.__convertManifest);
const files = await page.evaluate(() => (window.__convertFiles ?? []).map((file) => ({ name: file.name, size: file.size })));
let total = 0;
for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const base64 = await page.evaluate((i) => window.__convertFiles?.[i]?.base64 ?? "", index);
  const data = Buffer.from(base64, "base64");
  const target = path.join(outRoot, file.name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  if (file.name.startsWith("models/castle/")) {
    fs.writeFileSync(path.join(castleRoot, path.basename(file.name)), data);
  }
  total += data.byteLength;
  console.log("wrote", file.name, data.byteLength);
}
const packBase64 = await page.evaluate(() => window.__convertPack ?? "");
if (!packBase64) throw new Error("missing pack");
fs.writeFileSync(path.join(root, "release", "Marchlands-models-converted.mlpack"), Buffer.from(packBase64, "base64"));
fs.writeFileSync(path.join(outRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("files", files.length, "MB", (total / 1024 / 1024).toFixed(1));
console.log("pack", path.join(root, "release", "Marchlands-models-converted.mlpack"));
await browser.close();
