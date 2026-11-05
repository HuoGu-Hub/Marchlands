import type { UnitKind } from "./unit-models";
import { UNIT_TRAITS, sameTraits } from "./unit-traits";
import type { UnitTraits } from "./unit-traits";

export type UnitSkinKind = UnitKind;

export interface UnitSkinDef {
  key: string;
  label: string;
  family: "classic" | "sprite";
  /** 绑定兵种的皮肤；通用皮肤不绑定。 */
  kind?: UnitSkinKind;
  /**
   * 皮肤声明的通行属性。装了它的兵种必须属性完全一致；
   * 不声明表示历史资产，未做限制。
   */
  traits?: UnitTraits;
}

/** 冒险家角色皮肤：属性写死，只能装到对应属性的兵种上。 */
export const CLASSIC_UNIT_SKINS: UnitSkinDef[] = [
  {
    key: "kaykit-barbarian",
    label: "冒险家 · 野蛮人",
    family: "classic",
    traits: { river: true, flying: false, ranged: false },
  },
  {
    key: "kaykit-knight",
    label: "冒险家 · 骑士",
    family: "classic",
    traits: { river: false, flying: false, ranged: false },
  },
  {
    key: "kaykit-rogue-hooded",
    label: "冒险家 · 兜帽游侠",
    family: "classic",
    traits: { river: true, flying: false, ranged: true },
  },
  {
    key: "kaykit-rogue",
    label: "冒险家 · 游侠",
    family: "classic",
    traits: { river: true, flying: false, ranged: false },
  },
  {
    key: "kaykit-mage",
    label: "冒险家 · 法师",
    family: "classic",
    traits: { river: true, flying: true, ranged: true },
  },
  { key: "warrior", label: "剑士", family: "classic", traits: { river: false, flying: false, ranged: false } },
  { key: "cleric", label: "祭司", family: "classic", traits: { river: true, flying: false, ranged: true } },
  { key: "monk", label: "武僧", family: "classic", traits: { river: true, flying: false, ranged: false } },
  { key: "rogue", label: "游侠", family: "classic", traits: { river: true, flying: false, ranged: false } },
];

/** 八方向序列帧皮肤。不注册为 GLB 资产，由场景直接构造 SpriteUnitActor。 */
export const SPRITE_UNIT_SKINS: UnitSkinDef[] = [
  { key: "sprite-ranger", label: "游侠 · 序列帧", family: "sprite", kind: "barbarian", traits: { river: true, flying: false, ranged: false } },
  { key: "sprite-knight", label: "重甲盾兵 · 序列帧", family: "sprite", kind: "warrior", traits: { river: false, flying: false, ranged: false } },
];

export const ALL_UNIT_SKINS: UnitSkinDef[] = [
  ...CLASSIC_UNIT_SKINS,
  ...SPRITE_UNIT_SKINS,
];

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
