import { attackValue, resolveAttack, resolveFieldCombat } from "./combat";
import { applyUpgrade, growCity, growGold } from "./economy";
import { MapGraph } from "./path";
import {
  GRID_CAPTURE_RADIUS_CM,
  createNavGrid,
  createUnitNavGrid,
  gridDistance,
  gridSpeedCmPerTick,
  gridTravelTicks,
  moveAlongGridPath,
  planGridRoute,
  polylineLength,
} from "./grid";
import { blockedTransit, buildRetargetPath } from "./routes";
import { isProductionSiteKind, siteUnitKind } from "./types";
import { unitProfile } from "./units";
import {
  DEFAULT_RULESET,
  granarySpeedMilli,
  granaryStrengthMilli,
  levelRule,
  sendPercent,
  travelTicks,
} from "./rules";
import type {
  CityId,
  CityState,
  Command,
  CommandRejection,
  FinishReason,
  Level,
  MapCity,
  MapDef,
  Owner,
  PlayerId,
  PlayerState,
  Ruleset,
  SimEvent,
  SimState,
  SiteKind,
  SquadState,
  Stance,
  StepResult,
  UnitKind,
} from "./types";

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function findCity(state: SimState, id: CityId): CityState | undefined {
  for (const city of state.cities) if (city.id === id) return city;
  return undefined;
}

function findSquad(state: SimState, id: string): SquadState | undefined {
  for (const squad of state.squads) if (squad.id === id) return squad;
  return undefined;
}

function cloneState(state: SimState): SimState {
  return {
    ...state,
    players: state.players.map((player) => ({ ...player })),
    cities: state.cities.map((city) => ({
      ...city,
      pos: [city.pos[0], city.pos[1]],
      watch: city.watch ? [city.watch[0], city.watch[1]] : null,
    })),
    squads: state.squads.map((squad) => ({
      ...squad,
      path: squad.path.slice(),
      intercepted: squad.intercepted.slice(),
      ...(squad.gridPath
        ? { gridPath: squad.gridPath.map((point) => [point[0], point[1]] as [number, number]) }
        : {}),
      ...(squad.toCell ? { toCell: [squad.toCell[0], squad.toCell[1]] as [number, number] } : {}),
    })),
    events: [],
  };
}

function reject(rejected: CommandRejection[], command: Command, reason: string): void {
  rejected.push({ command, reason });
}

function addLoss(state: SimState, owner: Owner, loss: number): void {
  if (owner === 0 || loss <= 0) return;
  const player = state.players.find((entry) => entry.id === owner);
  if (player) player.losses += loss;
}

function siteMaxPop(kind: SiteKind, level: Level, rules: Ruleset): number {
  if (kind === "granary") return rules.granary.capacity;
  if (kind === "outpost") return rules.outpost.capacity;
  return levelRule(rules, level).maxPop;
}

function playerHasGranary(state: SimState, owner: Owner): boolean {
  if (owner === 0) return false;
  return state.cities.some((city) => city.kind === "granary" && city.owner === owner);
}

function strengthFor(state: SimState, owner: Owner): number {
  return granaryStrengthMilli(state.rules, playerHasGranary(state, owner));
}

function interceptTick(state: SimState, squad: SquadState, outpost: CityState): number | null {
  if (!outpost.watch) return null;
  if (squad.to === outpost.id) return null;

  let cursor = squad.legEndTick;
  for (let index = squad.pathIndex; index < squad.path.length - 1; index += 1) {
    const from = squad.path[index];
    const to = squad.path[index + 1];
    const length = state.graph.edgeCost(from, to);
    if (length === null) return null;
    const startTick = index === squad.pathIndex ? squad.legStartTick : cursor;
    const endTick =
      index === squad.pathIndex
        ? squad.legEndTick
        : startTick + travelTicks(length, state.rules, squad.speedMilli);
    const matches =
      (from === outpost.watch[0] && to === outpost.watch[1]) ||
      (from === outpost.watch[1] && to === outpost.watch[0]);
    if (matches) {
      const midTick =
        startTick + travelTicks(Math.floor(length / 2), state.rules, squad.speedMilli);
      return midTick < state.tick ? null : midTick;
    }
    cursor = endTick;
  }
  return null;
}

function resolveInterceptions(state: SimState, events: SimEvent[]): void {
  if (state.squads.length === 0) return;
  const outposts = state.cities.filter((city) => city.kind === "outpost").sort(byId);
  if (outposts.length === 0) return;

  const destroyed = new Set<string>();
  for (const squad of state.squads.slice().sort(byId)) {
    if (destroyed.has(squad.id)) continue;
    for (const outpost of outposts) {
      if (outpost.owner === 0 || outpost.pop <= 0 || outpost.stance !== "engage") continue;
      if (squad.owner === outpost.owner) continue;
      if (squad.intercepted.includes(outpost.id)) continue;
      if (interceptTick(state, squad, outpost) !== state.tick) continue;

      squad.intercepted.push(outpost.id);
      outpost.growthLockUntil = state.tick + 2 * state.rules.tickHz;
      const outpostOwner = outpost.owner as PlayerId;
      const outcome = resolveFieldCombat(
        squad.count,
        squad.strengthMilli,
        outpost,
        state.rules,
        strengthFor(state, outpost.owner),
      );
      addLoss(state, squad.owner, outcome.squadLoss);
      addLoss(state, outpostOwner, outcome.outpostLoss);
      events.push({
        type: "squadIntercepted",
        squadId: squad.id,
        cityId: outpost.id,
        squadOwner: squad.owner,
        outpostOwner,
        squadLoss: outcome.squadLoss,
        outpostLoss: outcome.outpostLoss,
        squadDestroyed: outcome.squadDestroyed,
        outpostEmptied: outcome.outpostEmptied,
      });

      if (outcome.outpostEmptied) {
        outpost.owner = 0;
        outpost.stance = "evade";
        outpost.decayAtTick = 0;
      }
      if (outcome.squadDestroyed) {
        destroyed.add(squad.id);
        break;
      }
      squad.count = outcome.squadCount;
    }
  }

  if (destroyed.size > 0) {
    state.squads = state.squads.filter((squad) => !destroyed.has(squad.id));
  }
}

export function createGame(map: MapDef, seed: number, rules: Ruleset = DEFAULT_RULESET): SimState {
  if (map.cities.length === 0) throw new Error("map has no cities");
  if (map.players.length !== 2) throw new Error("map must define exactly 2 players");
  if (!map.cities.some((city) => isProductionSiteKind(city.kind))) {
    throw new Error("map has no producing sites");
  }

  const cities: CityState[] = map.cities
    .map((city: MapCity) => {
      const kind = city.kind;
      const level: Level = isProductionSiteKind(kind) ? city.level : 1;
      const maxPop = siteMaxPop(kind, level, rules);
      const stance: Stance = kind === "outpost" ? (city.stance ?? "evade") : "evade";
      const watch: [CityId, CityId] | null =
        kind === "outpost" && city.watch ? [city.watch[0], city.watch[1]] : null;
      const decayAtTick =
        kind === "outpost" && city.owner !== 0 && city.pop > 0 ? rules.outpost.graceTicks : 0;
      return {
        id: city.id,
        kind,
        owner: city.owner,
        level,
        pop: city.pop,
        maxPop,
        growthCarry: 0,
        growthLockUntil: 0,
        overCapCarry: 0,
        pos: [city.pos[0], city.pos[1]] as [number, number],
        layer: city.layer,
        stance,
        decayAtTick,
        watch,
        ...(city.transit ? { transit: city.transit } : {}),
        ...(city.captureRadiusCm !== undefined ? { captureRadiusCm: city.captureRadiusCm } : {}),
        ...(city.footprintCm !== undefined ? { footprintCm: city.footprintCm } : {}),
      };
    })
    .sort(byId);

  const players: PlayerState[] = map.players
    .map((player) => ({ id: player.id, gold: map.startGold ?? 0, goldCarry: 0, losses: 0 }))
    .sort((a, b) => a.id - b.id);

  const timeObjective = map.objectives.find((objective) => objective.type === "time_limit");
  const maxTicks =
    timeObjective && typeof timeObjective.ticks === "number" && timeObjective.ticks > 0
      ? timeObjective.ticks
      : rules.maxTicks;
  const gameRules: Ruleset = maxTicks === rules.maxTicks ? rules : { ...rules, maxTicks };

  return {
    tick: 0,
    seed,
    slug: map.slug,
    status: "playing",
    winner: 0,
    finishReason: null,
    players,
    cities,
    squads: [],
    events: [],
    rules: gameRules,
    map,
    graph: new MapGraph(map),
    nav: createNavGrid(map),
    nextSquad: 1,
  };
}

export function step(state: SimState, commands: Command[]): StepResult {
  if (state.status !== "playing") {
    return {
      state: cloneState(state),
      rejected: commands.map((command) => ({ command, reason: "game_finished" })),
    };
  }

  const next = cloneState(state);
  const events: SimEvent[] = [];
  const rejected: CommandRejection[] = [];

  for (const command of commands) applyCommand(next, command, events, rejected);
  growEconomy(next);
  advanceSquads(next, events);
  starveSquads(next, events);
  decayOutposts(next, events);
  checkFinish(next, events);

  next.tick += 1;
  next.events = events;
  return { state: next, rejected };
}

function applyCommand(
  state: SimState,
  command: Command,
  events: SimEvent[],
  rejected: CommandRejection[],
): void {
  if (command.type === "send") {
    const from = findCity(state, command.from);
    if (!from) return reject(rejected, command, "unknown_city");
    const to = findCity(state, command.to);
    if (!to) return reject(rejected, command, "unknown_target");
    if (from.id === to.id) return reject(rejected, command, "same_city");
    if (from.owner === 0) return reject(rejected, command, "not_owned");
    if (!isProductionSiteKind(from.kind)) return reject(rejected, command, "not_producer");
    if (from.pop < 2) return reject(rejected, command, "too_few_troops");

    if (state.nav) {
      sendGridSquad(state, from, to, command, events, rejected);
      return;
    }

    const route = state.graph.route(from.id, to.id, blockedTransit(state, from.owner, to.id));
    if (!route) return reject(rejected, command, "no_route");

    const count = Math.max(1, Math.floor((from.pop * sendPercent(state.rules)) / 100));
    from.pop -= count;

    const hasGranary = playerHasGranary(state, from.owner);
    const speedMilli = granarySpeedMilli(state.rules, hasGranary);
    const strengthMilli = granaryStrengthMilli(state.rules, hasGranary);
    const path = route.path.slice();
    const arrivalTick = state.tick + travelTicks(route.distance, state.rules, speedMilli);
    const firstLength = state.graph.edgeCost(path[0], path[1]);
    const firstTicks =
      path.length === 2
        ? arrivalTick - state.tick
        : firstLength === null
          ? 1
          : travelTicks(firstLength, state.rules, speedMilli);
    const squad: SquadState = {
      id: `s${String(state.nextSquad).padStart(6, "0")}`,
      owner: from.owner,
      unitKind: siteUnitKind(from.kind) ?? "barbarian",
      from: from.id,
      to: to.id,
      count,
      path,
      pathIndex: 0,
      legStartTick: state.tick,
      legEndTick: state.tick + firstTicks,
      departTick: state.tick,
      arrivalTick,
      speedMilli,
      strengthMilli,
      supplyLeft: state.rules.supply.carryTicks,
      nextStarveTick: state.tick + state.rules.supply.carryTicks,
      intercepted: [],
    };
    state.nextSquad += 1;
    state.squads.push(squad);
    events.push({
      type: "squadSpawned",
      squadId: squad.id,
      from: squad.from,
      to: squad.to,
      count: squad.count,
      arrivalTick: squad.arrivalTick,
    });
    return;
  }

  if (command.type === "sendCell") {
    const from = findCity(state, command.from);
    if (!from) return reject(rejected, command, "unknown_city");
    if (from.owner === 0) return reject(rejected, command, "not_owned");
    if (!isProductionSiteKind(from.kind)) return reject(rejected, command, "not_producer");
    if (from.pop < 2) return reject(rejected, command, "too_few_troops");
    if (!Number.isFinite(command.xCm) || !Number.isFinite(command.zCm)) {
      return reject(rejected, command, "no_route");
    }
    if (!state.nav) return reject(rejected, command, "no_route");
    sendGridSquadToCell(state, from, command.xCm, command.zCm, command, events, rejected);
    return;
  }

  if (command.type === "retarget") {
    const squad = findSquad(state, command.squad);
    if (!squad) return reject(rejected, command, "unknown_squad");
    const to = findCity(state, command.to);
    if (!to) return reject(rejected, command, "unknown_target");
    if (state.nav) {
      retargetGridSquad(state, squad, to, command, events, rejected);
      return;
    }
    const result = buildRetargetPath(state.graph, squad, to.id, command.via, blockedTransit(state, squad.owner, to.id));
    if (result === "no_anchor") return reject(rejected, command, "squad_arrived");
    if (result === "invalid_via") return reject(rejected, command, "invalid_via");
    if (result === "no_route") return reject(rejected, command, "no_route");

    const tailTicks =
      result.distance === 0
        ? 0
        : travelTicks(result.distance, state.rules, squad.speedMilli);
    const arrivalTick = squad.legEndTick + tailTicks;
    squad.path = result.path;
    squad.to = to.id;
    squad.arrivalTick = arrivalTick;
    events.push({
      type: "squadRetargeted",
      squadId: squad.id,
      to: squad.to,
      via: command.via ?? null,
      arrivalTick,
    });
    return;
  }

  if (command.type === "retargetCell") {
    const squad = findSquad(state, command.squad);
    if (!squad) return reject(rejected, command, "unknown_squad");
    if (squad.owner !== 1 && squad.owner !== 2) return reject(rejected, command, "unknown_squad");
    if (!Number.isFinite(command.xCm) || !Number.isFinite(command.zCm)) {
      return reject(rejected, command, "no_route");
    }
    retargetGridSquadToCell(state, squad, command.xCm, command.zCm, command, events, rejected);
    return;
  }

  if (command.type === "setStance") {
    const city = findCity(state, command.city);
    if (!city) return reject(rejected, command, "unknown_city");
    if (city.owner === 0) return reject(rejected, command, "not_owned");
    if (city.kind !== "outpost") return reject(rejected, command, "not_outpost");
    if (command.stance !== "evade" && command.stance !== "engage") {
      return reject(rejected, command, "invalid_stance");
    }
    if (city.stance === command.stance) return;
    city.stance = command.stance;
    events.push({ type: "stanceChanged", cityId: city.id, stance: city.stance });
    return;
  }

  if (command.type === "setTransit") {
    const target = findCity(state, command.city);
    if (!target) return reject(rejected, command, "unknown_city");
    if (target.owner === 0) return reject(rejected, command, "not_owned");
    if (command.mode !== "release" && command.mode !== "intercept") {
      return reject(rejected, command, "invalid_transit");
    }
    const next = command.mode === "release" ? "open" : "closed";
    if (target.transit === next) return;
    target.transit = next;
    events.push({ type: "transitChanged", cityId: target.id, transit: command.mode });
    return;
  }

  const city = findCity(state, command.city);
  if (!city) return reject(rejected, command, "unknown_city");
  if (city.owner === 0) return reject(rejected, command, "not_owned");
  if (!isProductionSiteKind(city.kind)) return reject(rejected, command, "not_upgradable");
  if (city.level >= state.rules.maxLevel) return reject(rejected, command, "max_level");

  const cost = levelRule(state.rules, city.level).upgradeCost;
  if (city.pop < cost) return reject(rejected, command, "insufficient_pop");
  if (!applyUpgrade(city, state.rules)) return reject(rejected, command, "insufficient_pop");

  events.push({ type: "upgradeCompleted", cityId: city.id, level: city.level });
}

function growEconomy(state: SimState): void {
  const goldByPlayer: number[] = [0, 0, 0];
  for (const city of state.cities) {
    const lost = growCity(city, state.tick, state.rules.tickHz);
    addLoss(state, city.owner, lost);
    if (!isProductionSiteKind(city.kind)) continue;
    const rule = levelRule(state.rules, city.level);
    if (city.owner !== 0) goldByPlayer[city.owner] += rule.goldMilli;
  }
  for (const player of state.players) growGold(player, goldByPlayer[player.id] ?? 0);
}

function advanceSquads(state: SimState, events: SimEvent[]): void {
  if (state.nav) {
    advanceGridSquads(state, events);
    return;
  }
  resolveInterceptions(state, events);
  if (state.squads.length === 0) return;

  const removed = new Set<string>();
  resolveGraphClashes(state, events, removed);
  // 交战中的兵团原地停下：整条时间轴往后推一 tick，路径进度不变。
  for (const squad of state.squads) {
    if (!squad.engagedWith) continue;
    squad.legStartTick += 1;
    squad.legEndTick += 1;
    squad.arrivalTick += 1;
  }
  for (const squad of state.squads.slice().sort(byId)) {
    if (removed.has(squad.id)) continue;
    while (squad.legEndTick <= state.tick) {
      const nextIndex = squad.pathIndex + 1;
      if (nextIndex >= squad.path.length - 1) {
        removed.add(squad.id);
        resolveSquad(state, squad, events);
        break;
      }
      squad.pathIndex = nextIndex;
      squad.legStartTick = squad.legEndTick;
      if (nextIndex === squad.path.length - 2) {
        squad.legEndTick = Math.max(squad.legStartTick + 1, squad.arrivalTick);
        squad.arrivalTick = squad.legEndTick;
        continue;
      }
      const length = state.graph.edgeCost(squad.path[nextIndex], squad.path[nextIndex + 1]);
      if (length === null) {
        removed.add(squad.id);
        break;
      }
      squad.legEndTick =
        squad.legStartTick + travelTicks(length, state.rules, squad.speedMilli);
    }
  }

  if (removed.size > 0) {
    state.squads = state.squads.filter((squad) => !removed.has(squad.id));
  }
}

function starveSquads(state: SimState, events: SimEvent[]): void {
  if (state.squads.length === 0) return;
  const removed = new Set<string>();
  for (const squad of state.squads) {
    // 驻留在格子上的兵团不再消耗行军粮草，改道后重新计时。
    if (isIdleGridSquad(squad)) continue;
    if (state.tick > squad.departTick && squad.supplyLeft > 0) squad.supplyLeft -= 1;
    if (state.tick < squad.nextStarveTick) continue;

    const loss = Math.min(squad.count, state.rules.supply.starveLoss);
    squad.count -= loss;
    addLoss(state, squad.owner, loss);
    const destroyed = squad.count <= 0;
    events.push({
      type: "squadStarved",
      squadId: squad.id,
      owner: squad.owner,
      loss,
      count: squad.count,
      destroyed,
    });
    if (destroyed) {
      removed.add(squad.id);
      continue;
    }
    squad.nextStarveTick = state.tick + state.rules.supply.starveIntervalTicks;
  }

  if (removed.size > 0) {
    state.squads = state.squads.filter((squad) => !removed.has(squad.id));
  }
}

function resolveSquad(state: SimState, squad: SquadState, events: SimEvent[]): void {
  events.push({ type: "squadArrived", squadId: squad.id, cityId: squad.to });
  const city = findCity(state, squad.to);
  if (!city) return;

  if (city.owner === squad.owner) {
    // 增援兵力直接并入，允许短暂超过容量，之后按超编衰减。
    city.pop += squad.count;
    if (city.kind === "outpost") {
      city.decayAtTick = state.tick + state.rules.outpost.graceTicks;
    }
    return;
  }

  const fromOwner = city.owner;
  city.growthLockUntil = state.tick + 2 * state.rules.tickHz;
  const outcome = resolveAttack(city, squad.owner, squad.count, state.rules, {
    attackerStrengthMilli: squad.strengthMilli,
    defenderStrengthMilli: strengthFor(state, fromOwner),
  });
  addLoss(state, squad.owner, outcome.attackerLoss);
  addLoss(state, fromOwner, outcome.defenderLoss);
  events.push({
    type: "combatResolved",
    cityId: city.id,
    attacker: squad.owner,
    defender: fromOwner,
    attackerLoss: outcome.attackerLoss,
    defenderLoss: outcome.defenderLoss,
    captured: outcome.captured,
  });
  if (outcome.captured) {
    if (city.kind === "outpost") {
      city.stance = "evade";
      city.decayAtTick = city.pop > 0 ? state.tick + state.rules.outpost.graceTicks : 0;
    }
    events.push({
      type: "cityCaptured",
      cityId: city.id,
      fromOwner,
      toOwner: squad.owner,
      pop: city.pop,
    });
  }
}

function decayOutposts(state: SimState, events: SimEvent[]): void {
  for (const city of state.cities) {
    if (city.kind !== "outpost" || city.owner === 0 || city.pop <= 0) continue;
    if (state.tick < city.decayAtTick) continue;
    const loss = Math.min(city.pop, state.rules.outpost.decayPerInterval);
    city.pop -= loss;
    addLoss(state, city.owner, loss);
    events.push({ type: "outpostDecayed", cityId: city.id, loss, pop: city.pop });
    if (city.pop === 0) {
      city.owner = 0;
      city.stance = "evade";
      city.decayAtTick = 0;
    } else {
      city.decayAtTick = state.tick + state.rules.outpost.decayIntervalTicks;
    }
  }
}

function finish(state: SimState, winner: SimState["winner"], reason: FinishReason, events: SimEvent[]): void {
  state.status = "finished";
  state.winner = winner;
  state.finishReason = reason;
  events.push({ type: "gameOver", winner, reason });
}

function checkFinish(state: SimState, events: SimEvent[]): void {
  const towns = state.cities.filter((city) => isProductionSiteKind(city.kind));
  const total = towns.length;
  if (total === 0) return finish(state, 0, "draw", events);
  const counts: number[] = [0, 0, 0];
  for (const city of towns) counts[city.owner] += 1;

  // 1. 场上只剩一个玩家的势力，中立建筑可以继续存在。
  if (counts[1] === total) return finish(state, 1, "capture_all", events);
  if (counts[1] === 0) return finish(state, 2, "eliminated", events);
  if (counts[2] === 0) return finish(state, 1, "eliminated", events);
  if (state.tick + 1 < state.rules.maxTicks) return;

  // 2-6. 时间耗尽后依次比较：总兵力、建筑数、总损耗、金币，全部相同则平局。
  const troops: number[] = [0, 0, 0];
  for (const city of state.cities) troops[city.owner] += city.pop;
  for (const squad of state.squads) troops[squad.owner] += squad.count;
  const buildings: number[] = [0, 0, 0];
  for (const city of state.cities) buildings[city.owner] += 1;
  const losses: number[] = [0, 0, 0];
  const gold: number[] = [0, 0, 0];
  for (const player of state.players) {
    losses[player.id] = player.losses;
    gold[player.id] = player.gold;
  }

  let winner: SimState["winner"] = 0;
  if (troops[1] !== troops[2]) winner = troops[1] > troops[2] ? 1 : 2;
  else if (buildings[1] !== buildings[2]) winner = buildings[1] > buildings[2] ? 1 : 2;
  else if (losses[1] !== losses[2]) winner = losses[1] < losses[2] ? 1 : 2;
  else if (gold[1] !== gold[2]) winner = gold[1] > gold[2] ? 1 : 2;

  finish(state, winner, winner === 0 ? "draw" : "time_limit", events);
}
function sendGridSquad(
  state: SimState,
  from: CityState,
  to: CityState,
  command: Command,
  events: SimEvent[],
  rejected: CommandRejection[],
): void {
  const nav = state.nav;
  if (!nav) return;
  const unitKind = siteUnitKind(from.kind) ?? "barbarian";
  const unitNav = createUnitNavGrid(state.map, state.cities, from.owner, unitKind, to.id);
  if (!unitNav) return;
  const start: [number, number] = [from.pos[0] * 10, from.pos[1] * 10];
  const goal: [number, number] = [to.pos[0] * 10, to.pos[1] * 10];
  const route = planGridRoute(state.map, unitNav, start, goal, 40, unitKind);
  if (!route) {
    reject(rejected, command, "no_route");
    return;
  }
  spawnGridSquad(
    state,
    from,
    to.id,
    null,
    unitKind,
    [[start[0], start[1]], ...route.points],
    events,
  );
}

/** 网格模式下把兵团派往任意格子；抵达后原地驻留，可再次改道。 */
function sendGridSquadToCell(
  state: SimState,
  from: CityState,
  xCm: number,
  zCm: number,
  command: Command,
  events: SimEvent[],
  rejected: CommandRejection[],
): void {
  if (!state.nav) return reject(rejected, command, "no_route");
  const unitKind = siteUnitKind(from.kind) ?? "barbarian";
  const unitNav = createUnitNavGrid(state.map, state.cities, from.owner, unitKind);
  if (!unitNav) return reject(rejected, command, "no_route");
  const start: [number, number] = [from.pos[0] * 10, from.pos[1] * 10];
  const route = planGridRoute(state.map, unitNav, start, [xCm, zCm], 40, unitKind);
  if (!route) return reject(rejected, command, "no_route");
  spawnGridSquad(
    state,
    from,
    "",
    [xCm, zCm],
    unitKind,
    [[start[0], start[1]], ...route.points],
    events,
  );
}

function spawnGridSquad(
  state: SimState,
  from: CityState,
  to: CityId,
  toCell: [number, number] | null,
  unitKind: UnitKind,
  points: Array<[number, number]>,
  events: SimEvent[],
): void {
  const count = Math.max(1, Math.floor((from.pop * sendPercent(state.rules)) / 100));
  from.pop -= count;

  const hasGranary = playerHasGranary(state, from.owner);
  const speedMilli = granarySpeedMilli(state.rules, hasGranary);
  const strengthMilli = granaryStrengthMilli(state.rules, hasGranary);
  const speedCm = gridSpeedCmPerTick(state.rules, speedMilli);
  const arrivalTick = state.tick + gridTravelTicks(polylineLength(points), state.rules, speedMilli);
  const squad: SquadState = {
    id: `s${String(state.nextSquad).padStart(6, "0")}`,
    owner: from.owner as PlayerId,
    unitKind,
    from: from.id,
    to,
    ...(toCell ? { toCell } : {}),
    count,
    path: to ? [from.id, to] : [from.id],
    pathIndex: 0,
    legStartTick: state.tick,
    legEndTick: arrivalTick,
    departTick: state.tick,
    arrivalTick,
    speedMilli,
    strengthMilli,
    supplyLeft: state.rules.supply.carryTicks,
    nextStarveTick: state.tick + state.rules.supply.carryTicks,
    intercepted: [],
    xCm: points[0][0],
    zCm: points[0][1],
    gridPath: points,
    gridIndex: 1,
    gridSpeedCmPerTick: speedCm,
  };
  state.nextSquad += 1;
  state.squads.push(squad);
  events.push({
    type: "squadSpawned",
    squadId: squad.id,
    from: squad.from,
    to: squad.to,
    count: squad.count,
    arrivalTick: squad.arrivalTick,
  });
}

function retargetGridSquad(
  state: SimState,
  squad: SquadState,
  to: CityState,
  command: Command,
  events: SimEvent[],
  rejected: CommandRejection[],
): void {
  if (!state.nav) return;
  if (squad.xCm === undefined || squad.zCm === undefined) return reject(rejected, command, "squad_arrived");
  const unitKind = squad.unitKind ?? "barbarian";
  const unitNav = createUnitNavGrid(state.map, state.cities, squad.owner, unitKind, to.id);
  if (!unitNav) return reject(rejected, command, "no_route");
  const start: [number, number] = [squad.xCm, squad.zCm];
  const goal: [number, number] = [to.pos[0] * 10, to.pos[1] * 10];
  const route = planGridRoute(state.map, unitNav, start, goal, 40, unitKind);
  if (!route) return reject(rejected, command, "no_route");
  const points: Array<[number, number]> = [[start[0], start[1]], ...route.points];
  const distance = polylineLength(points);
  const arrivalTick = state.tick + gridTravelTicks(distance, state.rules, squad.speedMilli);
  const idle = isIdleGridSquad(squad);
  squad.path = [squad.from, to.id];
  squad.pathIndex = 0;
  squad.to = to.id;
  delete squad.toCell;
  squad.gridPath = points;
  if (idle) squad.nextStarveTick = state.tick + Math.max(1, squad.supplyLeft);
  squad.gridIndex = 1;
  squad.legStartTick = state.tick;
  squad.legEndTick = arrivalTick;
  squad.arrivalTick = arrivalTick;
  events.push({
    type: "squadRetargeted",
    squadId: squad.id,
    to: squad.to,
    via: command.type === "retarget" ? command.via ?? null : null,
    arrivalTick,
  });
}

function isIdleGridSquad(squad: SquadState): boolean {
  return squad.toCell !== undefined && soldierAtPathEnd(squad);
}

function soldierAtPathEnd(squad: SquadState): boolean {
  return squad.gridPath !== undefined && (squad.gridIndex ?? 0) >= squad.gridPath.length;
}

/** 网格模式下把驻留中的兵团改派到另一个格子。 */
function retargetGridSquadToCell(
  state: SimState,
  squad: SquadState,
  xCm: number,
  zCm: number,
  command: Command,
  events: SimEvent[],
  rejected: CommandRejection[],
): void {
  if (!state.nav) return reject(rejected, command, "no_route");
  if (squad.xCm === undefined || squad.zCm === undefined) return reject(rejected, command, "squad_arrived");
  const unitKind = squad.unitKind ?? "barbarian";
  const unitNav = createUnitNavGrid(state.map, state.cities, squad.owner, unitKind);
  if (!unitNav) return reject(rejected, command, "no_route");
  const start: [number, number] = [squad.xCm, squad.zCm];
  const route = planGridRoute(state.map, unitNav, start, [xCm, zCm], 40, unitKind);
  if (!route) return reject(rejected, command, "no_route");
  const points: Array<[number, number]> = [[start[0], start[1]], ...route.points];
  const distance = polylineLength(points);
  const arrivalTick = state.tick + gridTravelTicks(distance, state.rules, squad.speedMilli);
  const idle = isIdleGridSquad(squad);
  squad.path = [squad.from];
  squad.pathIndex = 0;
  squad.to = "";
  squad.toCell = [xCm, zCm];
  squad.gridPath = points;
  squad.gridIndex = 1;
  squad.legStartTick = state.tick;
  squad.legEndTick = arrivalTick;
  squad.arrivalTick = arrivalTick;
  if (idle) squad.nextStarveTick = state.tick + Math.max(1, squad.supplyLeft);
  events.push({
    type: "squadRetargeted",
    squadId: squad.id,
    to: "",
    via: null,
    arrivalTick,
  });
}

function cityAtGridCell(state: SimState, xCm: number, zCm: number): CityState | null {
  const grid = state.map.grid;
  if (!grid) return null;
  const offsetX = state.map.size[0] * 5;
  const offsetZ = state.map.size[1] * 5;
  const x = Math.floor((xCm + offsetX) / grid.cellSizeCm);
  const z = Math.floor((zCm + offsetZ) / grid.cellSizeCm);
  for (const city of state.cities) {
    const cx = Math.floor((city.pos[0] * 10 + offsetX) / grid.cellSizeCm);
    const cz = Math.floor((city.pos[1] * 10 + offsetZ) / grid.cellSizeCm);
    if (cx === x && cz === z) return city;
  }
  return null;
}

function advanceGridTransit(
  state: SimState,
  squad: SquadState,
  events: SimEvent[],
  removed: Set<string>,
): void {
  const transit = squad.transit;
  if (!transit) return;
  const city = findCity(state, transit.cityId);
  if (!city) {
    delete squad.transit;
    return;
  }
  const allows = city.owner === squad.owner || city.transit === "open";
  if (allows) {
    const total = squad.count + transit.passed;
    const chunk = Math.max(1, Math.ceil(total / Math.max(1, transit.totalTicks)));
    const moved = Math.min(squad.count, chunk);
    squad.count -= moved;
    transit.passed += moved;
    transit.ticksLeft -= 1;
    if (squad.count <= 0 || transit.ticksLeft <= 0) {
      squad.count += transit.passed;
      delete squad.transit;
    }
    return;
  }

  const beforeOwner = city.owner;
  const remaining = squad.count;
  const passed = transit.passed;
  delete squad.transit;
  if (remaining <= 0) {
    squad.count = passed;
    if (squad.count <= 0) removed.add(squad.id);
    return;
  }
  const outcome = resolveAttack(city, squad.owner, remaining, state.rules, {
    attackerStrengthMilli: squad.strengthMilli,
    defenderStrengthMilli: strengthFor(state, beforeOwner),
  });
  addLoss(state, squad.owner, outcome.attackerLoss);
  addLoss(state, beforeOwner, outcome.defenderLoss);
  events.push({
    type: "combatResolved",
    cityId: city.id,
    attacker: squad.owner,
    defender: beforeOwner,
    attackerLoss: outcome.attackerLoss,
    defenderLoss: outcome.defenderLoss,
    captured: outcome.captured,
  });
  if (outcome.captured) {
    events.push({ type: "cityCaptured", cityId: city.id, fromOwner: beforeOwner, toOwner: squad.owner, pop: city.pop });
    squad.count = passed + Math.max(0, remaining - outcome.attackerLoss);
  } else {
    squad.count = passed;
  }
  if (squad.count <= 0) removed.add(squad.id);
}

function advanceGridSquads(state: SimState, events: SimEvent[]): void {
  const removed = new Set<string>();
  for (const squad of state.squads.slice().sort(byId)) {
    if (removed.has(squad.id)) continue;
    // 交战中原地停下，由 resolveGridClashes 每 tick 结算。
    if (squad.engagedWith) continue;
    if (squad.transit) {
      advanceGridTransit(state, squad, events, removed);
      continue;
    }
    if (squad.xCm === undefined || squad.zCm === undefined || !squad.gridPath) {
      removed.add(squad.id);
      continue;
    }
    // 以格子为目标的兵团抵达后原地驻留，等待再次指挥。
    if (soldierAtPathEnd(squad)) continue;
    const surface = state.nav
      ? state.nav.surfaceAtXZ(squad.xCm + state.map.size[0] * 5, squad.zCm + state.map.size[1] * 5)
      : undefined;
    const budget = squad.gridSpeedCmPerTick ?? gridSpeedCmPerTick(state.rules, squad.speedMilli, surface);
    const moved = moveAlongGridPath(squad.xCm, squad.zCm, squad.gridPath, squad.gridIndex ?? 0, budget);
    squad.xCm = moved.xCm;
    squad.zCm = moved.zCm;
    squad.gridIndex = moved.index;

    const transitCity = cityAtGridCell(state, moved.xCm, moved.zCm);
    if (transitCity && transitCity.id !== squad.to && transitCity.owner !== squad.owner) {
      squad.transit = { cityId: transitCity.id, totalTicks: 5, ticksLeft: 5, passed: 0 };
      advanceGridTransit(state, squad, events, removed);
      continue;
    }

    const city = findCity(state, squad.to);
    const radius = city?.captureRadiusCm ?? GRID_CAPTURE_RADIUS_CM;
    if (city) {
      const cityPoint: [number, number] = [city.pos[0] * 10, city.pos[1] * 10];
      if (gridDistance([moved.xCm, moved.zCm], cityPoint) <= radius) {
        removed.add(squad.id);
        resolveSquad(state, squad, events);
        continue;
      }
    }
    if (moved.index >= squad.gridPath.length) {
      if (squad.toCell) {
        squad.arrivalTick = state.tick;
        continue;
      }
      removed.add(squad.id);
      resolveSquad(state, squad, events);
    }
  }

  resolveGridOutposts(state, events, removed);
  resolveGridClashes(state, events, removed);
  if (removed.size > 0) state.squads = state.squads.filter((squad) => !removed.has(squad.id));
}

function resolveGridOutposts(state: SimState, events: SimEvent[], removed: Set<string>): void {
  const outposts = state.cities.filter((city) => city.kind === "outpost").sort(byId);
  if (outposts.length === 0) return;
  for (const squad of state.squads.slice().sort(byId)) {
    if (removed.has(squad.id) || squad.xCm === undefined || squad.zCm === undefined) continue;
    for (const outpost of outposts) {
      if (outpost.owner === 0 || outpost.pop <= 0 || outpost.stance !== "engage") continue;
      if (outpost.owner === squad.owner || squad.intercepted.includes(outpost.id)) continue;
      const radius = outpost.captureRadiusCm ?? 600;
      const center: [number, number] = [outpost.pos[0] * 10, outpost.pos[1] * 10];
      if (gridDistance([squad.xCm, squad.zCm], center) > radius) continue;

      squad.intercepted.push(outpost.id);
      outpost.growthLockUntil = state.tick + 2 * state.rules.tickHz;
      const outpostOwner = outpost.owner as PlayerId;
      const outcome = resolveFieldCombat(
        squad.count,
        squad.strengthMilli,
        outpost,
        state.rules,
        strengthFor(state, outpost.owner),
      );
      addLoss(state, squad.owner, outcome.squadLoss);
      addLoss(state, outpostOwner, outcome.outpostLoss);
      events.push({
        type: "squadIntercepted",
        squadId: squad.id,
        cityId: outpost.id,
        squadOwner: squad.owner,
        outpostOwner,
        squadLoss: outcome.squadLoss,
        outpostLoss: outcome.outpostLoss,
        squadDestroyed: outcome.squadDestroyed,
        outpostEmptied: outcome.outpostEmptied,
      });
      if (outcome.outpostEmptied) {
        outpost.owner = 0;
        outpost.stance = "evade";
        outpost.decayAtTick = 0;
      }
      if (outcome.squadDestroyed) {
        removed.add(squad.id);
        break;
      }
      squad.count = outcome.squadCount;
    }
  }
}

const SQUAD_COMBAT_COLUMNS = 3;
const SQUAD_COMBAT_ROW_CM = 68;
/** 脱离交战的余量：双方射程之外再留一段，避免边界上来回抖。 */
const SQUAD_DISENGAGE_MARGIN_CM = 160;

/** 编队纵深：行数越多，后排越晚进入攻击距离。 */
function squadDepthCm(count: number): number {
  return (Math.ceil(Math.max(1, count) / SQUAD_COMBAT_COLUMNS) - 1) * SQUAD_COMBAT_ROW_CM;
}

/**
 * 距离对方前排 gap 厘米时，己方能在攻击范围内的士兵数。
 * rangeCm 是这个兵种的交战距离，远程兵种的射程能覆盖整个纵深。
 */
function engagedSoldiers(count: number, gapCm: number, rangeCm: number): number {
  if (count <= 0) return 0;
  const rows = Math.ceil(count / SQUAD_COMBAT_COLUMNS);
  const reachableRows = Math.floor((rangeCm - Math.max(0, gapCm)) / SQUAD_COMBAT_ROW_CM) + 1;
  return Math.min(count, Math.max(0, Math.min(rows, reachableRows)) * SQUAD_COMBAT_COLUMNS);
}

/** 兵团所属兵种的交战距离，缺省按近战算。 */
function squadRangeCm(squad: SquadState): number {
  return unitProfile(squad.unitKind ?? "barbarian").attackRangeCm;
}

/** 兵团当前在地图上的厘米坐标；路网模式按边的进度插值。 */
function squadPosition(state: SimState, squad: SquadState): [number, number] | null {
  if (squad.xCm !== undefined && squad.zCm !== undefined) return [squad.xCm, squad.zCm];
  const last = squad.path.length - 1;
  if (last <= 0) return null;
  const index = Math.min(squad.pathIndex, last - 1);
  const from = findCity(state, squad.path[index]);
  const to = findCity(state, squad.path[index + 1]);
  if (!from || !to) return null;
  const span = Math.max(1, squad.legEndTick - squad.legStartTick);
  const t = Math.min(1, Math.max(0, (state.tick - squad.legStartTick) / span));
  return [
    from.pos[0] * 10 + (to.pos[0] - from.pos[0]) * 10 * t,
    from.pos[1] * 10 + (to.pos[1] - from.pos[1]) * 10 * t,
  ];
}

/**
 * 地图设置开启时，敌对兵团进入攻击范围后原地交战；
 * 只有靠前、攻击距离覆盖到对方的士兵参与输出，后排随前排倒下逐排压上。
 */
function resolveGridClashes(state: SimState, events: SimEvent[], removed: Set<string>): void {
  if (!state.map.squadCombat) return;
  const squads = state.squads.filter((squad) => !removed.has(squad.id)).sort(byId);
  for (const squad of squads) {
    if (!squad.engagedWith) continue;
    const other = squads.find((entry) => entry.id === squad.engagedWith);
    if (
      !other ||
      squad.xCm === undefined ||
      squad.zCm === undefined ||
      other.xCm === undefined ||
      other.zCm === undefined ||
      gridDistance([squad.xCm, squad.zCm], [other.xCm, other.zCm]) >
        Math.max(squadRangeCm(squad), squadRangeCm(other)) + SQUAD_DISENGAGE_MARGIN_CM
    ) {
      delete squad.engagedWith;
    }
  }
  for (let a = 0; a < squads.length; a += 1) {
    const attacker = squads[a];
    if (removed.has(attacker.id) || attacker.engagedWith) continue;
    for (let b = a + 1; b < squads.length; b += 1) {
      const defender = squads[b];
      if (removed.has(defender.id) || defender.engagedWith || attacker.owner === defender.owner) continue;
      if (attacker.xCm === undefined || attacker.zCm === undefined) continue;
      if (defender.xCm === undefined || defender.zCm === undefined) continue;
      const distance = gridDistance([attacker.xCm, attacker.zCm], [defender.xCm, defender.zCm]);
      const rangeAttack = squadRangeCm(attacker);
      const rangeDefense = squadRangeCm(defender);
      if (distance > Math.max(rangeAttack, rangeDefense) + SQUAD_DISENGAGE_MARGIN_CM) continue;

      const halfDepth = (squadDepthCm(attacker.count) + squadDepthCm(defender.count)) / 2;
      const gap = Math.max(0, distance - halfDepth);
      const engagedAttack = engagedSoldiers(attacker.count, gap, rangeAttack);
      const engagedDefense = engagedSoldiers(defender.count, gap, rangeDefense);
      if (engagedAttack === 0 && engagedDefense === 0) continue;

      attacker.engagedWith = defender.id;
      defender.engagedWith = attacker.id;
      const damageAttack = attackValue(engagedAttack, attacker.strengthMilli);
      const damageDefense = attackValue(engagedDefense, defender.strengthMilli);
      const attackerLoss = Math.min(
        attacker.count,
        damageDefense > 0 ? Math.max(1, Math.floor(damageDefense / 30)) : 0,
      );
      const defenderLoss = Math.min(
        defender.count,
        damageAttack > 0 ? Math.max(1, Math.floor(damageAttack / 30)) : 0,
      );
      attacker.count -= attackerLoss;
      defender.count -= defenderLoss;
      addLoss(state, attacker.owner, attackerLoss);
      addLoss(state, defender.owner, defenderLoss);
      if (attacker.count <= 0) {
        removed.add(attacker.id);
        delete defender.engagedWith;
      }
      if (defender.count <= 0) {
        removed.add(defender.id);
        delete attacker.engagedWith;
      }
      events.push({
        type: "squadClashed",
        attacker: attacker.id,
        defender: defender.id,
        attackerOwner: attacker.owner,
        defenderOwner: defender.owner,
        attackerLoss,
        defenderLoss,
        defenderDestroyed: defender.count <= 0,
      });
      if (removed.has(attacker.id)) break;
    }
  }
}

/**
 * 路网模式下敌对兵团在射程内自动交战：双方原地停下，
 * 只有够得着对方的士兵输出，射程长的兵种可以先手打到对方。
 */
function resolveGraphClashes(state: SimState, events: SimEvent[], removed: Set<string>): void {
  if (state.squads.length < 2) return;
  const squads = state.squads.filter((squad) => !removed.has(squad.id)).sort(byId);

  for (const squad of squads) {
    if (!squad.engagedWith) continue;
    const other = squads.find((entry) => entry.id === squad.engagedWith);
    if (!other || other.owner === squad.owner) {
      delete squad.engagedWith;
      continue;
    }
    const from = squadPosition(state, squad);
    const to = squadPosition(state, other);
    if (!from || !to) {
      delete squad.engagedWith;
      continue;
    }
    const distance = Math.hypot(from[0] - to[0], from[1] - to[1]);
    if (distance > Math.max(squadRangeCm(squad), squadRangeCm(other)) + SQUAD_DISENGAGE_MARGIN_CM) {
      delete squad.engagedWith;
      delete other.engagedWith;
    }
  }

  for (let a = 0; a < squads.length; a += 1) {
    const attacker = squads[a];
    if (removed.has(attacker.id) || attacker.engagedWith) continue;
    const attackerPoint = squadPosition(state, attacker);
    if (!attackerPoint) continue;
    for (let b = a + 1; b < squads.length; b += 1) {
      const defender = squads[b];
      if (removed.has(defender.id) || defender.engagedWith) continue;
      if (attacker.owner === defender.owner) continue;
      const defenderPoint = squadPosition(state, defender);
      if (!defenderPoint) continue;

      const distance = Math.hypot(
        attackerPoint[0] - defenderPoint[0],
        attackerPoint[1] - defenderPoint[1],
      );
      const rangeAttack = squadRangeCm(attacker);
      const rangeDefense = squadRangeCm(defender);
      if (distance > Math.max(rangeAttack, rangeDefense) + SQUAD_DISENGAGE_MARGIN_CM) continue;

      const halfDepth = (squadDepthCm(attacker.count) + squadDepthCm(defender.count)) / 2;
      const gap = Math.max(0, distance - halfDepth);
      const engagedAttack = engagedSoldiers(attacker.count, gap, rangeAttack);
      const engagedDefense = engagedSoldiers(defender.count, gap, rangeDefense);
      if (engagedAttack === 0 && engagedDefense === 0) continue;

      attacker.engagedWith = defender.id;
      defender.engagedWith = attacker.id;
      const damageAttack = attackValue(engagedAttack, attacker.strengthMilli);
      const damageDefense = attackValue(engagedDefense, defender.strengthMilli);
      const attackerLoss = Math.min(
        attacker.count,
        damageDefense > 0 ? Math.max(1, Math.floor(damageDefense / 30)) : 0,
      );
      const defenderLoss = Math.min(
        defender.count,
        damageAttack > 0 ? Math.max(1, Math.floor(damageAttack / 30)) : 0,
      );
      attacker.count -= attackerLoss;
      defender.count -= defenderLoss;
      addLoss(state, attacker.owner, attackerLoss);
      addLoss(state, defender.owner, defenderLoss);

      if (attacker.count <= 0) {
        removed.add(attacker.id);
        delete defender.engagedWith;
      }
      if (defender.count <= 0) {
        removed.add(defender.id);
        delete attacker.engagedWith;
      }
      events.push({
        type: "squadClashed",
        attacker: attacker.id,
        defender: defender.id,
        attackerOwner: attacker.owner,
        defenderOwner: defender.owner,
        attackerLoss,
        defenderLoss,
        defenderDestroyed: defender.count <= 0,
      });
      if (removed.has(attacker.id)) break;
    }
  }
}

