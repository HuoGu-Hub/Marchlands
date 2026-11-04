import { ContentError, validateMap } from "@marchlands/content";
import { decodeBitmapBase64 } from "@marchlands/nav";
import { mapHashOf, type MapDef, type MapGridDef, type MapPlayer, type NavigationMode } from "@marchlands/sim";
import type {
  CompileResult,
  EditorDiagnostic,
  FoundationDraft,
  GridDraft,
  MapDocument,
  MapVisual,
  ParsedDocument,
  PropDraft,
  RoadDraft,
  SiteDraft,
  TerrainDraft,
  VisualDraft,
} from "./types";
import { isFoundationShape, isProductionSiteKind, TERRAIN_STYLE_IDS } from "./types";
import { createHeightField, edgeGrade } from "./height";
import {
  DEFAULT_CAPTURE_RADIUS_DM,
  DEFAULT_FOOTPRINT_DM,
  createGridDraft,
  gridIssues,
  gridNavigationIssues,
  packGridDraft,
  rasterizeRoadSurface,
  unpackGridDef,
} from "./grid";
import {
  cloneVisual,
  compileVisual,
  createDefaultVisual,
  createStarterVisual,
  foundationsForDocument,
  foundationsForMap,
  isAssetId,
  isRoadStyle,
  isTerrainStyle,
  roadDraft,
  terrainDraft,
} from "./visual";
import type { FoundationBoundsDm } from "./foundations";
import {
  MAX_FOUNDATION_SIZE_DM,
  MIN_FOUNDATION_SIZE_DM,
  clampDepth,
  clampElevation,
  clampRotation,
  clampScale,
  createFoundation,
  documentBounds,
  foundationContains,
  overlapArea,
} from "./foundations";

const DEFAULT_PLAYERS: MapPlayer[] = [
  { id: 1, name: "Player", color: "green", ai: false },
  { id: 2, name: "AI", color: "red", ai: true },
];

const MAX_PROPS = 2000;

function starterSites(): SiteDraft[] {
  return [
    { id: "c1", kind: "barracks", owner: 1, level: 3, pop: 30, pos: [-200, -150] },
    { id: "c2", kind: "stable", owner: 2, level: 3, pop: 30, pos: [200, 150] },
    { id: "c3", kind: "shieldBarracks", owner: 0, level: 1, pop: 10, pos: [-200, 150] },
    { id: "c4", kind: "archerBarracks", owner: 0, level: 1, pop: 10, pos: [200, -150] },
  ];
}

function starterRoads(): RoadDraft[] {
  return [
    { id: "r1", from: "c1", to: "c4" },
    { id: "r2", from: "c4", to: "c2" },
    { id: "r3", from: "c2", to: "c3" },
    { id: "r4", from: "c3", to: "c1" },
  ];
}

export function createStarterDocument(): MapDocument {
  const document: MapDocument = {
    schema: 3,
    navigation: "graph",
    vision: { enabled: false },
    slug: "custom",
    name: "新地图",
    size: [700, 700],
    biome: "frontier",
    players: DEFAULT_PLAYERS.map((player) => ({ ...player })),
    sites: starterSites(),
    roads: starterRoads(),
    objectives: [{ type: "capture_all" }, { type: "time_limit", ticks: 18000 }],
    startGold: 0,
    transit: "friendly",
    visual: createDefaultVisual(),
  };
  document.visual = createStarterVisual(document);
  return document;
}

export function createGridDocument(): MapDocument {
  const document: MapDocument = {
    schema: 3,
    navigation: "grid",
    grid: createGridDraft([700, 700]),
    vision: { enabled: false },
    slug: "custom-grid",
    name: "新网格地图",
    size: [700, 700],
    biome: "frontier",
    players: DEFAULT_PLAYERS.map((player) => ({ ...player })),
    sites: [
      { id: "c1", kind: "barracks", owner: 1, level: 3, pop: 30, pos: [-200, -150], footprintDm: 80, captureRadiusDm: 40 },
      { id: "c2", kind: "stable", owner: 2, level: 3, pop: 30, pos: [200, 150], footprintDm: 80, captureRadiusDm: 40 },
      { id: "c3", kind: "shieldBarracks", owner: 0, level: 1, pop: 10, pos: [-200, 150], footprintDm: 80, captureRadiusDm: 40 },
      { id: "c4", kind: "archerBarracks", owner: 0, level: 1, pop: 10, pos: [200, -150], footprintDm: 80, captureRadiusDm: 40 },
    ],
    roads: [],
    objectives: [{ type: "capture_all" }, { type: "time_limit", ticks: 18000 }],
    startGold: 0,
    transit: "open",
    visual: createDefaultVisual(),
  };
  document.visual = createStarterVisual(document);
  return document;
}

export function convertToGrid(document: MapDocument): MapDocument {
  const next = cloneDocument(document);
  next.schema = 3;
  next.navigation = "grid";
  next.vision = { enabled: false };
  if (!next.grid) next.grid = createGridDraft(next.size);
  // 网格导航只支持一块与网格同心的地基，转换时收拢。
  const primary = next.visual.foundations[0];
  next.visual.foundations = [
    createFoundation([], {
      pos: [0, 0],
      size: [next.size[0], next.size[1]],
      elevation: primary?.elevation ?? 0,
      ...(primary?.assetId ? { assetId: primary.assetId } : {}),
      ...(primary?.shape ? { shape: primary.shape } : {}),
      ...(primary?.terrainStyle ? { terrainStyle: primary.terrainStyle } : {}),
      ...(primary?.terrainSeed !== undefined ? { terrainSeed: primary.terrainSeed } : {}),
      ...(primary?.terrainAmplitude !== undefined ? { terrainAmplitude: primary.terrainAmplitude } : {}),
      ...(primary?.scatter !== undefined ? { scatter: primary.scatter } : {}),
      ...(primary?.material ? { material: primary.material } : {}),
      scale: primary?.scale ?? 1,
      rotation: primary?.rotation ?? 0,
    }),
  ];
  for (const site of next.sites) {
    if (site.footprintDm === undefined) site.footprintDm = DEFAULT_FOOTPRINT_DM;
    if (site.captureRadiusDm === undefined) site.captureRadiusDm = DEFAULT_CAPTURE_RADIUS_DM;
  }
  return next;
}

export function cloneDocument(document: MapDocument): MapDocument {
  return {
    ...document,
    size: [document.size[0], document.size[1]],
    players: document.players.map((player) => ({ ...player })),
    sites: document.sites.map((site) => ({
      ...site,
      pos: [site.pos[0], site.pos[1]],
      ...(site.watch ? { watch: [site.watch[0], site.watch[1]] as [string, string] } : {}),
    })),
    roads: document.roads.map((road) => ({
      ...road,
      ...(road.path ? { path: road.path.map((point) => [point[0], point[1]] as [number, number]) } : {}),
    })),
    objectives: document.objectives.map((objective) => ({ ...objective })),
    vision: { enabled: document.vision.enabled },
    ...(document.grid
      ? {
          grid: {
            ...document.grid,
            heightCm: document.grid.heightCm.slice(),
            surface: document.grid.surface.slice(),
          },
        }
      : {}),
    visual: cloneVisual(document.visual),
  };
}

function asRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return null;
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null;
  return [Math.round(value[0]), Math.round(value[1])];
}

function exactNumberPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  if (typeof value[0] !== "number" || typeof value[1] !== "number") return null;
  if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return null;
  return [value[0], value[1]];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function siteFromUnknown(value: unknown): SiteDraft | null {
  if (!asRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  // 旧文档的 town 统一迁移为兵营，新文档不再提供城镇类型。
  const kind = value.kind === "town" ? "barracks" : value.kind;
  if (!isProductionSiteKind(kind as SiteDraft["kind"]) && kind !== "granary" && kind !== "outpost") return null;
  const pos = numberPair(value.pos);
  if (!pos) return null;
  const owner = value.owner === 1 || value.owner === 2 ? value.owner : 0;
  const level = value.level === 2 || value.level === 3 ? value.level : 1;
  const pop = typeof value.pop === "number" && Number.isFinite(value.pop) ? Math.max(0, Math.round(value.pop)) : 0;
  const site: SiteDraft = { id: value.id, kind: kind as SiteDraft["kind"], owner, level, pop, pos };
  if (value.kind === "outpost") {
    site.stance = value.stance === "engage" ? "engage" : "evade";
    const watch = value.watch;
    if (Array.isArray(watch) && watch.length === 2 && typeof watch[0] === "string" && typeof watch[1] === "string") {
      site.watch = [watch[0], watch[1]];
    }
  }
  if (value.visualAssetId !== undefined) {
    if (!isAssetId(value.visualAssetId)) throw new Error(`据点 ${site.id} 的外观资产 ID 无效`);
    site.visualAssetId = value.visualAssetId;
  }
  if (value.visualRotation !== undefined) {
    const rotation = finiteNumber(value.visualRotation);
    if (rotation === null) throw new Error(`据点 ${site.id} 的外观朝向无效`);
    site.visualRotation = rotation;
  }
  if (value.visualRotationX !== undefined) {
    const rotation = finiteNumber(value.visualRotationX);
    if (rotation === null) throw new Error(`据点 ${site.id} 的外观俯仰无效`);
    site.visualRotationX = rotation;
  }
  if (value.visualRotationZ !== undefined) {
    const rotation = finiteNumber(value.visualRotationZ);
    if (rotation === null) throw new Error(`据点 ${site.id} 的外观侧倾无效`);
    site.visualRotationZ = rotation;
  }
  if (value.visualScale !== undefined) {
    const scale = finiteNumber(value.visualScale);
    if (scale === null || scale < 0.1 || scale > 10) throw new Error(`据点 ${site.id} 的外观缩放无效`);
    site.visualScale = scale;
  }
  if (value.footprintDm !== undefined) {
    const footprint = finiteNumber(value.footprintDm);
    if (footprint === null || footprint <= 0) throw new Error(`据点 ${site.id} 的占地直径无效`);
    site.footprintDm = footprint;
  }
  if (value.captureRadiusDm !== undefined) {
    const capture = finiteNumber(value.captureRadiusDm);
    if (capture === null || capture <= 0) throw new Error(`据点 ${site.id} 的占领半径无效`);
    site.captureRadiusDm = capture;
  }
  if (value.transit !== undefined) {
    if (value.transit !== "open" && value.transit !== "closed") throw new Error(`据点 ${site.id} 的通行规则无效`);
    site.transit = value.transit;
  }
  return site;
}

function roadFromUnknown(value: unknown, index: number): RoadDraft | null {
  if (!asRecord(value)) return null;
  const from = typeof value.from === "string" && value.from.length > 0 ? value.from : undefined;
  const to = typeof value.to === "string" && value.to.length > 0 ? value.to : undefined;
  if (!from && !to && value.path === undefined) return null;
  const road: RoadDraft = {
    id: typeof value.id === "string" && value.id.length > 0 ? value.id : `r${index + 1}`,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  if (value.path !== undefined) {
    if (!Array.isArray(value.path)) throw new Error("道路样条必须是点数组");
    const path: Array<[number, number]> = [];
    for (const entry of value.path) {
      const point = numberPair(entry);
      if (!point) throw new Error("道路样条包含无效点");
      path.push(point);
    }
    road.path = path;
  }
  if (value.widthDm !== undefined) {
    const width = finiteNumber(value.widthDm);
    if (width === null || width <= 0) throw new Error("道路宽度无效");
    road.widthDm = width;
  }
  return road;
}

function propFromUnknown(value: unknown): PropDraft | null {
  if (!asRecord(value)) return null;
  if (typeof value.id !== "string" || value.id.length === 0) return null;
  if (!isAssetId(value.assetId)) return null;
  const pos = exactNumberPair(value.pos);
  if (!pos) return null;
  const rotation = finiteNumber(value.rotation);
  const scale = finiteNumber(value.scale);
  if (rotation === null || scale === null || scale < 0.1 || scale > 10) return null;
  const prop: PropDraft = {
    id: value.id,
    assetId: value.assetId,
    pos,
    rotation: ((rotation % 360) + 360) % 360,
    scale,
  };
  if (typeof value.blocker === "boolean") prop.blocker = value.blocker;
  if (value.footprintDm !== undefined) {
    const footprint = finiteNumber(value.footprintDm);
    if (footprint === null || footprint <= 0) throw new Error(`装饰 ${prop.id} 的占地直径无效`);
    prop.footprintDm = footprint;
  }
  return prop;
}

function integerArray(value: unknown, label: string, length?: number): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组`);
  if (length !== undefined && value.length !== length) {
    throw new Error(`${label} 数量与格子数不一致`);
  }
  const output: number[] = [];
  for (const entry of value) {
    if (typeof entry !== "number" || !Number.isInteger(entry)) throw new Error(`${label} 必须是整数`);
    output.push(entry);
  }
  return output;
}

function gridFromUnknown(value: unknown): GridDraft {
  if (!asRecord(value)) throw new Error("地图网格数据必须是对象");
  const cellSizeDm = finiteNumber(value.cellSizeDm);
  if (cellSizeDm === null || !Number.isInteger(cellSizeDm) || cellSizeDm <= 0) {
    throw new Error("网格尺寸必须是正整数分米");
  }
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (width === null || !Number.isInteger(width) || width <= 0) throw new Error("网格宽度无效");
  if (height === null || !Number.isInteger(height) || height <= 0) throw new Error("网格高度无效");
  const cells = width * height;
  const heightCm = integerArray(value.heightCm, "网格高度", cells);
  for (const entry of heightCm) {
    if (entry < -32768 || entry > 32767) throw new Error("网格高度必须是 -32768 到 32767 的整数厘米");
  }
  const surface = integerArray(value.surface, "网格地表", cells);
  for (const entry of surface) {
    if (entry < 0 || entry > 9) throw new Error("网格地表必须是 0 到 9");
  }
  if (typeof value.blocked !== "string") throw new Error("网格阻挡位图必须是 Base64 字符串");
  if (typeof value.walkableOverride !== "string") throw new Error("网格可走覆盖位图必须是 Base64 字符串");
  try {
    decodeBitmapBase64(value.blocked, cells);
  } catch {
    throw new Error("网格阻挡位图无效");
  }
  try {
    decodeBitmapBase64(value.walkableOverride, cells);
  } catch {
    throw new Error("网格可走覆盖位图无效");
  }
  return { cellSizeDm, width, height, heightCm, surface, blocked: value.blocked, walkableOverride: value.walkableOverride };
}

function navigationFromUnknown(value: unknown, schema: number): NavigationMode {
  if (value === "grid") {
    if (schema !== 3) throw new Error("旧版地图不支持网格导航");
    return "grid";
  }
  if (value !== undefined && value !== "graph") throw new Error(`不支持的导航模式：${String(value)}`);
  return "graph";
}

function foundationFromUnknown(value: unknown, index: number): FoundationDraft {
  if (!asRecord(value)) throw new Error("地基配置必须是对象");
  const pos = numberPair(value.pos) ?? [0, 0];
  const size = numberPair(value.size);
  if (!size) throw new Error("地基尺寸必须是两个整数");
  if (size[0] < MIN_FOUNDATION_SIZE_DM || size[1] < MIN_FOUNDATION_SIZE_DM) {
    throw new Error(`地基尺寸不能小于 ${MIN_FOUNDATION_SIZE_DM / 10} 米`);
  }
  if (size[0] > MAX_FOUNDATION_SIZE_DM || size[1] > MAX_FOUNDATION_SIZE_DM) {
    throw new Error(`地基尺寸不能大于 ${MAX_FOUNDATION_SIZE_DM / 10} 米`);
  }
  const id = typeof value.id === "string" && value.id.length > 0 ? value.id : `f${index + 1}`;
  const elevation = finiteNumber(value.elevation) ?? 0;
  const foundation: FoundationDraft = {
    id,
    pos: [Math.round(pos[0]), Math.round(pos[1])],
    size: [Math.round(size[0]), Math.round(size[1])],
    elevation: clampElevation(elevation),
    scale: clampScale(finiteNumber(value.scale) ?? 1),
    rotation: clampRotation(finiteNumber(value.rotation) ?? 0),
  };
  if (value.depth !== undefined) {
    const depth = finiteNumber(value.depth);
    if (depth === null || depth <= 0) throw new Error(`地基 ${id} 的厚度无效`);
    foundation.depth = clampDepth(depth);
  }
  if (value.assetId !== undefined && value.assetId !== "") {
    if (!isAssetId(value.assetId)) throw new Error(`地基 ${id} 的外壳资产 ID 无效`);
    foundation.assetId = value.assetId;
  }
  if (value.shape !== undefined) {
    if (!isFoundationShape(value.shape)) throw new Error(`地基 ${id} 的外形无效`);
    foundation.shape = value.shape;
  }
  if (value.terrainStyle !== undefined) {
    if (!isTerrainStyle(value.terrainStyle)) throw new Error(`地基 ${id} 的地貌风格无效`);
    foundation.terrainStyle = value.terrainStyle;
  }
  if (value.terrainSeed !== undefined) {
    const seed = finiteNumber(value.terrainSeed);
    if (seed === null) throw new Error(`地基 ${id} 的地貌种子无效`);
    foundation.terrainSeed = Math.round(seed);
  }
  if (value.terrainAmplitude !== undefined) {
    const amplitude = finiteNumber(value.terrainAmplitude);
    if (amplitude === null) throw new Error(`地基 ${id} 的地貌起伏无效`);
    foundation.terrainAmplitude = Math.max(0.2, Math.min(1.5, amplitude));
  }
  if (typeof value.scatter === "boolean") foundation.scatter = value.scatter;
  if (typeof value.material === "string" && value.material.trim().length > 0) {
    foundation.material = value.material.trim().slice(0, 128);
  }
  return foundation;
}

function legacyFoundationFromUnknown(value: unknown, bounds: FoundationBoundsDm): FoundationDraft {
  if (!asRecord(value)) throw new Error("地基模型配置必须是对象");
  const assetId = value.assetId;
  if (!isAssetId(assetId)) throw new Error("地基模型资产 ID 无效");
  const scale = typeof value.scale === "number" && Number.isFinite(value.scale) ? value.scale : 1;
  const rotation = typeof value.rotation === "number" && Number.isFinite(value.rotation) ? value.rotation : 0;
  const offsetY = typeof value.offsetY === "number" && Number.isFinite(value.offsetY) ? value.offsetY : 0;
  return createFoundation([], {
    id: "f1",
    pos: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2],
    size: [bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ],
    elevation: clampElevation(offsetY),
    assetId,
    scale: clampScale(scale),
    rotation: clampRotation(rotation),
  });
}

function visualFromUnknown(value: unknown, fallbackSeed: number, fallbackBounds: FoundationBoundsDm): VisualDraft {
  const fallback = createDefaultVisual(fallbackSeed, [
    fallbackBounds.maxX - fallbackBounds.minX,
    fallbackBounds.maxZ - fallbackBounds.minZ,
  ]);
  fallback.foundations = [
    createFoundation([], {
      pos: [(fallbackBounds.minX + fallbackBounds.maxX) / 2, (fallbackBounds.minZ + fallbackBounds.maxZ) / 2],
      size: [fallbackBounds.maxX - fallbackBounds.minX, fallbackBounds.maxZ - fallbackBounds.minZ],
    }),
  ];
  if (value === undefined) return fallback;
  if (!asRecord(value)) throw new Error("地图视觉配置必须是对象");
  const terrainInput = asRecord(value.terrain) ? value.terrain : undefined;
  const terrainValue = terrainInput as Partial<TerrainDraft> | undefined;
  if (terrainInput?.style !== undefined && !isTerrainStyle(terrainInput.style)) {
    throw new Error(`不支持的地貌风格：${String(terrainInput.style)}`);
  }
  const terrain = terrainDraft(terrainValue, fallback.terrain);
  const roadsInput = asRecord(value.roads) ? value.roads : undefined;
  if (roadsInput?.style !== undefined && !isRoadStyle(roadsInput.style)) {
    throw new Error(`不支持的道路风格：${String(roadsInput.style)}`);
  }
  const roads = roadDraft(roadsInput as Partial<VisualDraft["roads"]> | undefined, fallback.roads);
  const scatter = typeof value.scatter === "boolean" ? value.scatter : fallback.scatter;
  let foundations: FoundationDraft[];
  if (Array.isArray(value.foundations)) {
    if (value.foundations.length === 0) throw new Error("地图至少需要一块地基");
    foundations = value.foundations.map((entry, index) => foundationFromUnknown(entry, index));
    const foundationIds = new Set<string>();
    for (const entry of foundations) {
      if (foundationIds.has(entry.id)) throw new Error(`地基编号重复：${entry.id}`);
      foundationIds.add(entry.id);
    }
  } else if (value.foundation !== undefined) {
    foundations = [legacyFoundationFromUnknown(value.foundation, fallbackBounds)];
  } else {
    foundations = fallback.foundations.map((entry) => ({ ...entry }));
  }
  const propsInput = value.props;
  let props: PropDraft[] = [];
  if (propsInput !== undefined) {
    if (!Array.isArray(propsInput)) throw new Error("地图装饰必须是数组");
    if (propsInput.length > MAX_PROPS) throw new Error(`地图装饰不能超过 ${MAX_PROPS} 个`);
    props = propsInput.map((entry) => {
      const parsed = propFromUnknown(entry);
      if (!parsed) throw new Error("地图文件包含无效装饰");
      return parsed;
    });
    const ids = new Set<string>();
    for (const entry of props) {
      if (ids.has(entry.id)) throw new Error(`装饰编号重复：${entry.id}`);
      ids.add(entry.id);
    }
  }
  const units: VisualDraft["units"] = {};
  if (value.units !== undefined) {
    if (!asRecord(value.units)) throw new Error("单位外观配置必须是对象");
    for (const key of ["player1", "player2"] as const) {
      const assetId = value.units[key];
      if (assetId === undefined || assetId === "") continue;
      if (!isAssetId(assetId)) throw new Error(`${key} 的单位资产 ID 无效`);
      units[key] = assetId;
    }
  }
  return {
    terrain,
    roads,
    foundations,
    props,
    units,
    scatter,
  };
}

function roadsFromMapDef(map: MapDef): RoadDraft[] {
  const roads: RoadDraft[] = [];
  const covered = new Set<string>();
  let next = 1;
  for (const road of map.roads ?? []) {
    roads.push({
      id: `r${next}`,
      ...(road.from ? { from: road.from } : {}),
      ...(road.to ? { to: road.to } : {}),
      path: road.points.map((point) => [point[0], point[1]] as [number, number]),
      widthDm: road.widthDm,
    });
    if (road.from && road.to) {
      covered.add(road.from < road.to ? `${road.from}|${road.to}` : `${road.to}|${road.from}`);
    }
    next += 1;
  }
  for (const edge of map.edges) {
    const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
    if (covered.has(key)) continue;
    roads.push({
      id: `r${next}`,
      from: edge.from,
      to: edge.to,
      ...(edge.path ? { path: edge.path.map((point) => [point[0], point[1]] as [number, number]) } : {}),
      ...(edge.widthDm !== undefined ? { widthDm: edge.widthDm } : {}),
    });
    next += 1;
  }
  return roads;
}

export function fromMapDef(map: MapDef): MapDocument {
  const visual = createDefaultVisual();
  visual.terrain.style = map.biome === "forest" ? "meadow" : "frontier";
  visual.roads.style = map.biome === "forest" ? "dirt" : "cobble";
  visual.foundations = foundationsForMap(map);
  return {
    schema: 3,
    navigation: map.navigation ?? "graph",
    ...(map.grid ? { grid: unpackGridDef(map.grid) } : {}),
    vision: { enabled: false },
    slug: map.slug,
    name: map.name,
    size: [map.size[0], map.size[1]],
    biome: map.biome,
    players: map.players.map((player) => ({ ...player })),
    sites: map.cities.map((city) => ({
      id: city.id,
      kind: city.kind,
      owner: city.owner,
      level: city.level,
      pop: city.pop,
      pos: [city.pos[0], city.pos[1]],
      ...(city.kind === "outpost"
        ? {
            stance: city.stance ?? "evade",
            ...(city.watch ? { watch: [city.watch[0], city.watch[1]] as [string, string] } : {}),
          }
        : {}),
      ...(city.transit ? { transit: city.transit } : {}),
      ...(city.footprintCm !== undefined ? { footprintDm: city.footprintCm / 10 } : {}),
      ...(city.captureRadiusCm !== undefined ? { captureRadiusDm: city.captureRadiusCm / 10 } : {}),
    })),
    roads: roadsFromMapDef(map),
    objectives: map.objectives.map((objective) => ({ ...objective })),
    startGold: map.startGold ?? 0,
    transit: map.transit ?? "open",
    visual,
  };
}

function centeredBounds(size: [number, number]): FoundationBoundsDm {
  return { minX: -size[0] / 2, maxX: size[0] / 2, minZ: -size[1] / 2, maxZ: size[1] / 2 };
}

/** 旧文档没有地基数据时，按据点范围加 14 米边缘还原原来的浮岛。 */
function fallbackBounds(sites: ReadonlyArray<SiteDraft>, size: [number, number]): FoundationBoundsDm {
  if (sites.length === 0) return centeredBounds(size);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const site of sites) {
    minX = Math.min(minX, site.pos[0]);
    maxX = Math.max(maxX, site.pos[0]);
    minZ = Math.min(minZ, site.pos[1]);
    maxZ = Math.max(maxZ, site.pos[1]);
  }
  return { minX: minX - 140, maxX: maxX + 140, minZ: minZ - 140, maxZ: maxZ + 140 };
}

export function parseDocument(input: unknown): ParsedDocument {
  if (!asRecord(input)) throw new Error("地图文件必须是 JSON 对象");
  if (Array.isArray(input.sites) && Array.isArray(input.roads)) {
    if (input.schema !== 1 && input.schema !== 2 && input.schema !== 3) {
      throw new Error("不支持的地图文档版本");
    }
    const schema = input.schema;
    const size = numberPair(input.size);
    if (!size) throw new Error("地图尺寸必须是两个整数");
    const players = Array.isArray(input.players)
      ? input.players
          .map((entry) => {
            if (!asRecord(entry)) return null;
            if (entry.id !== 1 && entry.id !== 2) return null;
            if (typeof entry.name !== "string" || typeof entry.color !== "string") return null;
            return { id: entry.id, name: entry.name, color: entry.color, ai: Boolean(entry.ai) } as MapPlayer;
          })
          .filter((entry): entry is MapPlayer => entry !== null)
      : [];
    const sites = input.sites
      .map(siteFromUnknown)
      .filter((entry): entry is SiteDraft => entry !== null);
    if (sites.length !== input.sites.length) throw new Error("地图文件包含无效据点");
    const roads = input.roads
      .map((entry, index) => roadFromUnknown(entry, index))
      .filter((entry): entry is RoadDraft => entry !== null);
    if (roads.length !== input.roads.length) throw new Error("地图文件包含无效道路");
    const roadIds = new Set<string>();
    for (const road of roads) {
      if (roadIds.has(road.id)) throw new Error(`道路编号重复：${road.id}`);
      roadIds.add(road.id);
    }
    const objectives = Array.isArray(input.objectives)
      ? input.objectives
          .map((entry) => {
            if (!asRecord(entry) || typeof entry.type !== "string") return null;
            return {
              type: entry.type,
              ...(typeof entry.ticks === "number" ? { ticks: Math.round(entry.ticks) } : {}),
            };
          })
          .filter((entry): entry is { type: string; ticks?: number } => entry !== null)
      : [];
    const navigation = navigationFromUnknown(input.navigation, schema);
    const grid = schema === 3 && input.grid !== undefined ? gridFromUnknown(input.grid) : undefined;
    if (schema === 3 && navigation === "grid" && !grid) throw new Error("网格地图缺少网格数据");
    if (schema !== 3 && input.grid !== undefined) throw new Error("旧版地图不支持网格数据");
    const vision =
      asRecord(input.vision) && typeof input.vision.enabled === "boolean"
        ? { enabled: input.vision.enabled }
        : { enabled: false };
    const document: MapDocument = {
      schema: 3,
      navigation,
      ...(grid ? { grid } : {}),
      vision,
      slug: typeof input.slug === "string" && input.slug.length > 0 ? input.slug : "custom",
      name: typeof input.name === "string" && input.name.length > 0 ? input.name : "新地图",
      size,
      biome: typeof input.biome === "string" && input.biome.length > 0 ? input.biome : "frontier",
      players: players.length === 2 ? players : DEFAULT_PLAYERS.map((player) => ({ ...player })),
      sites,
      roads,
      objectives,
      startGold:
        typeof input.startGold === "number" && Number.isFinite(input.startGold)
          ? Math.max(0, Math.round(input.startGold))
          : 0,
      transit: input.transit === "open" ? "open" : "friendly",
      visual: visualFromUnknown(
        input.visual,
        20261102,
        navigation === "grid" ? centeredBounds(size) : fallbackBounds(sites, size),
      ),
    };
    return { document, diagnostics: compileDocument(document).diagnostics };
  }

  try {
    const map = validateMap(input);
    const document = fromMapDef(map);
    return { document, diagnostics: compileDocument(document).diagnostics };
  } catch (error) {
    if (error instanceof ContentError) throw new Error(error.issues.join("；"));
    throw error;
  }
}

function polylineLengthDm(points: ReadonlyArray<readonly [number, number]>): number {
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
  }
  return Math.max(1, Math.round(total));
}

export interface CompileOptions {
  /** 编辑器拖动时可跳过网格可达性 A*，保存/试玩前再完整校验。 */
  readonly validateNavigation?: boolean;
}

export function compileDocument(document: MapDocument, options: CompileOptions = {}): CompileResult {
  const diagnostics: EditorDiagnostic[] = [];
  const seenMessages = new Set<string>();
  const add = (diagnostic: EditorDiagnostic): void => {
    if (seenMessages.has(diagnostic.message)) return;
    seenMessages.add(diagnostic.message);
    diagnostics.push(diagnostic);
  };
  const error = (
    code: string,
    message: string,
    siteId?: string,
    road?: [string, string],
    propId?: string,
  ): void => {
    add({
      severity: "error",
      code,
      message,
      ...(siteId ? { siteId } : {}),
      ...(road ? { road } : {}),
      ...(propId ? { propId } : {}),
    });
  };
  const warning = (code: string, message: string, siteId?: string): void => {
    add({ severity: "warning", code, message, ...(siteId ? { siteId } : {}) });
  };

  if (document.players.length !== 2) error("players", "地图必须恰好有两名玩家");
  if (document.size[0] < 100 || document.size[1] < 100) error("size", "地图尺寸至少为 100 x 100");
  const bounds = documentBounds(document);
  if (document.visual.foundations.length === 0) error("foundation-empty", "地图至少需要一块地基");
  const foundationIds = new Set<string>();
  for (const foundation of document.visual.foundations) {
    if (foundationIds.has(foundation.id)) {
      error("foundation-duplicate", `地基编号重复：${foundation.id}`);
    }
    foundationIds.add(foundation.id);
    if (foundation.size[0] < MIN_FOUNDATION_SIZE_DM || foundation.size[1] < MIN_FOUNDATION_SIZE_DM) {
      error("foundation-size", `${foundation.id} 的尺寸不能小于 ${MIN_FOUNDATION_SIZE_DM / 10} 米`);
    }
    if (foundation.size[0] > MAX_FOUNDATION_SIZE_DM || foundation.size[1] > MAX_FOUNDATION_SIZE_DM) {
      error("foundation-size", `${foundation.id} 的尺寸不能大于 ${MAX_FOUNDATION_SIZE_DM / 10} 米`);
    }
  }
  for (let a = 0; a < document.visual.foundations.length; a += 1) {
    for (let b = a + 1; b < document.visual.foundations.length; b += 1) {
      const first = document.visual.foundations[a];
      const second = document.visual.foundations[b];
      if (Math.abs(first.elevation - second.elevation) > 0.001) continue;
      const overlap = overlapArea(first, second);
      if (overlap > 0) warning("foundation-overlap", `${first.id} 与 ${second.id} 在同一高度重叠`);
    }
  }

  const gridProblems = document.grid ? gridIssues(document.grid, document.size) : [];
  if (document.navigation === "grid" && !document.grid) error("grid", "网格地图缺少网格数据");
  for (const issue of gridProblems) error("grid", issue);
  if (document.navigation === "graph" && document.grid) {
    warning("grid-unused", "当前为据点图模式，网格数据不会参与导航");
  }
  if (
    options.validateNavigation !== false &&
    document.navigation === "grid" &&
    document.grid &&
    gridProblems.length === 0
  ) {
    for (const issue of gridNavigationIssues(document.grid, document.size, document.sites)) {
      error("grid-nav", issue.message, issue.siteId);
    }
  }

  const ids = new Set<string>();
  const siteById = new Map<string, SiteDraft>();
  for (const site of document.sites) {
    if (ids.has(site.id)) error("duplicate-site", `据点编号重复：${site.id}`, site.id);
    ids.add(site.id);
    siteById.set(site.id, site);
    if (site.pos[0] < bounds.minX || site.pos[0] > bounds.maxX) {
      error("site-outside", `${site.id} 超出地图左右边界`, site.id);
    }
    if (site.pos[1] < bounds.minZ || site.pos[1] > bounds.maxZ) {
      error("site-outside", `${site.id} 超出地图上下边界`, site.id);
    }
    if (site.visualAssetId !== undefined && !isAssetId(site.visualAssetId)) {
      error("site-visual", `${site.id} 的外观资产 ID 无效`, site.id);
    }
  }

  if (document.navigation === "graph" && document.visual.foundations.length > 0) {
    for (const site of document.sites) {
      if (document.visual.foundations.some((foundation) => foundationContains(foundation, site.pos[0], site.pos[1]))) {
        continue;
      }
      warning("site-off-foundation", `${site.id} 不在地基上`, site.id);
    }
  }

  const producers = document.sites.filter((site) => isProductionSiteKind(site.kind));
  if (producers.length < 2) error("producer-count", "地图至少需要两个产兵据点");
  if (!producers.some((site) => site.owner === 1)) warning("no-player-producer", "绿方没有起始产兵据点");
  if (!producers.some((site) => site.owner === 2)) warning("no-enemy-producer", "红方没有起始产兵据点");

  const heightField = createHeightField({
    cities: document.sites.map((site) => [site.pos[0] / 10, site.pos[1] / 10] as [number, number]),
    terrain: document.visual.terrain,
  });
  const roadKeys = new Set<string>();
  const roadIds = new Set<string>();
  const edges: MapDef["edges"] = [];
  const adjacency = new Map<string, string[]>();
  for (const site of document.sites) adjacency.set(site.id, []);
  const mapRoads: NonNullable<MapDef["roads"]> = [];
  for (const road of document.roads) {
    if (roadIds.has(road.id)) {
      error("duplicate-road-id", `道路编号重复：${road.id}`, undefined, [road.from ?? "", road.to ?? ""]);
    }
    roadIds.add(road.id);
    const from = road.from;
    const to = road.to;
    const hasFrom = typeof from === "string" && from.length > 0;
    const hasTo = typeof to === "string" && to.length > 0;
    if (hasFrom && !siteById.has(from as string)) {
      error("unknown-road", `道路引用了不存在的据点：${from}`, undefined, [from as string, to ?? ""]);
      continue;
    }
    if (hasTo && !siteById.has(to as string)) {
      error("unknown-road", `道路引用了不存在的据点：${to}`, undefined, [from ?? "", to as string]);
      continue;
    }
    if (hasFrom && hasTo && from === to) {
      error("self-road", "道路不能连接自身", from as string, [from as string, to as string]);
      continue;
    }
    if (hasFrom && hasTo) {
      const key = (from as string) < (to as string) ? `${from}|${to}` : `${to}|${from}`;
      if (roadKeys.has(key)) {
        error("duplicate-road", `道路重复：${from} → ${to}`, undefined, [from as string, to as string]);
        continue;
      }
      roadKeys.add(key);
    }

    let path = road.path;
    if (path !== undefined) {
      if (path.length < 2) {
        error("road-path", `${road.id} 至少需要两个控制点`, undefined, [from ?? "", to ?? ""]);
        path = undefined;
      } else {
        for (const point of path) {
          if (point[0] < bounds.minX || point[0] > bounds.maxX || point[1] < bounds.minZ || point[1] > bounds.maxZ) {
            error("road-path", `${road.id} 的控制点超出地图边界`, undefined, [from ?? "", to ?? ""]);
            path = undefined;
            break;
          }
        }
      }
    }
    if (path === undefined && (!hasFrom || !hasTo)) {
      error("road-path", `${road.id} 是自由道路，必须提供控制点`, undefined, [from ?? "", to ?? ""]);
      continue;
    }
    if (road.widthDm !== undefined && (road.widthDm < 6 || road.widthDm > 60)) {
      error("road-width", `${road.id} 的宽度必须在 6 到 60 分米之间`, undefined, [from ?? "", to ?? ""]);
    }

    if (hasFrom && hasTo) {
      const a = siteById.get(from as string) as SiteDraft;
      const b = siteById.get(to as string) as SiteDraft;
      const length =
        path && path.length >= 2
          ? polylineLengthDm(path)
          : Math.max(1, Math.round(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])));
      const grade = edgeGrade(
        heightField,
        [a.pos[0] / 10, a.pos[1] / 10],
        [b.pos[0] / 10, b.pos[1] / 10],
        length,
      );
      edges.push({
        from: from as string,
        to: to as string,
        length,
        ...(document.navigation === "graph" && grade > 0.01 ? { grade: Math.round(grade * 1000) / 1000 } : {}),
        ...(path ? { path: path.map((point) => [point[0], point[1]] as [number, number]) } : {}),
        ...(road.widthDm !== undefined ? { widthDm: road.widthDm } : {}),
      });
      adjacency.get(from as string)?.push(to as string);
      adjacency.get(to as string)?.push(from as string);
    }

    if (path && path.length >= 2) {
      mapRoads.push({
        ...(hasFrom ? { from } : {}),
        ...(hasTo ? { to } : {}),
        points: path.map((point) => [point[0], point[1]] as [number, number]),
        widthDm: road.widthDm ?? Math.round(document.visual.roads.width * 10),
      });
    }
  }

  for (const site of document.sites) {
    const degree = adjacency.get(site.id)?.length ?? 0;
    if (document.navigation === "graph" && !isProductionSiteKind(site.kind) && degree !== 1) {
      error("leaf-site", `${site.id} 是${site.kind === "granary" ? "粮仓" : "驻兵点"}，只能连接一条道路`, site.id);
    }
    if (site.kind !== "outpost") continue;
    if (!site.watch) {
      error("outpost-watch", `${site.id} 还没有设置监视道路`, site.id);
      continue;
    }
    const watchKey = site.watch[0] < site.watch[1] ? `${site.watch[0]}|${site.watch[1]}` : `${site.watch[1]}|${site.watch[0]}`;
    if (!roadKeys.has(watchKey)) {
      error("outpost-watch-edge", `${site.id} 的监视道路不存在`, site.id, site.watch);
      continue;
    }
    const neighbors = adjacency.get(site.id) ?? [];
    if (neighbors.length === 1 && !site.watch.includes(neighbors[0])) {
      error("outpost-spur", `${site.id} 的支路必须连接监视道路的一个端点`, site.id);
    }
  }

  if (document.navigation === "graph" && document.sites.length > 0) {
    const first = document.sites[0].id;
    const seen = new Set<string>();
    const queue = [first];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) queue.push(next);
    }
    if (seen.size !== document.sites.length) error("disconnected", "地图道路没有把所有据点连成一张图");
  }

  if (!document.objectives.some((objective) => objective.type === "capture_all")) {
    error("objective", "地图目标必须包含占领全部城镇");
  }

  const visualErrors = validateVisual(document);
  for (const issue of visualErrors) error(issue.code, issue.message, undefined, undefined, issue.propId);

  let packedGrid: MapGridDef | undefined;
  if (document.navigation === "grid" && document.grid && gridProblems.length === 0) {
    try {
      const rasterized = rasterizeRoadSurface(document.grid, document.size, document.roads);
      const packed = {
        ...document.grid,
        surface: Array.from(rasterized.surface),
        heightCm: rasterized.heightCm,
      };
      packedGrid = packGridDraft(packed);
    } catch (caught) {
      error("grid", caught instanceof Error ? caught.message : "网格数据打包失败");
    }
  }

  const map: MapDef = {
    schema: 2,
    navigation: document.navigation,
    ...(packedGrid ? { grid: packedGrid } : {}),
    slug: document.slug,
    name: document.name,
    biome: document.biome,
    size: [document.size[0], document.size[1]],
    scale: 0.1,
    ruleset: "1",
    players: document.players.map((player) => ({ ...player })),
    cities: document.sites.map((site) => {
      const footprintCm = site.footprintDm !== undefined
        ? Math.round(site.footprintDm * 10)
        : document.navigation === "grid"
          ? DEFAULT_FOOTPRINT_DM * 10
          : undefined;
      const captureRadiusCm = site.captureRadiusDm !== undefined
        ? Math.round(site.captureRadiusDm * 10)
        : document.navigation === "grid"
          ? DEFAULT_CAPTURE_RADIUS_DM * 10
          : undefined;
      return {
        id: site.id,
        kind: site.kind,
        owner: site.owner,
        level: isProductionSiteKind(site.kind) ? site.level : 1,
        pop: site.pop,
        pos: [site.pos[0], site.pos[1]],
        layer: 0,
        ...(site.kind === "outpost"
          ? {
              stance: site.stance ?? "evade",
              ...(site.watch ? { watch: [site.watch[0], site.watch[1]] as [string, string] } : {}),
            }
          : {}),
        ...(site.transit ? { transit: site.transit } : {}),
        ...(footprintCm !== undefined ? { footprintCm } : {}),
        ...(captureRadiusCm !== undefined ? { captureRadiusCm } : {}),
      };
    }),
    edges,
    ...(mapRoads.length > 0 ? { roads: mapRoads } : {}),
    objectives: document.objectives.map((objective) => ({ ...objective })),
    startGold: document.startGold ?? 0,
    transit: document.transit,
  };
  map.mapHash = mapHashOf(map);

  try {
    validateMap(map);
  } catch (caught) {
    if (caught instanceof ContentError) {
      for (const issue of caught.issues) error("map", issue);
    } else {
      error("map", caught instanceof Error ? caught.message : "地图校验失败");
    }
  }

  return { map, visual: compileVisual(document), diagnostics };
}

function validateVisual(document: MapDocument): Array<{ code: string; message: string; propId?: string }> {
  const issues: Array<{ code: string; message: string; propId?: string }> = [];
  if (!(TERRAIN_STYLE_IDS as readonly string[]).includes(document.visual.terrain.style)) {
    issues.push({ code: "terrain-style", message: `不支持的地貌风格：${String(document.visual.terrain.style)}` });
  }
  if (!isRoadStyle(document.visual.roads.style)) {
    issues.push({ code: "road-style", message: `不支持的道路风格：${String(document.visual.roads.style)}` });
  }
  if (document.visual.roads.width < 0.6 || document.visual.roads.width > 6) {
    issues.push({ code: "road-width", message: "道路宽度必须在 0.6 到 6 之间" });
  }
  if (document.visual.props.length > MAX_PROPS) {
    issues.push({ code: "prop-count", message: `装饰不能超过 ${MAX_PROPS} 个` });
  }
  const ids = new Set<string>();
  for (const prop of document.visual.props) {
    if (ids.has(prop.id)) {
      issues.push({ code: "duplicate-prop", message: `装饰编号重复：${prop.id}`, propId: prop.id });
    }
    ids.add(prop.id);
    if (!isAssetId(prop.assetId)) {
      issues.push({ code: "prop-asset", message: `${prop.id} 的资产 ID 无效`, propId: prop.id });
    }
    const bounds = documentBounds(document);
    if (
      prop.pos[0] < bounds.minX ||
      prop.pos[0] > bounds.maxX ||
      prop.pos[1] < bounds.minZ ||
      prop.pos[1] > bounds.maxZ
    ) {
      issues.push({ code: "prop-outside", message: `${prop.id} 超出地图边界`, propId: prop.id });
    }
    if (prop.scale < 0.1 || prop.scale > 10) {
      issues.push({ code: "prop-scale", message: `${prop.id} 的缩放超出范围`, propId: prop.id });
    }
  }
  return issues;
}

export function serializeDocument(document: MapDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function documentLabel(document: MapDocument): string {
  return document.name.trim() || document.slug || "未命名地图";
}