import type { UnitKind } from "./unit-models";
import { UNIT_TRAITS, sameTraits } from "./unit-traits";
import type { UnitTraits } from "./unit-traits";

export type UnitSkinKind = UnitKind;

export interface UnitSkinDef {
  key: string;
  label: string;
  /** 绑定兵种的皮肤；通用皮肤不绑定。 */
  kind?: UnitSkinKind;
  /**
   * 皮肤声明的通行属性。装了它的兵种必须属性完全一致；
   * 不声明表示历史资产，未做限制。
   */
  traits?: UnitTraits;
}

/** 角色皮肤：属性写死，只能装到对应属性的兵种上。 */
export const CLASSIC_UNIT_SKINS: UnitSkinDef[] = [
  {
    key: "kaykit-barbarian",
    label: "野蛮人",
    kind: "barbarian",
    traits: { river: true, flying: false, ranged: false },
  },
  {
    key: "kaykit-knight",
    label: "骑士",
    kind: "warrior",
    traits: { river: false, flying: false, ranged: false },
  },
  {
    key: "kaykit-rogue-hooded",
    label: "弓箭手",
    kind: "archer",
    traits: { river: true, flying: false, ranged: true },
  },
  {
    key: "kaykit-rogue",
    label: "游侠",
    kind: "ranger",
    traits: { river: true, flying: false, ranged: false },
  },
  {
    key: "kaykit-mage",
    label: "法师",
    kind: "mage",
    traits: { river: true, flying: true, ranged: true },
  },
];

export const ALL_UNIT_SKINS: UnitSkinDef[] = [...CLASSIC_UNIT_SKINS];

export function unitSkinAssetId(key: string): string {
  return `builtin:unit.${key}`;
}

export function unitSkinByKey(key: string | undefined): UnitSkinDef | null {
  if (!key) return null;
  return ALL_UNIT_SKINS.find((skin) => skin.key === key) ?? null;
}

/** 皮肤能否装到这个兵种：未声明属性的一律放行，声明了就必须完全一致。 */
export function skinFitsKind(skin: UnitSkinDef, kind: UnitSkinKind): boolean {
  if (skin.kind && skin.kind !== kind) return false;
  if (!skin.traits) return true;
  return sameTraits(skin.traits, UNIT_TRAITS[kind]);
}

/** 当前兵种可选的皮肤。 */
export function skinsForKind(kind: UnitSkinKind): UnitSkinDef[] {
  return ALL_UNIT_SKINS.filter((skin) => skinFitsKind(skin, kind));
}
