import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

async function openClassicEditor(page: import("@playwright/test").Page): Promise<void> {
  await page.goto("/?editor=classic&intro=0");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#page-editor")).toBeVisible();
}

async function openGame(
  page: import("@playwright/test").Page,
  mapId = "frontier01",
  speed?: number,
): Promise<void> {
  const series = mapId === "autumnvale01" || mapId === "snowpass01" ? "north" : "frontier";
  await page.goto(`/?map=${mapId}&intro=0${speed ? `&speed=${speed}` : ""}`);
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await expect(page.locator("#page-campaign")).toBeVisible();
  await page.click(`[data-series="${series}"]`);
  await expect(page.locator("#page-series")).toBeVisible();
  await page.click(`[data-level="${mapId}"]`);
  await expect(page.locator("#level-overlay")).toHaveClass(/on/);
  await page.click("#btn-level-start");
  await expect(page.locator("#page-game")).toBeVisible();
}

test("result screen appears when the match ends", async ({ page }) => {
  test.setTimeout(180_000);
  await openGame(page, "frontier01", 20);
  await expect(page.locator("#page-result")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator("#result-mark")).toHaveText(/胜利|失败|平局/);
  await expect(page.locator("#stat-time")).toHaveText(/\d{2}:\d{2}/);
  await expect(page.locator("#stat-cities")).not.toHaveText("");
});

test("starts a match and captures an adjacent town", async ({ page }) => {
  await openGame(page);
  await expect(page.locator("#hud-cities")).toHaveText("1");
  const start = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c1") : null;
  });
  if (!start) throw new Error("c1 has no screen position");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);
  await expect(page.locator("#city-garrison")).toContainText("野蛮人");

  await page.waitForTimeout(400);
  const target = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c2") : null;
  });
  if (!target) throw new Error("c2 has no screen position");
  await page.mouse.dblclick(target.x, target.y);
  await expect(page.locator("#hud-cities")).toHaveText("2", { timeout: 30_000 });
  await expect(page.locator("#toast")).toContainText("c2 已占领", { timeout: 30_000 });
});


test("sets forced march before dispatching a squad", async ({ page }) => {
  await openGame(page);
  const start = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c1") : null;
  });
  if (!start) throw new Error("c1 has no screen position");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);
  await expect(page.locator('#city-stance [data-stance="guard"]')).toHaveClass(/on/);
  await page.click('#city-stance [data-stance="forced"]');
  await expect(page.locator('#city-stance [data-stance="forced"]')).toHaveClass(/on/);

  const target = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c2") : null;
  });
  if (!target) throw new Error("c2 has no screen position");
  await page.mouse.dblclick(target.x, target.y);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const hook = (window as unknown as {
            __mlSquads?: { squads: Array<{ owner: number; stance: string }> };
          }).__mlSquads;
          return hook?.squads.find((squad) => squad.owner === 1)?.stance ?? null;
        }),
      { timeout: 20_000 },
    )
    .toBe("forced");

  await page.waitForTimeout(2600);
  const squadPoint = await page.evaluate(() => {
    const squad = (window as unknown as {
      __mlSquads?: { squads: Array<{ owner: number; xCm?: number; zCm?: number }> };
    }).__mlSquads?.squads.find((entry) => entry.owner === 1);
    if (!squad || squad.xCm === undefined || squad.zCm === undefined) return null;
    const hook = (window as unknown as {
      __mlDebug?: { projectGround(x: number, z: number): { x: number; y: number } | null };
    }).__mlDebug;
    return hook ? hook.projectGround(squad.xCm / 10, squad.zCm / 10) : null;
  });
  if (!squadPoint) throw new Error("squad has no screen position");
  await page.mouse.click(squadPoint.x, squadPoint.y);
  await expect(page.locator("#squad-panel")).toHaveClass(/on/, { timeout: 5000 });
  await expect(page.locator('#squad-stance [data-stance="forced"]')).toHaveClass(/on/);
  await page.click('#squad-stance [data-stance="guard"]');
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const hook = (window as unknown as {
            __mlSquads?: { squads: Array<{ owner: number; stance: string }> };
          }).__mlSquads;
          return hook?.squads.find((squad) => squad.owner === 1)?.stance ?? null;
        }),
      { timeout: 10_000 },
    )
    .toBe("guard");
});


test("always dispatches half of the current garrison", async ({ page }) => {
  await openGame(page);
  const start = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c1") : null;
  });
  if (!start) throw new Error("c1 has no screen position");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#city-dispatch-count")).toHaveText("50%");
  const pop = Number(await page.locator("#city-pop").textContent());
  const expected = Math.floor(pop / 2);

  const target = await page.evaluate(() => {
    const hook = (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
      .__mlDebug;
    return hook ? hook.projectCity("c2") : null;
  });
  if (!target) throw new Error("c2 has no screen position");
  await page.mouse.dblclick(target.x, target.y);
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const hook = (window as unknown as {
            __mlSquads?: { squads: Array<{ owner: number; count: number }> };
          }).__mlSquads;
          return (hook?.squads ?? [])
            .filter((squad) => squad.owner === 1)
            .reduce((sum, squad) => sum + squad.count, 0);
        }),
      { timeout: 10_000 },
    )
    .toBe(expected);
});

test("creates a map in the editor and returns from playtest", async ({ page }) => {
  await openClassicEditor(page);
  await expect(page.locator("#ml-ed-status")).toContainText("地图有效");
  const box = await page.locator("#ml-ed-canvas").boundingBox();
  if (!box) throw new Error("editor canvas has no box");
  await page.click('[data-tool="barbarian"]');
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

test("next editor marks selected roads and keeps settings scoped", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "r1 ·" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __mlnxRoadMarker: () => number }).__mlnxRoadMarker()),
    )
    .toBeGreaterThan(0);
  await expect(page.locator("#mlnx-inspector")).toContainText("全图风格");
  await page.locator(".pcui-treeview-item-text", { hasText: "c2 ·" }).click();
  await expect(page.locator("#mlnx-inspector")).toContainText("未占领时");
  await page.getByText("← 地图设置", { exact: true }).click();
  const mapSettings = await page.locator("#mlnx-inspector").innerText();
  expect(mapSettings).toContain("对局时间");
  expect(mapSettings).not.toContain("全图风格");
  expect(mapSettings).not.toContain("未占领时");
});

test("next editor selects props and roads by clicking", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  const sitePoint = await page.evaluate(() => {
    const hooks = window as unknown as {
      __mlnxDoc: () => { sites: Array<{ id: string; pos: [number, number] }> };
      __mlnxProject: (x: number, y: number, z: number) => { x: number; y: number };
    };
    const site = hooks.__mlnxDoc().sites.find((entry) => entry.id === "c1");
    if (!site) throw new Error("missing site");
    return hooks.__mlnxProject(site.pos[0] / 10, 2.2, site.pos[1] / 10);
  });
  await page.mouse.click(sitePoint.x, sitePoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __mlnxSelection: () => { kind: string; id: string } | null }).__mlnxSelection()),
    )
    .toEqual({ kind: "site", id: "c1" });
  const propPoint = await page.evaluate(() => {
    const hooks = window as unknown as {
      __mlnxDoc: () => { visual: { props: Array<{ id: string; pos: [number, number] }> } };
      __mlnxProject: (x: number, y: number, z: number) => { x: number; y: number };
    };
    const prop = hooks.__mlnxDoc().visual.props[1];
    return { id: prop.id, ...hooks.__mlnxProject(prop.pos[0] / 10, 1.5, prop.pos[1] / 10) };
  });
  await page.mouse.click(propPoint.x, propPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __mlnxSelection: () => { kind: string; id: string } | null }).__mlnxSelection()),
    )
    .toEqual({ kind: "prop", id: propPoint.id });
  const roadPoint = await page.evaluate(() => {
    const hooks = window as unknown as {
      __mlnxDoc: () => { sites: Array<{ id: string; pos: [number, number] }> };
      __mlnxProject: (x: number, y: number, z: number) => { x: number; y: number };
    };
    const doc = hooks.__mlnxDoc();
    const from = doc.sites.find((site) => site.id === "c1");
    const to = doc.sites.find((site) => site.id === "c4");
    if (!from || !to) throw new Error("missing road endpoints");
    return hooks.__mlnxProject((from.pos[0] + to.pos[0]) / 20, 1, (from.pos[1] + to.pos[1]) / 20);
  });
  await page.mouse.click(roadPoint.x, roadPoint.y);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __mlnxSelection: () => { kind: string; id: string } | null }).__mlnxSelection()),
    )
    .toEqual({ kind: "road", id: "r1" });
});

test("next editor adds road control points by double-clicking", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  const point = await page.evaluate(() => {
    const hooks = window as unknown as {
      __mlnxDoc: () => { sites: Array<{ id: string; pos: [number, number] }> };
      __mlnxProject: (x: number, y: number, z: number) => { x: number; y: number };
    };
    const doc = hooks.__mlnxDoc();
    const from = doc.sites.find((site) => site.id === "c1");
    const to = doc.sites.find((site) => site.id === "c4");
    if (!from || !to) throw new Error("missing road endpoints");
    return hooks.__mlnxProject((from.pos[0] + to.pos[0]) / 20, 0.5, (from.pos[1] + to.pos[1]) / 20);
  });
  await page.mouse.dblclick(point.x, point.y);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { roads: Array<{ id: string; path?: unknown[] }> } })
            .__mlnxDoc().roads.find((road) => road.id === "r1")?.path?.length,
      ),
    )
    .toBe(3);
});

test("next editor rotates a selected site with the gizmo", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "c1 ·" }).click();
  await page.keyboard.press("r");
  const start = await page.evaluate(() => {
    const hooks = window as unknown as {
      __mlnxDoc: () => { sites: Array<{ id: string; pos: [number, number] }> };
      __mlnxProject: (x: number, y: number, z: number) => { x: number; y: number };
    };
    const site = hooks.__mlnxDoc().sites.find((entry) => entry.id === "c1");
    if (!site) throw new Error("missing site");
    return hooks.__mlnxProject(site.pos[0] / 10 + 0.8, 3.2, site.pos[1] / 10);
  });
  await page.mouse.move(start.x, start.y);
  await page.waitForTimeout(200);
  await page.mouse.down();
  await page.mouse.move(start.x + 50, start.y + 20, { steps: 10 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { sites: Array<{ id: string; visualRotation?: number }> } })
            .__mlnxDoc().sites.find((site) => site.id === "c1")?.visualRotation,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mlnxSiteRotation: (id: string) => number }).__mlnxSiteRotation("c1"),
      ),
    )
    .toBeGreaterThan(0);
});

test("next editor rotates a site on the vertical axes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "c1 ·" }).click();
  const pitch = page.locator("#mlnx-inspector .pcui-numeric-input input").nth(4);
  await pitch.fill("30");
  await pitch.dispatchEvent("change");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { sites: Array<{ id: string; visualRotationX?: number }> } })
            .__mlnxDoc().sites.find((site) => site.id === "c1")?.visualRotationX,
      ),
    )
    .toBe(30);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __mlnxSiteEuler: (id: string) => { x: number } }).__mlnxSiteEuler("c1").x,
      ),
    )
    .toBeGreaterThan(0);
});

test("next editor keeps map rules on the map and terrain on foundations", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await expect(page.locator("#mlnx-inspector")).toContainText("对局时间（分钟）");
  await expect(page.locator("#mlnx-inspector")).toContainText("起始金币");
  await expect(page.locator("#mlnx-inspector")).not.toContainText("地貌");
  await expect(page.locator("#mlnx-inspector")).not.toContainText("单位外观");
  const inputs = page.locator("#mlnx-inspector .pcui-numeric-input input");
  await inputs.nth(1).fill("200");
  await inputs.nth(1).dispatchEvent("change");
  await page.waitForTimeout(300);
  await inputs.nth(0).fill("5");
  await inputs.nth(0).dispatchEvent("change");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = (
          window as unknown as {
            __mlnxDoc: () => { startGold?: number; objectives: Array<{ type: string; ticks?: number }> };
          }
        ).__mlnxDoc();
        return {
          startGold: doc.startGold,
          time: doc.objectives.find((objective) => objective.type === "time_limit")?.ticks,
        };
      }),
    )
    .toEqual({ startGold: 200, time: 6000 });
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  await expect(page.locator("#mlnx-inspector")).toContainText("地貌");
  const style = page.locator("#mlnx-inspector .pcui-select-input").filter({ hasText: "跟随地图" }).first();
  await style.locator(".pcui-select-input-value").click();
  await style.locator(".pcui-select-input-list .pcui-label", { hasText: "雪原" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ terrainStyle?: string }> } } })
            .__mlnxDoc().visual.foundations[0].terrainStyle,
      ),
    )
    .toBe("snow");
});

test("next editor pans the view with a left drag", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  const box = await page.locator("#mlnx-canvas").boundingBox();
  if (!box) throw new Error("next editor canvas has no box");
  const camera = () =>
    page.evaluate(() => {
      const hook = (window as unknown as { __mlnxCamera?: () => { target: number[] } | null }).__mlnxCamera;
      return hook?.() ?? null;
    });
  const before = await camera();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await camera();
  expect(after?.target).not.toEqual(before?.target);
});

test("next editor retextures a procedural foundation without changing its shape", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const select = page.locator("#mlnx-inspector .pcui-select-input").filter({ hasText: "跟随地图材质" }).first();
  await select.locator(".pcui-select-input-value").click();
  await select.locator(".pcui-select-input-list .pcui-label", { hasText: "雪地" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = (
          window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ material?: string; assetId?: string }> } } }
        ).__mlnxDoc();
        const foundation = doc.visual.foundations[0];
        return { material: foundation.material, assetId: foundation.assetId ?? null, count: doc.visual.foundations.length };
      }),
    )
    .toEqual({ material: "snow014", assetId: null, count: 1 });
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  const material = await page.evaluate(
    () =>
      (
        window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ material?: string }> } } }
      ).__mlnxDoc().visual.foundations[0].material,
  );
  expect(material).toBe("snow014");
});

test("next editor fills a foundation with real props", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const before = await page.evaluate(
    () =>
      (window as unknown as { __mlnxDoc: () => { visual: { props: unknown[] } } }).__mlnxDoc().visual.props.length,
  );
  await page.getByRole("button", { name: /补景/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { props: unknown[] } } }).__mlnxDoc().visual.props.length,
      ),
    )
    .toBeGreaterThan(before);
  const after = await page.evaluate(
    () =>
      (window as unknown as { __mlnxDoc: () => { visual: { props: unknown[] } } }).__mlnxDoc().visual.props.length,
  );
  expect(after - before).toBeLessThanOrEqual(6);
});

test("next editor moves a foundation together with its contents", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const before = await page.evaluate(() => {
    const doc = (
      window as unknown as {
        __mlnxDoc: () => {
          visual: { foundations: Array<{ pos: [number, number] }>; props: Array<{ pos: [number, number] }> };
          sites: Array<{ pos: [number, number] }>;
        };
      }
    ).__mlnxDoc();
    return {
      foundation: doc.visual.foundations[0].pos[0],
      site: doc.sites[0].pos[0],
      prop: doc.visual.props[0].pos[0],
    };
  });
  const xInput = page.locator("#mlnx-inspector .pcui-numeric-input input").nth(0);
  await xInput.fill(String(before.foundation / 10 + 5));
  await xInput.dispatchEvent("change");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const doc = (
          window as unknown as {
            __mlnxDoc: () => {
              visual: { foundations: Array<{ pos: [number, number] }>; props: Array<{ pos: [number, number] }> };
              sites: Array<{ pos: [number, number] }>;
            };
          }
        ).__mlnxDoc();
        return {
          foundation: doc.visual.foundations[0].pos[0],
          site: doc.sites[0].pos[0],
          prop: doc.visual.props[0].pos[0],
        };
      }),
    )
    .toEqual({ foundation: before.foundation + 50, site: before.site + 50, prop: before.prop + 50 });
});

test("next editor switches foundation material and keeps atmosphere on foundation add", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const material = page.locator("#mlnx-inspector .pcui-select-input").filter({ hasText: "跟随地图材质" }).first();
  await material.locator(".pcui-select-input-value").click();
  await material.locator(".pcui-select-input-list .pcui-label", { hasText: "岩石" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ material?: string }> } } }).__mlnxDoc()
            .visual.foundations[0].material,
      ),
    )
    .toBe("rocks007");
  const snapshot = () =>
    page.evaluate(() => {
      const hooks = window as unknown as {
        __mlnxFog?: () => { near: number; far: number } | null;
        __mlnxAtmosphere?: () => string | null;
      };
      return { fog: hooks.__mlnxFog?.() ?? null, atmosphere: hooks.__mlnxAtmosphere?.() ?? null };
    });
  const before = await snapshot();
  const box = await page.locator("#mlnx-canvas").boundingBox();
  if (!box) throw new Error("next editor canvas has no box");
  await page.keyboard.press("b");
  await page.click('[data-tab="foundation"]');
  await page.locator("#mlnx-foundation-y").fill("24");
  await page.locator("#mlnx-foundation-y").dispatchEvent("change");
  await page.mouse.move(box.x + 80, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 350, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { foundations: unknown[] } } }).__mlnxDoc().visual
            .foundations.length,
      ),
    )
    .toBe(2);
  expect(await snapshot()).toEqual(before);
});

test("next editor imports a custom ground material and keeps it after reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.click("#mlnx-foundation-material");
  const chooser = await chooserPromise;
  await chooser.setFiles(path.join(process.cwd(), "apps/client/src/assets/materials/snow014/color.jpg"));
  const material = () =>
    page.evaluate(
      () =>
        (window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ material?: string }> } } }).__mlnxDoc()
          .visual.foundations[0].material,
    );
  await expect.poll(material).toMatch(/^custom\./);
  const id = await material();
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await expect.poll(material).toBe(id);
  await page.locator(".pcui-treeview-item-text", { hasText: "f1 ·" }).click();
  await expect(page.locator("#mlnx-inspector")).toContainText("自定义");
});

test("next editor imports an OBJ with MTL and texture", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.keyboard.press("b");
  await page.click('[data-tab="decor"]');
  const chooserPromise = page.waitForEvent("filechooser");
  await page.click("#mlnx-obj-import");
  const chooser = await chooserPromise;
  const root = process.cwd();
  await chooser.setFiles([
    path.join(root, "tests/fixtures/obj/cube.obj"),
    path.join(root, "tests/fixtures/obj/cube.mtl"),
    path.join(root, "apps/client/src/assets/materials/rocks007/color.jpg"),
  ]);
  await expect(page.locator("#mlnx-toast")).toContainText("已导入", { timeout: 20_000 });
  await expect(page.locator("#mlnx-left-content")).toContainText("cube");
  await expect(page.locator("[data-asset-id]").filter({ hasText: "cube" })).toHaveCount(1);
});

test("next editor adds varied foundation shapes and sizes", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.keyboard.press("b");
  await page.click('[data-tab="foundation"]');
  await page.locator("[data-foundation-preset='round-small']").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ shape?: string; size: number[] }> } } })
            .__mlnxDoc().visual.foundations.length,
      ),
    )
    .toBe(2);
  await page.locator("[data-foundation-preset='spire-float']").click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const foundations = (
          window as unknown as {
            __mlnxDoc: () => {
              visual: { foundations: Array<{ shape?: string; size: number[]; elevation: number; scatter?: boolean }> };
            };
          }
        ).__mlnxDoc().visual.foundations;
        return foundations.map((foundation) => [
          foundation.shape ?? null,
          foundation.size.join("x"),
          foundation.elevation,
          foundation.scatter ?? true,
        ]);
      }),
    )
    .toEqual([
      [null, "700x700", 0, true],
      ["round", "300x300", 0, false],
      ["spire", "400x400", 14, false],
    ]);
  await page.keyboard.press("v");
  await page.waitForTimeout(300);
  await page.locator(".pcui-treeview-item-text", { hasText: "f2 ·" }).click();
  const shapeSelect = page.locator("#mlnx-inspector .pcui-select-input").filter({ hasText: "圆岛" }).first();
  await shapeSelect.locator(".pcui-select-input-value").click();
  await shapeSelect.locator(".pcui-select-input-list .pcui-label", { hasText: "方山" }).first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __mlnxDoc: () => { visual: { foundations: Array<{ id: string; shape?: string; size: number[] }> } } })
            .__mlnxDoc().visual.foundations.find((foundation) => foundation.id === "f2")?.shape,
      ),
    )
    .toBe("mesa");
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

test("next editor creates a grid map at a chosen cell size and shows per-unit reach", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.keyboard.press("g");
  await page.fill("#mlnx-grid-w", "40");
  await page.fill("#mlnx-grid-h", "30");
  await page.selectOption("#mlnx-grid-cell", "20");
  await page.click("#mlnx-new-grid");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const doc = (window as unknown as { __mlnxDoc: () => { grid?: { cellSizeDm: number; width: number; height: number } } }).__mlnxDoc();
        return doc.grid ? [doc.grid.cellSizeDm, doc.grid.width, doc.grid.height] : null;
      }),
    )
    .toEqual([20, 20, 15]);
  await page.click("#mlnx-reach-toggle");
  await expect(page.locator("#mlnx-reach-toggle")).toContainText("关闭可达范围");
  await page.selectOption("#mlnx-reach-unit", "warrior");
  await expect(page.locator("#mlnx-reach-unit")).toHaveValue("warrior");
  await page.click("#mlnx-reach-toggle");
  await expect(page.locator("#mlnx-reach-toggle")).toContainText("显示可达范围");
});

test("next editor converts to half-metre grid cells", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-editor");
  await expect(page.locator("#mlnx-root")).toBeVisible();
  await page.keyboard.press("g");
  await page.selectOption("#mlnx-grid-cell", "5");
  await page.click("#mlnx-convert-grid");
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const doc = (window as unknown as { __mlnxDoc: () => { grid?: { cellSizeDm: number; width: number } } }).__mlnxDoc();
        return doc.grid ? [doc.grid.cellSizeDm, doc.grid.width] : null;
      }),
    )
    .toEqual([5, 140]);
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

test("skin cards live on the home page and save the chosen look", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-skins");
  await expect(page.locator("#page-skins")).toBeVisible();
  await expect(page.locator("#skin-tabs .skin-tab")).toHaveCount(6);
  await expect(page.locator("#skin-grid .skin-card")).not.toHaveCount(0);
  await expect(page.locator('.skin-card[data-skin-key^="frontier-"]')).toHaveCount(0);
  await expect(page.locator("#skin-grid .skin-card img").first()).toHaveAttribute("src", /\/skins\//);
  await expect(page.locator("#skin-grid")).toHaveCSS("flex-wrap", "nowrap");

  const target = page.locator("#skin-grid .skin-card").first();
  const key = await target.getAttribute("data-skin-key");
  expect(key).toBeTruthy();
  await target.click();
  await expect(target).toHaveClass(/selected/);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("marchlands.settings.v1") ?? "{}"));
  expect(stored.unitSkins.barbarian).toBe(`builtin:unit.${key}`);

  await page.click('.skin-tab[data-kind="warrior"]');
  await expect(page.locator("#skin-count")).toContainText("精锐战士");
  await expect(page.locator("#skin-grid .skin-card")).not.toHaveCount(0);
  await page.click("#btn-skins-back");
  await expect(page.locator("#page-menu")).toBeVisible();
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

test("campaign opens a series, a level sheet, difficulty and full map preview", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#page-menu")).toBeVisible({ timeout: 10_000 });
  await page.click("#btn-start");
  await expect(page.locator("#page-campaign")).toBeVisible();
  await expect(page.locator(".series-card")).toHaveCount(3);
  await expect(page.locator('[data-series="frontier"]')).toContainText("边境线");

  await page.click('[data-series="frontier"]');
  await expect(page.locator("#page-series")).toBeVisible();
  await expect(page.locator(".level-card")).toHaveCount(2);
  await expect(page.locator('[data-level="frontier01"]')).toContainText("边境线");
  await expect(page.locator('[data-level="frontier01"]')).toContainText("36 座产兵据点");

  await page.click('[data-level="frontier01"]');
  await expect(page.locator("#level-overlay")).toHaveClass(/on/);
  await expect(page.locator("#level-title")).toHaveText("边境线");
  await expect(page.locator("#level-objective")).toContainText("36");
  await expect(page.locator('input[name="level-difficulty"]')).toHaveCount(3);

  await page.click('.difficulty-option:has(input[value="hard"])');
  await expect(page.locator('input[name="level-difficulty"][value="hard"]')).toBeChecked();
  await expect(page.locator("#difficulty-hint")).toContainText("决策更频繁");

  await page.click("#btn-preview-open");
  await expect(page.locator("#map-viewer")).toHaveClass(/on/);
  await expect(page.locator("#map-viewer-img")).toHaveAttribute("src", /frontier01\.jpg/);
  await page.keyboard.press("Escape");
  await expect(page.locator("#map-viewer")).not.toHaveClass(/on/);

  await page.keyboard.press("Escape");
  await expect(page.locator("#level-overlay")).not.toHaveClass(/on/);
  await page.click('[data-level="frontier01"]');
  await expect(page.locator('input[name="level-difficulty"][value="hard"]')).toBeChecked();
  await page.click("#btn-level-start");
  await expect(page.locator("#page-game")).toBeVisible();
});

test("assigns groups in multi-select mode and dispatches with the button", async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page, "frontier01");

  const project = (id: string) =>
    page.evaluate(
      (cityId) =>
        (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
          .__mlDebug?.projectCity(cityId),
      id,
    );
  const reach = () =>
    page.evaluate(
      () =>
        (window as unknown as { __mlReach?: { targets: string[] } }).__mlReach?.targets ?? [],
    );
  const plan = () =>
    page.evaluate(
      () =>
        (window as unknown as {
          __mlPlan?: {
            multiSelect: boolean;
            pending: string[];
            groups: Array<{ sources: string[]; to: string }>;
            arcs: Array<{ x: number; y: number } | null>;
          };
        }).__mlPlan,
    );

  const start = await project("c1");
  if (!start) throw new Error("c1 has no screen position");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  // 网格通行下平原据点都能抵达；至少包含原来的五座相邻据点。
  await expect.poll(reach).toEqual(expect.arrayContaining(["c17", "c2", "c3", "c9", "g1"]));
  await expect
    .poll(async () =>
      page.evaluate(
        () => (window as unknown as { __mlReach?: { gridCells: number } }).__mlReach?.gridCells ?? 0,
      ),
    )
    .toBeGreaterThan(10_000);

  const c2 = await project("c2");
  if (!c2) throw new Error("c2 has no screen position");
  await page.mouse.dblclick(c2.x, c2.y);
  await expect(page.locator("#hud-cities")).toHaveText("2", { timeout: 40_000 });

  await page.mouse.click(c2.x, c2.y);
  await expect(page.locator("#city-name")).toContainText("c2");
  await expect
    .poll(async () => Number(await page.locator("#city-pop").textContent()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  const c1 = await project("c1");
  const c3 = await project("c3");
  const c9 = await project("c9");
  if (!c1 || !c3 || !c9) throw new Error("missing screen positions");

  // 单击 Ctrl 进入多选，松开不会发兵；随后点据点编组、点敌方据点指定目标。
  await page.keyboard.press("Control");
  await expect(page.locator("#plan-hint")).toContainText("多选模式");
  await expect(page.locator("#btn-dispatch")).toHaveClass(/on/);
  await expect(page.locator("#btn-dispatch")).toBeDisabled();
  await expect.poll(async () => (await plan())?.multiSelect).toBe(true);

  await page.mouse.click(c2.x, c2.y);
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#plan-hint")).toContainText("已编组 2 座");
  await expect.poll(reach).toEqual(expect.arrayContaining(["c10", "c17", "c3", "c9", "g1"]));
  await page.mouse.click(c3.x, c3.y);
  await expect(page.locator("#toast")).toContainText("2 座据点 → c3");
  await expect.poll(async () => (await plan())?.groups).toEqual([
    { sources: ["c2", "c1"], to: "c3" },
  ]);
  await expect(page.locator("#btn-dispatch")).toBeEnabled();

  // 把 c1 撤回编组，再指定第二组：c1 → c9。
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#plan-hint")).toContainText("待指定 1 座");
  await page.mouse.click(c9.x, c9.y);
  await expect(page.locator("#toast")).toContainText("1 座据点 → c9");
  await expect.poll(async () => (await plan())?.groups).toEqual([
    { sources: ["c2"], to: "c3" },
    { sources: ["c1"], to: "c9" },
  ]);

  // 单击“派遣”才真正发兵，所有编组一起出发，仍留在多选模式。
  await page.click("#btn-dispatch");
  await expect(page.locator("#toast")).toContainText("2 座据点同时发兵");
  await expect.poll(async () => (await plan())?.groups).toEqual([]);
  await expect(page.locator("#btn-dispatch")).toBeDisabled();
  await expect.poll(async () => (await plan())?.multiSelect).toBe(true);

  // 再次单击 Ctrl 退出多选。
  await page.keyboard.press("Control");
  await expect.poll(async () => (await plan())?.multiSelect).toBe(false);
  await expect(page.locator("#plan-hint")).not.toHaveClass(/on/);
  await expect(page.locator("#btn-dispatch")).not.toHaveClass(/on/);
});

test("dispatches one multi-select group from several towns", async ({ page }) => {
  test.setTimeout(120_000);
  await openGame(page, "frontier01");

  const project = (id: string) =>
    page.evaluate(
      (cityId) =>
        (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
          .__mlDebug?.projectCity(cityId),
      id,
    );
  const start = await project("c1");
  if (!start) throw new Error("c1 has no screen position");
  await page.mouse.click(start.x, start.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);
  const c2 = await project("c2");
  if (!c2) throw new Error("c2 has no screen position");
  await page.mouse.dblclick(c2.x, c2.y);
  await expect(page.locator("#hud-cities")).toHaveText("2", { timeout: 40_000 });

  await page.mouse.click(c2.x, c2.y);
  await expect(page.locator("#city-name")).toContainText("c2");
  await expect
    .poll(async () => Number(await page.locator("#city-pop").textContent()), { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);

  const c1 = await project("c1");
  const c3 = await project("c3");
  if (!c1 || !c3) throw new Error("missing screen positions");

  await page.keyboard.press("Control");
  await page.mouse.click(c2.x, c2.y);
  await page.mouse.click(c1.x, c1.y);
  await page.mouse.click(c3.x, c3.y);
  await expect(page.locator("#toast")).toContainText("2 座据点 → c3");
  await page.click("#btn-dispatch");
  await expect(page.locator("#toast")).toContainText("2 座据点同时发兵");
});

test("double-clicking an arched arrow cancels its task", async ({ page }) => {
  test.setTimeout(60_000);
  await openGame(page, "frontier01");

  const project = (id: string) =>
    page.evaluate(
      (cityId) =>
        (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
          .__mlDebug?.projectCity(cityId),
      id,
    );
  const plan = () =>
    page.evaluate(
      () =>
        (window as unknown as {
          __mlPlan?: {
            multiSelect: boolean;
            pending: string[];
            groups: Array<{ sources: string[]; to: string }>;
            arcs: Array<{ x: number; y: number } | null>;
          };
        }).__mlPlan,
    );

  await page.keyboard.press("Control");
  const c1 = await project("c1");
  const c3 = await project("c3");
  if (!c1 || !c3) throw new Error("missing screen positions");
  await page.mouse.click(c1.x, c1.y);
  await page.mouse.click(c3.x, c3.y);
  await expect(page.locator("#toast")).toContainText("1 座据点 → c3");

  const arc = (await plan())?.arcs[0];
  if (!arc) throw new Error("missing arched arrow");
  await page.mouse.dblclick(arc.x, arc.y);
  await expect(page.locator("#toast")).toContainText("已取消 1 座 → c3");
  await expect.poll(async () => (await plan())?.groups).toEqual([]);
  await expect(page.locator("#btn-dispatch")).toBeDisabled();

  // 再次指定后单击 Ctrl 退出，未派遣任务被取消。
  await page.mouse.click(c1.x, c1.y);
  await page.mouse.click(c3.x, c3.y);
  await expect(page.locator("#toast")).toContainText("1 座据点 → c3");
  await page.keyboard.press("Control");
  await expect(page.locator("#toast")).toContainText("已退出多选 · 1 组任务已取消");
  await expect.poll(async () => (await plan())?.groups).toEqual([]);
  await expect(page.locator("#btn-dispatch")).not.toHaveClass(/on/);
});

test("dispatches troops to any reachable grid cell", async ({ page }) => {
  test.setTimeout(120_000);
  await openClassicEditor(page);
  await page.click("#ml-ed-new-grid");
  await page.waitForTimeout(500);
  await page.click("#ml-ed-play");
  await expect(page.locator("#page-game")).toBeVisible();

  const reach = () =>
    page.evaluate(
      () =>
        (window as unknown as { __mlReach?: { gridCells: number } }).__mlReach?.gridCells ?? 0,
    );
  const projectCity = (id: string) =>
    page.evaluate(
      (cityId) =>
        (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } })
          .__mlDebug?.projectCity(cityId),
      id,
    );
  const c1 = await projectCity("c1");
  if (!c1) throw new Error("c1 has no screen position");
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);
  await expect.poll(reach).toBeGreaterThan(4000);

  const projectGround = (x: number, z: number) =>
    page.evaluate(
      (point) =>
        (window as unknown as { __mlDebug?: { projectGround(x: number, z: number): { x: number; y: number } | null } })
          .__mlDebug?.projectGround(point[0], point[1]),
      [x, z] as [number, number],
    );
  const ownSquads = () =>
    page.evaluate(
      () => (window as unknown as { __mlSquads?: { own: number } }).__mlSquads?.own ?? 0,
    );

  // 单选状态下直接点浅绿网格派兵。
  const ground = await projectGround(0, 0);
  if (!ground) throw new Error("grid cell has no screen position");
  // 单击只选择，不派兵。
  await page.mouse.click(ground.x, ground.y);
  await page.waitForTimeout(300);
  expect(await ownSquads()).toBe(0);
  await page.mouse.dblclick(ground.x, ground.y);
  await expect.poll(ownSquads).toBeGreaterThan(0);

  // 多选状态下把编组指定到另一个网格，再点“派遣”。
  await page.keyboard.press("Control");
  await page.mouse.click(c1.x, c1.y);
  const cell = await projectGround(-100, 100);
  if (!cell) throw new Error("target cell has no screen position");
  await page.mouse.click(cell.x, cell.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const plan = (window as unknown as { __mlPlan?: { groups: Array<{ cell?: number[] }> } }).__mlPlan;
        return plan?.groups[0]?.cell ?? null;
      }),
    )
    .not.toBeNull();
  await page.click("#btn-dispatch");
  await expect(page.locator("#toast")).toContainText("已派遣");
});

test("drags an arched arrow from a building to dispatch", async ({ page }) => {
  test.setTimeout(120_000);
  await openClassicEditor(page);
  await page.click("#ml-ed-new-grid");
  await page.waitForTimeout(500);
  await page.click("#ml-ed-play");
  await expect(page.locator("#page-game")).toBeVisible();

  const c1 = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCityBase(id: string): { x: number; y: number } | null } })
        .__mlDebug?.projectCityBase("c1"),
  );
  if (!c1) throw new Error("c1 has no screen position");
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  const cell = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectGround(x: number, z: number): { x: number; y: number } | null } })
        .__mlDebug?.projectGround(0, 0),
  );
  if (!cell) throw new Error("target cell has no screen position");

  await page.mouse.move(c1.x, c1.y);
  await page.mouse.down();
  await page.mouse.move(cell.x, cell.y, { steps: 12 });
  await page.mouse.up();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __mlSquads?: { own: number } }).__mlSquads?.own ?? 0),
    )
    .toBeGreaterThan(0);
});

test("single click previews the actual grid route", async ({ page }) => {
  await openGame(page, "frontier01");
  // 等开场镜头落位，再放大到一段空地：附近没有据点时，单击才会走路线预览而不是查看建筑。
  await page.waitForTimeout(4200);
  await page.evaluate(() =>
    (window as unknown as { __mlDebug?: { focus(x: number, z: number, zoom?: number): unknown } }).__mlDebug?.focus(
      -600,
      -280,
      1.6,
    ),
  );
  await page.waitForTimeout(600);
  const c1 = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCity("c1"),
  );
  if (!c1) throw new Error("c1 has no screen position");
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  const target = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectGround(x: number, z: number): { x: number; y: number } | null } })
        .__mlDebug?.projectGround(-600, -250),
  );
  if (!target) throw new Error("target cell has no screen position");
  await page.mouse.click(target.x, target.y);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __mlPreview?: { cells: number } }).__mlPreview?.cells ?? 0))
    .toBeGreaterThan(2);
});


test("inspects a neutral building without operating it", async ({ page }) => {
  await openGame(page, "frontier01");
  const target = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCity("c2"),
  );
  if (!target) throw new Error("c2 has no screen position");
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);
  await expect(page.locator("#city-panel")).toHaveClass(/inspect/, { timeout: 5000 });
  await expect(page.locator("#city-name")).toContainText("c2");
  await expect(page.locator("#city-multi")).toHaveText("仅查看");
  await expect(page.locator("#city-upgrade")).toBeDisabled();
  await expect(page.locator("#city-transit")).toBeDisabled();
  await expect(page.locator("#city-dispatch-count")).toHaveText("50%");
  await expect(page.locator("#city-dispatch-label")).toHaveText("不可操作");
  await expect(page.locator("#city-stance [data-stance]").first()).toBeDisabled();
});

test("shows the attack range when inspecting a mage tower", async ({ page }) => {
  await openGame(page, "frontier01");
  await page.evaluate(() => {
    (window as unknown as { __mlDebug?: { focus(x: number, z: number, zoom?: number): unknown } }).__mlDebug?.focus(
      -490,
      430,
      0.6,
    );
  });
  await page.waitForTimeout(400);
  const target = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCity(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCityBase("m1"),
  );
  if (!target) throw new Error("m1 has no screen position");
  await page.mouse.click(target.x, target.y);
  await expect(page.locator("#city-panel")).toHaveClass(/inspect/, { timeout: 5000 });
  await expect(page.locator("#city-name")).toContainText("m1");
  await expect(page.locator("#city-trait")).toContainText("射程 7.0 米");
});

test("neutral mage tower fires at an approaching squad", async ({ page }) => {
  await openGame(page, "frontier01");
  const c1 = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCityBase(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCityBase("c1"),
  );
  if (!c1) throw new Error("c1 has no screen position");
  await page.mouse.click(c1.x, c1.y);
  await expect(page.locator("#city-panel")).toHaveClass(/on/);

  await page.evaluate(() => {
    (window as unknown as { __mlDebug?: { focus(x: number, z: number, zoom?: number): unknown } }).__mlDebug?.focus(
      -710,
      -470,
      0.8,
    );
  });
  await page.waitForTimeout(500);
  const target = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCityBase(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCityBase("m2"),
  );
  if (!target) throw new Error("m2 has no screen position");
  await page.mouse.dblclick(target.x, target.y);

  await expect
    .poll(
      () =>
        page.evaluate(
          () => (window as unknown as { __mlTowerShots?: number }).__mlTowerShots ?? 0,
        ),
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const hook = (window as unknown as {
            __mlSquads?: { squads: Array<{ owner: number; count: number }> };
          }).__mlSquads;
          return hook?.squads.find((squad) => squad.owner === 1)?.count ?? 15;
        }),
      { timeout: 15000 },
    )
    .toBeLessThan(15);
});

test("dev tuner changes a live value", async ({ page }) => {
  await openGame(page, "frontier01");
  await page.click("#ml-dev-toggle");
  await expect(page.locator("#ml-dev-panel")).toBeVisible();
  await page.locator("#ml-dev-panel summary").filter({ hasText: "法师塔" }).click();
  const range = page.locator('[data-dev-field="mage.range"]');
  await expect(range).toHaveValue("7");
  await range.fill("9");
  await page.waitForTimeout(120);

  await page.evaluate(() => {
    (window as unknown as { __mlDebug?: { focus(x: number, z: number, zoom?: number): unknown } }).__mlDebug?.focus(
      -490,
      430,
      0.6,
    );
  });
  await page.waitForTimeout(400);
  const mage = await page.evaluate(
    () =>
      (window as unknown as { __mlDebug?: { projectCityBase(id: string): { x: number; y: number } | null } }).__mlDebug
        ?.projectCityBase("m1"),
  );
  if (!mage) throw new Error("m1 has no screen position");
  await page.mouse.click(mage.x, mage.y);
  await expect(page.locator("#city-trait")).toContainText("射程 9.0 米");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 balance.json" }).click();
  const download = await downloadPromise;
  const file = await download.path();
  if (!file) throw new Error("balance.json download has no path");
  const exported = JSON.parse(readFileSync(file, "utf8")) as {
    rules: { speedDmPerSecond: number; mageTower: { rangeCm: number } };
    units: { mage: { attackRangeCm: number } };
  };
  expect(exported.rules.speedDmPerSecond).toBe(36);
  expect(exported.rules.mageTower.rangeCm).toBe(900);
  expect(exported.units.mage.attackRangeCm).toBe(460);

  await page.getByRole("button", { name: "重置为开局值" }).click();
  await expect(range).toHaveValue("7");
  await expect(page.locator("#city-trait")).toContainText("射程 7.0 米");
});
