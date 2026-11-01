import { createAi, createGame, hash, step } from "@marchlands/sim";
import type { Command, MapDef, Ruleset, SimState } from "@marchlands/sim";

export interface MatchResult {
  status: SimState["status"];
  winner: SimState["winner"];
  reason: SimState["finishReason"];
  ticks: number;
  finalHash: string;
  rejected: number;
}

export interface ReplayCommand {
  tick: number;
  commands: Command[];
}

export interface Replay {
  version: 1;
  mapSlug: string;
  seed: number;
  commands: ReplayCommand[];
  checkpoints: Array<{ tick: number; hash: string }>;
  result: MatchResult;
}

export interface MatchRun {
  state: SimState;
  replay: Replay;
}

export function runMatch(map: MapDef, rules: Ruleset, seed: number): MatchRun {
  let state = createGame(map, seed, rules);
  const aiOne = createAi(1);
  const aiTwo = createAi(2);
  const commands: ReplayCommand[] = [];
  const checkpoints: Array<{ tick: number; hash: string }> = [];
  let rejected = 0;
  let guard = 0;

  while (state.status === "playing") {
    const tick = state.tick;
    const issued: Command[] = [];
    if (tick % 40 === 0) issued.push(...aiOne.decide(state), ...aiTwo.decide(state));

    const result = step(state, issued);
    rejected += result.rejected.length;
    state = result.state;

    if (issued.length > 0) commands.push({ tick, commands: issued });
    if (state.tick % 20 === 0) checkpoints.push({ tick: state.tick, hash: hash(state) });

    guard += 1;
    if (guard > rules.maxTicks + 10) throw new Error(`match exceeded tick budget: seed ${seed}`);
  }

  return {
    state,
    replay: {
      version: 1,
      mapSlug: map.slug,
      seed,
      commands,
      checkpoints,
      result: {
        status: state.status,
        winner: state.winner,
        reason: state.finishReason,
        ticks: state.tick,
        finalHash: hash(state),
        rejected,
      },
    },
  };
}

export function replayMatch(map: MapDef, rules: Ruleset, replay: Replay): SimState {
  const byTick = new Map<number, Command[]>();
  for (const entry of replay.commands) {
    const existing = byTick.get(entry.tick) ?? [];
    existing.push(...entry.commands);
    byTick.set(entry.tick, existing);
  }

  let state = createGame(map, replay.seed, rules);
  while (state.status === "playing") {
    const result = step(state, byTick.get(state.tick) ?? []);
    state = result.state;
  }
  return state;
}
