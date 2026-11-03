import type { MapDef, Ruleset } from "../src/types";
import { DEFAULT_RULESET } from "../src/rules";

const players: MapDef["players"] = [
  { id: 1, name: "P1", color: "green", ai: false },
  { id: 2, name: "P2", color: "red", ai: true },
];

export const THREE_CITY_MAP: MapDef = {
  schema: 1,
  slug: "three",
  name: "Three",
  biome: "test",
  size: [400, 400],
  scale: 0.1,
  ruleset: "1",
  players,
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [0, 0], layer: 0 },
    { id: "c", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [100, 0], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 100 },
    { from: "b", to: "c", length: 100 },
  ],
  objectives: [{ type: "capture_all" }],
};

export const TWO_CITY_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "two",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 3, pop: 30, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [100, 0], layer: 0 },
  ],
  edges: [{ from: "a", to: "b", length: 200 }],
};

export const SQUARE_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "square",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 10, pos: [-100, -100], layer: 0 },
    { id: "b", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [100, -100], layer: 0 },
    { id: "c", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [-100, 100], layer: 0 },
    { id: "d", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [100, 100], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 100 },
    { from: "a", to: "c", length: 100 },
    { from: "b", to: "d", length: 100 },
    { from: "c", to: "d", length: 100 },
  ],
};

export const AI_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "ai",
  size: [600, 600],
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 3, pop: 30, pos: [-250, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 0, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "c", kind: "barracks", owner: 0, level: 2, pop: 20, pos: [0, 0], layer: 0 },
    { id: "d", kind: "barracks", owner: 0, level: 1, pop: 10, pos: [100, 0], layer: 0 },
    { id: "e", kind: "barracks", owner: 2, level: 3, pop: 30, pos: [250, 0], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 150 },
    { from: "b", to: "c", length: 100 },
    { from: "c", to: "d", length: 100 },
    { from: "d", to: "e", length: 150 },
    { from: "a", to: "c", length: 260 },
    { from: "c", to: "e", length: 260 },
  ],
};

export function rulesWith(overrides: Partial<Ruleset>): Ruleset {
  return { ...DEFAULT_RULESET, ...overrides };
}

/**
 * 场景测试固定行军速度为 60dm/s。
 * 这些用例按固定 tick 编排时序，与平衡调参解耦，避免调整 speedDmPerSecond 后成批断言失效。
 */
export const TIMED_RULES: Ruleset = rulesWith({ speedDmPerSecond: 60 });

export const OUTPOST_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "outpost",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-150, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 5, pos: [0, 0], layer: 0 },
    { id: "c", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [150, 0], layer: 0 },
    {
      id: "o1",
      kind: "outpost",
      owner: 2,
      level: 1,
      pop: 10,
      pos: [0, 100],
      layer: 0,
      stance: "engage",
      watch: ["a", "b"],
    },
  ],
  edges: [
    { from: "a", to: "b", length: 150 },
    { from: "b", to: "c", length: 150 },
    { from: "b", to: "o1", length: 100 },
  ],
};

export const GRANARY_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "granary",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-150, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 5, pos: [50, 0], layer: 0 },
    { id: "g1", kind: "granary", owner: 1, level: 1, pop: 0, pos: [-150, 100], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 200 },
    { from: "a", to: "g1", length: 100 },
  ],
};

export const GRANARY_DEFENSE_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "granary-defense",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-150, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [50, 0], layer: 0 },
    { id: "g1", kind: "granary", owner: 2, level: 1, pop: 0, pos: [50, 100], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 200 },
    { from: "b", to: "g1", length: 100 },
  ],
};

export const DECAY_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "decay",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-150, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 5, pos: [150, 0], layer: 0 },
    {
      id: "o1",
      kind: "outpost",
      owner: 1,
      level: 1,
      pop: 5,
      pos: [0, 100],
      layer: 0,
      stance: "engage",
      watch: ["a", "b"],
    },
  ],
  edges: [
    { from: "a", to: "b", length: 300 },
    { from: "a", to: "o1", length: 180 },
  ],
};

export const VICTORY_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "victory",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 5, pos: [100, 0], layer: 0 },
    { id: "c", kind: "barracks", owner: 0, level: 1, pop: 0, pos: [0, 200], layer: 0 },
    { id: "g1", kind: "granary", owner: 2, level: 1, pop: 0, pos: [100, 100], layer: 0 },
    {
      id: "o1",
      kind: "outpost",
      owner: 2,
      level: 1,
      pop: 0,
      pos: [100, -100],
      layer: 0,
      stance: "evade",
      watch: ["a", "b"],
    },
  ],
  edges: [
    { from: "a", to: "b", length: 200 },
    { from: "a", to: "c", length: 224 },
    { from: "b", to: "c", length: 224 },
    { from: "b", to: "g1", length: 100 },
    { from: "b", to: "o1", length: 100 },
  ],
};

export const AI_OUTPOST_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "ai-outpost",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 2, level: 1, pop: 10, pos: [100, 0], layer: 0 },
    {
      id: "o1",
      kind: "outpost",
      owner: 2,
      level: 1,
      pop: 5,
      pos: [100, 100],
      layer: 0,
      stance: "evade",
      watch: ["a", "b"],
    },
  ],
  edges: [
    { from: "a", to: "b", length: 200 },
    { from: "b", to: "o1", length: 100 },
  ],
};

export const JUNCTION_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "junction",
  cities: [
    { id: "a", kind: "barracks", owner: 1, level: 1, pop: 20, pos: [-200, 0], layer: 0 },
    { id: "b", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [0, 100], layer: 0 },
    { id: "c", kind: "barracks", owner: 0, level: 1, pop: 5, pos: [0, -100], layer: 0 },
    { id: "d", kind: "barracks", owner: 2, level: 1, pop: 5, pos: [200, 0], layer: 0 },
  ],
  edges: [
    { from: "a", to: "b", length: 224 },
    { from: "a", to: "c", length: 224 },
    { from: "b", to: "c", length: 200 },
    { from: "b", to: "d", length: 224 },
    { from: "c", to: "d", length: 224 },
  ],
};
