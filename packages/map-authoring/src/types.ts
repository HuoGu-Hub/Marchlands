import type {
  CityId,
  Level,
  MapObjective,
  MapPlayer,
  NavigationMode,
  Owner,
  SiteKind,
  Stance,
} from "@marchlands/sim";

export { PRODUCTION_SITE_KINDS, isProductionSiteKind, siteUnitKind } from "@marchlands/sim";
export type { ProductionSiteKind, UnitKind } from "@marchlands/sim";

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
  /** 地表材质名，例如 rocks007；留空则使用顶点色。 */
  material?: string;
}

export interface RoadVisualDraft {
  style: RoadStyle;
  width: number;
}

export type FoundationShape = "plateau" | "mesa" | "spire" | "terrace" | "root" | "round";

export const FOUNDATION_SHAPES: readonly FoundationShape[] = ["plateau", "mesa", "spire", "terrace", "root", "round"];

export function isFoundationShape(value: unknown): value is FoundationShape {
  return typeof value === "string" && (FOUNDATION_SHAPES as readonly string[]).includes(value);
}

/**
 * 一块地基：地图上可独立增删、移动、缩放的浮空平台。
 * 同一高度且并集仍是矩形的相邻地基会在提交时合并。
 */
export interface FoundationDraft {
  id: string;
  /** 平台中心，分米。 */
  pos: [number, number];
  /** 平台顶面尺寸，分米。 */
  size: [number, number];
  /** 顶面基准高度，米；0 为地图基准面。 */
  elevation: number;
  /** 地基厚度，米；缺省按尺寸推算。 */
  depth?: number;
  /** 外壳模型资产 ID；缺省使用程序化浮岛。 */
  assetId?: string;
  /** 程序化外壳外形；缺省为高原。 */
  shape?: FoundationShape;
  /** 该地基的地貌风格；缺省跟随地图地貌。 */
  terrainStyle?: TerrainStyle;
  /** 该地基的地貌种子；缺省跟随地图。 */
  terrainSeed?: number;
  /** 该地基的起伏强度；缺省跟随地图。 */
  terrainAmplitude?: number;
  /** 是否在该地基上生成自动补景；缺省 true，新建地基默认 false。 */
  scatter?: boolean;
  /** 外壳/顶面贴图名；缺省跟随地图地表材质。 */
  material?: string;
  /** 外壳缩放。 */
  scale: number;
  /** 外壳朝向，单位为度。 */
  rotation: number;
}

export interface PropDraft {
  id: string;
  assetId: string;
  pos: [number, number];
  /** 朝向，单位为度。 */
  rotation: number;
  scale: number;
  /** 是否参与导航阻挡。 */
  blocker?: boolean;
  /** 阻挡占地直径，分米。 */
  footprintDm?: number;
}

export interface GridDraft {
  /** 格子边长，分米；10 表示 1 米。 */
  cellSizeDm: number;
  width: number;
  height: number;
  /** 每格高度，厘米，行优先。 */
  heightCm: number[];
  /** 每格地表枚举，行优先。 */
  surface: number[];
  /** Base64 阻挡位图，1 表示阻挡。 */
  blocked: string;
  /** Base64 可走覆盖位图，1 表示强制可走。 */
  walkableOverride: string;
}

export interface VisionDraft {
  enabled: boolean;
}

export interface UnitVisualDraft {
  player1?: string;
  player2?: string;
}

export interface VisualDraft {
  terrain: TerrainDraft;
  roads: RoadVisualDraft;
  /** 地图由若干地基平台拼成；至少保留一块。 */
  foundations: FoundationDraft[];
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
  /** 未占领时的通行规则；被占领后固定为友方通行。 */
  transit?: "open" | "closed";
  /** 据点外观资产 ID；缺省时按类型使用默认外观。 */
  visualAssetId?: string;
  /** 外观自带朝向，单位为度。 */
  visualRotation?: number;
  /** 外观俯仰 X，单位为度。 */
  visualRotationX?: number;
  /** 外观侧倾 Z，单位为度。 */
  visualRotationZ?: number;
  visualScale?: number;
  /** 城镇占地直径，分米。 */
  footprintDm?: number;
  /** 占领判定半径，分米。 */
  captureRadiusDm?: number;
}

export interface RoadDraft {
  id: string;
  /** 可选端点；自由道路没有端点。 */
  from?: CityId;
  to?: CityId;
  /** 道路控制点，分米；缺省为两端直线。 */
  path?: [number, number][];
  /** 道路宽度，分米；缺省使用地图道路宽度。 */
  widthDm?: number;
}

export interface MapDocument {
  schema: 3;
  navigation: NavigationMode;
  /** 仅网格地图使用。 */
  grid?: GridDraft;
  vision: VisionDraft;
  slug: string;
  name: string;
  size: [number, number];
  biome: string;
  players: MapPlayer[];
  sites: SiteDraft[];
  roads: RoadDraft[];
  objectives: MapObjective[];
  /** 对局起始金币；缺省 0。 */
  startGold?: number;
  transit: "open" | "friendly";
  /** 敌对兵团进入攻击范围后是否停下交战；缺省关闭。 */
  squadCombat?: boolean;
  visual: VisualDraft;
}

export interface SiteVisual {
  assetId?: string;
  rotation: number;
  rotationX?: number;
  rotationZ?: number;
  scale: number;
}

export interface MapVisual {
  terrain: TerrainDraft;
  roads: RoadVisualDraft;
  foundations: FoundationDraft[];
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