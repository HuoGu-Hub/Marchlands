import type { MapDef } from "@marchlands/sim";
import type {
  FoundationDraft,
  MapDocument,
  MapVisual,
  PropDraft,
  RoadVisualDraft,
  TerrainDraft,
  TerrainStyle,
  VisualDraft,
} from "./types";
import { isProductionSiteKind, TERRAIN_STYLE_IDS } from "./types";
import { createFoundation } from "./foundations";

const STARTER_SEED = 20261102;

interface Point {
  x: number;
  z: number;
  radius: number;
}

const TREES = [
  "builtin:prop.tree.pine-tall",
  "builtin:prop.tree.oak",
  "builtin:prop.tree.detailed",
  "builtin:prop.tree.default",
  "builtin:prop.tree.pine-round",
  "builtin:prop.tree.simple",
  "builtin:prop.tree.thin",
];

const ROCKS = [
  "builtin:prop.rock.large",
  "builtin:prop.rock.small-a",
  "builtin:prop.rock.small-b",
  "builtin:prop.rock.small-c",
];

const PLANTS = [
  "builtin:prop.plant.bush",
  "builtin:prop.plant.grass",
  "builtin:prop.flower.red",
  "builtin:prop.flower.yellow",
  "builtin:prop.mushroom.red-group",
];

const TOWN_PROPS = [
  "builtin:prop.lantern",
  "builtin:prop.stall.green",
  "builtin:prop.stall.red",
  "builtin:prop.cart",
  "builtin:prop.fountain.round",
  "builtin:prop.hedge",
  "builtin:prop.fence",
  "builtin:prop.banner.green",
];

function snap(value: number): number {
  const rounded = Math.round(value * 2) / 2;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hashText(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function segmentDistance(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function roadDistance(document: MapDocument, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  const byId = new Map(document.sites.map((site) => [site.id, site]));
  for (const road of document.roads) {
    if (!road.from || !road.to) continue;
    const a = byId.get(road.from);
    const b = byId.get(road.to);
    if (!a || !b) continue;
    best = Math.min(best, segmentDistance(x, z, a.pos[0] / 10, a.pos[1] / 10, b.pos[0] / 10, b.pos[1] / 10));
  }
  return best;
}

function siteDistance(document: MapDocument, x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const site of document.sites) {
    best = Math.min(best, Math.hypot(site.pos[0] / 10 - x, site.pos[1] / 10 - z));
  }
  return best;
}

function place(
  document: MapDocument,
  random: () => number,
  placed: Point[],
  radius: number,
  options: { nearTown?: boolean; minTown?: number; maxTown?: number } = {},
): [number, number] | null {
  const halfW = Math.max(8, document.size[0] / 20 - 3);
  const halfH = Math.max(8, document.size[1] / 20 - 3);
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const x = snap(-halfW + random() * halfW * 2);
    const z = snap(-halfH + random() * halfH * 2);
    const town = siteDistance(document, x, z);
    if (options.nearTown) {
      if (town < (options.minTown ?? 5.4) || town > (options.maxTown ?? 8.2)) continue;
    } else if (town < 6.2 + radius) {
      continue;
    }
    if (roadDistance(document, x, z) < 2.6 + radius * 0.35) continue;
    let blocked = false;
    for (const point of placed) {
      if (Math.hypot(point.x - x, point.z - z) < radius + point.radius + 0.8) {
        blocked = true;
        break;
      }
    }
    if (blocked) continue;
    placed.push({ x, z, radius });
    return [x, z];
  }
  return null;
}

function prop(
  id: string,
  assetId: string,
  pos: [number, number],
  rotation: number,
  scale: number,
): PropDraft {
  return { id, assetId, pos, rotation, scale };
}

export function createStarterVisual(document: MapDocument): VisualDraft {
  const random = seeded(STARTER_SEED);
  const placed: Point[] = [];
  const props: PropDraft[] = [];
  let next = 1;

  const anchors: Array<{ assetId: string; x: number; z: number }> = [
    { assetId: "builtin:terrain.hill", x: -8, z: -3 },
    { assetId: "builtin:terrain.grove", x: 4, z: 10 },
    { assetId: "builtin:terrain.pond", x: 10, z: -10 },
    { assetId: "builtin:terrain.field", x: -14, z: 5 },
    { assetId: "builtin:terrain.ruin", x: -13, z: -22 },
    { assetId: "builtin:terrain.ridge", x: 5, z: -24 },
  ];
  for (const anchor of anchors) {
    let position: [number, number] | null = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      const jitter = attempt === 0 ? 0 : 2.2;
      const x = snap(anchor.x + (random() - 0.5) * jitter);
      const z = snap(anchor.z + (random() - 0.5) * jitter);
      if (siteDistance(document, x, z) < 7.2) continue;
      if (roadDistance(document, x, z) < 4.4) continue;
      let blocked = false;
      for (const point of placed) {
        if (Math.hypot(point.x - x, point.z - z) < 11) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      placed.push({ x, z, radius: 5.8 });
      position = [x, z];
      break;
    }
    if (!position) continue;
    props.push(prop(`p${next}`, anchor.assetId, position, Math.round(random() * 360), 0.94 + random() * 0.14));
    next += 1;
  }

  for (const site of document.sites) {
    if (!isProductionSiteKind(site.kind)) continue;
    const count = site.owner === 0 ? 2 : 3;
    for (let index = 0; index < count; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = 5.2 + random() * 3;
      const x = snap(site.pos[0] / 10 + Math.cos(angle) * distance);
      const z = snap(site.pos[1] / 10 + Math.sin(angle) * distance);
      if (Math.abs(x) > document.size[0] / 20 - 2 || Math.abs(z) > document.size[1] / 20 - 2) continue;
      if (roadDistance(document, x, z) < 2.1) continue;
      let blocked = false;
      for (const point of placed) {
        if (Math.hypot(point.x - x, point.z - z) < point.radius + 1.1) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const assetId = TOWN_PROPS[Math.floor(random() * TOWN_PROPS.length)];
      placed.push({ x, z, radius: 1 });
      props.push(prop(`p${next}`, assetId, [x, z], Math.round(random() * 360), 0.9 + random() * 0.3));
      next += 1;
    }
  }

  const scatterPlan: Array<{ pool: string[]; count: number; radius: number; scale: [number, number] }> = [
    { pool: TREES, count: 34, radius: 1.1, scale: [0.8, 1.2] },
    { pool: ROCKS, count: 8, radius: 0.9, scale: [0.8, 1.3] },
    { pool: PLANTS, count: 12, radius: 0.7, scale: [0.8, 1.2] },
  ];
  for (const plan of scatterPlan) {
    for (let index = 0; index < plan.count; index += 1) {
      const position = place(document, random, placed, plan.radius);
      if (!position) continue;
      const assetId = plan.pool[Math.floor(random() * plan.pool.length)];
      const scale = plan.scale[0] + random() * (plan.scale[1] - plan.scale[0]);
      props.push(prop(`p${next}`, assetId, position, Math.round(random() * 360), scale));
      next += 1;
    }
  }

  return {
    terrain: { style: "frontier", seed: STARTER_SEED, amplitude: 1 },
    roads: { style: "cobble", width: 1.6 },
    foundations: foundationsForDocument(document),
    props,
    units: {},
    scatter: true,
  };
}

export function createDefaultVisual(seed = STARTER_SEED, size: [number, number] = [700, 700]): VisualDraft {
  return {
    terrain: { style: "frontier", seed, amplitude: 1 },
    roads: { style: "cobble", width: 1.6 },
    foundations: [createFoundation([], { pos: [0, 0], size })],
    props: [],
    units: {},
    scatter: true,
  };
}

/** 编辑器文档的默认地基：铺满当前地图尺寸。 */
export function foundationsForDocument(document: MapDocument): FoundationDraft[] {
  return [createFoundation([], { pos: [0, 0], size: [document.size[0], document.size[1]] })];
}

/** 内置地图的默认地基：网格图铺满地图，据点图包住所有据点并留出 14 米边缘。 */
export function foundationsForMap(map: MapDef): FoundationDraft[] {
  if (map.navigation === "grid" || map.cities.length === 0) {
    return [createFoundation([], { pos: [0, 0], size: [map.size[0], map.size[1]] })];
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const city of map.cities) {
    minX = Math.min(minX, city.pos[0]);
    maxX = Math.max(maxX, city.pos[0]);
    minZ = Math.min(minZ, city.pos[1]);
    maxZ = Math.max(maxZ, city.pos[1]);
  }
  const pad = 140;
  return [
    createFoundation([], {
      pos: [(minX + maxX) / 2, (minZ + maxZ) / 2],
      size: [maxX - minX + pad * 2, maxZ - minZ + pad * 2],
    }),
  ];
}

export function defaultVisualForMap(map: MapDef): MapVisual {
  const style: TerrainStyle = map.biome === "forest" ? "meadow" : "frontier";
  return {
    terrain: { style, seed: hashText(map.slug) % 1_000_000, amplitude: 1 },
    roads: { style: map.biome === "forest" ? "dirt" : "cobble", width: 1.6 },
    foundations: foundationsForMap(map),
    props: [],
    units: {},
    scatter: true,
    sites: {},
  };
}

export function cloneVisual(visual: VisualDraft): VisualDraft {
  return {
    terrain: { ...visual.terrain },
    roads: { ...visual.roads },
    foundations: visual.foundations.map((foundation) => ({
      ...foundation,
      pos: [foundation.pos[0], foundation.pos[1]] as [number, number],
      size: [foundation.size[0], foundation.size[1]] as [number, number],
    })),
    props: visual.props.map((entry) => ({
      ...entry,
      pos: [entry.pos[0], entry.pos[1]],
    })),
    units: { ...visual.units },
    scatter: visual.scatter,
  };
}

export function compileVisual(document: MapDocument): MapVisual {
  const sites: MapVisual["sites"] = {};
  for (const site of document.sites) {
    if (
      !site.visualAssetId &&
      site.visualRotation === undefined &&
      site.visualRotationX === undefined &&
      site.visualRotationZ === undefined &&
      site.visualScale === undefined
    ) {
      continue;
    }
    sites[site.id] = {
      ...(site.visualAssetId ? { assetId: site.visualAssetId } : {}),
      rotation: site.visualRotation ?? 0,
      ...(site.visualRotationX !== undefined ? { rotationX: site.visualRotationX } : {}),
      ...(site.visualRotationZ !== undefined ? { rotationZ: site.visualRotationZ } : {}),
      scale: site.visualScale ?? 1,
    };
  }
  return {
    terrain: { ...document.visual.terrain },
    roads: { ...document.visual.roads },
    foundations: document.visual.foundations.map((foundation) => ({
      ...foundation,
      pos: [foundation.pos[0], foundation.pos[1]] as [number, number],
      size: [foundation.size[0], foundation.size[1]] as [number, number],
    })),
    props: document.visual.props.map((entry) => ({
      ...entry,
      pos: [entry.pos[0], entry.pos[1]],
    })),
    units: { ...document.visual.units },
    scatter: document.visual.scatter,
    sites,
  };
}

const ASSET_ID = /^[a-z][a-z0-9_.-]{1,31}:[a-z0-9][a-z0-9_.\/-]{0,95}$/;

export function isAssetId(value: unknown): value is string {
  return typeof value === "string" && ASSET_ID.test(value);
}

export function isTerrainStyle(value: unknown): value is TerrainStyle {
  return typeof value === "string" && (TERRAIN_STYLE_IDS as readonly string[]).includes(value);
}

export function isRoadStyle(value: unknown): value is RoadVisualDraft["style"] {
  return value === "cobble" || value === "dirt";
}

export function terrainDraft(value: Partial<TerrainDraft> | undefined, fallback: TerrainDraft): TerrainDraft {
  const material =
    typeof value?.material === "string" && value.material.trim().length > 0
      ? value.material.trim().slice(0, 128)
      : fallback.material;
  return {
    style: isTerrainStyle(value?.style) ? value.style : fallback.style,
    seed: typeof value?.seed === "number" && Number.isFinite(value.seed) ? Math.round(value.seed) : fallback.seed,
    amplitude:
      typeof value?.amplitude === "number" && Number.isFinite(value.amplitude)
        ? Math.min(1.5, Math.max(0.2, value.amplitude))
        : fallback.amplitude,
    ...(material ? { material } : {}),
  };
}

export function roadDraft(
  value: Partial<RoadVisualDraft> | undefined,
  fallback: RoadVisualDraft,
): RoadVisualDraft {
  return {
    style: isRoadStyle(value?.style) ? value.style : fallback.style,
    width:
      typeof value?.width === "number" && Number.isFinite(value.width)
        ? Math.min(6, Math.max(0.6, value.width))
        : fallback.width,
  };
}

export { STARTER_SEED };