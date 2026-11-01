import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { growCity, growGold, applyUpgrade } from "../src/economy";
import { levelRule } from "../src/rules";
import { DEFAULT_RULESET } from "../src/rules";
import { THREE_CITY_MAP } from "./fixtures";

describe("economy", () => {
  it("grows one pop after twenty level-1 ticks", () => {
    const city = { ...createGame(THREE_CITY_MAP, 1).cities[0], pop: 0, maxPop: 30, growthCarry: 0 };
    const rule = levelRule(DEFAULT_RULESET, 1);
    for (let tick = 0; tick < 20; tick += 1) growCity(city, rule);
    expect(city.pop).toBe(1);
    expect(city.growthCarry).toBe(0);
  });

  it("carries level-2 remainder", () => {
    const city = { ...createGame(THREE_CITY_MAP, 1).cities[0], pop: 0, maxPop: 45, growthCarry: 0 };
    const rule = levelRule(DEFAULT_RULESET, 2);
    for (let tick = 0; tick < 20; tick += 1) growCity(city, rule);
    expect(city.pop).toBe(1);
    expect(city.growthCarry).toBe(240);
  });

  it("stops at max population and drops the carry", () => {
    const city = { ...createGame(THREE_CITY_MAP, 1).cities[0], pop: 29, maxPop: 30, growthCarry: 900 };
    const rule = levelRule(DEFAULT_RULESET, 1);
    for (let tick = 0; tick < 40; tick += 1) growCity(city, rule);
    expect(city.pop).toBe(30);
    expect(city.growthCarry).toBe(0);
  });

  it("accumulates gold in milli units", () => {
    const player = { id: 1 as const, gold: 0, goldCarry: 0 };
    for (let tick = 0; tick < 20; tick += 1) growGold(player, 100);
    expect(player.gold).toBe(2);
    expect(player.goldCarry).toBe(0);
  });

  it("upgrades only with enough population", () => {
    const state = createGame(THREE_CITY_MAP, 1);
    const city = state.cities.find((entry) => entry.id === "a");
    if (!city) throw new Error("missing city");
    city.pop = 14;
    expect(applyUpgrade(city, DEFAULT_RULESET)).toBe(false);
    city.pop = 15;
    expect(applyUpgrade(city, DEFAULT_RULESET)).toBe(true);
    expect(city.level).toBe(2);
    expect(city.pop).toBe(0);
    expect(city.maxPop).toBe(45);
  });

  it("refuses to upgrade past max level", () => {
    const state = createGame(THREE_CITY_MAP, 1);
    const city = state.cities.find((entry) => entry.id === "a");
    if (!city) throw new Error("missing city");
    city.level = 3;
    city.pop = 65;
    expect(applyUpgrade(city, DEFAULT_RULESET)).toBe(false);
  });
});
