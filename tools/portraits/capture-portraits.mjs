import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/**
 * 生成首页皮肤卡片用的正面照。
 * 先启动客户端 dev server，再运行：
 *   pnpm portraits [skinKey ...]
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "apps/client/public/skins");
const baseUrl = process.env.PORTRAIT_BASE_URL ?? "http://127.0.0.1:5188";

const KEYS = [
  "frontier-infantry-A",
  "frontier-infantry-B",
  "frontier-shield-A",
  "frontier-shield-B",
  "frontier-cavalry-A",
  "frontier-cavalry-B",
  "frontier-archer-A",
  "frontier-archer-B",
  "frontier-elite-A",
  "frontier-elite-B",
  "warrior",
  "cleric",
  "monk",
  "rogue",
];

const requested = process.argv.slice(2);
const skins = requested.length > 0 ? requested : KEYS;

try {
  const response = await fetch(baseUrl);
  if (!response.ok) throw new Error(String(response.status));
} catch {
  console.error(`无法连接 ${baseUrl}，请先运行 pnpm dev。`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 600, height: 750 }, deviceScaleFactor: 1 });
page.on("pageerror", (error) => console.error("pageerror", error.message));

try {
  for (const key of skins) {
    await page.goto(`${baseUrl}/?scene=unit-portrait&skin=${key}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__mlPortraitReady === true, null, { timeout: 60_000 });
    await page.waitForTimeout(250);
    const target = path.join(outDir, `${key}.png`);
    await page.locator("#portrait-canvas").screenshot({ path: target });
    console.log(key, `${Math.round(fs.statSync(target).size / 1024)} KB`);
  }
} finally {
  await browser.close();
}
