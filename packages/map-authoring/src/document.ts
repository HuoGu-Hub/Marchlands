import { ContentError, validateMap } from "@marchlands/content";
import type { MapDef, MapPlayer } from "@marchlands/sim";
import type {
  CompileResult,
  EditorDiagnostic,
  MapDocument,
  MapVisual,
  ParsedDocument,
  PropDraft,
  RoadDraft,
  SiteDraft,
  TerrainDraft,
  VisualDraft,
} from "./types";
import { TERRAIN_STYLE_IDS } from "./types";
import { createHeightField, edgeGrade } from "./height";
import {
  cloneVisual,
  compileVisual,
  createDefaultVisual,
  createStarterVisual,
  isAssetId,
  isRoadStyle,
  isTerrainStyle,
  roadDraft,
  terrainDraft,
} from "./visual";

const DEFAULT_PLAYERS: MapPlayer[] = [
  { id: 1, name: "Player", color: "green", ai: false },
  { id: 2, name: "AI", color: "red", ai: true },
];

const MAX_PROPS = 2000;

function starterSites(): SiteDraft[] {
  return [
    { id: "c1", kind: "town", owner: 1, level: 3, pop: 30, pos: [-200, -150] },
    { id: "c2", kind: "town", owner: 2, level: 3, pop: 30, pos: [200, 150] },
    { id: "c3", kind: "town", owner: 0, level: 1, pop: 10, pos: [-200, 150] },
    { id: "c4", kind: "town", owner: 0, level: 1, pop: 10, pos: [200, -150] },
  ];
}

function starterRoads(): RoadDraft[] {
  return [
    { from: "c1", to: "c4" },
    { from: "c4", to: "c2" },
    { from: "c2", to: "c3" },
    { from: "c3", to: "c1" },
  ];
}

export function createStarterDocument(): MapDocument {
  const document: MapDocument = {
    schema: 2,
    slug: "custom",
    name: "新地图",
    size: [700, 700],
    biome: "frontier",
    players: DEFAULT_PLAYERS.map((player) => ({ ...player })),
    sites: starterSites(),
    roads: starterRoads(),
    objectives: [{ type: "capture_all" }, { type: "time_limit", ticks: 18000 }],
    transit: "friendly",
    visual: createDefaultVisual(),
  };
  document.visual = createStarterVisual(document);
  return document;
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
    roads: document.roads.map((road) => ({ ...road })),
    objectives: document.objectives.map((objective) => ({ ...objective })),
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
  if (value.kind !== "town" && value.kind !== "granary" && value.kind !== "outpost") return null;
  const pos = numberPair(value.pos);
  if (!pos) return null;
  const owner = value.owner === 1 || value.owner === 2 ? value.owner : 0;
  const level = value.level === 2 || value.level === 3 ? value.level : 1;
  const pop = typeof value.pop === "number" && Number.isFinite(value.pop) ? Math.max(0, Math.round(value.pop)) : 0;
  const site: SiteDraft = { id: value.id, kind: value.kind, owner, level, pop, pos };
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
  if (value.visualScale !== undefined) {
    const scale = finiteNumber(value.visualScale);
    if (scale === null || scale < 0.1 || scale > 10) throw new Error(`据点 ${site.id} 的外观缩放无效`);
    site.visualScale = scale;
  }
  return site;
}

function roadFromUnknown(value: unknown): RoadDraft | null {
  if (!asRecord(value)) return null;
  if (typeof value.from !== "string" || typeof value.to !== "string") return null;
  return { from: value.from, to: value.to };
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
  return {
    id: value.id,
    assetId: value.assetId,
    pos,
    rotation: ((rotation % 360) + 360) % 360,
    scale,
  };
}

function visualFromUnknown(value: unknown, fallbackSeed: number): VisualDraft {
  const fallback = createDefaultVisual(fallbackSeed);
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
  return { terrain, roads, props, units, scatter };
}

export function fromMapDef(map: MapDef): MapDocument {
  const visual = createDefaultVisual();
  visual.terrain.style = map.biome === "forest" ? "meadow" : "frontier";
  visual.roads.style = map.biome === "forest" ? "dirt" : "cobble";
  return {
    schema: 2,
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
    })),
    roads: map.edges.map((edge) => ({ from: edge.from, to: edge.to })),
    objectives: map.objectives.map((objective) => ({ ...objective })),
    transit: map.transit ?? "open",
    visual,
  };
}

export function parseDocument(input: unknown): ParsedDocument {
  if (!asRecord(input)) throw new Error("地图文件必须是 JSON 对象");
  if (Array.isArray(input.sites) && Array.isArray(input.roads)) {
    if (input.schema !== 1 && input.schema !== 2) throw new Error("不支持的地图文档版本");
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
      .map(roadFromUnknown)
      .filter((entry): entry is RoadDraft => entry !== null);
    if (roads.length !== input.roads.length) throw new Error("地图文件包含无效道路");
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
    const document: MapDocument = {
      schema: 2,
      slug: typeof input.slug === "string" && input.slug.length > 0 ? input.slug : "custom",
      name: typeof input.name === "string" && input.name.length > 0 ? input.name : "新地图",
      size,
      biome: typeof input.biome === "string" && input.biome.length > 0 ? input.biome : "frontier",
      players: players.length === 2 ? players : DEFAULT_PLAYERS.map((player) => ({ ...player })),
      sites,
      roads,
      objectives,
      transit: input.transit === "open" ? "open" : "friendly",
      visual: visualFromUnknown(input.visual, input.schema === 1 ? 20261102 : 20261102),
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

export function compileDocument(document: MapDocument): CompileResult {
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

  const ids = new Set<string>();
  const siteById = new Map<string, SiteDraft>();
  for (const site of document.sites) {
    if (ids.has(site.id)) error("duplicate-site", `据点编号重复：${site.id}`, site.id);
    ids.add(site.id);
    siteById.set(site.id, site);
    if (site.pos[0] < -document.size[0] / 2 || site.pos[0] > document.size[0] / 2) {
      error("site-outside", `${site.id} 超出地图左右边界`, site.id);
    }
    if (site.pos[1] < -document.size[1] / 2 || site.pos[1] > document.size[1] / 2) {
      error("site-outside", `${site.id} 超出地图上下边界`, site.id);
    }
    if (site.visualAssetId !== undefined && !isAssetId(site.visualAssetId)) {
      error("site-visual", `${site.id} 的外观资产 ID 无效`, site.id);
    }
  }

  const towns = document.sites.filter((site) => site.kind === "town");
  if (towns.length < 2) error("town-count", "地图至少需要两座城镇");
  if (!towns.some((site) => site.owner === 1)) warning("no-player-town", "绿方没有起始城镇");
  if (!towns.some((site) => site.owner === 2)) warning("no-enemy-town", "红方没有起始城镇");

  const heightField = createHeightField({
    cities: document.sites.map((site) => [site.pos[0] / 10, site.pos[1] / 10] as [number, number]),
    terrain: document.visual.terrain,
  });
  const roadKeys = new Set<string>();
  const edges: MapDef["edges"] = [];
  const adjacency = new Map<string, string[]>();
  for (const site of document.sites) adjacency.set(site.id, []);
  for (const road of document.roads) {
    const key = road.from < road.to ? `${road.from}|${road.to}` : `${road.to}|${road.from}`;
    if (road.from === road.to) {
      error("self-road", "道路不能连接自身", road.from, [road.from, road.to]);
      continue;
    }
    if (!siteById.has(road.from) || !siteById.has(road.to)) {
      error("unknown-road", `道路引用了不存在的据点：${road.from} → ${road.to}`, undefined, [road.from, road.to]);
      continue;
    }
    if (roadKeys.has(key)) {
      error("duplicate-road", `道路重复：${road.from} → ${road.to}`, undefined, [road.from, road.to]);
      continue;
    }
    roadKeys.add(key);
    const a = siteById.get(road.from) as SiteDraft;
    const b = siteById.get(road.to) as SiteDraft;
    const length = Math.max(1, Math.round(Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1])));
    const grade = edgeGrade(
      heightField,
      [a.pos[0] / 10, a.pos[1] / 10],
      [b.pos[0] / 10, b.pos[1] / 10],
      length,
    );
    edges.push({
      from: road.from,
      to: road.to,
      length,
      ...(grade > 0.01 ? { grade: Math.round(grade * 1000) / 1000 } : {}),
    });
    adjacency.get(road.from)?.push(road.to);
    adjacency.get(road.to)?.push(road.from);
  }

  for (const site of document.sites) {
    const degree = adjacency.get(site.id)?.length ?? 0;
    if (site.kind !== "town" && degree !== 1) {
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

  if (document.sites.length > 0) {
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

  const map: MapDef = {
    schema: 1,
    slug: document.slug,
    name: document.name,
    biome: document.biome,
    size: [document.size[0], document.size[1]],
    scale: 0.1,
    ruleset: "1",
    players: document.players.map((player) => ({ ...player })),
    cities: document.sites.map((site) => ({
      id: site.id,
      kind: site.kind,
      owner: site.owner,
      level: site.kind === "town" ? site.level : 1,
      pop: site.pop,
      pos: [site.pos[0], site.pos[1]],
      layer: 0,
      ...(site.kind === "outpost"
        ? {
            stance: site.stance ?? "evade",
            ...(site.watch ? { watch: [site.watch[0], site.watch[1]] as [string, string] } : {}),
          }
        : {}),
    })),
    edges,
    objectives: document.objectives.map((objective) => ({ ...objective })),
    transit: document.transit,
  };

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
    if (
      prop.pos[0] < -document.size[0] / 2 ||
      prop.pos[0] > document.size[0] / 2 ||
      prop.pos[1] < -document.size[1] / 2 ||
      prop.pos[1] > document.size[1] / 2
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