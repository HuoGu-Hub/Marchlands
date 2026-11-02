import type {
  CityId,
  Level,
  MapObjective,
  MapPlayer,
  Owner,
  SiteKind,
  Stance,
} from "@marchlands/sim";

export interface SiteDraft {
  id: CityId;
  kind: SiteKind;
  owner: Owner;
  level: Level;
  pop: number;
  pos: [number, number];
  stance?: Stance;
  watch?: [CityId, CityId];
}

export interface RoadDraft {
  from: CityId;
  to: CityId;
}

export interface MapDocument {
  schema: 1;
  slug: string;
  name: string;
  size: [number, number];
  biome: string;
  players: MapPlayer[];
  sites: SiteDraft[];
  roads: RoadDraft[];
  objectives: MapObjective[];
  transit: "open" | "friendly";
}

export type DiagnosticSeverity = "error" | "warning";

export interface EditorDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  siteId?: CityId;
  road?: [CityId, CityId];
}

export interface CompileResult {
  map: import("@marchlands/sim").MapDef;
  diagnostics: EditorDiagnostic[];
}

export interface ParsedDocument {
  document: MapDocument;
  diagnostics: EditorDiagnostic[];
}
