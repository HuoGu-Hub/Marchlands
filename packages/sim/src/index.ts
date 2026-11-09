export type {
  CityId,
  CityState,
  Command,
  CommandRejection,
  FinishReason,
  GranaryRule,
  Level,
  LevelRule,
  MageTowerRule,
  MapCity,
  MapDef,
  MapEdge,
  MapGridDef,
  MapObjective,
  MapRoadDef,
  NavigationMode,
  MapPlayer,
  MatchStatus,
  OutpostRule,
  Owner,
  PlayerId,
  PlayerState,
  ProductionSiteKind,
  Ruleset,
  SimEvent,
  SimState,
  SiteId,
  SiteKind,
  SiteState,
  SquadState,
  SquadStance,
  Stance,
  StepResult,
  SupplyRule,
  UnitKind,
} from "./types";

export {
  PRODUCTION_SITE_KINDS,
  isProductionSiteKind,
  isUpgradableSiteKind,
  normalizeSiteKind,
  siteUnitKind,
} from "./types";

export { createGame, step } from "./game";
export { dispatchParts, garrisonEntries, garrisonTotal, initialGarrison, reconcileGarrison } from "./garrison";
export type { DispatchPart, Garrison } from "./garrison";
export { UNIT_PROFILES, UNIT_TRAITS, unitProfile, unitTraits } from "./units";
export type { UnitProfile, UnitTraits } from "./units";
export { canonicalState, hash, hashText, mapHashOf } from "./hash";
export { createAi } from "./ai";
export type { AiController, AiTuning } from "./ai";
export {
  DEFAULT_RULESET,
  arrivalTicks,
  canDispatchFrom,
  granarySpeedMilli,
  granaryStrengthMilli,
  levelRule,
  sendPercent,
  speedPerTick,
  travelTicks,
} from "./rules";
export { MapGraph } from "./path";
export type { Route } from "./path";
export { blockedTransit, buildRetargetPath, nextAnchor, pathTicks, routeOptions } from "./routes";
export { reachableGridCells, reachableGridCities, sendReachableTargets } from "./reach";
export type { GridReach } from "./reach";
export type { RetargetFailure, RetargetPath, RouteOption } from "./routes";
export {
  attackValue,
  defenseMilliFor,
  defenseValue,
  resolveAttack,
  resolveFieldCombat,
} from "./combat";
export type { CombatModifiers, CombatOutcome, FieldOutcome } from "./combat";
export { applyUpgrade, growCity, growGold } from "./economy";

export {
  GRID_CAPTURE_RADIUS_CM,
  GRID_UNIT_RADIUS_CM,
  createUnitNavGrid,
  gridSpeedCmPerTick,
  gridTravelTicks,
  planGridRoute,
} from "./grid";
