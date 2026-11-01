import type { Level, MapCity, MapDef, MapEdge, MapPlayer, PlayerId, Ruleset } from "@marchlands/sim";

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

export function validateMap(input: unknown): MapDef {
  if (!isRecord(input)) throw new ContentError("map", ["root must be an object"]);
  const issues: string[] = [];

  if (input.schema !== 1) issues.push("schema must be 1");
  if (typeof input.slug !== "string" || input.slug.length === 0) issues.push("slug required");
  if (typeof input.name !== "string" || input.name.length === 0) issues.push("name required");
  if (typeof input.biome !== "string" || input.biome.length === 0) issues.push("biome required");
  if (typeof input.ruleset !== "string" || input.ruleset.length === 0) issues.push("ruleset required");

  const size = Array.isArray(input.size) ? input.size : [];
  if (size.length !== 2) issues.push("size must be [width, height]");
  const width = requireInt(size[0], "size[0]", issues, 1);
  const height = requireInt(size[1], "size[1]", issues, 1);
  requireNumber(input.scale, "scale", issues);

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
    if (entry.kind !== "town") issues.push(`cities[${id}].kind must be town`);
    const owner = requireInt(entry.owner, `cities[${id}].owner`, issues, 0);
    if (owner !== 0 && !playerIds.has(owner)) issues.push(`cities[${id}].owner must be 0 or a player id`);
    const level = requireInt(entry.level, `cities[${id}].level`, issues, 1);
    if (level !== 1 && level !== 2 && level !== 3) issues.push(`cities[${id}].level must be 1..3`);
    requireInt(entry.pop, `cities[${id}].pop`, issues, 0);
    requireInt(entry.layer, `cities[${id}].layer`, issues, 0);
    const pos = Array.isArray(entry.pos) ? entry.pos : [];
    if (pos.length !== 2) {
      issues.push(`cities[${id}].pos must be [x, z]`);
      return;
    }
    const x = requireInt(pos[0], `cities[${id}].pos[0]`, issues);
    const z = requireInt(pos[1], `cities[${id}].pos[1]`, issues);
    if (width > 0 && Math.abs(x) > width / 2) issues.push(`cities[${id}].pos[0] outside map`);
    if (height > 0 && Math.abs(z) > height / 2) issues.push(`cities[${id}].pos[1] outside map`);
    positions.set(id, [x, z]);
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
    if (typeof from === "string" && typeof to === "string") {
      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      if (edgeKeys.has(key)) issues.push(`edges[${index}] duplicated: ${key}`);
      edgeKeys.add(key);
      const a = positions.get(from);
      const b = positions.get(to);
      if (a && b) {
        const expected = Math.round(Math.hypot(a[0] - b[0], a[1] - b[1]));
        if (Math.abs(expected - length) > 1) {
          issues.push(`edges[${index}].length ${length} does not match positions (expected ${expected})`);
        }
      }
    }
  });

  if (issues.length === 0) {
    const adjacency = new Map<string, string[]>();
    for (const id of cityIds) adjacency.set(id, []);
    for (const edge of edges as MapEdge[]) {
      adjacency.get(edge.from)?.push(edge.to);
      adjacency.get(edge.to)?.push(edge.from);
    }
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
  requireNumber(input.speedDmPerSecond, "speedDmPerSecond", issues);
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
  if (issues.length > 0) throw new ContentError("content", issues);
  return { map, rules };
}

export type { Level, MapCity, MapDef, MapEdge, MapPlayer, PlayerId };
