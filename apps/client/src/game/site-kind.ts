import { isProductionSiteKind, siteUnitKind } from "@marchlands/sim";
import type { SiteKind, UnitKind } from "@marchlands/sim";
import type { BuildingKind } from "./building-types";

export const SITE_KIND_LABELS: Record<SiteKind, string> = {
  barracks: "兵营",
  stable: "马厩",
  shieldBarracks: "盾兵营",
  archerBarracks: "弓兵营",
  granary: "粮仓",
  outpost: "驻兵点",
};

export const SITE_KIND_OPTIONS: ReadonlyArray<{ kind: SiteKind; label: string; desc: string }> = [
  { kind: "barracks", label: "兵营", desc: "步兵" },
  { kind: "stable", label: "马厩", desc: "骑兵" },
  { kind: "shieldBarracks", label: "盾兵营", desc: "盾兵" },
  { kind: "archerBarracks", label: "弓兵营", desc: "弓兵" },
  { kind: "granary", label: "粮仓", desc: "不产兵" },
  { kind: "outpost", label: "驻兵点", desc: "不产兵" },
];

export function siteKindLabel(kind: SiteKind): string {
  return SITE_KIND_LABELS[kind];
}

export function siteBuildingKind(kind: SiteKind): BuildingKind {
  if (kind === "barracks") return "infantry";
  if (kind === "stable") return "cavalry";
  if (kind === "shieldBarracks") return "shield";
  if (kind === "archerBarracks") return "archer";
  if (kind === "granary") return "granary";
  return "tower";
}

export function siteDefaultAsset(kind: SiteKind): string {
  if (kind === "barracks") return "builtin:building.barracks";
  if (kind === "stable") return "builtin:building.stable";
  if (kind === "shieldBarracks") return "builtin:building.shieldBarracks";
  if (kind === "archerBarracks") return "builtin:building.archerBarracks";
  if (kind === "granary") return "builtin:building.granary";
  return "builtin:building.tower";
}

export function producingUnitKind(kind: SiteKind): UnitKind | null {
  return siteUnitKind(kind);
}

export function isProducing(kind: SiteKind): boolean {
  return isProductionSiteKind(kind);
}
