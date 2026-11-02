import type {
  CityId,
  Level,
  MapObjective,
  MapPlayer,
  Owner,
  SiteKind,
  Stance,
} from "@marchlands/sim";

export const TERRAIN_STYLE_IDS = ["frontier", "meadow", "autumn", "ash", "coast", "snow"] as const;
export type TerrainStyle = (typeof TERRAIN_STYLE_IDS)[number];

export const TERRAIN_STYLES: ReadonlyArray<{ id: TerrainStyle; label: string }> = [
  { id: "frontier", label: "边境" },
  { id: "meadow", label: "草原" },
  { id: "autumn", label: "秋林" },
  { id: "ash", label: "灰烬" },
  { id: "coast", label: "海岸" },
  { id: "snow", label: "雪原" },
];

export type RoadStyle = "cobble" | "dirt";

export interface TerrainDraft {
  style: TerrainStyle;
  seed: number;
  /** 起伏强度，1 为默认。 */
  amplitude: number;
}

export interface RoadVisualDraft {
  style: RoadStyle;
  width: number;
}

export interface PropDraft {
  id: string;
  assetId: string;
  pos: [number, number];
  /** 朝向，单位为度。 */
  rotation: number;
  scale: number;
}

export interface UnitVisualDraft {
  player1?: string;
  player2?: string;
}

export interface VisualDraft {
  terrain: TerrainDraft;
  roads: RoadVisualDraft;
  props: PropDraft[];
  units: UnitVisualDraft;
  /** 是否在空白处自动补树、石头与草丛。 */
  scatter: boolean;
}

export interface SiteDraft {
  id: CityId;
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  stance?: Stance;
  watch?: [CityId, CityId];
  /** 据点外观资产 ID；缺省时按类型使用默认外观。 */
  visualAssetId?: string;
  /** 外观自带朝向，单位为度。 */
  visualRotation?: number;
  visualScale?: number;
}

export interface RoadDraft {
  from: CityId;
  to: CityId;
}

export interface MapDocument {
  schema: 2;
  slug: string;
  name: string;
  size: [number, number];
  biome: string;
  players: MapPlayer[];
  sites: SiteDraft[];
  roads: RoadDraft[];
  objectives: MapObjective[];
  transit: "open" | "friendly";
  visual: VisualDraft;
}

export interface SiteVisual {
  assetId?: string;
  rotation: number;
  scale: number;
}

export interface MapVisual {
  terrain: TerrainDraft;
  roads: RoadVisualDraft;
  props: PropDraft[];
  units: UnitVisualDraft;
  scatter: boolean;
  sites: Record<string, SiteVisual>;
}

export type DiagnosticSeverity = "error" | "warning";

export interface EditorDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  siteId?: CityId;
  road?: [CityId, CityId];
  propId?: string;
}

export interface CompileResult {
  map: import("@marchlands/sim").MapDef;
  visual: MapVisual;
  diagnostics: EditorDiagnostic[];
}

export interface ParsedDocument {
  document: MapDocument;
  diagnostics: EditorDiagnostic[];
}