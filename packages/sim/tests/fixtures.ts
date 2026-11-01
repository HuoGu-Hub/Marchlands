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
    { id: "a", kind: "town", owner: 1, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "town", owner: 0, level: 1, pop: 5, pos: [0, 0], layer: 0 },
    { id: "c", kind: "town", owner: 2, level: 1, pop: 10, pos: [100, 0], layer: 0 },
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
    { id: "a", kind: "town", owner: 1, level: 3, pop: 30, pos: [-100, 0], layer: 0 },
    { id: "b", kind: "town", owner: 2, level: 1, pop: 10, pos: [100, 0], layer: 0 },
  ],
  edges: [{ from: "a", to: "b", length: 200 }],
};

export const SQUARE_MAP: MapDef = {
  ...THREE_CITY_MAP,
  slug: "square",
  cities: [
    { id: "a", kind: "town", owner: 1, level: 1, pop: 10, pos: [-100, -100], layer: 0 },
    { id: "b", kind: "town", owner: 0, level: 1, pop: 5, pos: [100, -100], layer: 0 },
    { id: "c", kind: "town", owner: 0, level: 1, pop: 5, pos: [-100, 100], layer: 0 },
    { id: "d", kind: "town", owner: 2, level: 1, pop: 10, pos: [100, 100], layer: 0 },
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
    { id: "a", kind: "town", owner: 1, level: 3, pop: 30, pos: [-250, 0], layer: 0 },
    { id: "b", kind: "town", owner: 0, level: 1, pop: 10, pos: [-100, 0], layer: 0 },
    { id: "c", kind: "town", owner: 0, level: 2, pop: 20, pos: [0, 0], layer: 0 },
    { id: "d", kind: "town", owner: 0, level: 1, pop: 10, pos: [100, 0], layer: 0 },
    { id: "e", kind: "town", owner: 2, level: 3, pop: 30, pos: [250, 0], layer: 0 },
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
