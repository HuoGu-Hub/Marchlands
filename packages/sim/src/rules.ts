import { isProductionSiteKind } from "./types";
import type { CityState, LevelRule, Ruleset } from "./types";

export const DEFAULT_RULESET: Ruleset = {
  ruleset: "1",
  tickHz: 20,
  maxTicks: 18000,
  sendRatio: 0.5,
  speedDmPerSecond: 36,
  maxLevel: 3,
  levels: [
    { level: 1, maxPop: 30, upgradeCost: 15, defense: 1.0, growthMilli: 50, goldMilli: 100 },
    { level: 2, maxPop: 45, upgradeCost: 22, defense: 1.1, growthMilli: 62, goldMilli: 125 },
    { level: 3, maxPop: 65, upgradeCost: 32, defense: 1.2, growthMilli: 75, goldMilli: 150 },
  ],
  granary: {
    capacity: 50,
    defenseMilli: 1300,
    speedBonusMilli: 200,
    strengthBonusMilli: 200,
  },
  outpost: {
    capacity: 50,
    defenseMilli: 800,
    graceTicks: 600,
    decayIntervalTicks: 200,
    decayPerInterval: 2,
  },
  supply: {
    carryTicks: 600,
    starveIntervalTicks: 200,
    starveLoss: 1,
  },
};

export function levelRule(rules: Ruleset, level: number): LevelRule {
  const found = rules.levels.find((entry) => entry.level === level);
  if (!found) throw new Error(`missing level rule: ${level}`);
  return found;
}

export function sendPercent(rules: Ruleset): number {
  return Math.round(rules.sendRatio * 100);
}

/**
 * 能否从该据点派兵。产兵据点仍要至少 2 人；
 * 粮仓与驻兵点靠外部增援获得驻军，有 1 人就能把驻军派出去。
 */
export function canDispatchFrom(city: CityState): boolean {
  if (city.owner === 0) return false;
  return city.pop >= (isProductionSiteKind(city.kind) ? 2 : 1);
}

export function speedPerTick(rules: Ruleset): number {
  return rules.speedDmPerSecond / rules.tickHz;
}

export function granarySpeedMilli(rules: Ruleset, hasGranary: boolean): number {
  return 1000 + (hasGranary ? rules.granary.speedBonusMilli : 0);
}

export function granaryStrengthMilli(rules: Ruleset, hasGranary: boolean): number {
  return 1000 + (hasGranary ? rules.granary.strengthBonusMilli : 0);
}

export function travelTicks(distance: number, rules: Ruleset, speedMilli: number): number {
  return Math.max(
    1,
    Math.ceil((distance * rules.tickHz * 1000) / (rules.speedDmPerSecond * Math.max(1, speedMilli))),
  );
}

export function arrivalTicks(distance: number, rules: Ruleset): number {
  return travelTicks(distance, rules, 1000);
}
