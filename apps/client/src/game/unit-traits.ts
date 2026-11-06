import { UNIT_TRAITS as SIM_UNIT_TRAITS } from "@marchlands/sim";
import type { UnitTraits } from "@marchlands/sim";
import type { UnitKind } from "./unit-models";

export type { UnitTraits };

/**
 * 兵种通行属性。真正的规则在 sim 里，客户端只做展示与皮肤准入，
 * 两边共用 @marchlands/sim 的同一份定义，避免各写一套。
 */
export const UNIT_TRAITS: Record<UnitKind, UnitTraits> = SIM_UNIT_TRAITS;

export const TRAIT_FIELDS = ["river", "flying", "ranged"] as const;

export const TRAIT_LABELS: Record<keyof UnitTraits, string> = {
  river: "可渡河",
  flying: "可腾空",
  ranged: "远程",
};

export function sameTraits(a: UnitTraits, b: UnitTraits): boolean {
  return a.river === b.river && a.flying === b.flying && a.ranged === b.ranged;
}

/** 把属性拆成短标签，用于皮肤卡片和提示。 */
export function traitTags(traits: UnitTraits): string[] {
  return TRAIT_FIELDS.filter((field) => traits[field]).map((field) => TRAIT_LABELS[field]);
}

