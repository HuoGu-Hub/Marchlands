export type UnitSkinKind = "infantry" | "shield" | "cavalry" | "archer" | "elite";

export interface UnitSkinDef {
  key: string;
  label: string;
  family: "frontier" | "classic" | "sprite";
  /** 边军皮肤绑定兵种；经典皮肤可套用到任意兵种。 */
  kind?: UnitSkinKind;
  variant?: "A" | "B";
}

/** 边军兵种皮肤：key 对应 assets/characters 下的 GLB 文件名，含老兵 A / 新募 B 两版。 */
export const FRONTIER_UNIT_SKINS: UnitSkinDef[] = [
  { key: "frontier-infantry-A", label: "边军步兵 · 老兵", family: "frontier", kind: "infantry", variant: "A" },
  { key: "frontier-infantry-B", label: "边军步兵 · 新募", family: "frontier", kind: "infantry", variant: "B" },
  { key: "frontier-shield-A", label: "边军盾兵 · 老兵", family: "frontier", kind: "shield", variant: "A" },
  { key: "frontier-shield-B", label: "边军盾兵 · 新募", family: "frontier", kind: "shield", variant: "B" },
  { key: "frontier-cavalry-A", label: "边军骑兵 · 老兵", family: "frontier", kind: "cavalry", variant: "A" },
  { key: "frontier-cavalry-B", label: "边军骑兵 · 新募", family: "frontier", kind: "cavalry", variant: "B" },
  { key: "frontier-archer-A", label: "边军弓兵 · 老兵", family: "frontier", kind: "archer", variant: "A" },
  { key: "frontier-archer-B", label: "边军弓兵 · 新募", family: "frontier", kind: "archer", variant: "B" },
  { key: "frontier-elite-A", label: "边军精兵 · 老兵", family: "frontier", kind: "elite", variant: "A" },
  { key: "frontier-elite-B", label: "边军精兵 · 新募", family: "frontier", kind: "elite", variant: "B" },
];

/** 通用角色皮肤，可替换任意兵种。 */
export const CLASSIC_UNIT_SKINS: UnitSkinDef[] = [
  { key: "warrior", label: "剑士", family: "classic" },
  { key: "cleric", label: "祭司", family: "classic" },
  { key: "monk", label: "武僧", family: "classic" },
  { key: "rogue", label: "游侠", family: "classic" },
];

/** 八方向序列帧皮肤。不注册为 GLB 资产，由场景直接构造 SpriteUnitActor。 */
export const SPRITE_UNIT_SKINS: UnitSkinDef[] = [
  { key: "sprite-ranger", label: "游侠 · 序列帧", family: "sprite", kind: "infantry" },
];

export const ALL_UNIT_SKINS: UnitSkinDef[] = [
  ...FRONTIER_UNIT_SKINS,
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

/** 当前兵种可选的皮肤：专属边军皮肤 + 通用皮肤。 */
export function skinsForKind(kind: UnitSkinKind): UnitSkinDef[] {
  return ALL_UNIT_SKINS.filter((skin) => !skin.kind || skin.kind === kind);
}
