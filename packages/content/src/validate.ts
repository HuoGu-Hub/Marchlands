import {
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
} from "@marchlands/nav";
import type {
  Level,
  MapCity,
  MapDef,
  MapEdge,
  MapPlayer,
  PlayerId,
  Ruleset,
  SiteKind,
  Stance,
} from "@marchlands/sim";
import { isProductionSiteKind, mapHashOf } from "@marchlands/sim";

export class ContentError extends Error {
  readonly issues: string[];

  constructor(kind: string, issues: string[]) {
    super(`${kind}: ${issues.join("; ")}`);
    this.name = "ContentError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireInt(value: unknown, label: string, issues: string[], min?: number): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    issues.push(`${label} must be an integer`);
    return 0;
  }
  if (min !== undefined && value < min) issues.push(`${label} must be >= ${min}`);
  return value;
}

function requireNumber(value: unknown, label: string, issues: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push(`${label} must be a finite number`);
    return 0;
  }
  return value;
}

function edgeKey(from: string, to: string): string {
  return from < to ? `${from}|${to}` : `${to}|${from}`;
}

function requireBase64<T>(
  value: unknown,
  label: string,
  issues: string[],
  decode: (text: string) => T,
): T | null {
  if (typeof value !== "string") {
    issues.push(`${label} must be a base64 string`);
    return null;
  }
  try {
    return decode(value);
  } catch (error) {
    issues.push(`${label} invalid: ${error instanceof Error ? error.message : "base64 error"}`);
    return null;
  }
}

function validateGrid(grid: Record<string, unknown>, width: number, height: number, issues: string[]): void {
  const cellSize = requireInt(grid.cellSizeCm, "grid.cellSizeCm", issues, 1);
  if (cellSize !== 100) issues.push("grid.cellSizeCm must be 100");
  const gridWidth = requireInt(grid.width, "grid.width", issues, 1);
  const gridHeight = requireInt(grid.height, "grid.height", issues, 1);
  if (gridWidth > 0 && cellSize > 0 && width > 0 && gridWidth * cellSize !== width * 10) {
    issues.push(`grid.width * grid.cellSizeCm must equal map width in cm (${width * 10})`);
  }
  if (gridHeight > 0 && cellSize > 0 && height > 0 && gridHeight * cellSize !== height * 10) {
    issues.push(`grid.height * grid.cellSizeCm must equal map height in cm (${height * 10})`);
  }
  const cells = gridWidth * gridHeight;
  if (cells <= 0) return;

  requireBase64(grid.heightCm, "grid.heightCm", issues, (text) => decodeInt16Base64(text, cells));
  const surfaces = requireBase64(grid.surface, "grid.surface", issues, (text) => decodeUint8Base64(text, cells));
  if (surfaces) {
    for (let index = 0; index < surfaces.length; index += 1) {
      if (surfaces[index] > 9) {
        issues.push(`grid.surface[${index}] must be 0..9`);
        break;
      }
    }
  }
  requireBase64(grid.blocked, "grid.blocked", issues, (text) => decodeBitmapBase64(text, cells));
  requireBase64(grid.walkableOverride, "grid.walkableOverride", issues, (text) =>
    decodeBitmapBase64(text, cells),
  );
}

export function validateMap(input: unknown): MapDef {
  if (!isRecord(input)) throw new ContentError("map", ["root must be an object"]);
  const issues: string[] = [];

  if (input.schema !== 1 && input.schema !== 2) issues.push("schema must be 1 or 2");
  if (typeof input.slug !== "string" || input.slug.length === 0) issues.push("slug required");
  if (typeof input.name !== "string" || input.name.length === 0) issues.push("name required");
  if (typeof input.biome !== "string" || input.biome.length === 0) issues.push("biome required");
  if (typeof input.ruleset !== "string" || input.ruleset.length === 0) issues.push("ruleset required");

  const size = Array.isArray(input.size) ? input.size : [];
  if (size.length !== 2) issues.push("size must be [width, height]");
  const width = requireInt(size[0], "size[0]", issues, 1);
  const height = requireInt(size[1], "size[1]", issues, 1);
  requireNumber(input.scale, "scale", issues);

  const schema = input.schema;
  const navigation = input.navigation;
  if (schema === 2) {
    if (navigation !== "graph" && navigation !== "grid") issues.push("navigation must be graph or grid");
    if (typeof input.mapHash !== "string" || !/^[0-9a-f]{16}$/.test(input.mapHash)) {
      issues.push("mapHash must be 16 lowercase hex characters");
    }
  } else if (schema === 1) {
    if (navigation !== undefined && navigation !== "graph") issues.push("schema 1 maps are graph navigation");
    if (input.grid !== undefined) issues.push("schema 1 maps cannot carry a grid");
  }
  const gridMode = navigation === "grid";
  if (gridMode) {
    if (!isRecord(input.grid)) issues.push("grid required for grid navigation");
    else validateGrid(input.grid, width, height, issues);
  } else if (input.grid !== undefined) {
    issues.push("grid only allowed for grid navigation");
  }

  const players = Array.isArray(input.players) ? input.players : [];
  if (players.length !== 2) issues.push("players must contain exactly 2 entries");
  const playerIds = new Set<number>();
  players.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`players[${index}] must be an object`);
      return;
    }
    const id = requireInt(entry.id, `players[${index}].id`, issues);
    if (id !== 1 && id !== 2) issues.push(`players[${index}].id must be 1 or 2`);
    if (playerIds.has(id)) issues.push(`players[${index}].id duplicated`);
    playerIds.add(id);
    if (typeof entry.name !== "string" || entry.name.length === 0) issues.push(`players[${index}].name required`);
    if (typeof entry.color !== "string" || entry.color.length === 0) issues.push(`players[${index}].color required`);
    if (typeof entry.ai !== "boolean") issues.push(`players[${index}].ai must be boolean`);
  });

  const cities = Array.isArray(input.cities) ? input.cities : [];
  if (cities.length < 2) issues.push("cities must contain at least 2 entries");
  const cityIds = new Set<string>();
  const cityKinds = new Map<string, unknown>();
  const watches = new Map<string, [string, string]>();
  const positions = new Map<string, [number, number]>();
  cities.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`cities[${index}] must be an object`);
      return;
    }
    const id = entry.id;
    if (typeof id !== "string" || id.length === 0) {
      issues.push(`cities[${index}].id required`);
      return;
    }
    if (cityIds.has(id)) issues.push(`cities[${index}].id duplicated: ${id}`);
    cityIds.add(id);
    const kind = entry.kind;
    cityKinds.set(id, kind);
    if (!isProductionSiteKind(kind as SiteKind) && kind !== "granary" && kind !== "outpost") {
      issues.push(`cities[${id}].kind must be a producing site, granary or outpost`);
    }
    const owner = requireInt(entry.owner, `cities[${id}].owner`, issues, 0);
    if (owner !== 0 && !playerIds.has(owner)) issues.push(`cities[${id}].owner must be 0 or a player id`);
    const level = requireInt(entry.level, `cities[${id}].level`, issues, 1);
    if (isProductionSiteKind(kind as SiteKind)) {
      if (level !== 1 && level !== 2 && level !== 3) issues.push(`cities[${id}].level must be 1..3`);
    } else if (kind === "granary" || kind === "outpost") {
      if (level !== 1) issues.push(`cities[${id}].level must be 1 for ${kind}`);
    }
    requireInt(entry.pop, `cities[${id}].pop`, issues, 0);
    requireInt(entry.layer, `cities[${id}].layer`, issues, 0);
    if (entry.footprintCm !== undefined) {
      requireInt(entry.footprintCm, `cities[${id}].footprintCm`, issues, 1);
    }
    if (entry.captureRadiusCm !== undefined) {
      requireInt(entry.captureRadiusCm, `cities[${id}].captureRadiusCm`, issues, 1);
    }
    const pos = Array.isArray(entry.pos) ? entry.pos : [];
    if (pos.length !== 2) {
      issues.push(`cities[${id}].pos must be [x, z]`);
    } else {
      const x = requireInt(pos[0], `cities[${id}].pos[0]`, issues);
      const z = requireInt(pos[1], `cities[${id}].pos[1]`, issues);
      if (width > 0 && Math.abs(x) > width / 2) issues.push(`cities[${id}].pos[0] outside map`);
      if (height > 0 && Math.abs(z) > height / 2) issues.push(`cities[${id}].pos[1] outside map`);
      positions.set(id, [x, z]);
    }

    if (kind === "outpost") {
      const watch = entry.watch;
      if (!Array.isArray(watch) || watch.length !== 2 || typeof watch[0] !== "string" || typeof watch[1] !== "string") {
        issues.push(`cities[${id}].watch must be [from, to]`);
      } else if (watch[0] === watch[1]) {
        issues.push(`cities[${id}].watch must reference two different sites`);
      } else {
        watches.set(id, [watch[0], watch[1]]);
      }
      const stance = entry.stance;
      if (stance !== undefined && stance !== "evade" && stance !== "engage") {
        issues.push(`cities[${id}].stance must be evade or engage`);
      }
    } else {
      if (entry.watch !== undefined) issues.push(`cities[${id}].watch only allowed on outpost`);
      if (entry.stance !== undefined) issues.push(`cities[${id}].stance only allowed on outpost`);
    }
  });

  const edges = Array.isArray(input.edges) ? input.edges : [];
  const edgeKeys = new Set<string>();
  edges.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`edges[${index}] must be an object`);
      return;
    }
    const from = entry.from;
    const to = entry.to;
    if (typeof from !== "string" || !cityIds.has(from)) issues.push(`edges[${index}].from unknown`);
    if (typeof to !== "string" || !cityIds.has(to)) issues.push(`edges[${index}].to unknown`);
    if (from === to) issues.push(`edges[${index}] is a self loop`);
    const length = requireInt(entry.length, `edges[${index}].length`, issues, 1);
    if (entry.grade !== undefined) {
      const grade = requireNumber(entry.grade, `edges[${index}].grade`, issues);
      if (grade < 0 || grade > 1) issues.push(`edges[${index}].grade must be in [0, 1]`);
    }
    if (typeof from === "string" && typeof to === "string") {
      const key = edgeKey(from, to);
      if (edgeKeys.has(key)) issues.push(`edges[${index}] duplicated: ${key}`);
      edgeKeys.add(key);
      const a = positions.get(from);
      const b = positions.get(to);
      if (entry.widthDm !== undefined) {
        const width = requireNumber(entry.widthDm, `edges[${index}].widthDm`, issues);
        if (width < 6 || width > 60) issues.push(`edges[${index}].widthDm must be in [6, 60]`);
      }
      let expected: number | null = null;
      if (entry.path !== undefined) {
        const path = Array.isArray(entry.path) ? entry.path : [];
        if (path.length < 2) {
          issues.push(`edges[${index}].path must contain at least 2 points`);
        } else {
          let total = 0;
          let valid = true;
          for (let pointIndex = 0; pointIndex < path.length; pointIndex += 1) {
            const point = path[pointIndex];
            if (
              !Array.isArray(point) ||
              point.length !== 2 ||
              typeof point[0] !== "number" ||
              typeof point[1] !== "number" ||
              !Number.isFinite(point[0]) ||
              !Number.isFinite(point[1])
            ) {
              issues.push(`edges[${index}].path[${pointIndex}] must be [x, z]`);
              valid = false;
              break;
            }
            if (pointIndex > 0) {
              total += Math.hypot(point[0] - path[pointIndex - 1][0], point[1] - path[pointIndex - 1][1]);
            }
          }
          if (valid) expected = Math.max(1, Math.round(total));
        }
      } else if (a && b) {
        expected = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
      }
      if (expected !== null && Math.abs(expected - length) > 1) {
        issues.push(`edges[${index}].length ${length} does not match positions (expected ${expected})`);
      }
    }
  });

  const adjacency = new Map<string, string[]>();
  for (const id of cityIds) adjacency.set(id, []);
  for (const edge of edges as MapEdge[]) {
    if (typeof edge.from !== "string" || typeof edge.to !== "string") continue;
    adjacency.get(edge.from)?.push(edge.to);
    adjacency.get(edge.to)?.push(edge.from);
  }

  const producerCount = [...cityKinds.values()].filter((kind) => isProductionSiteKind(kind as SiteKind)).length;
  if (producerCount < 2) issues.push("map must contain at least 2 producing sites");

  for (const [id, kind] of cityKinds) {
    if (!gridMode && (kind === "granary" || kind === "outpost")) {
      const degree = adjacency.get(id)?.length ?? 0;
      if (degree !== 1) issues.push(`cities[${id}] ${kind} must be a leaf site`);
    }
    if (kind !== "outpost") continue;
    const watch = watches.get(id);
    if (!watch) continue;
    if (!cityIds.has(watch[0]) || !cityIds.has(watch[1])) {
      issues.push(`cities[${id}].watch references unknown city`);
      continue;
    }
    if (watch[0] === id || watch[1] === id) {
      issues.push(`cities[${id}].watch cannot include itself`);
    }
    if (!edgeKeys.has(edgeKey(watch[0], watch[1]))) {
      issues.push(`cities[${id}].watch edge not found`);
    }
    const neighbors = adjacency.get(id) ?? [];
    if (neighbors.length === 1 && !watch.includes(neighbors[0])) {
      issues.push(`cities[${id}] spur must touch one endpoint of watch edge`);
    }
  }

  if (issues.length === 0 && !gridMode) {
    const first = [...cityIds].sort()[0];
    const seen = new Set<string>();
    const queue = first ? [first] : [];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) queue.push(next);
    }
    if (seen.size !== cityIds.size) issues.push("graph is not connected");
  }

  const objectives = Array.isArray(input.objectives) ? input.objectives : [];
  if (!objectives.some((objective) => isRecord(objective) && objective.type === "capture_all")) {
    issues.push("objectives must include capture_all");
  }

  if (input.roads !== undefined) {
    if (!Array.isArray(input.roads)) {
      issues.push("roads must be an array");
    } else {
      input.roads.forEach((road, index) => {
        if (!isRecord(road)) {
          issues.push(`roads[${index}] must be an object`);
          return;
        }
        const points = Array.isArray(road.points) ? road.points : [];
        if (points.length < 2) issues.push(`roads[${index}].points must contain at least 2 points`);
        for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
          const point = points[pointIndex];
          if (
            !Array.isArray(point) ||
            point.length !== 2 ||
            typeof point[0] !== "number" ||
            typeof point[1] !== "number" ||
            !Number.isFinite(point[0]) ||
            !Number.isFinite(point[1])
          ) {
            issues.push(`roads[${index}].points[${pointIndex}] must be [x, z]`);
            break;
          }
        }
        if (typeof road.widthDm !== "number" || road.widthDm < 6 || road.widthDm > 60) {
          issues.push(`roads[${index}].widthDm must be in [6, 60]`);
        }
        for (const key of ["from", "to"] as const) {
          const value = road[key];
          if (value === undefined) continue;
          if (typeof value !== "string" || !cityIds.has(value)) {
            issues.push(`roads[${index}].${key} references an unknown city`);
          }
        }
      });
    }
  }

  if (schema === 2 && typeof input.mapHash === "string" && /^[0-9a-f]{16}$/.test(input.mapHash)) {
    try {
      if (mapHashOf(input as unknown as MapDef) !== input.mapHash) issues.push("mapHash does not match map content");
    } catch {
      issues.push("mapHash could not be computed");
    }
  }

  if (issues.length > 0) throw new ContentError("map", issues);
  return input as unknown as MapDef;
}

export function validateRules(input: unknown): Ruleset {
  if (!isRecord(input)) throw new ContentError("rules", ["root must be an object"]);
  const issues: string[] = [];

  if (typeof input.ruleset !== "string" || input.ruleset.length === 0) issues.push("ruleset required");
  const tickHz = requireInt(input.tickHz, "tickHz", issues, 1);
  requireInt(input.maxTicks, "maxTicks", issues, 1);
  const sendRatio = requireNumber(input.sendRatio, "sendRatio", issues);
  if (sendRatio <= 0 || sendRatio > 1) issues.push("sendRatio must be in (0, 1]");
  const speed = requireNumber(input.speedDmPerSecond, "speedDmPerSecond", issues);
  if (speed <= 0) issues.push("speedDmPerSecond must be > 0");
  const maxLevel = requireInt(input.maxLevel, "maxLevel", issues, 1);
  if (tickHz !== 20) issues.push("tickHz must be 20");

  const levels = Array.isArray(input.levels) ? input.levels : [];
  if (levels.length !== maxLevel) issues.push("levels length must equal maxLevel");
  const seen = new Set<number>();
  levels.forEach((entry, index) => {
    if (!isRecord(entry)) {
      issues.push(`levels[${index}] must be an object`);
      return;
    }
    const level = requireInt(entry.level, `levels[${index}].level`, issues, 1);
    if (seen.has(level)) issues.push(`levels[${index}].level duplicated`);
    seen.add(level);
    const maxPop = requireInt(entry.maxPop, `levels[${index}].maxPop`, issues, 1);
    const cost = requireInt(entry.upgradeCost, `levels[${index}].upgradeCost`, issues, 1);
    if (cost !== Math.floor(maxPop / 2)) issues.push(`levels[${index}].upgradeCost must be floor(maxPop / 2)`);
    const defense = requireNumber(entry.defense, `levels[${index}].defense`, issues);
    if (defense < 1) issues.push(`levels[${index}].defense must be >= 1`);
    requireInt(entry.growthMilli, `levels[${index}].growthMilli`, issues, 1);
    requireInt(entry.goldMilli, `levels[${index}].goldMilli`, issues, 1);
  });

  const granary = input.granary;
  if (!isRecord(granary)) {
    issues.push("granary required");
  } else {
    requireInt(granary.capacity, "granary.capacity", issues, 1);
    requireInt(granary.defenseMilli, "granary.defenseMilli", issues, 1);
    requireInt(granary.speedBonusMilli, "granary.speedBonusMilli", issues, 0);
    requireInt(granary.strengthBonusMilli, "granary.strengthBonusMilli", issues, 0);
  }

  const outpost = input.outpost;
  if (!isRecord(outpost)) {
    issues.push("outpost required");
  } else {
    requireInt(outpost.capacity, "outpost.capacity", issues, 1);
    requireInt(outpost.defenseMilli, "outpost.defenseMilli", issues, 1);
    requireInt(outpost.graceTicks, "outpost.graceTicks", issues, 0);
    requireInt(outpost.decayIntervalTicks, "outpost.decayIntervalTicks", issues, 1);
    requireInt(outpost.decayPerInterval, "outpost.decayPerInterval", issues, 1);
  }

  const supply = input.supply;
  if (!isRecord(supply)) {
    issues.push("supply required");
  } else {
    requireInt(supply.carryTicks, "supply.carryTicks", issues, 0);
    requireInt(supply.starveIntervalTicks, "supply.starveIntervalTicks", issues, 1);
    requireInt(supply.starveLoss, "supply.starveLoss", issues, 1);
  }

  if (issues.length > 0) throw new ContentError("rules", issues);
  return input as unknown as Ruleset;
}

export function validateContent(mapInput: unknown, rulesInput: unknown): { map: MapDef; rules: Ruleset } {
  const map = validateMap(mapInput);
  const rules = validateRules(rulesInput);
  const issues: string[] = [];
  if (map.ruleset !== rules.ruleset) issues.push(`map ruleset ${map.ruleset} does not match rules ${rules.ruleset}`);
  const timeLimit = map.objectives.find((objective) => objective.type === "time_limit");
  if (timeLimit && timeLimit.ticks !== rules.maxTicks) {
    issues.push(`time_limit ${timeLimit.ticks} does not match maxTicks ${rules.maxTicks}`);
  }
  for (const city of map.cities) {
    if (city.kind === "granary" && city.pop > rules.granary.capacity) {
      issues.push(`cities[${city.id}].pop exceeds granary capacity`);
    }
    if (city.kind === "outpost" && city.pop > rules.outpost.capacity) {
      issues.push(`cities[${city.id}].pop exceeds outpost capacity`);
    }
  }
  if (issues.length > 0) throw new ContentError("content", issues);
  return { map, rules };
}

export type { Level, MapCity, MapDef, MapEdge, MapPlayer, PlayerId, SiteKind, Stance };