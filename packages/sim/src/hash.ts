import type { MapDef, SimState } from "./types";

const FNV_PRIME = 0x01000193;
const FNV_OFFSET = 0x811c9dc5;

export function hashText(text: string): string {
  const first = fnv1a(text, FNV_OFFSET);
  const second = fnv1a(text, 0x9e3779b9);
  return first.toString(16).padStart(8, "0") + second.toString(16).padStart(8, "0");
}

function fnv1a(text: string, seed: number): number {
  let value = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, FNV_PRIME) >>> 0;
  }
  return value >>> 0;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return "null";
}

/** 地图内容哈希，排除 mapHash 字段本身。 */
export function mapHashOf(map: MapDef): string {
  const rest: Record<string, unknown> = { ...map };
  delete rest.mapHash;
  return hashText(canonicalJson(rest));
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function canonicalState(state: SimState): string {
  const parts: string[] = [];
  parts.push(`t${state.tick}`);
  parts.push(`slug${state.slug}`);
  parts.push(`seed${state.seed}`);
  parts.push(`status${state.status}`);
  parts.push(`winner${state.winner}`);
  parts.push(`reason${state.finishReason ?? "-"}`);
  parts.push(`next${state.nextSquad}`);
  parts.push(`ruleset${state.rules.ruleset}`);
  for (const level of state.rules.levels) {
    parts.push(
      `L${level.level},${level.maxPop},${level.upgradeCost},${level.defense},${level.growthMilli},${level.goldMilli}`,
    );
  }
  parts.push(`ticks${state.rules.maxTicks}`);
  parts.push(`send${state.rules.sendRatio}`);
  parts.push(`speed${state.rules.speedDmPerSecond}`);
  const granary = state.rules.granary;
  parts.push(
    `G,${granary.capacity},${granary.defenseMilli},${granary.speedBonusMilli},${granary.strengthBonusMilli}`,
  );
  const outpost = state.rules.outpost;
  parts.push(
    `O,${outpost.capacity},${outpost.defenseMilli},${outpost.graceTicks},${outpost.decayIntervalTicks},${outpost.decayPerInterval}`,
  );
  const supply = state.rules.supply;
  parts.push(`F,${supply.carryTicks},${supply.starveIntervalTicks},${supply.starveLoss}`);
  for (const player of state.players.slice().sort((a, b) => a.id - b.id)) {
    parts.push(`P${player.id},${player.gold},${player.goldCarry}`);
  }
  for (const city of state.cities.slice().sort(byId)) {
    parts.push(
      `C${city.id},${city.kind},${city.owner},${city.level},${city.pop},${city.maxPop},${city.growthCarry},${city.layer},${city.pos[0]},${city.pos[1]},${city.stance},${city.decayAtTick},${city.watch ? city.watch.join(">") : "-"}`,
    );
  }
  for (const squad of state.squads.slice().sort(byId)) {
    const grid =
      squad.xCm !== undefined
        ? `|${squad.xCm},${squad.zCm ?? 0},${squad.gridIndex ?? 0},${squad.gridSpeedCmPerTick ?? 0},${(squad.gridPath ?? []).map((point) => `${point[0]}:${point[1]}`).join(">")}`
        : "";
    parts.push(
      `S${squad.id},${squad.owner},${squad.from},${squad.to},${squad.count},${squad.pathIndex},${squad.legStartTick},${squad.legEndTick},${squad.departTick},${squad.arrivalTick},${squad.speedMilli},${squad.strengthMilli},${squad.supplyLeft},${squad.nextStarveTick},${squad.path.join(">")},${squad.intercepted.join(">") || "-"}${grid}`,
    );
  }
  return parts.join("|");
}

export function hash(state: SimState): string {
  return hashText(canonicalState(state));
}
