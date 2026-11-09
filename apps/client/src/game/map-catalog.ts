import autumnvaleMapJson from "@marchlands/content/maps/autumnvale01.json";
import frontierMapJson from "@marchlands/content/maps/frontier01.json";
import highlandMapJson from "@marchlands/content/maps/highland01.json";
import snowpassMapJson from "@marchlands/content/maps/snowpass01.json";
import { validateContent } from "@marchlands/content";
import { defaultVisualForMap } from "@marchlands/map-authoring";
import type { MapVisual } from "@marchlands/map-authoring";
import { DEFAULT_RULESET, isProductionSiteKind } from "@marchlands/sim";
import type { MapDef, Ruleset } from "@marchlands/sim";

interface TerrainPreset {
  style: "frontier" | "meadow" | "autumn" | "ash" | "coast" | "snow";
  amplitude: number;
  seed: number;
  roadStyle: "cobble" | "dirt";
  material: string;
}

const TERRAIN_PRESETS: Record<string, TerrainPreset> = {
  highland01: {
    style: "meadow",
    amplitude: 2.6,
    seed: 4711,
    roadStyle: "cobble",
    material: "rocks007",
  },
  autumnvale01: {
    style: "autumn",
    amplitude: 2.4,
    seed: 923,
    roadStyle: "dirt",
    material: "ground068",
  },
  snowpass01: {
    style: "snow",
    amplitude: 2.2,
    seed: 1607,
    roadStyle: "cobble",
    material: "snow014",
  },
};

function withTerrainPreset(visual: MapVisual, id: string): MapVisual {
  const preset = TERRAIN_PRESETS[id];
  if (!preset) return visual;
  return {
    ...visual,
    terrain: {
      ...visual.terrain,
      style: preset.style,
      seed: preset.seed,
      amplitude: preset.amplitude,
      material: preset.material,
    },
    roads: { ...visual.roads, style: preset.roadStyle },
  };
}

export interface MapCatalogEntry {
  id: string;
  map: MapDef;
  visual: MapVisual;
  rules: Ruleset;
  /** 产兵据点数量。 */
  towns: number;
  /** 对局时限，分钟。 */
  minutes: number;
}

function buildEntry(id: string, json: unknown): MapCatalogEntry {
  const content = validateContent(json, DEFAULT_RULESET);
  return {
    id,
    map: content.map,
    visual: withTerrainPreset(defaultVisualForMap(content.map), id),
    rules: content.rules,
    towns: content.map.cities.filter((city) => isProductionSiteKind(city.kind)).length,
    minutes: Math.round(content.rules.maxTicks / content.rules.tickHz / 60),
  };
}

export const MAP_CATALOG: ReadonlyMap<string, MapCatalogEntry> = new Map<string, MapCatalogEntry>([
  ["frontier01", buildEntry("frontier01", frontierMapJson)],
  ["highland01", buildEntry("highland01", highlandMapJson)],
  ["autumnvale01", buildEntry("autumnvale01", autumnvaleMapJson)],
  ["snowpass01", buildEntry("snowpass01", snowpassMapJson)],
]);

export function mapEntry(id: string): MapCatalogEntry | undefined {
  return MAP_CATALOG.get(id);
}

export const BASE_RULES: Ruleset = [...MAP_CATALOG.values()][0].rules;
