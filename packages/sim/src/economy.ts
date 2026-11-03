import { levelRule } from "./rules";
import { isProductionSiteKind } from "./types";
import type { CityState, LevelRule, PlayerState, Ruleset } from "./types";

export function growCity(city: CityState, rule: LevelRule): void {
  if (!isProductionSiteKind(city.kind)) {
    city.growthCarry = 0;
    return;
  }
  if (city.pop >= city.maxPop) {
    city.growthCarry = 0;
    return;
  }
  const carry = city.growthCarry + rule.growthMilli;
  const gain = Math.floor(carry / 1000);
  city.growthCarry = carry - gain * 1000;
  city.pop = Math.min(city.maxPop, city.pop + gain);
  if (city.pop >= city.maxPop) city.growthCarry = 0;
}

export function growGold(player: PlayerState, milli: number): void {
  const carry = player.goldCarry + milli;
  const gain = Math.floor(carry / 1000);
  player.goldCarry = carry - gain * 1000;
  player.gold += gain;
}

export function applyUpgrade(city: CityState, rules: Ruleset): boolean {
  if (!isProductionSiteKind(city.kind)) return false;
  if (city.level >= rules.maxLevel) return false;
  const cost = levelRule(rules, city.level).upgradeCost;
  if (city.pop < cost) return false;
  city.pop -= cost;
  city.level = (city.level + 1) as CityState["level"];
  city.maxPop = levelRule(rules, city.level).maxPop;
  if (city.pop > city.maxPop) city.pop = city.maxPop;
  return true;
}
