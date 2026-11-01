import { defenseValue } from "./combat";
import { levelRule, sendPercent } from "./rules";
import type { CityState, Command, PlayerId, SimState } from "./types";

export interface AiController {
  decide(state: SimState): Command[];
}

const DECIDE_EVERY = 40;
const FALLBACK_TICKS = 600;

function byCityId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickTarget(
  state: SimState,
  origin: CityState,
  player: PlayerId,
  count: number,
  allowTrade: boolean,
): CityState | null {
  let capture: CityState | null = null;
  let captureScore = Number.POSITIVE_INFINITY;
  let trade: CityState | null = null;
  let tradeScore = Number.POSITIVE_INFINITY;

  for (const target of state.cities) {
    if (target.owner === player) continue;
    const route = state.graph.route(origin.id, target.id);
    if (!route) continue;
    const defense = defenseValue(target, state.rules);
    const score = route.distance * 1000 + defense;
    if (count > defense) {
      if (score < captureScore || (score === captureScore && capture !== null && target.id < capture.id)) {
        capture = target;
        captureScore = score;
      }
    } else if (allowTrade && count * 2 >= defense) {
      if (score < tradeScore || (score === tradeScore && trade !== null && target.id < trade.id)) {
        trade = target;
        tradeScore = score;
      }
    }
  }

  return capture ?? trade;
}

export function createAi(player: PlayerId): AiController {
  let lastAction = 0;

  return {
    decide(state: SimState): Command[] {
      if (state.tick % DECIDE_EVERY !== 0) return [];

      const commands: Command[] = [];
      const own = state.cities.filter((city) => city.owner === player).sort(byCityId);

      for (const city of own) {
        const rule = levelRule(state.rules, city.level);
        const full = city.pop * 100 >= rule.maxPop * 80;

        if (city.pop * 100 >= rule.maxPop * 60) {
          const count = Math.max(1, Math.floor((city.pop * sendPercent(state.rules)) / 100));
          const capture = pickTarget(state, city, player, count, false);
          if (capture) {
            commands.push({ type: "send", from: city.id, to: capture.id });
            continue;
          }
        }

        if (city.level < state.rules.maxLevel && full && city.pop >= rule.upgradeCost) {
          commands.push({ type: "upgrade", city: city.id });
          continue;
        }

        if (full) {
          const count = Math.max(1, Math.floor((city.pop * sendPercent(state.rules)) / 100));
          const trade = pickTarget(state, city, player, count, true);
          if (trade) commands.push({ type: "send", from: city.id, to: trade.id });
        }
      }

      if (commands.length > 0) {
        lastAction = state.tick;
        return commands;
      }

      if (state.tick - lastAction >= FALLBACK_TICKS) {
        const sources = own.filter((city) => city.pop >= 2).sort((a, b) => b.pop - a.pop || byCityId(a, b));
        for (const source of sources) {
          const count = Math.max(1, Math.floor((source.pop * sendPercent(state.rules)) / 100));
          const target = pickTarget(state, source, player, count, true);
          if (target) {
            commands.push({ type: "send", from: source.id, to: target.id });
            lastAction = state.tick;
            break;
          }
        }
      }

      return commands;
    },
  };
}
