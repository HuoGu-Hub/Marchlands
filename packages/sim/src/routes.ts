import type { MapGraph } from "./path";
import { travelTicks } from "./rules";
import type { CityId, Ruleset, SimState, SquadState } from "./types";

export interface RouteOption {
  /** 在下一个节点要走的下一跳。 */
  via: CityId;
  /** 从下一个节点到目的地的完整路径，包含起点。 */
  path: CityId[];
  /** 从下一个节点到目的地的距离。 */
  distance: number;
  /** 是否与当前计划一致。 */
  current: boolean;
}

export type RetargetFailure = "no_anchor" | "invalid_via" | "no_route";

export interface RetargetPath {
  path: CityId[];
  distance: number;
}

export function blockedTransit(state: SimState, owner: number, destination?: CityId): Set<CityId> {
  const blocked = new Set<CityId>();
  if (state.map.transit !== "friendly") return blocked;
  for (const city of state.cities) {
    if (city.id === destination) continue;
    if (city.owner !== owner) blocked.add(city.id);
  }
  return blocked;
}

export function nextAnchor(squad: SquadState): CityId | null {
  return squad.path[squad.pathIndex + 1] ?? null;
}

export function pathTicks(
  graph: MapGraph,
  rules: Ruleset,
  path: CityId[],
  startIndex: number,
  speedMilli: number,
): number {
  let total = 0;
  for (let index = startIndex; index < path.length - 1; index += 1) {
    const length = graph.edgeCost(path[index], path[index + 1]);
    if (length === null) return Number.POSITIVE_INFINITY;
    total += travelTicks(length, rules, speedMilli);
  }
  return total;
}

export function routeOptions(graph: MapGraph, squad: SquadState, blocked?: ReadonlySet<CityId>): RouteOption[] {
  const anchorIndex = squad.pathIndex + 1;
  const anchor = squad.path[anchorIndex];
  if (!anchor || anchor === squad.to) return [];

  const visited = new Set(squad.path.slice(0, anchorIndex + 1));
  const currentHop = squad.path[anchorIndex + 1] ?? null;
  const options = new Map<CityId, RouteOption>();

  for (const via of graph.neighbors(anchor)) {
    if (via === anchor) continue;
    const edge = graph.edgeCost(anchor, via);
    if (edge === null) continue;
    let path: CityId[];
    let distance: number;
    if (via === squad.to) {
      path = [anchor, via];
      distance = edge;
    } else {
      const route = graph.route(via, squad.to, blocked);
      if (!route) continue;
      path = [anchor, via, ...route.path.slice(1)];
      distance = edge + route.distance;
    }
    if (path.slice(1).some((node) => visited.has(node))) continue;
    options.set(via, { via, path, distance, current: via === currentHop });
  }

  if (currentHop && !options.has(currentHop)) {
    let distance = 0;
    let valid = true;
    for (let index = anchorIndex; index < squad.path.length - 1; index += 1) {
      const length = graph.edgeCost(squad.path[index], squad.path[index + 1]);
      if (length === null) {
        valid = false;
        break;
      }
      distance += length;
    }
    if (valid) {
      options.set(currentHop, {
        via: currentHop,
        path: squad.path.slice(anchorIndex),
        distance,
        current: true,
      });
    }
  }

  return [...options.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    return a.via < b.via ? -1 : a.via > b.via ? 1 : 0;
  });
}

export function buildRetargetPath(
  graph: MapGraph,
  squad: SquadState,
  to: CityId,
  via?: CityId,
  blocked?: ReadonlySet<CityId>,
): RetargetPath | RetargetFailure {
  const anchorIndex = squad.pathIndex + 1;
  const anchor = squad.path[anchorIndex];
  if (!anchor) return "no_anchor";
  const prefix = squad.path.slice(0, anchorIndex + 1);

  if (to === anchor) {
    if (via !== undefined && via !== to) return "invalid_via";
    return { path: prefix, distance: 0 };
  }

  if (via !== undefined) {
    if (via === anchor) return "invalid_via";
    const edge = graph.edgeCost(anchor, via);
    if (edge === null) return "invalid_via";
    const route = graph.route(via, to, blocked);
    if (!route) return "no_route";
    return {
      path: prefix.concat([via, ...route.path.slice(1)]),
      distance: edge + route.distance,
    };
  }

  const route = graph.route(anchor, to, blocked);
  if (!route) return "no_route";
  return {
    path: prefix.concat(route.path.slice(1)),
    distance: route.distance,
  };
}