import { describe, expect, it } from "vitest";
import { MapGraph } from "../src/path";
import { SQUARE_MAP } from "./fixtures";

describe("MapGraph", () => {
  it("finds the shortest route", () => {
    const graph = new MapGraph(SQUARE_MAP);
    const route = graph.route("a", "d");
    expect(route?.distance).toBe(200);
    expect(route?.path).toEqual(["a", "b", "d"]);
  });

  it("breaks equal-length ties by city id", () => {
    const graph = new MapGraph(SQUARE_MAP);
    expect(graph.route("a", "d")?.path.join("")).toBe("abd");
  });

  it("prefers flatter routes and charges grade cost", () => {
    const map = {
      ...SQUARE_MAP,
      edges: [
        { from: "a" as const, to: "b" as const, length: 100 },
        { from: "b" as const, to: "d" as const, length: 100 },
        { from: "a" as const, to: "c" as const, length: 100, grade: 0.8 },
        { from: "c" as const, to: "d" as const, length: 100, grade: 0.8 },
      ],
    };
    const graph = new MapGraph(map);
    expect(graph.route("a", "d")?.path).toEqual(["a", "b", "d"]);
    expect(graph.route("a", "d")?.distance).toBe(200);
    expect(graph.edgeCost("a", "c")).toBe(340);
  });

  it("returns null for disconnected nodes", () => {
    const map = {
      ...SQUARE_MAP,
      edges: [{ from: "a" as const, to: "b" as const, length: 100 }],
    };
    const graph = new MapGraph(map);
    expect(graph.route("a", "d")).toBeNull();
  });

  it("keeps routes stable across repeated queries", () => {
    const graph = new MapGraph(SQUARE_MAP);
    const first = graph.route("a", "d");
    const second = graph.route("a", "d");
    expect(second).toBe(first);
  });
});