import { levelRule } from "./rules";
import { isProductionSiteKind } from "./types";
import type { CityState, PlayerState, Ruleset, SiteKind } from "./types";

/** 每秒基础增长：玩家 1.2，中立 0.8；建筑特性再乘系数。 */
const PLAYER_GROWTH_PER_SECOND = 1.2;
const NEUTRAL_GROWTH_PER_SECOND = 0.8;
const GROWTH_MODIFIER: Record<SiteKind, number> = {
  barbarian: 1,
  warrior: 0.85,
  ranger: 0.9,
  archer: 1.1,
  mage: 0.95,
  cavalry: 0.8,
  granary: 1,
  outpost: 1,
};
/** 部分建筑超编衰减更慢。 */
const DECAY_MODIFIER: Record<SiteKind, number> = {
  barbarian: 1,
  warrior: 0.6,
  ranger: 0.95,
  archer: 1,
  mage: 0.75,
  cavalry: 0.7,
  granary: 1,
  outpost: 1,
};

export function growCity(city: CityState, tick: number, tickHz: number): number {
  if (city.pop > city.maxPop) {
    city.growthCarry = 0;
    city.overCapCarry += (DECAY_MODIFIER[city.kind] * 1000) / tickHz;
    let lost = 0;
    while (city.overCapCarry >= 1000 && city.pop > city.maxPop) {
      city.pop -= 1;
      city.overCapCarry -= 1000;
      lost += 1;
    }
    if (city.pop <= city.maxPop) city.overCapCarry = 0;
    return lost;
  }
  city.overCapCarry = 0;
  if (!isProductionSiteKind(city.kind)) {
    city.growthCarry = 0;
    return 0;
  }
  if (tick < city.growthLockUntil) {
    city.growthCarry = 0;
    return 0;
  }
  if (city.pop >= city.maxPop) {
    city.growthCarry = 0;
    return 0;
  }
  const base = city.owner === 0 ? NEUTRAL_GROWTH_PER_SECOND : PLAYER_GROWTH_PER_SECOND;
  const milliPerTick = (base * GROWTH_MODIFIER[city.kind] * 1000) / tickHz;
  const carry = city.growthCarry + milliPerTick;
  const gain = Math.floor(carry / 1000);
  city.growthCarry = carry - gain * 1000;
  city.pop = Math.min(city.maxPop, city.pop + gain);
  if (city.pop >= city.maxPop) city.growthCarry = 0;
  return 0;
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
