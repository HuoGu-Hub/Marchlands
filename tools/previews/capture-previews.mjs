import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

/**
 * 生成关卡卡片与全屏预览用的地图截图。
 * 先启动客户端 dev server，再运行：
 *   pnpm previews [mapId ...]
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const outDir = path.join(root, "apps/client/public/previews");
const baseUrl = process.env.PREVIEW_BASE_URL ?? "http://127.0.0.1:5188";

function existingIds() {
  if (!fs.existsSync(outDir)) return [];
  return fs
    .readdirSync(outDir)
    .filter((file) => file.endsWith(".jpg"))
    .map((file) => path.basename(file, ".jpg"));
}

const mapIds = process.argv.slice(2);
if (mapIds.length === 0) mapIds.push(...existingIds());
if (mapIds.length === 0) {
  console.error("没有可生成的地图，传入 mapId，例如：pnpm previews frontier01");
  process.exit(1);
}

try {
  const response = await fetch(baseUrl);
  if (!response.ok) throw new Error(String(response.status));
} catch {
  console.error(`无法连接 ${baseUrl}，请先运行 pnpm dev。`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (error) => console.error("pageerror", error.message));

try {
  for (const mapId of mapIds) {
    await page.goto(`${baseUrl}/?scene=map-preview&map=${mapId}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__mlPreviewReady === true, null, { timeout: 90_000 });
    await page.waitForTimeout(900);
    const target = path.join(outDir, `${mapId}.jpg`);
    await page.locator("#preview-canvas").screenshot({ path: target, type: "jpeg", quality: 86 });
    console.log(mapId, `${Math.round(fs.statSync(target).size / 1024)} KB`);
  }
} finally {
  await browser.close();
}
