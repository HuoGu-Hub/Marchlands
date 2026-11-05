import type { UnitKind } from "./unit-models";

/**
 * 兵种的通行属性。皮肤必须声明同样的属性才能套用，
 * 避免一个会飞的法师皮肤被装在重甲兵身上。
 */
export interface UnitTraits {
  /** 可渡河。 */
  river: boolean;
  /** 可腾空飞翔。 */
  flying: boolean;
  /** 远程单位。 */
  ranged: boolean;
}

export const TRAIT_FIELDS = ["river", "flying", "ranged"] as const;

export const TRAIT_LABELS: Record<keyof UnitTraits, string> = {
  river: "可渡河",
  flying: "可腾空",
  ranged: "远程",
};

/** 兵种属性表，皮肤导入时按这张表校验。 */
export const UNIT_TRAITS: Record<UnitKind, UnitTraits> = {
  infantry: { river: true, flying: false, ranged: false },
  shield: { river: false, flying: false, ranged: false },
  cavalry: { river: true, flying: false, ranged: false },
  archer: { river: true, flying: false, ranged: true },
  elite: { river: true, flying: true, ranged: true },
};

export function sameTraits(a: UnitTraits, b: UnitTraits): boolean {
  return a.river === b.river && a.flying === b.flying && a.ranged === b.ranged;
}

/** 把属性拆成短标签，用于皮肤卡片和提示。 */
export function traitTags(traits: UnitTraits): string[] {
  return TRAIT_FIELDS.filter((field) => traits[field]).map((field) => TRAIT_LABELS[field]);
}

/** 校验外部传入的属性对象，缺字段或类型不对返回 null。 */
export function parseTraits(value: unknown): UnitTraits | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const read = (key: string): boolean | null =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : null;
  const river = read("river");
  const flying = read("flying");
  const ranged = read("ranged");
  if (river === null || flying === null || ranged === null) return null;
  return { river, flying, ranged };
}
