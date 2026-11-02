import { describe, expect, it } from "vitest";
import { validateMap } from "@marchlands/content";
import {
  addProp,
  addSite,
  compileDocument,
  connect,
  createStarterDocument,
  disconnect,
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
    expect(parseDocument(JSON.parse(JSON.stringify(map))).document.schema).toBe(2);
  });

  it("upgrades a schema 1 document with default visual settings", () => {
    const legacy = { ...createStarterDocument(), schema: 1 } as Record<string, unknown>;
    delete legacy.visual;
    const parsed = parseDocument(legacy);
    expect(parsed.document.schema).toBe(2);
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

  it("updates terrain settings without touching simulation data", () => {
    const starter = createStarterDocument();
    const next = updateTerrain(starter, { style: "autumn", amplitude: 1.2 });
    expect(next.visual.terrain.style).toBe("autumn");
    expect(compileDocument(next).map).toEqual(compileDocument(starter).map);
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
});