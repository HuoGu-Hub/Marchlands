import { describe, expect, it } from "vitest";
import { createGame } from "../src/game";
import { growCity, growGold, applyUpgrade } from "../src/economy";
import { DEFAULT_RULESET } from "../src/rules";
import { THREE_CITY_MAP, TIMED_RULES } from "./fixtures";

function growthCity(): ReturnType<typeof createGame>["cities"][number] {
  const city = createGame(THREE_CITY_MAP, 1, TIMED_RULES).cities[0];
  return {
    ...city,
    kind: "barbarian",
    owner: 1,
    pop: 0,
    maxPop: 30,
    growthCarry: 0,
    growthLockUntil: 0,
    overCapCarry: 0,
  };
}

describe("economy", () => {
  it("grows a player city at 1.2 per second", () => {
    const city = growthCity();
    for (let tick = 0; tick < 16; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(0);
    growCity(city, 16, 20);
    expect(city.pop).toBe(1);
    expect(city.growthCarry).toBe(20);
  });

  it("grows a neutral city at 0.8 per second", () => {
    const city = { ...growthCity(), owner: 0 as const };
    for (let tick = 0; tick < 25; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(1);
    expect(city.growthCarry).toBe(0);
  });

  it("does not grow during the two second attack lock", () => {
    const city = { ...growthCity(), growthLockUntil: 40 };
    for (let tick = 0; tick < 40; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(0);
    for (let tick = 40; tick < 57; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(1);
  });

  it("decays over-cap population at one per second", () => {
    const city = { ...growthCity(), pop: 33 };
    for (let tick = 0; tick < 20; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(32);
    for (let tick = 20; tick < 60; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(30);
  });

  it("slows over-cap decay for shield barracks", () => {
    const city = { ...growthCity(), kind: "warrior" as const, pop: 33 };
    for (let tick = 0; tick < 20; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(33);
  });

  it("stops at max population and drops the carry", () => {
    const city = { ...growthCity(), pop: 29, growthCarry: 900 };
    for (let tick = 0; tick < 40; tick += 1) growCity(city, tick, 20);
    expect(city.pop).toBe(30);
    expect(city.growthCarry).toBe(0);
  });

  it("accumulates gold in milli units", () => {
    const player = { id: 1 as const, gold: 0, goldCarry: 0, losses: 0 };
    for (let tick = 0; tick < 20; tick += 1) growGold(player, 100);
    expect(player.gold).toBe(2);
    expect(player.goldCarry).toBe(0);
  });

  it("upgrades only with enough population", () => {
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
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
    const state = createGame(THREE_CITY_MAP, 1, TIMED_RULES);
    const city = state.cities.find((entry) => entry.id === "a");
    if (!city) throw new Error("missing city");
    city.level = 3;
    city.pop = 65;
    expect(applyUpgrade(city, DEFAULT_RULESET)).toBe(false);
  });
});
