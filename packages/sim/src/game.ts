import { resolveAttack } from "./combat";
import { applyUpgrade, growCity, growGold } from "./economy";
import { MapGraph } from "./path";
import { DEFAULT_RULESET, arrivalTicks, levelRule, sendPercent } from "./rules";
import type {
  CityId,
  CityState,
  Command,
  CommandRejection,
  FinishReason,
  MapDef,
  PlayerState,
  Ruleset,
  SimEvent,
  SimState,
  SquadState,
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
    cities: state.cities.map((city) => ({ ...city, pos: [city.pos[0], city.pos[1]] })),
    squads: state.squads.map((squad) => ({ ...squad, path: squad.path.slice() })),
    events: [],
  };
}

function reject(rejected: CommandRejection[], command: Command, reason: string): void {
  rejected.push({ command, reason });
}

export function createGame(map: MapDef, seed: number, rules: Ruleset = DEFAULT_RULESET): SimState {
  if (map.cities.length === 0) throw new Error("map has no cities");
  if (map.players.length !== 2) throw new Error("map must define exactly 2 players");

  const cities: CityState[] = map.cities
    .map((city) => ({
      id: city.id,
      owner: city.owner,
      level: city.level,
      pop: city.pop,
      maxPop: levelRule(rules, city.level).maxPop,
      growthCarry: 0,
      pos: [city.pos[0], city.pos[1]] as [number, number],
      layer: city.layer,
    }))
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

    const squad: SquadState = {
      id: `s${String(state.nextSquad).padStart(6, "0")}`,
      owner: from.owner,
      from: from.id,
      to: to.id,
      count,
      path: route.path.slice(),
      departTick: state.tick,
      arrivalTick: state.tick + arrivalTicks(route.distance, state.rules),
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

  const city = findCity(state, command.city);
  if (!city) return reject(rejected, command, "unknown_city");
  if (city.owner === 0) return reject(rejected, command, "not_owned");
  if (city.level >= state.rules.maxLevel) return reject(rejected, command, "max_level");

  const cost = levelRule(state.rules, city.level).upgradeCost;
  if (city.pop < cost) return reject(rejected, command, "insufficient_pop");
  if (!applyUpgrade(city, state.rules)) return reject(rejected, command, "insufficient_pop");

  events.push({ type: "upgradeCompleted", cityId: city.id, level: city.level });
}

function growEconomy(state: SimState): void {
  const goldByPlayer: number[] = [0, 0, 0];
  for (const city of state.cities) {
    const rule = levelRule(state.rules, city.level);
    growCity(city, rule);
    if (city.owner !== 0) goldByPlayer[city.owner] += rule.goldMilli;
  }
  for (const player of state.players) growGold(player, goldByPlayer[player.id] ?? 0);
}

function advanceSquads(state: SimState, events: SimEvent[]): void {
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
    return;
  }

  const fromOwner = city.owner;
  const outcome = resolveAttack(city, squad.owner, squad.count, state.rules);
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
    events.push({
      type: "cityCaptured",
      cityId: city.id,
      fromOwner,
      toOwner: squad.owner,
      pop: city.pop,
    });
  }
}

function finish(state: SimState, winner: SimState["winner"], reason: FinishReason, events: SimEvent[]): void {
  state.status = "finished";
  state.winner = winner;
  state.finishReason = reason;
  events.push({ type: "gameOver", winner, reason });
}

function checkFinish(state: SimState, events: SimEvent[]): void {
  const total = state.cities.length;
  const counts: number[] = [0, 0, 0];
  const population: number[] = [0, 0, 0];
  for (const city of state.cities) {
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
