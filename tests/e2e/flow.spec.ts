import { expect, test } from "@playwright/test";

async function openGame(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?map=forest01");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await expect(page.locator("#page-briefing")).toBeVisible();
  await page.click("#btn-brief-start");
  await expect(page.locator("#page-game")).toBeVisible();
}

test("starts a match and captures an adjacent town", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#hud-cities")).toHaveText("1");
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  await page.waitForTimeout(400);
  await page.mouse.click(420, 352);
  await expect(page.locator("#hud-cities")).toHaveText("2", { timeout: 20_000 });
  await expect(page.locator("#toast")).toContainText("c4 已占领", { timeout: 20_000 });
});

test("creates a map in the editor and returns from playtest", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#page-editor")).toBeVisible();
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  await page.click('[data-tool="town"]');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator("#ml-ed-map-label")).toContainText("5 据点");
  await expect(page.locator("#ml-ed-status")).toContainText("错误");
  await page.click("#ml-ed-undo");
  await expect(page.locator("#ml-ed-map-label")).toContainText("4 据点");
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  await page.click("#ml-ed-play");
  await expect(page.locator("#page-game")).toBeVisible();
  await page.click("#btn-pause");
  await expect(page.locator("#btn-editor-return")).toBeVisible();
  await page.click("#btn-editor-return");
  await expect(page.locator("#page-editor")).toBeVisible();
  await expect(page.locator("#ml-ed-map-label")).toContainText("4 据点");
});

test("creates a grid map, sculpts terrain and previews navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#page-editor")).toBeVisible();
  await page.click("#ml-ed-new-grid");
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  await expect(page.locator("#ml-ed-grid-enable")).toBeDisabled();

  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.click('[data-grid-tool="raise"]');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 12, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator("#ml-ed-badge")).toContainText("高度");
  await expect(page.locator("#ml-ed-undo")).toBeEnabled();

  await page.click("#ml-ed-nav-preview");
  await expect(page.locator("#ml-ed-nav-preview")).toHaveClass(/active/);

  await page.click("#ml-ed-path-test");
  await page.mouse.click(cx - 40, cy + 10);
  await page.mouse.click(cx + 40, cy - 10);
  await expect(page.locator("#ml-ed-toast")).toContainText("路径", { timeout: 5000 });

  await page.click('[data-grid-tool="blocker"]');
  await page.mouse.click(cx + 60, cy + 20);
  await page.click("#ml-ed-undo");
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");

  await page.click("#ml-ed-play");
  await expect(page.locator("#page-game")).toBeVisible();
  await expect(page.locator("#hud-cities")).toHaveText("1");
  await page.click("#btn-pause");
  await page.click("#btn-editor-return");
  await expect(page.locator("#page-editor")).toBeVisible();
});

test("places and rotates a terrain prop in the editor", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  const label = page.locator("#ml-ed-map-label");
  const before = await label.textContent();
  const count = Number(/(\d+) 装饰/.exec(before ?? "")?.[1] ?? "0");
  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  await page.click("#ml-ed-terrain-grid .ml-ed-asset >> nth=0");
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.55);
  await expect(label).toContainText(`${count + 1} 装饰`);
  await page.keyboard.press("r");
  await expect(page.locator("#ml-ed-toast")).toContainText("已旋转装饰");
  await page.click("#ml-ed-undo");
  await page.click("#ml-ed-undo");
  await expect(label).toContainText(`${count} 装饰`);
});

test("pauses and resumes without losing the match", async ({ page }) => {
  await openGame(page);
  const timer = page.locator("#hud-timer");
  const before = await timer.textContent();

  await page.keyboard.press("Escape");
  await expect(page.locator("#pause-overlay")).toHaveClass(/on/);
  await page.waitForTimeout(1200);
  expect(await timer.textContent()).toBe(before);

  await page.click("#btn-resume");
  await expect(page.locator("#pause-overlay")).not.toHaveClass(/on/);
  await page.waitForTimeout(1200);
  expect(await timer.textContent()).not.toBe(before);
});

test("restart asks for confirmation and keeps the match on cancel", async ({ page }) => {
  await openGame(page);
  await page.keyboard.press("Escape");
  await page.click("#btn-restart");
  await expect(page.locator("#confirm-overlay")).toHaveClass(/on/);
  await page.click("#btn-confirm-no");
  await expect(page.locator("#confirm-overlay")).not.toHaveClass(/on/);
  await expect(page.locator("#pause-overlay")).toHaveClass(/on/);
});

test("settings persist to local storage", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-settings");
  await page.fill("#set-volume", "35");
  await page.click("#btn-save-settings");
  await expect(page.locator("#set-volume-out")).toHaveText("35");
  const stored = await page.evaluate(() => localStorage.getItem("marchlands.settings.v1"));
  expect(stored).toContain('"volume":35');
});

test("height test scene boots with a live canvas", async ({ page }) => {
  await page.goto("/?scene=height");
  await expect(page.locator("#height-canvas")).toBeVisible();
  await expect(page.locator(".chip").first()).toContainText("HeightTest");
  const size = await page.locator("#height-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  });
  expect(size.width).toBeGreaterThan(0);
  expect(size.height).toBeGreaterThan(0);
});

test("loads the crossroads01 map and selector", async ({ page }) => {
  await page.goto("/?map=crossroads01");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await expect(page.locator("#brief-title")).toHaveText("Crossroads 01");
  await expect(page.locator("#brief-objective")).toContainText("12");
  await expect(page.locator("#map-select")).toHaveValue("crossroads01");
  await page.click("#btn-brief-start");
  await expect(page.locator("#page-game")).toBeVisible();
  await expect(page.locator("#hud-cities")).toHaveText("1");
});

test("result screen appears at the time limit", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?map=forest01&speed=20");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await page.click("#btn-brief-start");
  await expect(page.locator("#page-result")).toBeVisible({ timeout: 70_000 });
  await expect(page.locator("#result-mark")).toHaveText("失败");
  await expect(page.locator("#stat-time")).toHaveText("15:00");
});