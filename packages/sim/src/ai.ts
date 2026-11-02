import { attackValue, defenseValue } from "./combat";
import { granaryStrengthMilli, levelRule, sendPercent } from "./rules";
import { blockedTransit } from "./routes";
import { planGridRoute } from "./grid";
import type { CityState, Command, Owner, PlayerId, SimState } from "./types";

export interface AiController {
  decide(state: SimState): Command[];
}

const DECIDE_EVERY = 40;
const FALLBACK_TICKS = 600;
const GRANARY_EXTRA_COST = 5000;
const GRANARY_FIRST_BONUS = 1500;

function byCityId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function hasGranary(state: SimState, owner: Owner): boolean {
  return owner !== 0 && state.cities.some((city) => city.kind === "granary" && city.owner === owner);
}

function strengthFor(state: SimState, owner: Owner): number {
  return granaryStrengthMilli(state.rules, hasGranary(state, owner));
}

function routeDistance(state: SimState, origin: CityState, target: CityState): number | null {
  if (state.nav) {
    const route = planGridRoute(
      state.map,
      state.nav,
      [origin.pos[0] * 10, origin.pos[1] * 10],
      [target.pos[0] * 10, target.pos[1] * 10],
    );
    return route ? route.cost : null;
  }
  const route = state.graph.route(origin.id, target.id, blockedTransit(state, origin.owner, target.id));
  return route ? route.distance : null;
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
  const ownsGranary = hasGranary(state, player);
  const power = attackValue(count, strengthFor(state, player));

  for (const target of state.cities) {
    if (target.owner === player) continue;
    if (target.kind === "outpost") continue;
    const distance = routeDistance(state, origin, target);
    if (distance === null) continue;
    const defense = defenseValue(target, state.rules, strengthFor(state, target.owner));
    let score = distance * 1000 + defense;
    if (target.kind === "granary") {
      score += ownsGranary ? GRANARY_EXTRA_COST : -GRANARY_FIRST_BONUS;
    }
    if (power > defense) {
      if (score < captureScore || (score === captureScore && capture !== null && target.id < capture.id)) {
        capture = target;
        captureScore = score;
      }
    } else if (allowTrade && power * 2 >= defense) {
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
      for (const site of state.cities) {
        if (site.kind !== "outpost" || site.owner !== player) continue;
        if (site.pop <= 0 || site.stance === "engage") continue;
        commands.push({ type: "setStance", city: site.id, stance: "engage" });
      }

      const own = state.cities
        .filter((city) => city.owner === player && city.kind !== "outpost")
        .sort(byCityId);

      for (const city of own) {
        const full = city.pop * 100 >= city.maxPop * 80;

        if (city.pop * 100 >= city.maxPop * 60) {
          const count = Math.max(1, Math.floor((city.pop * sendPercent(state.rules)) / 100));
          const capture = pickTarget(state, city, player, count, false);
          if (capture) {
            commands.push({ type: "send", from: city.id, to: capture.id });
            continue;
          }
        }

        if (city.kind === "town" && city.level < state.rules.maxLevel && full) {
          const rule = levelRule(state.rules, city.level);
          if (city.pop >= rule.upgradeCost) {
            commands.push({ type: "upgrade", city: city.id });
            continue;
          }
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
