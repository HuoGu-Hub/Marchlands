import { expect, test } from "@playwright/test";

async function openClassicEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?editor=classic");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#page-editor")).toBeVisible();
}

async function openGame(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?map=forest01");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await expect(page.locator("#page-briefing")).toBeVisible();
  await page.click("#btn-brief-start");
  await expect(page.locator("#page-game")).toBeVisible();
}

test("result screen appears at the time limit", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/?map=forest01&speed=20");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await page.click("#btn-brief-start");
  await expect(page.locator("#page-result")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator("#result-mark")).toHaveText("失败");
  await expect(page.locator("#stat-time")).toHaveText("15:00");
});

test("starts a match and captures an adjacent town", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#hud-cities")).toHaveText("1");
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  await page.waitForTimeout(400);
  const target = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c4") : null;
  });
  if (!target) throw new Error("c4 has no screen position");
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#hud-cities")).toHaveText("2", { timeout: 20_000 });
  await expect(page.locator("#toast")).toContainText("c4 已占领", { timeout: 20_000 });
});

test("creates a map in the editor and returns from playtest", async ({ page }) => {
  await openClassicEditor(page);
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
  await openClassicEditor(page);
  await page.click("#ml-ed-new-grid");
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  await page.click('[data-mode="terrain"]');
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

test("draws and reshapes a road in the editor", async ({ page }) => {
  await openClassicEditor(page);
  await page.click("#ml-ed-new-grid");
  await page.waitForTimeout(500);

  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const knobX = cx - 10;
  const knobY = cy - 20;

  await page.click('[data-tool="road"]');
  await page.mouse.move(cx - 110, cy + 30);
  await page.mouse.down();
  await page.mouse.move(cx - 70, cy - 10, { steps: 8 });
  await page.mouse.move(knobX, knobY, { steps: 8 });
  await page.mouse.move(cx + 80, cy + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#ml-ed-inspector")).toContainText("道路 r1");
  await expect(page.locator("#ml-ed-toast")).toContainText("已绘制道路");

  const countOf = async (): Promise<number> => {
    const text = await page.locator("#ml-ed-inspector").innerText();
    return Number(/(\d+) 个控制点/.exec(text)?.[1] ?? "0");
  };
  const drawn = await countOf();
  expect(drawn).toBeGreaterThan(2);

  await page.mouse.dblclick(knobX, knobY);
  await expect(page.locator("#ml-ed-inspector")).toContainText(`${drawn + 1} 个控制点`);
  await page.mouse.click(knobX, knobY, { button: "right" });
  await expect(page.locator("#ml-ed-inspector")).toContainText(`${drawn} 个控制点`);

  const before = await page.locator("#ml-ed-inspector").innerText();
  const beforeLength = /长度 ([\d.]+) 米/.exec(before)?.[1];
  expect(beforeLength).toBeTruthy();

  await page.mouse.move(knobX, knobY);
  await page.mouse.down();
  await page.mouse.move(knobX, cy + 70, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator("#ml-ed-toast")).toContainText("已调整道路");
  const after = await page.locator("#ml-ed-inspector").innerText();
  const afterLength = /长度 ([\d.]+) 米/.exec(after)?.[1];
  expect(afterLength).toBeTruthy();
  expect(afterLength).not.toBe(beforeLength);
});

test("draws a free road with empty endpoints", async ({ page }) => {
  await openClassicEditor(page);
  await page.click("#ml-ed-new-grid");
  await page.waitForTimeout(500);

  await page.click('[data-tool="road"]');
  await page.mouse.move(400, 470);
  await page.mouse.down();
  await page.mouse.move(520, 440, { steps: 6 });
  await page.mouse.move(700, 480, { steps: 6 });
  await page.mouse.up();
  await expect(page.locator("#ml-ed-inspector")).toContainText("自由道路");
  await expect(page.locator("#ml-ed-inspector")).toContainText("无起点");
  await expect(page.locator("#ml-ed-inspector")).toContainText("无终点");
});

test("places and rotates a terrain prop in the editor", async ({ page }) => {
  await openClassicEditor(page);
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  const label = page.locator("#ml-ed-map-label");
  const before = await label.textContent();
  const count = Number(/(\d+) 装饰/.exec(before ?? "")?.[1] ?? "0");
  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  await page.click('[data-mode="terrain"]');
  await page.click("#ml-ed-terrain-grid .ml-ed-asset >> nth=0");
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.55);
  await expect(label).toContainText(`${count + 1} 装饰`);
  await page.keyboard.press("r");
  await expect(page.locator("#ml-ed-toast")).toContainText("已旋转装饰");
  await page.click("#ml-ed-undo");
  await page.click("#ml-ed-undo");
  await expect(label).toContainText(`${count} 装饰`);
});

test("adds a floating foundation and deletes it", async ({ page }) => {
  await openClassicEditor(page);
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  await page.click('[data-mode="foundation"]');
  await expect(page.locator(".ml-ed-foundation-row")).toHaveCount(1);
  await page.click('[data-tool="island"]');
  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  await page.mouse.click(box.x + box.width * 0.78, box.y + box.height * 0.3);
  await expect(page.locator(".ml-ed-foundation-row")).toHaveCount(2);
  await expect(page.locator("#ml-ed-inspector")).toContainText("地基 f2");
  await expect(page.locator("#ml-ed-inspector")).toContainText("顶面高度");
  const elevation = page.locator('[data-foundation="f2"][data-field="elevation"]');
  await elevation.fill("20");
  await elevation.press("Enter");
  await expect(page.locator("#ml-ed-toast")).toContainText("已调整地基高度");
  await page.screenshot({ path: "test-results/foundation.png" });
  await page.keyboard.press("Delete");
  await expect(page.locator(".ml-ed-foundation-row")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.locator(".ml-ed-foundation-row")).toHaveCount(2);
});

test("next editor expands a foundation and creates a floating island", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await expect(page.locator("#mlnx-status")).toContainText("地图有效");
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  await expect(page.locator("#mlnx-inspector")).toContainText("地基 f1");
  await page.getByText("东 +10m", { exact: true }).click();
  await expect(page.locator("#mlnx-left-content")).toContainText("f1 · 80×70");
  const box = await page.locator("#mlnx-canvas").boundingBox();
  if (!box) throw new Error("next editor canvas has no box");
  await page.keyboard.press("b");
  await page.click('[data-tab="foundation"]');
  await page.locator("#mlnx-foundation-y").fill("12");
  await page.locator("#mlnx-foundation-y").dispatchEvent("change");
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#mlnx-left-content")).toContainText("地基 (2)");
  await page.click("#mlnx-undo");
  await expect(page.locator("#mlnx-left-content")).toContainText("地基 (1)");
  await page.keyboard.press("p");
  await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.5);
  await page.mouse.click(box.x + box.width * 0.56, box.y + box.height * 0.58);
  await page.keyboard.press("Enter");
  await expect(page.locator("#mlnx-left-content")).toContainText("道路 (5)");
  await expect(page.locator("#mlnx-inspector")).toContainText("道路 r5");
});

test("next editor drags a foundation face handle", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const east = await page.evaluate(() => {
    const hook = (window as unknown as { __mlnxProject?: (x: number, y: number, z: number) => { x: number; y: number } })
      .__mlnxProject;
    return hook ? hook(35, 1.1, 0) : null;
  });
  if (!east) throw new Error("face handle has no screen position");
  await page.mouse.move(east.x, east.y);
  await page.mouse.down();
  await page.mouse.move(east.x + 60, east.y + 10, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#mlnx-toast")).toContainText("已扩展地基");
});

test("next editor converts to a grid map and sculpts terrain", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.keyboard.press("g");
  await page.click("#mlnx-convert-grid");
  await expect(page.locator("[data-brush]")).toHaveCount(9);
  const box = await page.locator("#mlnx-canvas").boundingBox();
  if (!box) throw new Error("next editor canvas has no box");
  await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator("#mlnx-toast")).toContainText("已修改网格地形");
  await page.click("#mlnx-undo");
  await expect(page.locator("#mlnx-toast")).toContainText("已撤销");
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
