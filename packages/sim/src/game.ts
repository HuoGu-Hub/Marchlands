import { resolveAttack, resolveFieldCombat } from "./combat";
import { applyUpgrade, growCity, growGold } from "./economy";
import { MapGraph } from "./path";
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
} from "./types";

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function findCity(state: SimState, id: CityId): CityState | undefined {
  for (const city of state.cities) if (city.id === id) return city;
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
    })),
    events: [],
  };
}

function reject(rejected: CommandRejection[], command: Command, reason: string): void {
  rejected.push({ command, reason });
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

function watchDistance(state: SimState, squad: SquadState, watch: [CityId, CityId]): number | null {
  let travelled = 0;
  for (let index = 0; index < squad.path.length - 1; index += 1) {
    const from = squad.path[index];
    const to = squad.path[index + 1];
    const length = state.graph.edgeLength(from, to);
    if (length === null) return null;
    const matches =
      (from === watch[0] && to === watch[1]) || (from === watch[1] && to === watch[0]);
    if (matches) return travelled + Math.floor(length / 2);
    travelled += length;
  }
  return null;
}

function interceptTick(state: SimState, squad: SquadState, outpost: CityState): number | null {
  if (!outpost.watch) return null;
  if (squad.to === outpost.id) return null;
  const distance = watchDistance(state, squad, outpost.watch);
  if (distance === null) return null;
  return squad.departTick + travelTicks(distance, state.rules, squad.speedMilli);
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
      const outpostOwner = outpost.owner as PlayerId;
      const outcome = resolveFieldCombat(
        squad.count,
        squad.strengthMilli,
        outpost,
        state.rules,
        strengthFor(state, outpost.owner),
      );
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
  if (!map.cities.some((city) => city.kind === "town")) throw new Error("map has no towns");

  const cities: CityState[] = map.cities
    .map((city: MapCity) => {
      const kind = city.kind;
      const level: Level = kind === "town" ? city.level : 1;
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
        pos: [city.pos[0], city.pos[1]] as [number, number],
        layer: city.layer,
        stance,
        decayAtTick,
        watch,
      };
    })
    .sort(byId);

  const players: PlayerState[] = map.players
    .map((player) => ({ id: player.id, gold: 0, goldCarry: 0 }))
    .sort((a, b) => a.id - b.id);

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
    rules,
    map,
    graph: new MapGraph(map),
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
    if (from.pop < 2) return reject(rejected, command, "too_few_troops");

    const route = state.graph.route(from.id, to.id);
    if (!route) return reject(rejected, command, "no_route");

    const count = Math.max(1, Math.floor((from.pop * sendPercent(state.rules)) / 100));
    from.pop -= count;

    const hasGranary = playerHasGranary(state, from.owner);
    const speedMilli = granarySpeedMilli(state.rules, hasGranary);
    const strengthMilli = granaryStrengthMilli(state.rules, hasGranary);
    const squad: SquadState = {
      id: `s${String(state.nextSquad).padStart(6, "0")}`,
      owner: from.owner,
      from: from.id,
      to: to.id,
      count,
      path: route.path.slice(),
      departTick: state.tick,
      arrivalTick: state.tick + travelTicks(route.distance, state.rules, speedMilli),
      speedMilli,
      strengthMilli,
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

  const city = findCity(state, command.city);
  if (!city) return reject(rejected, command, "unknown_city");
  if (city.owner === 0) return reject(rejected, command, "not_owned");
  if (city.kind !== "town") return reject(rejected, command, "not_upgradable");
  if (city.level >= state.rules.maxLevel) return reject(rejected, command, "max_level");

  const cost = levelRule(state.rules, city.level).upgradeCost;
  if (city.pop < cost) return reject(rejected, command, "insufficient_pop");
  if (!applyUpgrade(city, state.rules)) return reject(rejected, command, "insufficient_pop");

  events.push({ type: "upgradeCompleted", cityId: city.id, level: city.level });
}

function growEconomy(state: SimState): void {
  const goldByPlayer: number[] = [0, 0, 0];
  for (const city of state.cities) {
    if (city.kind !== "town") continue;
    const rule = levelRule(state.rules, city.level);
    growCity(city, rule);
    if (city.owner !== 0) goldByPlayer[city.owner] += rule.goldMilli;
  }
  for (const player of state.players) growGold(player, goldByPlayer[player.id] ?? 0);
}

function advanceSquads(state: SimState, events: SimEvent[]): void {
  resolveInterceptions(state, events);
  if (state.squads.length === 0) return;
  const due = state.squads.filter((squad) => squad.arrivalTick <= state.tick).sort(byId);
  if (due.length === 0) return;

  const dueIds = new Set(due.map((squad) => squad.id));
  state.squads = state.squads.filter((squad) => !dueIds.has(squad.id));
  for (const squad of due) resolveSquad(state, squad, events);
}

function resolveSquad(state: SimState, squad: SquadState, events: SimEvent[]): void {
  events.push({ type: "squadArrived", squadId: squad.id, cityId: squad.to });
  const city = findCity(state, squad.to);
  if (!city) return;

  if (city.owner === squad.owner) {
    city.pop = Math.min(city.maxPop, city.pop + squad.count);
    if (city.kind === "outpost") {
      city.decayAtTick = state.tick + state.rules.outpost.graceTicks;
    }
    return;
  }

  const fromOwner = city.owner;
  const outcome = resolveAttack(city, squad.owner, squad.count, state.rules, {
    attackerStrengthMilli: squad.strengthMilli,
    defenderStrengthMilli: strengthFor(state, fromOwner),
  });
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
  const towns = state.cities.filter((city) => city.kind === "town");
  const total = towns.length;
  if (total === 0) return finish(state, 0, "draw", events);
  const counts: number[] = [0, 0, 0];
  const population: number[] = [0, 0, 0];
  for (const city of towns) {
    counts[city.owner] += 1;
    population[city.owner] += city.pop;
  }

  if (counts[1] === total) return finish(state, 1, "capture_all", events);
  if (counts[1] === 0) return finish(state, 2, "eliminated", events);
  if (counts[2] === 0) return finish(state, 1, "eliminated", events);
  if (state.tick + 1 < state.rules.maxTicks) return;

  const gold: number[] = [0, 0, 0];
  for (const player of state.players) gold[player.id] = player.gold;

  let winner: SimState["winner"] = 0;
  if (counts[1] !== counts[2]) winner = counts[1] > counts[2] ? 1 : 2;
  else if (population[1] !== population[2]) winner = population[1] > population[2] ? 1 : 2;
  else if (gold[1] !== gold[2]) winner = gold[1] > gold[2] ? 1 : 2;

  finish(state, winner, winner === 0 ? "draw" : "time_limit", events);
}
