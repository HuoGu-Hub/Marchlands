import balance from "./balance.json";
import { isProductionSiteKind } from "./types";
import type { CityState, LevelRule, Ruleset } from "./types";

/** 唯一数值源；开发面板导出的 balance.json 直接替换这份文件。 */
export const DEFAULT_RULESET: Ruleset = balance.rules as unknown as Ruleset;

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
