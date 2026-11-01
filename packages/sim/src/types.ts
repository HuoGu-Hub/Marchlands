import type { MapGraph } from "./path";

export type CityId = string;
export type PlayerId = 1 | 2;
export type Owner = 0 | PlayerId;
export type Level = 1 | 2 | 3;
export type MatchStatus = "playing" | "finished";
export type FinishReason = "capture_all" | "eliminated" | "time_limit" | "draw";

export interface MapPlayer {
  id: PlayerId;
  name: string;
  color: string;
  ai: boolean;
}

export interface MapCity {
  id: CityId;
  kind: "town";
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  layer: number;
}

export interface MapEdge {
  from: CityId;
  to: CityId;
  length: number;
}

export interface MapObjective {
  type: string;
  ticks?: number;
}

export interface MapDef {
  schema: number;
  slug: string;
  name: string;
  biome: string;
  size: [number, number];
  scale: number;
  ruleset: string;
  players: MapPlayer[];
  cities: MapCity[];
  edges: MapEdge[];
  objectives: MapObjective[];
}

export interface LevelRule {
  level: number;
  maxPop: number;
  upgradeCost: number;
  defense: number;
  growthMilli: number;
  goldMilli: number;
}

export interface Ruleset {
  ruleset: string;
  tickHz: number;
  maxTicks: number;
  sendRatio: number;
  speedDmPerSecond: number;
  maxLevel: number;
  levels: LevelRule[];
}

export interface CityState {
  id: CityId;
  owner: Owner;
  level: Level;
  pop: number;
  maxPop: number;
  growthCarry: number;
  pos: [number, number];
  layer: number;
}

export interface SquadState {
  id: string;
  owner: PlayerId;
  from: CityId;
  to: CityId;
  count: number;
  path: CityId[];
  departTick: number;
  arrivalTick: number;
}

export interface PlayerState {
  id: PlayerId;
  gold: number;
  goldCarry: number;
}

export type SimEvent =
  | {
      type: "squadSpawned";
      squadId: string;
      from: CityId;
      to: CityId;
      count: number;
      arrivalTick: number;
    }
  | { type: "squadArrived"; squadId: string; cityId: CityId }
  | {
      type: "combatResolved";
      cityId: CityId;
      attacker: PlayerId;
      defender: Owner;
      attackerLoss: number;
      defenderLoss: number;
      captured: boolean;
    }
  | { type: "cityCaptured"; cityId: CityId; fromOwner: Owner; toOwner: PlayerId; pop: number }
  | { type: "upgradeCompleted"; cityId: CityId; level: Level }
  | { type: "gameOver"; winner: Owner; reason: FinishReason };

export type Command =
  | { type: "send"; from: CityId; to: CityId }
  | { type: "upgrade"; city: CityId };

export interface CommandRejection {
  command: Command;
  reason: string;
}

export interface StepResult {
  state: SimState;
  rejected: CommandRejection[];
}

export interface SimState {
  tick: number;
  seed: number;
  slug: string;
  status: MatchStatus;
  winner: Owner;
  finishReason: FinishReason | null;
  players: PlayerState[];
  cities: CityState[];
  squads: SquadState[];
  events: SimEvent[];
  rules: Ruleset;
  map: MapDef;
  graph: MapGraph;
  nextSquad: number;
}
