import { createUnitNavGrid, planGridRoute } from "./grid";
import { blockedTransit } from "./routes";
import { isProductionSiteKind, siteUnitKind } from "./types";
import type { CityId, CityState, SimState } from "./types";

/** 与 send 指令一致：只有己方产兵据点、且守军不少于两人时才能派兵。 */
function canSendFrom(city: CityState | undefined): city is CityState {
  return city !== undefined && city.owner !== 0 && isProductionSiteKind(city.kind) && city.pop >= 2;
}

/**
 * 从 fromId 的驻军出发可以派兵抵达的目标。
 * 规则与 send 指令保持一致：中立或敌方建筑阻断道路，但目标本身不受阻断限制。
 */
export function sendReachableTargets(state: SimState, fromId: CityId): CityId[] {
  const from = state.cities.find((city) => city.id === fromId);
  if (!canSendFrom(from)) return [];
  const targets: CityId[] = [];

  if (state.nav) {
    const unitKind = siteUnitKind(from.kind) ?? "infantry";
    const start: [number, number] = [from.pos[0] * 10, from.pos[1] * 10];
    for (const city of state.cities) {
      if (city.id === from.id) continue;
      const unitNav = createUnitNavGrid(state.map, state.cities, from.owner, unitKind, city.id);
      if (!unitNav) continue;
      const goal: [number, number] = [city.pos[0] * 10, city.pos[1] * 10];
      if (planGridRoute(state.map, unitNav, start, goal, 40, unitKind)) targets.push(city.id);
    }
    return targets;
  }

  const blocked = blockedTransit(state, from.owner);
  const visited = new Set<CityId>([from.id]);
  const queue: CityId[] = [from.id];
  while (queue.length > 0) {
    const current = queue.shift() as CityId;
    for (const next of state.graph.neighbors(current)) {
      if (visited.has(next) || blocked.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  for (const city of state.cities) {
    if (city.id === from.id) continue;
    if (visited.has(city.id)) {
      targets.push(city.id);
      continue;
    }
    // 被阻断的建筑仍可直接作为目的地，只要它紧邻已连通的道路。
    if (blocked.has(city.id) && state.graph.neighbors(city.id).some((other) => visited.has(other))) {
      targets.push(city.id);
    }
  }
  return targets;
}
