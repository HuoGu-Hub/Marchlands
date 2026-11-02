export {
  cloneDocument,
  compileDocument,
  convertToGrid,
  createGridDocument,
  createStarterDocument,
  documentLabel,
  fromMapDef,
  parseDocument,
  serializeDocument,
} from "./document";
export {
  addProp,
  addSite,
  clampPosition,
  connect,
  disconnect,
  moveProp,
  moveSite,
  nextPropId,
  nextSiteId,
  removeProp,
  removeSite,
  updateDocument,
  updateProp,
  updateRoadVisual,
  updateScatter,
  updateSite,
  updateTerrain,
  updateUnitVisual,
  watchCandidates,
} from "./ops";
export {
  STARTER_SEED,
  cloneVisual,
  compileVisual,
  createDefaultVisual,
  createStarterVisual,
  defaultVisualForMap,
  isAssetId,
  isRoadStyle,
  isTerrainStyle,
  roadDraft,
  terrainDraft,
} from "./visual";
export {
  DEFAULT_CAPTURE_RADIUS_DM,
  DEFAULT_CELL_SIZE_DM,
  DEFAULT_FOOTPRINT_DM,
  createGridDraft,
  emptyBitmap,
  gridCellAt,
  gridCellCenter,
  gridIssues,
  gridNavigationIssues,
  packGridDraft,
  unpackGridDef,
} from "./grid";
export type { GridDraftOptions } from "./grid";
export { applyGridBrush, gridCellFromGround } from "./grid-ops";
export type { GridBrushMode, GridBrushOptions } from "./grid-ops";
export { createHeightField, edgeGrade } from "./height";
export type { HeightField, HeightFieldOptions } from "./height";
export { TERRAIN_STYLE_IDS, TERRAIN_STYLES } from "./types";
export type {
  CompileResult,
  DiagnosticSeverity,
  EditorDiagnostic,
  GridDraft,
  MapDocument,
  MapVisual,
  ParsedDocument,
  PropDraft,
  RoadDraft,
  RoadStyle,
  RoadVisualDraft,
  SiteDraft,
  SiteVisual,
  TerrainDraft,
  TerrainStyle,
  UnitVisualDraft,
  VisionDraft,
  VisualDraft,
} from "./types";