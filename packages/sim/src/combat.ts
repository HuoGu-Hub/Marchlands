import { levelRule } from "./rules";
import type { CityState, PlayerId, Ruleset } from "./types";

export interface CombatOutcome {
  captured: boolean;
  attackerLoss: number;
  defenderLoss: number;
}

export function defenseValue(city: CityState, rules: Ruleset): number {
  const defense = levelRule(rules, city.level).defense;
  return Math.floor((city.pop * Math.round(defense * 1000)) / 1000);
}

export function resolveAttack(
  city: CityState,
  attacker: PlayerId,
  troops: number,
  rules: Ruleset,
): CombatOutcome {
  const popBefore = city.pop;
  const defense = defenseValue(city, rules);
  city.growthCarry = 0;

  if (troops > defense) {
    const survivors = troops - defense;
    city.owner = attacker;
    city.pop = Math.min(survivors, city.maxPop);
    return { captured: true, attackerLoss: defense, defenderLoss: popBefore };
  }

  const remaining = Math.min(popBefore, Math.max(0, defense - troops));
  city.pop = remaining;
  return { captured: false, attackerLoss: troops, defenderLoss: popBefore - remaining };
}
