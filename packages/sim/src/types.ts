import type { MapGraph } from "./path";

export type CityId = string;
export type SiteId = CityId;
export type PlayerId = 1 | 2;
export type Owner = 0 | PlayerId;
export type Level = 1 | 2 | 3;
export type SiteKind = "town" | "granary" | "outpost";
export type Stance = "evade" | "engage";
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
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  layer: number;
  /** 仅临时驻兵点使用；缺省为避战。 */
  stance?: Stance;
  /** 仅临时驻兵点使用；它监视的公路边，用于迎战拦截。 */
  watch?: [CityId, CityId];
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

export interface GranaryRule {
  capacity: number;
  defenseMilli: number;
  speedBonusMilli: number;
  strengthBonusMilli: number;
}

export interface OutpostRule {
  capacity: number;
  defenseMilli: number;
  graceTicks: number;
  decayIntervalTicks: number;
  decayPerInterval: number;
}

export interface SupplyRule {
  /** 队伍出发后可安全行军的 tick 数。 */
  carryTicks: number;
  /** 断粮后掉兵间隔。 */
  starveIntervalTicks: number;
  /** 断粮后每次掉兵数量。 */
  starveLoss: number;
}

export interface Ruleset {
  ruleset: string;
  tickHz: number;
  maxTicks: number;
  sendRatio: number;
  speedDmPerSecond: number;
  maxLevel: number;
  levels: LevelRule[];
  granary: GranaryRule;
  outpost: OutpostRule;
  supply: SupplyRule;
}

export interface CityState {
  id: CityId;
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  maxPop: number;
  growthCarry: number;
  pos: [number, number];
  layer: number;
  stance: Stance;
  decayAtTick: number;
  watch: [CityId, CityId] | null;
}

export type SiteState = CityState;

export interface SquadState {
  id: string;
  owner: PlayerId;
  from: CityId;
  to: CityId;
  count: number;
  path: CityId[];
  /** 当前正在走的边在 path 中的下标。 */
  pathIndex: number;
  /** 当前边开始、结束的 tick。 */
  legStartTick: number;
  legEndTick: number;
  departTick: number;
  arrivalTick: number;
  speedMilli: number;
  strengthMilli: number;
  /** 剩余可安全行军的 tick；0 表示断粮。 */
  supplyLeft: number;
  /** 下一次断粮掉兵的 tick。 */
  nextStarveTick: number;
  intercepted: CityId[];
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
  | {
      type: "squadIntercepted";
      squadId: string;
      cityId: CityId;
      squadOwner: PlayerId;
      outpostOwner: PlayerId;
      squadLoss: number;
      outpostLoss: number;
      squadDestroyed: boolean;
      outpostEmptied: boolean;
    }
  | { type: "outpostDecayed"; cityId: CityId; loss: number; pop: number }
  | { type: "stanceChanged"; cityId: CityId; stance: Stance }
  | {
      type: "squadRetargeted";
      squadId: string;
      to: CityId;
      via: CityId | null;
      arrivalTick: number;
    }
  | {
      type: "squadStarved";
      squadId: string;
      owner: PlayerId;
      loss: number;
      count: number;
      destroyed: boolean;
    }
  | { type: "gameOver"; winner: Owner; reason: FinishReason };

export type Command =
  | { type: "send"; from: CityId; to: CityId }
  | { type: "upgrade"; city: CityId }
  | { type: "setStance"; city: CityId; stance: Stance }
  | { type: "retarget"; squad: string; to: CityId; via?: CityId };

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
