import type { SimState } from "./types";

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
  for (const player of state.players.slice().sort((a, b) => a.id - b.id)) {
    parts.push(`P${player.id},${player.gold},${player.goldCarry}`);
  }
  for (const city of state.cities.slice().sort(byId)) {
    parts.push(
      `C${city.id},${city.owner},${city.level},${city.pop},${city.maxPop},${city.growthCarry},${city.layer},${city.pos[0]},${city.pos[1]}`,
    );
  }
  for (const squad of state.squads.slice().sort(byId)) {
    parts.push(
      `S${squad.id},${squad.owner},${squad.from},${squad.to},${squad.count},${squad.departTick},${squad.arrivalTick},${squad.path.join(">")}`,
    );
  }
  return parts.join("|");
}

export function hash(state: SimState): string {
  return hashText(canonicalState(state));
}
