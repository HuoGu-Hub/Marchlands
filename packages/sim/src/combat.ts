import { defaultUnitKind, resizeGarrison, setGarrisonKind } from "./garrison";
import { levelRule } from "./rules";
import type { CityState, PlayerId, Ruleset, UnitKind } from "./types";

export interface CombatOutcome {
  captured: boolean;
  attackerLoss: number;
  defenderLoss: number;
}

export interface CombatModifiers {
  attackerStrengthMilli?: number;
  defenderStrengthMilli?: number;
  /** 城破后新驻军按进攻兵种记账；缺省按目标建筑默认兵种。 */
  attackerUnitKind?: UnitKind;
}

export interface FieldOutcome {
  squadCount: number;
  outpostPop: number;
  squadLoss: number;
  outpostLoss: number;
  squadDestroyed: boolean;
  outpostEmptied: boolean;
}

export function defenseMilliFor(city: CityState, rules: Ruleset): number {
  if (city.kind === "granary") return rules.granary.defenseMilli;
  if (city.kind === "outpost") return rules.outpost.defenseMilli;
  return Math.round(levelRule(rules, city.level).defense * 1000);
}

export function defenseValue(city: CityState, rules: Ruleset, strengthMilli = 1000): number {
  const multiplier = Math.max(1, strengthMilli);
  return Math.floor((city.pop * defenseMilliFor(city, rules) * multiplier) / 1_000_000);
}

export function attackValue(troops: number, strengthMilli = 1000): number {
  return Math.floor((troops * Math.max(1, strengthMilli)) / 1000);
}

export function resolveAttack(
  city: CityState,
  attacker: PlayerId,
  troops: number,
  rules: Ruleset,
  modifiers: CombatModifiers = {},
): CombatOutcome {
  const popBefore = city.pop;
  const attackerStrength = Math.max(1, modifiers.attackerStrengthMilli ?? 1000);
  const attack = attackValue(troops, attackerStrength);
  const defense = defenseValue(city, rules, modifiers.defenderStrengthMilli ?? 1000);
  city.growthCarry = 0;

  if (attack > defense) {
    const attackerLoss = Math.min(troops, Math.floor((defense * 1000) / attackerStrength));
    const survivors = troops - attackerLoss;
    city.owner = attacker;
    city.pop = Math.min(survivors, city.maxPop);
    setGarrisonKind(city, modifiers.attackerUnitKind ?? defaultUnitKind(city.kind), city.pop);
    return { captured: true, attackerLoss, defenderLoss: popBefore };
  }

  const remaining = Math.min(popBefore, Math.max(0, defense - attack));
  city.pop = remaining;
  resizeGarrison(city, remaining);
  return { captured: false, attackerLoss: troops, defenderLoss: popBefore - remaining };
}

export function resolveFieldCombat(
  squadCount: number,
  attackerStrengthMilli: number,
  outpost: CityState,
  rules: Ruleset,
  defenderStrengthMilli = 1000,
): FieldOutcome {
  const attackerStrength = Math.max(1, attackerStrengthMilli);
  const attack = attackValue(squadCount, attackerStrength);
  const defense = defenseValue(outpost, rules, defenderStrengthMilli);

  if (attack > defense) {
    const outpostLoss = outpost.pop;
    const squadLoss = Math.min(squadCount, Math.floor((defense * 1000) / attackerStrength));
    const survivors = squadCount - squadLoss;
    outpost.pop = 0;
    resizeGarrison(outpost, 0);
    return {
      squadCount: survivors,
      outpostPop: 0,
      squadLoss,
      outpostLoss,
      squadDestroyed: survivors <= 0,
      outpostEmptied: true,
    };
  }

  const remaining = Math.min(outpost.pop, Math.max(0, defense - attack));
  const outpostLoss = outpost.pop - remaining;
  outpost.pop = remaining;
  resizeGarrison(outpost, remaining);
  return {
    squadCount: 0,
    outpostPop: remaining,
    squadLoss: squadCount,
    outpostLoss,
    squadDestroyed: true,
    outpostEmptied: remaining <= 0,
  };
}
