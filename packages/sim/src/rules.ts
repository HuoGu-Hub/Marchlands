import type { LevelRule, Ruleset } from "./types";

export const DEFAULT_RULESET: Ruleset = {
  ruleset: "1",
  tickHz: 20,
  maxTicks: 18000,
  sendRatio: 0.5,
  speedDmPerSecond: 60,
  maxLevel: 3,
  levels: [
    { level: 1, maxPop: 30, upgradeCost: 15, defense: 1.0, growthMilli: 50, goldMilli: 100 },
    { level: 2, maxPop: 45, upgradeCost: 22, defense: 1.1, growthMilli: 62, goldMilli: 125 },
    { level: 3, maxPop: 65, upgradeCost: 32, defense: 1.2, growthMilli: 75, goldMilli: 150 },
  ],
};

export function levelRule(rules: Ruleset, level: number): LevelRule {
  const found = rules.levels.find((entry) => entry.level === level);
  if (!found) throw new Error(`missing level rule: ${level}`);
  return found;
}

export function sendPercent(rules: Ruleset): number {
  return Math.round(rules.sendRatio * 100);
}

export function speedPerTick(rules: Ruleset): number {
  return rules.speedDmPerSecond / rules.tickHz;
}

export function arrivalTicks(distance: number, rules: Ruleset): number {
  return Math.max(1, Math.ceil((distance * rules.tickHz) / rules.speedDmPerSecond));
}
