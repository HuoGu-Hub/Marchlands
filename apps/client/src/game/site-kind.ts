import { isProductionSiteKind, siteUnitKind } from "@marchlands/sim";
import type { SiteKind, UnitKind } from "@marchlands/sim";
import type { BuildingKind } from "./building-types";

/** 据点类型与产出兵种同名，名字和 id 只有一套。 */
export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  barbarian: "野蛮人营地",
  warrior: "精锐战士营",
  ranger: "游侠营地",
  archer: "弓箭手营",
  mage: "法师塔",
  cavalry: "马厩",
  granary: "粮仓",
  outpost: "驻兵点",
};

export const SITE_KIND_OPTIONS: ReadonlyArray<{ kind: SiteKind; label: string; desc: string }> = [
  { kind: "barbarian", label: "野蛮人营地", desc: "野蛮人 · 可渡河" },
  { kind: "warrior", label: "精锐战士营", desc: "精锐战士 · 重甲" },
  { kind: "ranger", label: "游侠营地", desc: "游侠 · 可渡河" },
  { kind: "archer", label: "弓箭手营", desc: "弓箭手 · 远程" },
  { kind: "mage", label: "法师塔", desc: "法师 · 远程 · 可腾空" },
  { kind: "cavalry", label: "马厩", desc: "骑兵 · 可渡河 · 冲锋" },
  { kind: "granary", label: "粮仓", desc: "不产兵" },
  { kind: "outpost", label: "驻兵点", desc: "不产兵" },
];

export function siteKindLabel(kind: SiteKind): string {
  return SITE_KIND_LABELS[kind];
}

export function siteBuildingKind(kind: SiteKind): BuildingKind {
  if (kind === "granary") return "granary";
  if (kind === "outpost") return "tower";
  return kind;
}

export function siteDefaultAsset(kind: SiteKind): string {
  if (kind === "granary") return "builtin:building.granary";
  if (kind === "outpost") return "builtin:building.tower";
  return `builtin:building.${kind}`;
}

export function producingUnitKind(kind: SiteKind): UnitKind | null {
  return siteUnitKind(kind);
}

export function isProducing(kind: SiteKind): boolean {
  return isProductionSiteKind(kind);
}
