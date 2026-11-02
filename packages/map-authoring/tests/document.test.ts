import { describe, expect, it } from "vitest";
import { validateMap } from "@marchlands/content";
import { createGame } from "@marchlands/sim";
import { decodeBitmapBase64, encodeBitmapBase64 } from "@marchlands/nav";
import {
  addProp,
  addSite,
  compileDocument,
  connect,
  convertToGrid,
  createGridDocument,
  createStarterDocument,
  disconnect,
  gridCellAt,
  fromMapDef,
  moveProp,
  moveSite,
  parseDocument,
  removeProp,
  removeSite,
  serializeDocument,
  updateProp,
  updateSite,
  updateTerrain,
  updateUnitVisual,
} from "../src";

describe("map authoring", () => {
  it("compiles a valid starter document with a visual layer", () => {
    const result = compileDocument(createStarterDocument());
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toHaveLength(0);
    expect(result.map.cities).toHaveLength(4);
    expect(result.map.edges).toHaveLength(4);
    expect(result.map.edges.find((edge) => edge.from === "c1" && edge.to === "c4")?.length).toBe(400);
    expect(result.visual.props.length).toBeGreaterThan(40);
    expect(result.visual.terrain.style).toBe("frontier");
    expect(() => validateMap(result.map)).not.toThrow();
  });

  it("does not add roads when placing a site", () => {
    const starter = createStarterDocument();
    const result = addSite(starter, "town", [0, 0]);
    expect(result.document.sites).toHaveLength(starter.sites.length + 1);
    expect(result.document.roads).toEqual(starter.roads);
  });

  it("adds sites and recomputes road length after moving one", () => {
    const starter = createStarterDocument();
    const added = addSite(starter, "town", [0, 0]);
    const withRoad = connect(added.document, "c1", added.site.id);
    const before = compileDocument(withRoad);
    const c1c3 = before.map.edges.find((edge) => edge.from === "c1" && edge.to === added.site.id);
    expect(c1c3?.length).toBe(Math.round(Math.hypot(200, 150)));
    const moved = moveSite(withRoad, added.site.id, [0, 120]);
    const after = compileDocument(moved);
    const movedEdge = after.map.edges.find((edge) => edge.from === "c1" && edge.to === added.site.id);
    expect(movedEdge?.length).toBe(Math.round(Math.hypot(200, 270)));
  });

  it("turns a connected outpost into a watched leaf by default", () => {
    const starter = createStarterDocument();
    const added = addSite(starter, "outpost", [0, 0]);
    const connected = connect(added.document, "c1", "o1");
    const outpost = connected.sites.find((site) => site.id === "o1");
    expect(outpost?.watch).toEqual(["c1", "c4"]);
    const result = compileDocument(connected);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toHaveLength(0);
  });

  it("reports a second road on a special site as an error", () => {
    const starter = createStarterDocument();
    const added = addSite(starter, "granary", [0, 0]);
    const one = connect(added.document, "c1", "g1");
    const two = connect(one, "g1", "c2");
    const result = compileDocument(two);
    expect(result.diagnostics.some((entry) => entry.code === "leaf-site")).toBe(true);
  });

  it("cleans up roads and watches when a site is removed", () => {
    const starter = createStarterDocument();
    const added = addSite(starter, "outpost", [0, 0]);
    const connected = connect(added.document, "c1", "o1");
    const removed = removeSite(connected, "c1");
    expect(removed.roads.some((road) => road.from === "c1" || road.to === "c1" || road.from === "o1" || road.to === "o1")).toBe(false);
    expect(removed.sites.find((site) => site.id === "o1")?.watch).toBeUndefined();
  });

  it("normalizes special sites when kind changes", () => {
    const starter = createStarterDocument();
    const changed = updateSite(starter, "c1", { kind: "outpost" });
    const site = changed.sites.find((entry) => entry.id === "c1");
    expect(site?.level).toBe(1);
    expect(site?.pop).toBe(0);
    expect(site?.stance).toBe("evade");
  });

  it("disconnects a watch when its road is removed", () => {
    const starter = createStarterDocument();
    const added = addSite(starter, "outpost", [0, 0]);
    const connected = connect(added.document, "c1", "o1");
    const disconnected = disconnect(connected, "c1", "o1");
    expect(disconnected.sites.find((site) => site.id === "o1")?.watch).toBeUndefined();
  });

  it("round-trips a document and imports a MapDef", () => {
    const starter = createStarterDocument();
    const parsed = parseDocument(JSON.parse(serializeDocument(starter)));
    expect(parsed.document).toEqual(starter);
    const map = compileDocument(starter).map;
    const imported = fromMapDef(map);
    expect(imported.sites).toEqual(starter.sites);
    expect(imported.roads).toEqual(starter.roads);
    expect(imported.visual.props).toEqual([]);
    expect(parseDocument(JSON.parse(JSON.stringify(map))).document.schema).toBe(3);
  });

  it("upgrades a schema 1 document with default visual settings", () => {
    const legacy = { ...createStarterDocument(), schema: 1 } as Record<string, unknown>;
    delete legacy.visual;
    const parsed = parseDocument(legacy);
    expect(parsed.document.schema).toBe(3);
    expect(parsed.document.visual.props).toEqual([]);
    expect(parsed.document.visual.terrain.style).toBe("frontier");
  });

  it("adds, updates, moves and removes visual props", () => {
    const starter = createStarterDocument();
    const added = addProp(starter, "builtin:prop.tree_oak", [0, 0], 15, 1.4);
    expect(added.prop.id).toMatch(/^p\d+$/);
    const propId = added.prop.id;
    expect(added.document.visual.props.some((prop) => prop.id === propId)).toBe(true);
    const moved = moveProp(added.document, propId, [12, -8]);
    expect(moved.visual.props.find((prop) => prop.id === propId)?.pos).toEqual([12, -8]);
    const updated = updateProp(moved, propId, { rotation: 370, scale: 2 });
    expect(updated.visual.props.find((prop) => prop.id === propId)?.rotation).toBe(10);
    const removed = removeProp(updated, propId);
    expect(removed.visual.props.some((prop) => prop.id === propId)).toBe(false);
  });

  it("stores unit visuals and round-trips them", () => {
    const starter = createStarterDocument();
    const next = updateUnitVisual(starter, "player1", "com.example:unit");
    expect(next.visual.units.player1).toBe("com.example:unit");
    const parsed = parseDocument(JSON.parse(serializeDocument(next)));
    expect(parsed.document.visual.units.player1).toBe("com.example:unit");
    expect(compileDocument(next).visual.units.player1).toBe("com.example:unit");
    const bad = updateUnitVisual(next, "player2", "not-an-asset");
    expect(() => parseDocument(JSON.parse(serializeDocument(bad)))).toThrow();
  });

  it("updates terrain settings and recomputes edge grades", () => {
    const starter = createStarterDocument();
    const next = updateTerrain(starter, { style: "autumn", amplitude: 1.2 });
    expect(next.visual.terrain.style).toBe("autumn");
    const before = compileDocument(starter).map;
    const after = compileDocument(next).map;
    expect(after.cities).toEqual(before.cities);
    expect(after.edges.map((edge) => edge.length)).toEqual(before.edges.map((edge) => edge.length));
    expect(after.edges.some((edge) => edge.grade !== undefined)).toBe(true);
    expect(after.edges.map((edge) => edge.grade)).not.toEqual(before.edges.map((edge) => edge.grade));
  });

  it("reports props outside the map bounds", () => {
    const starter = createStarterDocument();
    starter.visual.props.push({
      id: "bad",
      assetId: "builtin:prop.tree_oak",
      pos: [99999, 0],
      rotation: 0,
      scale: 1,
    });
    const result = compileDocument(starter);
    expect(result.diagnostics.some((entry) => entry.code === "prop-outside")).toBe(true);
  });

  it("rejects malformed site and prop entries instead of silently dropping them", () => {
    const malformed = { ...createStarterDocument(), sites: [{ id: "broken" }] };
    expect(() => parseDocument(malformed)).toThrow();
    const badProp = createStarterDocument();
    badProp.visual.props = [{ id: "p1", assetId: "not-a-namespace", pos: [0, 0], rotation: 0, scale: 1 }];
    expect(() => parseDocument(JSON.parse(serializeDocument(badProp)))).toThrow();
  });

  it("reports disconnected and insufficient-town documents", () => {
    const starter = createStarterDocument();
    const oneTown = { ...starter, sites: starter.sites.filter((site) => site.id === "c2"), roads: [] };
    const oneResult = compileDocument(oneTown);
    expect(oneResult.diagnostics.some((entry) => entry.code === "town-count")).toBe(true);
    const disconnected = { ...starter, roads: [] };
    const disconnectedResult = compileDocument(disconnected);
    expect(disconnectedResult.diagnostics.some((entry) => entry.code === "disconnected")).toBe(true);
  });

  it("compiles a grid document with packed heights, footprints and a map hash", () => {
    const document = createGridDocument();
    const result = compileDocument(document);
    expect(result.diagnostics.filter((entry) => entry.severity === "error")).toEqual([]);
    expect(result.map.schema).toBe(2);
    expect(result.map.navigation).toBe("grid");
    expect(result.map.grid?.cellSizeCm).toBe(100);
    expect(result.map.grid?.width).toBe(70);
    expect(result.map.grid?.height).toBe(70);
    expect(result.map.cities[0].footprintCm).toBe(800);
    expect(result.map.cities[0].captureRadiusCm).toBe(400);
    expect(result.map.mapHash).toMatch(/^[0-9a-f]{16}$/);
    expect(() => validateMap(result.map)).not.toThrow();
    const state = createGame(result.map, 1);
    expect(state.map.navigation).toBe("grid");
    expect(state.cities).toHaveLength(4);
    expect(state.squads).toHaveLength(0);
  });

  it("round-trips a grid document through JSON and MapDef", () => {
    const document = createGridDocument();
    document.grid!.heightCm[0] = 125;
    document.grid!.surface[0] = 3;
    const parsed = parseDocument(JSON.parse(serializeDocument(document)));
    expect(parsed.document.navigation).toBe("grid");
    expect(parsed.document.grid).toEqual(document.grid);
    const compiled = compileDocument(parsed.document);
    const imported = fromMapDef(compiled.map);
    expect(imported.navigation).toBe("grid");
    expect(imported.grid?.heightCm[0]).toBe(125);
    expect(imported.grid?.surface[0]).toBe(3);
  });

  it("upgrades a schema 2 document to graph navigation", () => {
    const legacy = { ...createStarterDocument(), schema: 2 } as Record<string, unknown>;
    delete legacy.grid;
    delete legacy.navigation;
    delete legacy.vision;
    const parsed = parseDocument(legacy);
    expect(parsed.document.schema).toBe(3);
    expect(parsed.document.navigation).toBe("graph");
    expect(parsed.document.grid).toBeUndefined();
    expect(parsed.document.vision).toEqual({ enabled: false });
  });

  it("changes the map hash when baked heights change", () => {
    const document = createGridDocument();
    const first = compileDocument(document).map.mapHash;
    document.grid!.heightCm[10] += 30;
    const second = compileDocument(document).map.mapHash;
    expect(second).not.toBe(first);
  });

  it("converts a graph document to a flat grid and keeps sites and roads", () => {
    const starter = createStarterDocument();
    const converted = convertToGrid(starter);
    expect(converted.navigation).toBe("grid");
    expect(converted.grid?.width).toBe(70);
    expect(converted.grid?.heightCm.every((value) => value === 0)).toBe(true);
    expect(converted.sites.map((site) => site.id)).toEqual(starter.sites.map((site) => site.id));
    expect(converted.roads).toEqual(starter.roads);
    expect(converted.sites.every((site) => site.footprintDm === 80)).toBe(true);
    expect(converted.sites.every((site) => site.captureRadiusDm === 40)).toBe(true);
  });

  it("reports grid sizes that do not match the map", () => {
    const document = createGridDocument();
    document.grid!.width = 69;
    const result = compileDocument(document);
    expect(
      result.diagnostics.some((entry) => entry.code === "grid" && entry.message.includes("网格宽度")),
    ).toBe(true);
  });

  it("reports a blocked grid town", () => {
    const document = createGridDocument();
    const grid = document.grid;
    if (!grid) throw new Error("missing grid");
    const cell = gridCellAt(grid, document.size, document.sites[0].pos);
    if (!cell) throw new Error("missing cell");
    const flags = decodeBitmapBase64(grid.blocked, grid.width * grid.height);
    flags[cell[1] * grid.width + cell[0]] = 1;
    grid.blocked = encodeBitmapBase64(flags);
    const result = compileDocument(document);
    expect(
      result.diagnostics.some((entry) => entry.code === "grid-nav" && entry.message.includes("不可走")),
    ).toBe(true);
  });

  it("reports grid towns split by a wall", () => {
    const document = createGridDocument();
    const grid = document.grid;
    if (!grid) throw new Error("missing grid");
    const flags = decodeBitmapBase64(grid.blocked, grid.width * grid.height);
    for (let z = 0; z < grid.height; z += 1) flags[z * grid.width + 35] = 1;
    grid.blocked = encodeBitmapBase64(flags);
    const result = compileDocument(document);
    expect(
      result.diagnostics.some((entry) => entry.code === "grid-nav" && entry.message.includes("无法到达")),
    ).toBe(true);
  });

  it("reports a grid map without grid data", () => {
    const document = createGridDocument();
    delete document.grid;
    const result = compileDocument(document);
    expect(result.diagnostics.some((entry) => entry.code === "grid")).toBe(true);
  });
});