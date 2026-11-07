import { createGame, isProductionSiteKind } from "@marchlands/sim";
import type { CityId, MapDef, Owner, Ruleset, SimState, SiteKind, Stance } from "@marchlands/sim";
import { SITE_KIND_OPTIONS, siteKindLabel } from "../game/site-kind";
import {
  TERRAIN_STYLES,
  addFoundation,
  addProp,
  addRoad,
  addSite,
  applyGridBrush,
  cloneDocument,
  compileDocument,
  convertToGrid,
  createGridDocument,
  createStarterDocument,
  documentBounds,
  documentLabel,
  duplicateFoundation,
  foundationRect,
  gridCellCenter,
  gridCellFromGround,
  moveProp,
  moveSite,
  parseDocument,
  removeFoundation,
  removeProp,
  removeRoad,
  removeSite,
  serializeDocument,
  updateDocument,
  updateFoundation,
  updateProp,
  updateRoad,
  updateRoadVisual,
  updateSite,
  updateTerrain,
  watchCandidates,
} from "@marchlands/map-authoring";
import type {
  CompileResult,
  FoundationBoundsDm,
  MapDocument,
  FoundationDraft,
  MapVisual,
  PropDraft,
  RoadDraft,
  RoadStyle,
  SiteDraft,
  TerrainStyle,
} from "@marchlands/map-authoring";
import {
  NavGrid,
  decodeBitmapBase64,
  decodeInt16Base64,
  decodeUint8Base64,
  planPath,
} from "@marchlands/nav";
import { buildBuiltinAssetPack } from "../game/asset-pack-export";
import { assetRegistry } from "../game/asset-registry";
import { BattleScene } from "../game/scene";
import type { SceneViewState } from "../game/scene";
import { openAssetPackFile, openMapText, saveAssetPackFile, saveMapText } from "./map-io";
import "./editor.css";

type GridTool = "raise" | "lower" | "smooth" | "ramp" | "cliff" | "water" | "surface" | "blocker" | "passable";

type Tool = "select" | SiteKind | "road" | "erase" | "asset" | "foundation" | "island" | GridTool;

const GRID_TOOL_SET: ReadonlySet<string> = new Set<GridTool>([
  "raise",
  "lower",
  "smooth",
  "ramp",
  "cliff",
  "water",
  "surface",
  "blocker",
  "passable",
]);

function isGridTool(tool: Tool): tool is GridTool {
  return GRID_TOOL_SET.has(tool);
}

type Selection =
  | { kind: "site"; id: CityId }
  | { kind: "prop"; id: string }
  | { kind: "road"; id: string }
  | { kind: "foundation"; id: string }
  | null;

interface RoadDrawState {
  from?: CityId;
  points: Array<[number, number]>;
  ground: [number, number] | null;
}

interface RoadPointDragState {
  id: string;
  index: number;
  ground: [number, number];
}

interface EditorOptions {
  root: HTMLElement;
  rules: Ruleset;
  onPlaytest: (map: MapDef, visual: MapVisual) => void;
  onExit: () => void;
}

interface PointerState {
  x: number;
  y: number;
  ground: [number, number] | null;
}

interface DragState {
  id: CityId;
  startX: number;
  startY: number;
  moved: boolean;
  ground: [number, number] | null;
}

interface PropDragState {
  id: string;
  startX: number;
  startY: number;
  moved: boolean;
  ground: [number, number] | null;
}

interface GridStrokeState {
  document: MapDocument;
  start: [number, number];
  lastCell: [number, number];
  changed: boolean;
}

interface FoundationDragState {
  id: string;
  startX: number;
  startY: number;
  originPos: [number, number];
  startGround: [number, number];
  previewPos: [number, number];
  moved: boolean;
}

interface FoundationResizeState {
  id: string;
  kind: "corner" | "edge";
  index: number;
  startRect: FoundationBoundsDm;
  rect: FoundationBoundsDm;
  startX: number;
  startY: number;
  moved: boolean;
}

const TOOL_LABEL: Record<Tool, string> = {
  select: "选择 / 移动",
  barbarian: "野蛮人营地",
  warrior: "精锐战士营",
  ranger: "游侠营地",
  archer: "弓箭手营",
  mage: "法师塔",
  cavalry: "马厩",
  granary: "粮仓",
  outpost: "驻兵点",
  road: "道路",
  erase: "删除",
  asset: "放置装饰",
  raise: "抬高地形",
  lower: "降低地形",
  smooth: "平滑地形",
  ramp: "坡道",
  cliff: "悬崖",
  water: "水面",
  surface: "地表",
  blocker: "阻挡",
  passable: "可通行覆盖",
  foundation: "添加地基",
  island: "添加浮空岛",
};

const AUTOSAVE_KEY = "marchlands.editor.autosave.v1";

const TEMPLATE = `
<div class="ml-ed-shell">
  <header class="ml-ed-bar">
    <button class="ml-ed-back" id="ml-ed-back">返回</button>
    <div class="ml-ed-title">地图编辑器</div>
    <div class="ml-ed-map-label" id="ml-ed-map-label"></div>
    <div class="ml-ed-bar-spacer"></div>
    <div class="ml-ed-actions">
      <button class="ml-ed-btn" id="ml-ed-undo">撤销</button>
      <button class="ml-ed-btn" id="ml-ed-redo">重做</button>
      <button class="ml-ed-btn" id="ml-ed-new">新建</button>
      <button class="ml-ed-btn" id="ml-ed-open">载入</button>
      <button class="ml-ed-btn" id="ml-ed-save">保存</button>
      <button class="ml-ed-btn primary" id="ml-ed-play">试玩</button>
    </div>
  </header>
  <div class="ml-ed-body">
    <aside class="ml-ed-palette">
      <div class="ml-ed-section-label">工具</div>
      <button class="ml-ed-piece tool active" data-tool="select" draggable="false"><i></i><b>选择 / 移动</b><span>拖动据点或装饰</span></button>
      <button class="ml-ed-piece tool" data-tool="road" draggable="false"><i></i><b>道路</b><span>拖动绘制</span></button>
      <button class="ml-ed-piece tool" data-tool="erase" draggable="false"><i></i><b>删除</b><span>点据点、道路或装饰</span></button>
      <div class="ml-ed-modes">
        <button class="ml-ed-mode active" data-mode="site">据点</button>
        <button class="ml-ed-mode" data-mode="foundation">地基</button>
        <button class="ml-ed-mode" data-mode="terrain">地形</button>
        <button class="ml-ed-mode" data-mode="decor">装饰</button>
      </div>
      <div data-panel="terrain">
      <details class="ml-ed-fold" open>
      <summary>网格地形</summary>
      <div class="ml-ed-grid-tools">
        <button class="ml-ed-grid-tool" data-grid-tool="raise">抬高</button>
        <button class="ml-ed-grid-tool" data-grid-tool="lower">降低</button>
        <button class="ml-ed-grid-tool" data-grid-tool="smooth">平滑</button>
        <button class="ml-ed-grid-tool" data-grid-tool="ramp">坡道</button>
        <button class="ml-ed-grid-tool" data-grid-tool="cliff">悬崖</button>
        <button class="ml-ed-grid-tool" data-grid-tool="water">水面</button>
        <button class="ml-ed-grid-tool" data-grid-tool="surface">地表</button>
        <button class="ml-ed-grid-tool" data-grid-tool="blocker">阻挡</button>
        <button class="ml-ed-grid-tool" data-grid-tool="passable">可走</button>
      </div>
      </details>
      </div>
      <div class="ml-ed-grid-actions">
        <select class="ml-ed-grid-cell" id="ml-ed-grid-cell" title="网格分辨率">
          <option value="5">格宽 0.5 米</option>
          <option value="10" selected>格宽 1 米</option>
          <option value="20">格宽 2 米</option>
          <option value="25">格宽 2.5 米</option>
          <option value="50">格宽 5 米</option>
        </select>
        <button class="ml-ed-btn" id="ml-ed-new-grid">新建网格</button>
        <button class="ml-ed-btn" id="ml-ed-grid-enable">启用网格</button>
        <button class="ml-ed-btn" id="ml-ed-nav-preview">导航预览</button>
        <button class="ml-ed-btn" id="ml-ed-path-test">路径测试</button>
      </div>
      <details class="ml-ed-fold" open data-panel="site">
      <summary>据点</summary>
      <button class="ml-ed-piece" data-tool="barbarian" draggable="true"><i class="town"></i><b>兵营</b><span>步兵 · 可升级</span></button>
      <button class="ml-ed-piece" data-tool="ranger" draggable="true"><i class="town"></i><b>马厩</b><span>骑兵 · 可升级</span></button>
      <button class="ml-ed-piece" data-tool="warrior" draggable="true"><i class="town"></i><b>盾兵营</b><span>盾兵 · 可升级</span></button>
      <button class="ml-ed-piece" data-tool="archer" draggable="true"><i class="town"></i><b>弓兵营</b><span>弓兵 · 可升级</span></button>
      <button class="ml-ed-piece" data-tool="granary" draggable="true"><i class="granary"></i><b>粮仓</b><span>不产兵 · 叶子据点</span></button>
      <button class="ml-ed-piece" data-tool="outpost" draggable="true"><i class="outpost"></i><b>驻兵点</b><span>不产兵 · 监视一条路</span></button>
      </details>
      <details class="ml-ed-fold" open data-panel="foundation">
      <summary>地基</summary>
      <button class="ml-ed-piece tool" data-tool="foundation" draggable="false"><i></i><b>添加地基</b><span>点边缘扩展地图</span></button>
      <button class="ml-ed-piece tool" data-tool="island" draggable="false"><i></i><b>添加浮空岛</b><span>独立悬浮平台</span></button>
      <div class="ml-ed-foundation-list" id="ml-ed-foundation-list"></div>
      </details>
      <details class="ml-ed-fold" open data-panel="terrain">
      <summary>地形</summary>
      <div class="ml-ed-asset-grid" id="ml-ed-terrain-grid"></div>
      </details>
      <details class="ml-ed-fold" data-panel="decor">
      <summary>装饰</summary>
      <div id="ml-ed-prop-groups"></div>
      </details>
      <details class="ml-ed-fold">
      <summary>资产包</summary>
      <div class="ml-ed-pack-actions">
        <button class="ml-ed-btn" id="ml-ed-import-pack">导入 .mlpack</button>
        <button class="ml-ed-btn" id="ml-ed-export-pack">导出内置包</button>
      </div>
      <div class="ml-ed-pack-status" id="ml-ed-pack-status"></div>
      </details>
    </aside>
    <main class="ml-ed-stage">
      <canvas id="ml-ed-canvas"></canvas>
      <canvas id="ml-ed-overlay"></canvas>
      <div class="ml-ed-stage-badge" id="ml-ed-badge">选择工具开始</div>
      <div class="ml-ed-stage-hint">左键放置/选择 · 右键拖动平移 · 滚轮缩放 · Q/E 旋转 · 地基模式可扩展地图与加浮空岛 · Delete 删除 · Ctrl+Z 撤销</div>
      <div class="ml-ed-toast" id="ml-ed-toast"></div>
    </main>
    <aside class="ml-ed-inspector" id="ml-ed-inspector"></aside>
  </div>
  <footer class="ml-ed-footer">
    <div class="ml-ed-status" id="ml-ed-status">就绪</div>
    <div class="ml-ed-diagnostics" id="ml-ed-diagnostics"></div>
  </footer>
</div>`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function option(value: string | number, current: string | number, label: string): string {
  return `<option value="${escapeHtml(String(value))}"${String(value) === String(current) ? " selected" : ""}>${escapeHtml(label)}</option>`;
}

function kindLabel(kind: SiteKind): string {
  return siteKindLabel(kind);
}

function toolColor(tool: Tool): string {
  if (tool === "barbarian") return "#c6a36a";
  if (tool === "ranger") return "#b58f67";
  if (tool === "warrior") return "#9c9fbd";
  if (tool === "archer") return "#9fbd72";
  if (tool === "granary") return "#d0b36a";
  if (tool === "outpost") return "#d07a58";
  if (tool === "road") return "#9cae9c";
  if (tool === "erase") return "#b95332";
  if (tool === "raise") return "#8fd18f";
  if (tool === "lower") return "#d18f8f";
  if (tool === "smooth") return "#9fb7d1";
  if (tool === "ramp") return "#d1b78f";
  if (tool === "cliff") return "#d18f5f";
  if (tool === "water") return "#6fb7d1";
  if (tool === "surface") return "#c6a36a";
  if (tool === "blocker") return "#b95332";
  if (tool === "passable") return "#53c7bd";
  if (tool === "foundation") return "#c9a86a";
  if (tool === "island") return "#8fb6d8";
  return "#d8ccb8";
}

function clampRoadPoint(document: MapDocument, point: [number, number]): [number, number] {
  const bounds = documentBounds(document);
  return [
    Math.max(bounds.minX, Math.min(bounds.maxX, Math.round(point[0]))),
    Math.max(bounds.minZ, Math.min(bounds.maxZ, Math.round(point[1]))),
  ];
}

function simplifyRoad(points: Array<[number, number]>, tolerance = 8): Array<[number, number]> {
  if (points.length <= 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  let index = -1;
  let maxDistance = tolerance;
  const dx = last[0] - first[0];
  const dz = last[1] - first[1];
  const length = Math.hypot(dx, dz) || 1;
  for (let cursor = 1; cursor < points.length - 1; cursor += 1) {
    const point = points[cursor];
    const distance = Math.abs(dz * point[0] - dx * point[1] + last[0] * first[1] - last[1] * first[0]) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      index = cursor;
    }
  }
  if (index < 0) return [first, last];
  const left = simplifyRoad(points.slice(0, index + 1), tolerance);
  const right = simplifyRoad(points.slice(index), tolerance);
  return [...left.slice(0, -1), ...right];
}

function pointInQuad(point: { x: number; y: number }, quad: Array<{ x: number; y: number }>): boolean {
  let sign = 0;
  for (let index = 0; index < quad.length; index += 1) {
    const a = quad[index];
    const b = quad[(index + 1) % quad.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 0.0001) continue;
    const current = cross > 0 ? 1 : -1;
    if (sign === 0) sign = current;
    else if (sign !== current) return false;
  }
  return true;
}

export class EditorController {
  private readonly options: EditorOptions;
  private doc: MapDocument = createStarterDocument();
  private compiled: CompileResult = compileDocument(this.doc, { validateNavigation: false });
  private undoStack: MapDocument[] = [];
  private redoStack: MapDocument[] = [];
  private selection: Selection = null;
  private tool: Tool = "select";
  private activeAsset: string | null = null;
  private mounted = false;
  private running = false;
  private dirty = false;
  private raf = 0;
  private lastFrame = 0;
  private scene: BattleScene | null = null;
  private preview: SimState | null = null;
  private view: SceneViewState | null = null;
  private roadFrom: CityId | null = null;
  private pointer: PointerState = { x: 0, y: 0, ground: null };
  private drag: DragState | null = null;
  private propDrag: PropDragState | null = null;
  private pan: { x: number; y: number; moved: boolean } | null = null;
  private suppressClick = false;
  private pointerId: number | null = null;
  private toastTimer = 0;
  private brushRadius = 2;
  private brushStrength = 20;
  private surfaceBrush = 0;
  private navPreview = false;
  private gridStroke: GridStrokeState | null = null;
  private pathTest = false;
  private pathFrom: [number, number] | null = null;
  private pathPoints: Array<[number, number]> | null = null;
  private navCache: { hash: string; grid: NavGrid } | null = null;
  private roadDraw: RoadDrawState | null = null;
  private roadPointDrag: RoadPointDragState | null = null;
  private foundationDrag: FoundationDragState | null = null;
  private foundationResize: FoundationResizeState | null = null;
  private foundationFloatElevation = 12;
  private validationTimer = 0;

  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private inspector!: HTMLElement;
  private statusEl!: HTMLElement;
  private diagnosticsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private terrainGrid!: HTMLElement;
  private foundationList!: HTMLElement;
  private propGroups!: HTMLElement;
  private packStatus!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;
  private navButton!: HTMLButtonElement;
  private pathButton!: HTMLButtonElement;

  constructor(options: EditorOptions) {
    this.options = options;
  }

  open(): void {
    if (!this.mounted) {
      this.mount();
      this.restoreAutosave();
      this.mounted = true;
    }
    this.rebuild(true);
    this.resume();
  }

  suspend(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resume(): void {
    if (!this.mounted || this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose(): void {
    this.suspend();
    if (this.validationTimer !== 0) {
      window.clearTimeout(this.validationTimer);
      this.validationTimer = 0;
    }
    window.removeEventListener("keydown", this.onKeyDown);
    this.scene?.dispose();
    this.scene = null;
  }

  private mount(): void {
    this.options.root.innerHTML = TEMPLATE;
    this.canvas = this.options.root.querySelector("#ml-ed-canvas") as HTMLCanvasElement;
    this.overlay = this.options.root.querySelector("#ml-ed-overlay") as HTMLCanvasElement;
    this.inspector = this.options.root.querySelector("#ml-ed-inspector") as HTMLElement;
    this.statusEl = this.options.root.querySelector("#ml-ed-status") as HTMLElement;
    this.diagnosticsEl = this.options.root.querySelector("#ml-ed-diagnostics") as HTMLElement;
    this.toastEl = this.options.root.querySelector("#ml-ed-toast") as HTMLElement;
    this.badgeEl = this.options.root.querySelector("#ml-ed-badge") as HTMLElement;
    this.terrainGrid = this.options.root.querySelector("#ml-ed-terrain-grid") as HTMLElement;
    this.foundationList = this.options.root.querySelector("#ml-ed-foundation-list") as HTMLElement;
    this.propGroups = this.options.root.querySelector("#ml-ed-prop-groups") as HTMLElement;
    this.packStatus = this.options.root.querySelector("#ml-ed-pack-status") as HTMLElement;
    this.playButton = this.options.root.querySelector("#ml-ed-play") as HTMLButtonElement;
    this.undoButton = this.options.root.querySelector("#ml-ed-undo") as HTMLButtonElement;
    this.redoButton = this.options.root.querySelector("#ml-ed-redo") as HTMLButtonElement;
    this.navButton = this.options.root.querySelector("#ml-ed-nav-preview") as HTMLButtonElement;
    this.pathButton = this.options.root.querySelector("#ml-ed-path-test") as HTMLButtonElement;
    const context = this.overlay.getContext("2d");
    if (!context) throw new Error("editor overlay canvas unavailable");
    this.ctx = context;

    this.options.root.querySelector("#ml-ed-back")?.addEventListener("click", () => this.requestExit());
    this.options.root.querySelector("#ml-ed-undo")?.addEventListener("click", () => this.undo());
    this.options.root.querySelector("#ml-ed-redo")?.addEventListener("click", () => this.redo());
    this.options.root.querySelector("#ml-ed-new")?.addEventListener("click", () => this.newDocument());
    this.options.root.querySelector("#ml-ed-open")?.addEventListener("click", () => {
      void this.openDocument();
    });
    this.options.root.querySelector("#ml-ed-save")?.addEventListener("click", () => {
      void this.saveDocument();
    });
    this.playButton.addEventListener("click", () => this.playtest());
    this.options.root.querySelector("#ml-ed-import-pack")?.addEventListener("click", () => {
      void this.importAssetPack();
    });
    this.options.root.querySelector("#ml-ed-export-pack")?.addEventListener("click", () => {
      void this.exportBuiltinPack();
    });
    this.options.root.querySelector("#ml-ed-new-grid")?.addEventListener("click", () => {
      this.commit(createGridDocument([700, 700], { cellSizeDm: this.gridCellSize() }), "已新建网格地图");
    });
    this.options.root.querySelector("#ml-ed-grid-enable")?.addEventListener("click", () => this.enableGrid());
    this.navButton.addEventListener("click", () => this.toggleNavPreview());
    this.pathButton.addEventListener("click", () => this.togglePathTest());
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-grid-tool]")) {
      button.addEventListener("click", () => {
        const tool = button.dataset.gridTool as GridTool | undefined;
        if (tool) this.setTool(tool);
      });
    }
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-mode]")) {
      button.addEventListener("click", () => {
        const mode = button.dataset.mode;
        if (mode === "site" || mode === "foundation" || mode === "terrain" || mode === "decor") this.setPaletteMode(mode);
      });
    }
    this.setPaletteMode("site");

    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool as Tool | undefined;
        if (tool) this.setTool(tool);
      });
      button.addEventListener("dragstart", (event) => {
        const tool = button.dataset.tool;
        if (!tool || (!isProductionSiteKind(tool as SiteKind) && tool !== "granary" && tool !== "outpost")) return;
        event.dataTransfer?.setData("text/ml-site-kind", tool);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      });
    }

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("click", this.onClick);
    this.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.canvas.addEventListener("dragover", (event) => {
      if (
        event.dataTransfer?.types.includes("text/ml-site-kind") ||
        event.dataTransfer?.types.includes("text/ml-asset-id")
      ) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    });
    this.canvas.addEventListener("drop", this.onDrop);
    window.addEventListener("keydown", this.onKeyDown);
    this.badgeEl.textContent = TOOL_LABEL[this.tool];
    this.renderAssetPalette();
    this.updateGridControls();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlEditor = {
        foundations: () => this.doc.visual.foundations.map((foundation) => ({ ...foundation })),
        quad: (id: string) => {
          const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
          return foundation ? this.foundationQuad(foundation) : null;
        },
        select: (id: string) => this.selectFoundation(id),
      };
    }
  }

  private restoreAutosave(): void {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return;
      const parsed = parseDocument(JSON.parse(text));
      this.doc = parsed.document;
      this.compiled = compileDocument(this.doc, { validateNavigation: false });
      this.dirty = false;
      this.notice("已恢复上次草稿");
    } catch {
      this.doc = createStarterDocument();
      this.compiled = compileDocument(this.doc, { validateNavigation: false });
    }
  }

  private rebuild(preserveView: boolean): void {
    const view = preserveView ? this.scene?.getViewState() ?? this.view : null;
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    if (this.selection?.kind === "site" && !this.doc.sites.some((site) => site.id === this.selection?.id)) {
      this.selection = null;
    }
    if (this.selection?.kind === "prop" && !this.doc.visual.props.some((prop) => prop.id === this.selection?.id)) {
      this.selection = null;
    }
    if (this.selection?.kind === "road" && !this.doc.roads.some((road) => road.id === this.selection?.id)) {
      this.selection = null;
    }
    if (
      this.selection?.kind === "foundation" &&
      !this.doc.visual.foundations.some((foundation) => foundation.id === this.selection?.id)
    ) {
      this.selection = null;
    }

    this.navCache = null;
    this.pathFrom = null;
    this.pathPoints = null;
    let preview: SimState | null = null;
    const hasTown = this.compiled.map.cities.some((city) => isProductionSiteKind(city.kind));
    if (hasTown && this.compiled.map.players.length === 2) {
      try {
        preview = createGame(this.compiled.map, 1, this.options.rules);
      } catch {
        preview = null;
      }
    }

    this.scene?.dispose();
    this.scene = null;
    this.preview = preview;
    if (this.compiled.map.cities.length > 0) {
      const scene = new BattleScene(this.canvas, this.compiled.map, this.compiled.visual);
      if (view) scene.setViewState(view);
      if (preview) scene.update(preview, 0);
      scene.setSelected(this.selection?.kind === "site" ? this.selection.id : null);
      scene.setNavPreview(this.navPreview);
      this.scene = scene;
      this.view = scene.getViewState();
    }

    this.autosave();
    this.renderInspector();
    this.renderFoundationList();
    this.renderStatus();
    this.syncTop();
    this.updateGridControls();
    this.drawOverlay();
    this.scheduleValidation();
  }

  private scheduleValidation(): void {
    if (this.validationTimer !== 0) window.clearTimeout(this.validationTimer);
    this.validationTimer = window.setTimeout(() => {
      this.validationTimer = 0;
      try {
        this.compiled = compileDocument(this.doc);
        this.renderStatus();
      } catch {
        // keep the last compiled result; the next edit retries
      }
    }, 300);
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeDocument(this.doc));
    } catch {
      // localStorage can be unavailable in a locked profile
    }
  }

  private commit(
    next: MapDocument,
    message: string,
    options: { roadOnly?: boolean; propsOnly?: boolean; terrainOnly?: boolean; siteOnly?: boolean } = {},
  ): void {
    if (serializeDocument(next) === serializeDocument(this.doc)) return;
    this.undoStack.push(cloneDocument(this.doc));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.doc = next;
    this.dirty = true;
    if ((options.roadOnly || options.propsOnly || options.terrainOnly || options.siteOnly) && this.scene) {
      this.compiled = compileDocument(next, { validateNavigation: false });
      if (options.siteOnly) {
        try {
          this.preview = createGame(this.compiled.map, 1, this.options.rules);
          this.scene.updateSites(this.compiled.map, this.compiled.visual, this.preview);
        } catch {
          this.rebuild(true);
          this.notice(message);
          return;
        }
      } else if (options.roadOnly) this.scene.updateRoads(this.compiled.map, this.compiled.visual);
      else if (options.terrainOnly) {
        this.scene.updateTerrain(this.compiled.map, this.compiled.visual);
        this.scene.setNavPreview(this.navPreview);
      } else this.scene.updateProps(this.compiled.visual);
      this.autosave();
      this.renderInspector();
      this.renderStatus();
      this.syncTop();
      this.updateGridControls();
      this.drawOverlay();
      this.scheduleValidation();
      this.notice(message);
      return;
    }
    this.rebuild(true);
    this.notice(message);
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneDocument(this.doc));
    this.doc = previous;
    this.dirty = true;
    this.rebuild(true);
    this.notice("已撤销");
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDocument(this.doc));
    this.doc = next;
    this.dirty = true;
    this.rebuild(true);
    this.notice("已重做");
  }

  private setTool(tool: Tool): void {
    if (isGridTool(tool)) {
      if (this.pathTest) {
        this.pathTest = false;
        this.pathButton?.classList.remove("active");
      }
      if (this.doc.navigation !== "grid" || !this.doc.grid) {
        this.notice("先启用网格导航或新建网格地图");
        return;
      }
    }
    this.tool = tool;
    if (tool !== "asset") this.activeAsset = null;
    this.roadFrom = null;
    this.roadDraw = null;
    this.roadPointDrag = null;
    this.foundationDrag = null;
    this.foundationResize = null;
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.classList.toggle("active", button.dataset.tool === tool);
    }
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-grid-tool]")) {
      button.classList.toggle("active", button.dataset.gridTool === tool);
    }
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      button.classList.toggle("active", this.tool === "asset" && button.dataset.assetId === this.activeAsset);
    }
    this.canvas.style.cursor = tool === "select" ? "grab" : tool === "erase" ? "not-allowed" : "crosshair";
    this.badgeEl.textContent = TOOL_LABEL[tool];
    this.drawOverlay();
  }

  private setPaletteMode(mode: "site" | "foundation" | "terrain" | "decor"): void {
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === mode);
    }
    for (const panel of this.options.root.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== mode;
    }
  }

  private updateGridControls(): void {
    const grid = this.doc.navigation === "grid" && Boolean(this.doc.grid);
    for (const button of this.options.root.querySelectorAll<HTMLButtonElement>("[data-grid-tool]")) {
      button.disabled = !grid;
      button.classList.toggle("active", grid && button.dataset.gridTool === this.tool);
    }
    const enable = this.options.root.querySelector<HTMLButtonElement>("#ml-ed-grid-enable");
    if (enable) enable.disabled = grid;
    this.navButton.classList.toggle("active", this.navPreview);
  }

  private gridCellSize(): number {
    const select = this.options.root.querySelector<HTMLSelectElement>("#ml-ed-grid-cell");
    return Math.max(5, Math.round(Number(select?.value) || 10));
  }

  private enableGrid(): void {
    if (this.doc.navigation === "grid" && this.doc.grid) {
      this.notice("已经是网格地图");
      return;
    }
    try {
      this.commit(convertToGrid(this.doc, { cellSizeDm: this.gridCellSize() }), "已启用网格导航");
    } catch {
      this.notice("地图尺寸必须能被网格边长整除");
    }
  }

  private toggleNavPreview(): void {
    this.navPreview = !this.navPreview;
    this.scene?.setNavPreview(this.navPreview);
    this.updateGridControls();
    this.drawOverlay();
  }

  private togglePathTest(): void {
    this.pathTest = !this.pathTest;
    this.pathFrom = null;
    this.pathPoints = null;
    this.pathButton.classList.toggle("active", this.pathTest);
    this.canvas.style.cursor = this.pathTest ? "crosshair" : this.tool === "select" ? "grab" : "crosshair";
    this.notice(this.pathTest ? "路径测试：点起点和终点" : "已退出路径测试");
    this.drawOverlay();
  }

  private navGridForMap(): NavGrid | null {
    const map = this.compiled.map;
    if (!map.grid) return null;
    const hash = map.mapHash ?? "";
    if (this.navCache && this.navCache.hash === hash) return this.navCache.grid;
    const grid = map.grid;
    const cells = grid.width * grid.height;
    const climbCm = map.climbCm ?? 60;
    const nav = new NavGrid({
      cellSizeCm: grid.cellSizeCm,
      width: grid.width,
      height: grid.height,
      heightCm: decodeInt16Base64(grid.heightCm, cells),
      surface: decodeUint8Base64(grid.surface, cells),
      blocked: decodeBitmapBase64(grid.blocked, cells),
      walkableOverride: decodeBitmapBase64(grid.walkableOverride, cells),
      rules: {
        maxSlopePermille: Math.round((climbCm / grid.cellSizeCm) * 1000),
      },
    });
    this.navCache = { hash, grid: nav };
    return nav;
  }

  private handlePathClick(ground: [number, number]): void {
    const nav = this.navGridForMap();
    if (!nav) {
      this.notice("当前不是网格地图");
      return;
    }
    const cell = gridCellFromGround(this.doc, ground);
    if (!cell) return;
    const goal = nav.index(cell[0], cell[1]);
    if (!this.pathFrom) {
      this.pathFrom = cell;
      this.pathPoints = null;
      this.notice(`路径起点 ${cell[0]}, ${cell[1]}，再点终点`);
      this.drawOverlay();
      return;
    }
    const start = nav.index(this.pathFrom[0], this.pathFrom[1]);
    const from = this.pathFrom;
    this.pathFrom = null;
    const path = planPath(nav, nav.centerOf(start), nav.centerOf(goal), { radiusCm: 40, smooth: true });
    if (!path) {
      this.pathPoints = null;
      this.notice(`${from[0]}, ${from[1]} 到 ${cell[0]}, ${cell[1]} 不可达`);
      this.drawOverlay();
      return;
    }
    const offsetX = this.doc.size[0] * 5;
    const offsetZ = this.doc.size[1] * 5;
    this.pathPoints = path.points.map(
      (point) => [(point.xCm - offsetX) / 10, (point.zCm - offsetZ) / 10] as [number, number],
    );
    this.notice(`路径 ${path.cells.length} 格 · 代价 ${path.cost} · 终点 ${cell[0]}, ${cell[1]}`);
    this.drawOverlay();
  }

  private beginGridStroke(ground: [number, number]): void {
    const cell = gridCellFromGround(this.doc, ground);
    if (!cell) return;
    this.gridStroke = { document: cloneDocument(this.doc), start: cell, lastCell: cell, changed: false };
    this.applyGridStroke(ground);
  }

  private extendGridStroke(): void {
    const stroke = this.gridStroke;
    if (!stroke || !this.pointer.ground) return;
    const cell = gridCellFromGround(stroke.document, this.pointer.ground);
    if (!cell) return;
    if (cell[0] === stroke.lastCell[0] && cell[1] === stroke.lastCell[1]) return;
    stroke.lastCell = cell;
    this.applyGridStroke(this.pointer.ground);
  }

  private applyGridStroke(ground: [number, number]): void {
    const stroke = this.gridStroke;
    if (!stroke || !isGridTool(this.tool)) return;
    const cell = gridCellFromGround(stroke.document, ground);
    if (!cell) return;
    const next = applyGridBrush(stroke.document, {
      mode: this.tool,
      cell,
      startCell: stroke.start,
      radiusCells: this.brushRadius,
      // 悬崖笔刷一次抬高一层，正好跨过 120 厘米的陡壁阈值。
      strengthCm: this.tool === "cliff" ? 120 : this.brushStrength,
      surface: this.surfaceBrush,
    });
    stroke.document = next;
    stroke.changed = true;
    const grid = next.grid;
    if (grid) {
      const index = cell[1] * grid.width + cell[0];
      this.badgeEl.textContent = `${TOOL_LABEL[this.tool]} · 高度 ${grid.heightCm[index]} cm · ${cell[0]}, ${cell[1]}`;
    }
    this.drawOverlay();
  }

  private setActiveAsset(assetId: string): void {
    this.tool = "asset";
    this.activeAsset = assetId;
    this.roadFrom = null;
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.classList.remove("active");
    }
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      button.classList.toggle("active", button.dataset.assetId === assetId);
    }
    this.canvas.style.cursor = "crosshair";
    const info = assetRegistry.info(assetId);
    this.badgeEl.textContent = `放置 ${info?.label ?? assetId}`;
    this.drawOverlay();
  }

  private renderAssetPalette(): void {
    assetRegistry.registerBuiltins();
    const terrainOrder = ["hill", "ridge", "mesa", "pond", "field", "grove", "ruin", "camp"];
    const terrain = assetRegistry
      .list("terrain")
      .sort((a, b) => terrainOrder.indexOf(a.id.split(".").pop() ?? "") - terrainOrder.indexOf(b.id.split(".").pop() ?? ""));
    const props = assetRegistry.list("prop");
    const counts = assetRegistry.counts();
    this.terrainGrid.innerHTML = terrain.map((asset) => this.assetButton(asset)).join("");
    const groups = new Map<string, typeof props>();
    for (const asset of props) {
      const tag = asset.tags[0] ?? "其他";
      const bucket = groups.get(tag) ?? [];
      bucket.push(asset);
      groups.set(tag, bucket);
    }
    const groupOrder = ["树木", "草木", "岩石", "城镇", "建筑构件", "城堡", "其他"];
    const orderedGroups = [...groups.entries()].sort(
      (a, b) => {
        const left = groupOrder.indexOf(a[0]);
        const right = groupOrder.indexOf(b[0]);
        return (left < 0 ? 99 : left) - (right < 0 ? 99 : right);
      },
    );
    this.propGroups.innerHTML = orderedGroups
      .map(
        ([tag, assets]) => `
          <div class="ml-ed-asset-group">
            <div class="ml-ed-asset-group-label">${escapeHtml(tag)}</div>
            <div class="ml-ed-asset-grid">${assets.map((asset) => this.assetButton(asset)).join("")}</div>
          </div>`,
      )
      .join("");
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.assetId;
        if (id) this.setActiveAsset(id);
      });
      button.addEventListener("dragstart", (event) => {
        const id = button.dataset.assetId;
        if (!id || !event.dataTransfer) return;
        event.dataTransfer.setData("text/ml-asset-id", id);
        event.dataTransfer.effectAllowed = "copy";
      });
    }
    const missing = this.doc.visual.props.filter((prop) => !assetRegistry.has(prop.assetId)).length;
    const packLabel = counts.packs > 0 ? `${counts.packs} 个资产包` : "未导入资产包";
    this.packStatus.textContent = `${packLabel} · ${counts.prop + counts.terrain} 个可用资产${missing > 0 ? ` · ${missing} 个缺失` : ""}`;
  }

  private assetButton(asset: { id: string; label: string; kind: string; source: string }): string {
    const active = this.tool === "asset" && this.activeAsset === asset.id;
    return `<button class="ml-ed-asset${active ? " active" : ""}" data-asset-id="${escapeHtml(asset.id)}" data-kind="${escapeHtml(asset.kind)}" draggable="true" title="${escapeHtml(asset.label)} · ${asset.source === "builtin" ? "内置" : "资产包"}">
      <i></i><b>${escapeHtml(asset.label)}</b>
    </button>`;
  }

  private addAssetAt(assetId: string, ground: [number, number]): void {
    const pos = this.snapGround(ground);
    if (this.scene && !this.scene.hasGround(pos[0], pos[1])) {
      this.notice("这里不在地基上，先添加一块地基");
      return;
    }
    const result = addProp(this.doc, assetId, pos, 0, 1);
    this.selection = { kind: "prop", id: result.prop.id };
    this.commit(result.document, `已放置 ${assetRegistry.info(assetId)?.label ?? "装饰"}`, { propsOnly: true });
  }

  private async importAssetPack(): Promise<void> {
    const opened = await openAssetPackFile();
    if (!opened) return;
    this.notice("正在导入资产包…");
    try {
      const result = await assetRegistry.loadPack(opened.bytes, { persist: true, fileName: opened.name });
      this.renderAssetPalette();
      this.renderInspector();
      this.renderStatus();
      this.notice(`已导入 ${result.manifest.name} · ${result.count} 个资产`);
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "资产包无法读取");
    }
  }

  private async exportBuiltinPack(): Promise<void> {
    this.notice("正在打包内置模型…");
    try {
      const pack = await buildBuiltinAssetPack();
      const saved = await saveAssetPackFile(pack.bytes, `Marchlands-Builtin-${pack.count}.mlpack`);
      this.notice(saved ? `已导出 ${pack.count} 个内置模型` : "已取消导出");
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "内置资产包导出失败");
    }
  }

  private pickProp(clientX: number, clientY: number): string | null {
    if (!this.scene) return null;
    let best: string | null = null;
    let bestDistance = 26;
    for (const prop of this.doc.visual.props) {
      const point = this.scene.projectGround(prop.pos[0], prop.pos[1], 0.5);
      if (!point) continue;
      const info = assetRegistry.info(prop.assetId);
      const radius = Math.max(18, Math.min(46, (info?.footprint ?? 2) * 2.2));
      const distance = Math.hypot(clientX - point.x, clientY - point.y);
      if (distance < radius && distance < bestDistance) {
        bestDistance = distance;
        best = prop.id;
      }
    }
    return best;
  }

  private snapGround(ground: [number, number]): [number, number] {
    const step = 5;
    return [Math.round(ground[0] / step) * step, Math.round(ground[1] / step) * step];
  }

  private addAt(kind: SiteKind, ground: [number, number]): void {
    const pos = this.snapGround(ground);
    if (this.scene && !this.scene.hasGround(pos[0], pos[1])) {
      this.notice("这里不在地基上，先添加一块地基");
      return;
    }
    const tooClose = this.doc.sites.some((site) => Math.hypot(site.pos[0] - pos[0], site.pos[1] - pos[1]) < 80);
    if (tooClose) {
      this.notice("两个据点至少间隔 8 米");
      return;
    }
    const result = addSite(this.doc, kind, pos, 0);
    this.selection = { kind: "site", id: result.site.id };
    this.commit(result.document, `已放置 ${kindLabel(kind)}`, { siteOnly: true });
  }

  private pickSite(clientX: number, clientY: number): CityId | null {
    if (!this.scene) return null;
    let best: CityId | null = null;
    let bestDistance = 34;
    for (const site of this.doc.sites) {
      const point = this.scene.projectGround(site.pos[0], site.pos[1], 2);
      if (!point) continue;
      const distance = Math.hypot(clientX - point.x, clientY - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site.id;
      }
    }
    return best;
  }

  private roadPoints(road: RoadDraft): Array<[number, number]> {
    if (road.path && road.path.length >= 2) return road.path;
    const from = this.doc.sites.find((site) => site.id === road.from);
    const to = this.doc.sites.find((site) => site.id === road.to);
    return from && to ? [from.pos, to.pos] : [];
  }

  private pickRoad(clientX: number, clientY: number): string | null {
    if (!this.scene) return null;
    let best: string | null = null;
    let bestDistance = 12;
    for (const road of this.doc.roads) {
      const points = this.roadPoints(road);
      for (let index = 0; index < points.length - 1; index += 1) {
        const pa = this.scene.projectGround(points[index][0], points[index][1], 1);
        const pb = this.scene.projectGround(points[index + 1][0], points[index + 1][1], 1);
        if (!pa || !pb) continue;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq < 1) continue;
        const t = Math.max(0, Math.min(1, ((clientX - pa.x) * dx + (clientY - pa.y) * dy) / lengthSq));
        const distance = Math.hypot(clientX - (pa.x + dx * t), clientY - (pa.y + dy * t));
        if (distance < bestDistance) {
          bestDistance = distance;
          best = road.id;
        }
      }
    }
    return best;
  }

  private pickRoadPoint(clientX: number, clientY: number): { road: RoadDraft; index: number } | null {
    if (!this.scene || this.selection?.kind !== "road") return null;
    const road = this.selectedRoad();
    if (!road) return null;
    const points = this.roadPoints(road);
    for (let index = 0; index < points.length; index += 1) {
      const projected = this.scene.projectGround(points[index][0], points[index][1], 0.6);
      if (!projected) continue;
      if (Math.hypot(clientX - projected.x, clientY - projected.y) <= 10) return { road, index };
    }
    return null;
  }

  private pickRoadSegment(clientX: number, clientY: number): { index: number; point: [number, number] } | null {
    if (!this.scene) return null;
    const road = this.selectedRoad();
    if (!road) return null;
    const points = this.roadPoints(road);
    let bestIndex = -1;
    let bestDistance = 12;
    let bestT = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const a = this.scene.projectGround(points[index][0], points[index][1], 0.5);
      const b = this.scene.projectGround(points[index + 1][0], points[index + 1][1], 0.5);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1) continue;
      const t = Math.max(0, Math.min(1, ((clientX - a.x) * dx + (clientY - a.y) * dy) / lengthSq));
      const distance = Math.hypot(clientX - (a.x + dx * t), clientY - (a.y + dy * t));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
        bestT = t;
      }
    }
    if (bestIndex < 0) return null;
    const a = points[bestIndex];
    const b = points[bestIndex + 1];
    return {
      index: bestIndex,
      point: [Math.round(a[0] + (b[0] - a[0]) * bestT), Math.round(a[1] + (b[1] - a[1]) * bestT)],
    };
  }

  private removeRoadPoint(index: number): void {
    const road = this.selectedRoad();
    if (!road) return;
    const points = this.roadPoints(road).map((point) => [point[0], point[1]] as [number, number]);
    const isAttachedStart = index === 0 && Boolean(road.from);
    const isAttachedEnd = index === points.length - 1 && Boolean(road.to);
    if (isAttachedStart || isAttachedEnd) {
      this.notice("已连接据点的端点不能删除");
      return;
    }
    points.splice(index, 1);
    if (points.length < 2) {
      this.notice("道路至少需要两个控制点");
      return;
    }
    this.commit(updateRoad(this.doc, road.id, { path: points }), "已删除道路控制点", { roadOnly: true });
    this.suppressClick = true;
  }

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (!this.scene || this.tool !== "select" || this.selection?.kind !== "road") return;
    const segment = this.pickRoadSegment(event.clientX, event.clientY);
    if (!segment) return;
    event.preventDefault();
    const road = this.selectedRoad();
    if (!road) return;
    const points = this.roadPoints(road).map((point) => [point[0], point[1]] as [number, number]);
    points.splice(segment.index + 1, 0, segment.point);
    this.commit(updateRoad(this.doc, road.id, { path: points }), "已添加道路控制点", { roadOnly: true });
    this.suppressClick = true;
  };

  private selectSite(id: CityId | null): void {
    this.selection = id ? { kind: "site", id } : null;
    this.scene?.setSelected(id);
    this.renderInspector();
    this.drawOverlay();
  }

  private selectProp(id: string | null): void {
    this.selection = id ? { kind: "prop", id } : null;
    this.scene?.setSelected(null);
    this.renderInspector();
    this.drawOverlay();
  }

  private selectRoad(id: string | null): void {
    this.selection = id ? { kind: "road", id } : null;
    this.scene?.setSelected(null);
    this.renderInspector();
    this.drawOverlay();
  }

  private selectedRoad(): RoadDraft | null {
    if (this.selection?.kind !== "road") return null;
    return this.doc.roads.find((road) => road.id === this.selection?.id) ?? null;
  }

  private selectedFoundation(): FoundationDraft | null {
    if (this.selection?.kind !== "foundation") return null;
    return this.doc.visual.foundations.find((foundation) => foundation.id === this.selection?.id) ?? null;
  }

  private selectFoundation(id: string | null): void {
    this.selection = id ? { kind: "foundation", id } : null;
    this.scene?.setSelected(null);
    this.renderInspector();
    this.renderFoundationList();
    this.drawOverlay();
  }

  /** 地基四角投影到覆盖层坐标；顺序为左上、右上、右下、左下。 */
  private foundationQuad(foundation: FoundationDraft): Array<{ x: number; y: number }> | null {
    if (!this.scene) return null;
    const rect = foundationRect(foundation);
    const corners: Array<[number, number]> = [
      [rect.minX, rect.minZ],
      [rect.maxX, rect.minZ],
      [rect.maxX, rect.maxZ],
      [rect.minX, rect.maxZ],
    ];
    const screen = corners.map(([x, z]) => this.scene?.projectGround(x, z, 0.25));
    if (screen.some((point) => !point)) return null;
    const rectClient = this.canvas.getBoundingClientRect();
    return (screen as Array<{ x: number; y: number }>).map((point) => ({
      x: point.x - rectClient.left,
      y: point.y - rectClient.top,
    }));
  }

  private pickFoundation(clientX: number, clientY: number): string | null {
    if (!this.scene) return null;
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    let best: FoundationDraft | null = null;
    for (const foundation of this.doc.visual.foundations) {
      const quad = this.foundationQuad(foundation);
      if (!quad || !pointInQuad(point, quad)) continue;
      if (!best || foundation.elevation > best.elevation) best = foundation;
    }
    return best?.id ?? null;
  }

  private foundationHandleAt(
    clientX: number,
    clientY: number,
  ): { id: string; kind: "corner" | "edge"; index: number } | null {
    const selected = this.selectedFoundation();
    if (!selected) return null;
    const quad = this.foundationQuad(selected);
    if (!quad) return null;
    const rect = this.canvas.getBoundingClientRect();
    const point = { x: clientX - rect.left, y: clientY - rect.top };
    for (let corner = 0; corner < 4; corner += 1) {
      if (Math.hypot(quad[corner].x - point.x, quad[corner].y - point.y) <= 13) {
        return { id: selected.id, kind: "corner", index: corner };
      }
    }
    for (let edge = 0; edge < 4; edge += 1) {
      const a = quad[edge];
      const b = quad[(edge + 1) % 4];
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (Math.hypot(middle.x - point.x, middle.y - point.y) <= 12) {
        return { id: selected.id, kind: "edge", index: edge };
      }
    }
    return null;
  }

  private nearestFoundation(ground: [number, number]): { foundation: FoundationDraft; distance: number } | null {
    let best: { foundation: FoundationDraft; distance: number } | null = null;
    for (const foundation of this.doc.visual.foundations) {
      const rect = foundationRect(foundation);
      const dx = Math.max(rect.minX - ground[0], 0, ground[0] - rect.maxX);
      const dz = Math.max(rect.minZ - ground[1], 0, ground[1] - rect.maxZ);
      const distance = Math.hypot(dx, dz);
      if (!best || distance < best.distance) best = { foundation, distance };
    }
    return best;
  }

  private addFoundationAt(ground: [number, number], floating: boolean): void {
    if (this.doc.navigation === "grid") {
      this.notice("网格地图只支持一块地基，请改用地图宽高调整范围");
      return;
    }
    const dm: [number, number] = [Math.round(ground[0] / 5) * 5, Math.round(ground[1] / 5) * 5];
    if (floating) {
      const result = addFoundation(this.doc, {
        pos: dm,
        size: [200, 200],
        elevation: this.foundationFloatElevation,
      });
      this.selection = { kind: "foundation", id: result.foundation.id };
      this.commit(result.document, "已添加浮空岛");
      return;
    }
    const nearest = this.nearestFoundation(ground);
    if (!nearest) {
      const result = addFoundation(this.doc, { pos: dm, size: [200, 200] });
      this.selection = { kind: "foundation", id: result.foundation.id };
      this.commit(result.document, "已添加地基");
      return;
    }
    const rect = foundationRect(nearest.foundation);
    const inside = dm[0] >= rect.minX && dm[0] <= rect.maxX && dm[1] >= rect.minZ && dm[1] <= rect.maxZ;
    if (inside) {
      this.selectFoundation(nearest.foundation.id);
      this.notice("点在地基内部；点到地基外侧即可扩展地图");
      return;
    }
    // 把点击点并进最近的地基：两条轴各自按需要外扩，至少扩 5 米。
    const nextRect = { ...rect };
    if (dm[0] < rect.minX) nextRect.minX = Math.min(rect.minX - 50, dm[0]);
    if (dm[0] > rect.maxX) nextRect.maxX = Math.max(rect.maxX + 50, dm[0]);
    if (dm[1] < rect.minZ) nextRect.minZ = Math.min(rect.minZ - 50, dm[1]);
    if (dm[1] > rect.maxZ) nextRect.maxZ = Math.max(rect.maxZ + 50, dm[1]);
    const next = updateFoundation(this.doc, nearest.foundation.id, {
      pos: [(nextRect.minX + nextRect.maxX) / 2, (nextRect.minZ + nextRect.maxZ) / 2],
      size: [nextRect.maxX - nextRect.minX, nextRect.maxZ - nextRect.minZ],
    });
    if (next === this.doc) {
      this.notice("地基没有变化");
      return;
    }
    this.selection = { kind: "foundation", id: nearest.foundation.id };
    this.commit(next, "已扩展地基");
  }

  private removeFoundationById(id: string): void {
    if (this.doc.visual.foundations.length <= 1) {
      this.notice("至少保留一块地基");
      return;
    }
    const next = removeFoundation(this.doc, id);
    if (next === this.doc) {
      this.notice("没有移除地基");
      return;
    }
    if (this.selection?.kind === "foundation" && this.selection.id === id) this.selection = null;
    this.commit(next, "已删除地基");
  }

  private duplicateSelectedFoundation(): void {
    const foundation = this.selectedFoundation();
    if (!foundation) return;
    const result = duplicateFoundation(this.doc, foundation.id);
    if (!result) return;
    this.selection = { kind: "foundation", id: result.foundation.id };
    this.commit(result.document, "已复制地基");
  }

  private nudgeFoundationElevation(delta: number): void {
    const foundation = this.selectedFoundation();
    if (!foundation) return;
    const next = updateFoundation(this.doc, foundation.id, { elevation: foundation.elevation + delta });
    this.commit(next, delta > 0 ? "已抬高地基" : "已降低地基");
  }

  private changeFoundationField(id: string, field: string, value: string): void {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
    if (!foundation) return;
    const number = Number(value);
    if (field === "posX" || field === "posZ") {
      if (!Number.isFinite(number)) return;
      const pos: [number, number] = [
        field === "posX" ? Math.round(number * 10) : foundation.pos[0],
        field === "posZ" ? Math.round(number * 10) : foundation.pos[1],
      ];
      this.commit(updateFoundation(this.doc, id, { pos }), "已移动地基");
      return;
    }
    if (field === "sizeW" || field === "sizeD") {
      if (!Number.isFinite(number)) return;
      const size: [number, number] = [
        field === "sizeW" ? Math.round(number * 10) : foundation.size[0],
        field === "sizeD" ? Math.round(number * 10) : foundation.size[1],
      ];
      this.commit(updateFoundation(this.doc, id, { size }), "已调整地基尺寸");
      return;
    }
    if (field === "elevation" && Number.isFinite(number)) {
      this.foundationFloatElevation = Math.max(0, number);
      this.commit(updateFoundation(this.doc, id, { elevation: number }), "已调整地基高度");
      return;
    }
    if (field === "depth" && Number.isFinite(number)) {
      this.commit(updateFoundation(this.doc, id, { depth: number }), "已调整地基厚度");
      return;
    }
    if (field === "scale" && Number.isFinite(number)) {
      this.commit(updateFoundation(this.doc, id, { scale: number }), "已调整外壳缩放");
      return;
    }
    if (field === "rotation" && Number.isFinite(number)) {
      this.commit(updateFoundation(this.doc, id, { rotation: number }), "已调整外壳朝向");
      return;
    }
    if (field === "assetId") {
      this.commit(updateFoundation(this.doc, id, { assetId: value || null }), value ? "已设置地基外壳" : "已恢复程序化浮岛");
    }
  }

  private renderFoundationList(): void {
    if (!this.foundationList) return;
    const rows = this.doc.visual.foundations
      .map((foundation) => {
        const selected = this.selection?.kind === "foundation" && this.selection.id === foundation.id;
        const size = `${(foundation.size[0] / 10).toFixed(0)}×${(foundation.size[1] / 10).toFixed(0)}`;
        const height = foundation.elevation === 0 ? "地面" : `${foundation.elevation.toFixed(1)} 米`;
        return `<button class="ml-ed-foundation-row${selected ? " active" : ""}" data-foundation-id="${escapeHtml(foundation.id)}"><b>${escapeHtml(foundation.id)}</b><span>${size} 米 · ${height}</span></button>`;
      })
      .join("");
    this.foundationList.innerHTML = rows || '<p class="ml-ed-note">还没有地基。</p>';
    for (const button of this.foundationList.querySelectorAll<HTMLElement>("[data-foundation-id]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.foundationId;
        if (id) this.selectFoundation(id);
      });
    }
  }

  private foundationInspectorHtml(foundation: FoundationDraft): string {
    const rect = foundationRect(foundation);
    const assets = assetRegistry.list("foundation");
    const grid = this.doc.navigation === "grid";
    const lock = grid ? " disabled" : "";
    const info = foundation.assetId ? assetRegistry.info(foundation.assetId) : null;
    const missing = foundation.assetId && !info ? '<div class="ml-ed-kind warn">外壳资产未载入</div>' : "";
    const shell = foundation.assetId
      ? `<div class="ml-ed-row">
          <label class="ml-ed-field"><span>外壳缩放</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="scale" type="number" min="0.01" max="50" step="0.05" value="${foundation.scale}"></label>
          <label class="ml-ed-field"><span>外壳朝向</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="rotation" type="number" min="-360" max="360" step="5" value="${foundation.rotation}"></label>
        </div>`
      : "";
    return `
      <h3>地基 ${escapeHtml(foundation.id)}</h3>
      <div class="ml-ed-kind">${foundation.assetId ? escapeHtml(info?.label ?? foundation.assetId) : "程序化浮岛"} · ${((rect.maxX - rect.minX) / 10).toFixed(1)} × ${((rect.maxZ - rect.minZ) / 10).toFixed(1)} 米</div>
      ${missing}
      ${grid ? '<p class="ml-ed-note">网格地图的地基与网格范围绑定，尺寸随地图宽高变化。</p>' : ""}
      <div class="ml-ed-section-label">位置</div>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>X（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="posX" type="number" step="0.5" value="${(foundation.pos[0] / 10).toFixed(1)}"${lock}></label>
        <label class="ml-ed-field"><span>Z（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="posZ" type="number" step="0.5" value="${(foundation.pos[1] / 10).toFixed(1)}"${lock}></label>
      </div>
      <div class="ml-ed-section-label">尺寸</div>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>宽（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="sizeW" type="number" min="10" max="400" step="1" value="${(foundation.size[0] / 10).toFixed(1)}"${lock}></label>
        <label class="ml-ed-field"><span>深（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="sizeD" type="number" min="10" max="400" step="1" value="${(foundation.size[1] / 10).toFixed(1)}"${lock}></label>
      </div>
      <div class="ml-ed-section-label">高度</div>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>顶面高度（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="elevation" type="number" step="0.5" value="${foundation.elevation.toFixed(1)}"${lock}></label>
        <label class="ml-ed-field"><span>厚度（米）</span><input data-foundation="${escapeHtml(foundation.id)}" data-field="depth" type="number" min="2" max="200" step="1" value="${(foundation.depth ?? 20).toFixed(1)}"></label>
      </div>
      <div class="ml-ed-row">
        <button class="ml-ed-btn" data-action="foundation-up"${lock}>抬高 1 米</button>
        <button class="ml-ed-btn" data-action="foundation-down"${lock}>降低 1 米</button>
      </div>
      <div class="ml-ed-section-label">外壳</div>
      <label class="ml-ed-field"><span>模型</span>
        <select data-foundation="${escapeHtml(foundation.id)}" data-field="assetId">
          ${option("", foundation.assetId ?? "", "程序化浮岛")}
          ${assets.map((asset) => option(asset.id, foundation.assetId ?? "", asset.label + (asset.source === "pack" ? " · 资产包" : ""))).join("")}
        </select>
      </label>
      ${shell}
      <div class="ml-ed-meta">范围 ${(rect.minX / 10).toFixed(1)}, ${(rect.minZ / 10).toFixed(1)} → ${(rect.maxX / 10).toFixed(1)}, ${(rect.maxZ / 10).toFixed(1)} 米</div>
      <p class="ml-ed-note">拖动地基内部移动；拖四角改尺寸；点空白处用“添加地基”向外扩展。Delete 删除，Ctrl+D 复制。</p>
      <div class="ml-ed-row">
        <button class="ml-ed-btn" data-action="foundation-duplicate">复制</button>
        <button class="ml-ed-btn" data-action="foundation-focus">镜头对准</button>
      </div>
      <button class="ml-ed-delete" data-action="delete-foundation">删除这块地基</button>
    `;
  }

  private extendRoadDraw(ground: [number, number] | null): void {
    const state = this.roadDraw;
    if (!state || !ground) return;
    state.ground = ground;
    const last = state.points[state.points.length - 1];
    if (Math.hypot(ground[0] - last[0], ground[1] - last[1]) < 4) return;
    state.points.push(clampRoadPoint(this.doc, ground));
    this.drawOverlay();
  }

  private finishRoadDraw(): void {
    const state = this.roadDraw;
    this.roadDraw = null;
    if (!state || !state.ground) return;
    let target: SiteDraft | null = null;
    let bestDistance = 60;
    for (const site of this.doc.sites) {
      if (site.id === state.from) continue;
      const distance = Math.hypot(site.pos[0] - state.ground[0], site.pos[1] - state.ground[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = site;
      }
    }
    const points = state.points.map((point) => clampRoadPoint(this.doc, point));
    if (target) {
      const last = points[points.length - 1];
      if (Math.hypot(target.pos[0] - last[0], target.pos[1] - last[1]) > 1) {
        points.push([target.pos[0], target.pos[1]]);
      }
    } else {
      const last = points[points.length - 1];
      const end = clampRoadPoint(this.doc, state.ground);
      if (Math.hypot(end[0] - last[0], end[1] - last[1]) > 1) points.push(end);
    }
    if (points.length < 2) {
      this.drawOverlay();
      return;
    }
    const simplified = simplifyRoad(points);
    const result = addRoad(this.doc, simplified, {
      ...(state.from ? { from: state.from } : {}),
      ...(target ? { to: target.id } : {}),
      widthDm: Math.max(6, Math.min(60, Math.round(this.doc.visual.roads.width * 10))),
    });
    this.selection = { kind: "road", id: result.road.id };
    this.commit(result.document, "已绘制道路", { roadOnly: true });
    this.setTool("select");
    this.suppressClick = true;
  }

  private finishRoadPointDrag(): void {
    const drag = this.roadPointDrag;
    this.roadPointDrag = null;
    const road = this.selectedRoad();
    if (!drag || !road || !this.pointer.ground) return;
    const points = this.roadPoints(road).map((point) => [point[0], point[1]] as [number, number]);
    if (drag.index < 0 || drag.index >= points.length) return;
    points[drag.index] = clampRoadPoint(this.doc, this.pointer.ground);
    this.commit(updateRoad(this.doc, road.id, { path: points }), "已调整道路", { roadOnly: true });
    this.suppressClick = true;
  }

  private selectedProp(): PropDraft | null {
    if (this.selection?.kind !== "prop") return null;
    return this.doc.visual.props.find((prop) => prop.id === this.selection?.id) ?? null;
  }

  private removeSiteById(id: CityId): void {
    const site = this.doc.sites.find((entry) => entry.id === id);
    if (!site) return;
    const towns = this.doc.sites.filter((entry) => isProductionSiteKind(entry.kind)).length;
    if (isProductionSiteKind(site.kind) && towns <= 1) {
      this.notice("地图至少需要保留一个产兵据点");
      return;
    }
    if (this.selection?.kind === "site" && this.selection.id === id) this.selection = null;
    this.commit(removeSite(this.doc, id), `已删除 ${id}`, { siteOnly: true });
  }

  private removePropById(id: string): void {
    const prop = this.doc.visual.props.find((entry) => entry.id === id);
    if (!prop) return;
    if (this.selection?.kind === "prop" && this.selection.id === id) this.selection = null;
    this.commit(removeProp(this.doc, id), `已删除装饰 ${prop.id}`, { propsOnly: true });
  }

  private removeRoadById(id: string): void {
    const next = removeRoad(this.doc, id);
    if (serializeDocument(next) === serializeDocument(this.doc)) {
      this.notice("没有移除道路");
      return;
    }
    if (this.selection?.kind === "road" && this.selection.id === id) this.selection = null;
    this.commit(next, "已移除道路", { roadOnly: true });
  }

  private readonly onDrop = (event: DragEvent): void => {
    event.preventDefault();
    const ground = this.scene?.screenToGround(event.clientX, event.clientY);
    if (!ground) return;
    const assetId = event.dataTransfer?.getData("text/ml-asset-id");
    if (assetId) {
      this.setActiveAsset(assetId);
      this.addAssetAt(assetId, ground);
      return;
    }
    const kind = event.dataTransfer?.getData("text/ml-site-kind") as SiteKind | undefined;
    if (!kind || (!isProductionSiteKind(kind) && kind !== "granary" && kind !== "outpost")) return;
    this.setTool(kind);
    this.addAt(kind, ground);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button === 2 && this.tool === "select" && this.selection?.kind === "road") {
      const handle = this.pickRoadPoint(event.clientX, event.clientY);
      if (handle) {
        event.preventDefault();
        this.removeRoadPoint(handle.index);
        return;
      }
    }
    if (!this.scene || event.button === 1 || event.button === 2) {
      this.pan = { x: event.clientX, y: event.clientY, moved: false };
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    this.pointer = { x: event.clientX, y: event.clientY, ground: this.scene.screenToGround(event.clientX, event.clientY) };
    if (this.tool === "road") {
      if (!this.pointer.ground) return;
      const site = this.pickSite(event.clientX, event.clientY);
      const draft = site ? this.doc.sites.find((entry) => entry.id === site) : null;
      const start = draft ? draft.pos : clampRoadPoint(this.doc, this.pointer.ground);
      this.roadDraw = {
        ...(draft ? { from: draft.id } : {}),
        points: [start],
        ground: this.pointer.ground,
      };
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      this.drawOverlay();
      return;
    }
    if (isGridTool(this.tool) && !this.pathTest) {
      if (this.doc.navigation !== "grid" || !this.doc.grid) {
        this.notice("先启用网格导航或新建网格地图");
        return;
      }
      if (!this.pointer.ground) return;
      this.beginGridStroke(this.pointer.ground);
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }
    if (this.tool === "select") {
      const handle = this.pickRoadPoint(event.clientX, event.clientY);
      if (handle) {
        this.roadPointDrag = { id: handle.road.id, index: handle.index, ground: this.pointer.ground ?? handle.road.path?.[handle.index] ?? [0, 0] };
        this.pointerId = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const siteHit = this.pickSite(event.clientX, event.clientY);
      if (siteHit) {
        this.selectSite(siteHit);
        this.drag = {
          id: siteHit,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          ground: this.pointer.ground,
        };
        this.pointerId = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const propHit = this.pickProp(event.clientX, event.clientY);
      if (propHit) {
        this.selectProp(propHit);
        this.propDrag = {
          id: propHit,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          ground: this.pointer.ground,
        };
        this.pointerId = event.pointerId;
        this.canvas.setPointerCapture(event.pointerId);
        return;
      }
      const foundationHandle = this.foundationHandleAt(event.clientX, event.clientY);
      if (foundationHandle) {
        const foundation = this.doc.visual.foundations.find((entry) => entry.id === foundationHandle.id);
        if (foundation) {
          const rect = foundationRect(foundation);
          this.foundationResize = {
            id: foundation.id,
            kind: foundationHandle.kind,
            index: foundationHandle.index,
            startRect: rect,
            rect: { ...rect },
            startX: event.clientX,
            startY: event.clientY,
            moved: false,
          };
          this.pointerId = event.pointerId;
          this.canvas.setPointerCapture(event.pointerId);
          return;
        }
      }
      const foundationHit = this.pickFoundation(event.clientX, event.clientY);
      if (foundationHit) {
        const foundation = this.doc.visual.foundations.find((entry) => entry.id === foundationHit);
        if (foundation) {
          this.selectFoundation(foundationHit);
          this.foundationDrag = {
            id: foundation.id,
            startX: event.clientX,
            startY: event.clientY,
            originPos: [foundation.pos[0], foundation.pos[1]],
            startGround: this.pointer.ground ?? [foundation.pos[0], foundation.pos[1]],
            previewPos: [foundation.pos[0], foundation.pos[1]],
            moved: false,
          };
          this.pointerId = event.pointerId;
          this.canvas.setPointerCapture(event.pointerId);
          return;
        }
      }
    }
    this.pan = { x: event.clientX, y: event.clientY, moved: false };
    this.pointerId = event.pointerId;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointer = {
      x: event.clientX,
      y: event.clientY,
      ground: this.scene?.screenToGround(event.clientX, event.clientY) ?? null,
    };

    if (this.roadDraw) {
      this.extendRoadDraw(this.pointer.ground);
      return;
    }

    if (this.roadPointDrag) {
      if (this.pointer.ground) this.roadPointDrag.ground = this.pointer.ground;
      this.drawOverlay();
      return;
    }

    if (this.gridStroke) {
      this.extendGridStroke();
      return;
    }

    if (this.drag) {
      const dx = event.clientX - this.drag.startX;
      const dy = event.clientY - this.drag.startY;
      if (!this.drag.moved && Math.hypot(dx, dy) < 5) return;
      this.drag.moved = true;
      this.drag.ground = this.pointer.ground;
      this.drawOverlay();
      return;
    }

    if (this.propDrag) {
      const dx = event.clientX - this.propDrag.startX;
      const dy = event.clientY - this.propDrag.startY;
      if (!this.propDrag.moved && Math.hypot(dx, dy) < 5) return;
      this.propDrag.moved = true;
      this.propDrag.ground = this.pointer.ground;
      this.drawOverlay();
      return;
    }

    if (this.foundationResize) {
      const dx = event.clientX - this.foundationResize.startX;
      const dy = event.clientY - this.foundationResize.startY;
      if (!this.foundationResize.moved && Math.hypot(dx, dy) < 3) return;
      this.foundationResize.moved = true;
      if (this.pointer.ground) {
        const rect = { ...this.foundationResize.startRect };
        const snap = (value: number): number => Math.round(value / 5) * 5;
        const [gx, gz] = this.pointer.ground;
        if (this.foundationResize.kind === "corner") {
          const corner = this.foundationResize.index;
          if (corner === 0 || corner === 3) rect.minX = Math.min(snap(gx), rect.maxX - 100);
          if (corner === 1 || corner === 2) rect.maxX = Math.max(snap(gx), rect.minX + 100);
          if (corner === 0 || corner === 1) rect.minZ = Math.min(snap(gz), rect.maxZ - 100);
          if (corner === 2 || corner === 3) rect.maxZ = Math.max(snap(gz), rect.minZ + 100);
        } else {
          const edge = this.foundationResize.index;
          if (edge === 0) rect.minZ = Math.min(snap(gz), rect.maxZ - 100);
          if (edge === 1) rect.maxX = Math.max(snap(gx), rect.minX + 100);
          if (edge === 2) rect.maxZ = Math.max(snap(gz), rect.minZ + 100);
          if (edge === 3) rect.minX = Math.min(snap(gx), rect.maxX - 100);
        }
        this.foundationResize.rect = rect;
      }
      this.drawOverlay();
      return;
    }

    if (this.foundationDrag) {
      const dx = event.clientX - this.foundationDrag.startX;
      const dy = event.clientY - this.foundationDrag.startY;
      if (!this.foundationDrag.moved && Math.hypot(dx, dy) < 5) return;
      this.foundationDrag.moved = true;
      if (this.pointer.ground) {
        const snap = (value: number): number => Math.round(value / 5) * 5;
        this.foundationDrag.previewPos = [
          snap(this.foundationDrag.originPos[0] + this.pointer.ground[0] - this.foundationDrag.startGround[0]),
          snap(this.foundationDrag.originPos[1] + this.pointer.ground[1] - this.foundationDrag.startGround[1]),
        ];
      }
      this.drawOverlay();
      return;
    }

    if (this.pan && (event.buttons & 1 || event.buttons & 2 || event.buttons & 4)) {
      const dx = event.clientX - this.pan.x;
      const dy = event.clientY - this.pan.y;
      if (!this.pan.moved && Math.hypot(dx, dy) < 4) return;
      this.pan.moved = true;
      this.pan.x = event.clientX;
      this.pan.y = event.clientY;
      this.scene?.panBy(dx, dy);
      this.view = this.scene?.getViewState() ?? this.view;
      this.drawOverlay();
      return;
    }

    if (this.tool === "asset" && this.pointer.ground) {
      this.badgeEl.textContent = `放置 ${assetRegistry.info(this.activeAsset ?? "")?.label ?? "装饰"} · ${Math.round(this.pointer.ground[0])}, ${Math.round(this.pointer.ground[1])}`;
    } else if (this.tool !== "select" && this.pointer.ground) {
      const [x, z] = this.pointer.ground;
      this.badgeEl.textContent = `${TOOL_LABEL[this.tool]} · ${Math.round(x)}, ${Math.round(z)}`;
    }
    this.drawOverlay();
  };

  private readonly onPointerUp = (): void => {
    if (this.pointerId !== null && this.canvas.hasPointerCapture(this.pointerId)) {
      this.canvas.releasePointerCapture(this.pointerId);
    }
    this.pointerId = null;
    if (this.roadDraw) {
      this.finishRoadDraw();
      return;
    }
    if (this.roadPointDrag) {
      this.finishRoadPointDrag();
      return;
    }
    if (this.gridStroke) {
      const stroke = this.gridStroke;
      this.gridStroke = null;
      if (stroke.changed) {
        this.commit(stroke.document, "已修改网格地形", { terrainOnly: true });
        this.suppressClick = true;
      }
      return;
    }
    if (this.drag) {
      if (this.drag.moved && this.drag.ground) {
        this.commit(moveSite(this.doc, this.drag.id, this.drag.ground), `已移动 ${this.drag.id}`, { siteOnly: true });
        this.suppressClick = true;
      }
      this.drag = null;
    }
    if (this.propDrag) {
      if (this.propDrag.moved && this.propDrag.ground) {
        this.commit(moveProp(this.doc, this.propDrag.id, this.propDrag.ground), `已移动装饰 ${this.propDrag.id}`, { propsOnly: true });
        this.suppressClick = true;
      }
      this.propDrag = null;
    }
    if (this.foundationResize) {
      const state = this.foundationResize;
      this.foundationResize = null;
      if (state.moved) {
        const rect = state.rect;
        this.commit(
          updateFoundation(this.doc, state.id, {
            pos: [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2],
            size: [rect.maxX - rect.minX, rect.maxZ - rect.minZ],
          }),
          "已调整地基尺寸",
        );
        this.suppressClick = true;
      }
      return;
    }
    if (this.foundationDrag) {
      const state = this.foundationDrag;
      this.foundationDrag = null;
      if (state.moved) {
        this.commit(updateFoundation(this.doc, state.id, { pos: state.previewPos }), "已移动地基");
        this.suppressClick = true;
      }
      return;
    }
    if (this.pan?.moved) this.suppressClick = true;
    this.pan = null;
  };

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (!this.scene) {
      if (this.tool === "select") this.notice("先放置一个产兵据点");
      return;
    }
    const ground = this.scene.screenToGround(event.clientX, event.clientY);
    if (!ground) return;
    if (this.pathTest) {
      this.handlePathClick(ground);
      return;
    }
    if (isGridTool(this.tool)) return;

    if (this.tool === "asset") {
      if (this.activeAsset) this.addAssetAt(this.activeAsset, ground);
      else this.notice("先从左侧选择地形或装饰");
      return;
    }

    if (isProductionSiteKind(this.tool as SiteKind) || this.tool === "granary" || this.tool === "outpost") {
      this.addAt(this.tool as SiteKind, ground);
      return;
    }

    if (this.tool === "foundation" || this.tool === "island") {
      this.addFoundationAt(ground, this.tool === "island");
      return;
    }

    if (this.tool === "road") return;

    if (this.tool === "erase") {
      const site = this.pickSite(event.clientX, event.clientY);
      if (site) {
        this.removeSiteById(site);
        return;
      }
      const prop = this.pickProp(event.clientX, event.clientY);
      if (prop) {
        this.removePropById(prop);
        return;
      }
      const road = this.pickRoad(event.clientX, event.clientY);
      if (road) {
        this.removeRoadById(road);
        return;
      }
      const foundation = this.pickFoundation(event.clientX, event.clientY);
      if (foundation) this.removeFoundationById(foundation);
      else this.notice("这里没有可删除的对象");
      return;
    }

    const site = this.pickSite(event.clientX, event.clientY);
    if (site) {
      this.selectSite(site);
      return;
    }
    const prop = this.pickProp(event.clientX, event.clientY);
    if (prop) {
      this.selectProp(prop);
      return;
    }
    const road = this.pickRoad(event.clientX, event.clientY);
    if (road) {
      this.selectRoad(road);
      return;
    }
    const foundation = this.pickFoundation(event.clientX, event.clientY);
    if (foundation) {
      this.selectFoundation(foundation);
      return;
    }
    this.selectSite(null);
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.scene?.zoomBy(event.deltaY > 0 ? -0.08 : 0.08);
    this.view = this.scene?.getViewState() ?? this.view;
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.running) return;
    const target = event.target as HTMLElement | null;
    // 只有文本输入保留原生撤销；数字框、下拉框聚焦时 Ctrl+Z 仍要撤销地图编辑。
    const tag = target?.tagName;
    const inputType = tag === "INPUT" ? (target as HTMLInputElement).type : "";
    if (tag === "TEXTAREA" || (tag === "INPUT" && inputType !== "number" && inputType !== "range" && inputType !== "checkbox")) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redo();
      else this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      this.redo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      if (this.selection?.kind === "foundation") this.duplicateSelectedFoundation();
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      if (this.selection?.kind === "foundation") {
        event.preventDefault();
        this.nudgeFoundationElevation(event.key === "PageUp" ? 1 : -1);
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.selection?.kind === "site") {
        event.preventDefault();
        this.removeSiteById(this.selection.id);
      } else if (this.selection?.kind === "prop") {
        event.preventDefault();
        this.removePropById(this.selection.id);
      } else if (this.selection?.kind === "road") {
        event.preventDefault();
        this.removeRoadById(this.selection.id);
      } else if (this.selection?.kind === "foundation") {
        event.preventDefault();
        this.removeFoundationById(this.selection.id);
      }
      return;
    }
    if (event.key.toLowerCase() === "r") {
      const prop = this.selectedProp();
      if (prop) {
        event.preventDefault();
        this.commit(updateProp(this.doc, prop.id, { rotation: prop.rotation + (event.shiftKey ? -15 : 15) }), "已旋转装饰", { propsOnly: true });
      }
      return;
    }
    if (event.key === "[" || event.key === "]") {
      const prop = this.selectedProp();
      if (prop) {
        event.preventDefault();
        const scale = prop.scale + (event.key === "]" ? 0.1 : -0.1);
        this.commit(updateProp(this.doc, prop.id, { scale }), "已缩放装饰", { propsOnly: true });
      }
      return;
    }
    if (event.key === "Escape") {
      this.roadFrom = null;
      this.roadDraw = null;
      this.roadPointDrag = null;
      this.foundationDrag = null;
      this.foundationResize = null;
      this.pathFrom = null;
      this.pathPoints = null;
      if (this.pathTest) {
        this.pathTest = false;
        this.pathButton.classList.remove("active");
        this.notice("已退出路径测试");
      }
      this.selectSite(null);
      this.setTool("select");
      this.drawOverlay();
      return;
    }
    if (event.key.toLowerCase() === "q") this.scene?.rotate(-1);
    if (event.key.toLowerCase() === "e") this.scene?.rotate(1);
  };

  private renderInspector(): void {
    if (this.selection?.kind === "foundation") {
      const foundation = this.selectedFoundation();
      if (foundation) {
        this.inspector.innerHTML = this.foundationInspectorHtml(foundation);
        this.bindInspector();
        return;
      }
      this.selection = null;
    }
    if (this.selection?.kind === "road") {
      const road = this.selectedRoad();
      this.inspector.innerHTML = road ? this.roadInspectorHtml(road) : this.mapSettingsHtml();
      this.bindInspector();
      return;
    }
    if (this.selection?.kind === "prop") {
      const prop = this.selectedProp();
      if (prop) {
        this.inspector.innerHTML = this.propInspectorHtml(prop);
        this.bindInspector();
        return;
      }
      this.selection = null;
    }

    const site = this.selection?.kind === "site"
      ? this.doc.sites.find((entry) => entry.id === this.selection?.id) ?? null
      : null;
    if (!site) {
      this.inspector.innerHTML = this.mapSettingsHtml();
      this.bindInspector();
      return;
    }

    const candidates = watchCandidates(this.doc, site.id);
    const currentWatch = site.watch ? `${site.watch[0]}|${site.watch[1]}` : "";
    if (currentWatch && !candidates.some((road) => `${road.from}|${road.to}` === currentWatch || `${road.to}|${road.from}` === currentWatch)) {
      candidates.push({ id: "watch", from: site.watch?.[0] ?? "", to: site.watch?.[1] ?? "" });
    }
    const watchOptions = candidates
      .filter((road) => road.from && road.to)
      .map((road) => option(`${road.from}|${road.to}`, currentWatch, `${road.from} ↔ ${road.to}`))
      .join("");
    const buildingOptions = assetRegistry
      .list("building")
      .map((asset) => option(asset.id, site.visualAssetId ?? "", `${asset.label}${asset.source === "pack" ? " · 资产包" : ""}`))
      .join("");

    this.inspector.innerHTML = `
      <h3>${escapeHtml(site.id)}</h3>
      <div class="ml-ed-kind">${kindLabel(site.kind)} · 等级 ${site.level}</div>
      <label class="ml-ed-field"><span>类型</span>
        <select data-site="${site.id}" data-field="kind">
          ${SITE_KIND_OPTIONS.map((entry) => option(entry.kind, site.kind, entry.label)).join("")}
        </select>
      </label>
      <label class="ml-ed-field"><span>归属</span>
        <select data-site="${site.id}" data-field="owner">
          ${option(0, site.owner, "中立")}
          ${option(1, site.owner, "绿方")}
          ${option(2, site.owner, "红方")}
        </select>
      </label>
      ${isProductionSiteKind(site.kind) ? `
      <label class="ml-ed-field"><span>等级</span>
        <select data-site="${site.id}" data-field="level">
          ${option(1, site.level, "L1")}
          ${option(2, site.level, "L2")}
          ${option(3, site.level, "L3")}
        </select>
      </label>
      <label class="ml-ed-field"><span>驻军</span><input data-site="${site.id}" data-field="pop" type="number" min="0" max="999" value="${site.pop}"></label>
      ` : ""}
      ${site.kind === "outpost" ? `
      <label class="ml-ed-field"><span>驻守状态</span>
        <select data-site="${site.id}" data-field="stance">
          ${option("evade", site.stance ?? "evade", "避战")}
          ${option("engage", site.stance ?? "evade", "迎战")}
        </select>
      </label>
      <label class="ml-ed-field"><span>监视道路</span>
        <select data-site="${site.id}" data-field="watch" ${candidates.length === 0 ? "disabled" : ""}>
          ${option("", currentWatch, "未设置")}
          ${watchOptions}
        </select>
      </label>
      ` : ""}
      <div class="ml-ed-section-label">外观</div>
      <label class="ml-ed-field"><span>建筑模型</span>
        <select data-site="${site.id}" data-field="visualAssetId">
          ${option("", site.visualAssetId ?? "", "默认外观")}
          ${buildingOptions}
        </select>
      </label>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>朝向</span><input data-site="${site.id}" data-field="visualRotation" type="number" step="15" value="${site.visualRotation ?? 0}"></label>
        <label class="ml-ed-field"><span>缩放</span><input data-site="${site.id}" data-field="visualScale" type="number" min="0.1" max="10" step="0.1" value="${site.visualScale ?? 1}"></label>
      </div>
      <div class="ml-ed-meta">坐标 ${site.pos[0]}, ${site.pos[1]}<br>编号 ${site.id}</div>
      <button class="ml-ed-delete" data-action="delete">删除这个据点</button>
    `;
    this.bindInspector();
  }

  private propInspectorHtml(prop: PropDraft): string {
    const info = assetRegistry.info(prop.assetId);
    const missing = info ? "" : `<div class="ml-ed-kind warn">资产包未载入</div>`;
    return `
      <h3>${escapeHtml(prop.id)}</h3>
      <div class="ml-ed-kind">${escapeHtml(info?.label ?? "未知装饰")} · ${info?.source === "pack" ? "资产包" : "内置"}</div>
      ${missing}
      <label class="ml-ed-field"><span>资产 ID</span><input value="${escapeHtml(prop.assetId)}" readonly></label>
      <label class="ml-ed-field"><span>朝向</span><input data-prop="${prop.id}" data-field="rotation" type="number" step="15" value="${Math.round(prop.rotation)}"></label>
      <label class="ml-ed-field"><span>缩放</span><input data-prop="${prop.id}" data-field="scale" type="number" min="0.1" max="10" step="0.1" value="${prop.scale.toFixed(2)}"></label>
      <div class="ml-ed-meta">坐标 ${prop.pos[0]}, ${prop.pos[1]}<br>占地 ${info?.footprint ?? "?"} 米</div>
      <p class="ml-ed-note">拖动可以移动装饰；R 旋转 15°，Shift+R 反向旋转；[ ] 缩放。</p>
      <button class="ml-ed-delete" data-action="delete-prop">删除这个装饰</button>
    `;
  }

  private roadInspectorHtml(road: RoadDraft): string {
    const points = this.roadPoints(road);
    let lengthDm = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      lengthDm += Math.hypot(points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]);
    }
    const widthDm = road.widthDm ?? this.doc.visual.roads.width * 10;
    const ends = road.from && road.to ? `${road.from} ↔ ${road.to}` : road.from ? `${road.from} → 自由端点` : road.to ? `自由端点 → ${road.to}` : "自由道路";
    return `
      <h3>道路 ${escapeHtml(road.id)}</h3>
      <div class="ml-ed-kind">${ends} · ${points.length} 个控制点</div>
      <label class="ml-ed-field"><span>宽度（米）</span><input data-road="${escapeHtml(road.id)}" data-field="widthM" type="number" min="0.6" max="6" step="0.1" value="${(widthDm / 10).toFixed(1)}"></label>
      <div class="ml-ed-meta">长度 ${(lengthDm / 10).toFixed(1)} 米<br>${road.from ? `起点 ${road.from}` : "无起点"} · ${road.to ? `终点 ${road.to}` : "无终点"}</div>
      <p class="ml-ed-note">选中道路后拖动青色控制点即可改形状。宽度不会随拖动改变。</p>
      <div class="ml-ed-road-actions">
        <button class="ml-ed-btn" data-action="reverse-road">反向</button>
        ${road.from && road.to ? '<button class="ml-ed-btn" data-action="straight-road">拉直</button>' : ""}
      </div>
      <button class="ml-ed-delete" data-action="delete-road">删除这条道路</button>
    `;
  }

  private mapSettingsHtml(): string {
    const climb = this.doc.climbCm ?? 60;
    const climbDeg = ((Math.atan(climb / 100) * 180) / Math.PI).toFixed(1);
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error").length;
    const missing = this.doc.visual.props.filter((prop) => !assetRegistry.has(prop.assetId)).length;
    const bounds = documentBounds(this.doc);
    const foundationCount = this.doc.visual.foundations.length;
    const packRows = assetRegistry.packList
      .map(
        (pack) => `<div class="ml-ed-pack-row"><span>${escapeHtml(pack.name)}</span><button data-pack-remove="${escapeHtml(pack.id)}">移除</button></div>`,
      )
      .join("");
    const sizeControls = this.doc.navigation === "grid"
      ? `<div class="ml-ed-row">
        <label class="ml-ed-field"><span>宽</span><input data-field="width" type="number" min="100" max="2000" step="10" value="${this.doc.size[0]}"></label>
        <label class="ml-ed-field"><span>高</span><input data-field="height" type="number" min="100" max="2000" step="10" value="${this.doc.size[1]}"></label>
      </div>`
      : `<div class="ml-ed-meta">地图范围 ${((bounds.maxX - bounds.minX) / 10).toFixed(1)} × ${((bounds.maxZ - bounds.minZ) / 10).toFixed(1)} 米，由地基决定</div>`;
    return `
      <h3>地图设置</h3>
      <div class="ml-ed-kind">${this.doc.sites.length} 个据点 · ${this.doc.visual.props.length} 个装饰 · ${errors} 个错误</div>
      <label class="ml-ed-field"><span>地图名称</span><input data-field="name" value="${escapeHtml(this.doc.name)}"></label>
      ${sizeControls}
      <label class="ml-ed-field"><span>通行规则</span>
        <select data-field="transit">
          ${option("friendly", this.doc.transit, "友方通行")}
          ${option("open", this.doc.transit, "开放通行")}
        </select>
      </label>
      <label class="ml-ed-field"><span>坡度上限（cm/格）</span><input data-field="climbCm" type="number" min="10" max="200" step="5" value="${climb}"></label>
      <div class="ml-ed-meta">1 米格高差 ${climb} 厘米，约 ${climbDeg}°；导航预览中黄色格超过该高差</div>
      <div class="ml-ed-section-label">地貌</div>
      <label class="ml-ed-field"><span>风格</span>
        <select data-field="terrainStyle">
          ${TERRAIN_STYLES.map((style) => option(style.id, this.doc.visual.terrain.style, style.label)).join("")}
        </select>
      </label>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>起伏</span><input data-field="terrainAmplitude" type="number" min="0.2" max="1.5" step="0.1" value="${this.doc.visual.terrain.amplitude}"></label>
        <label class="ml-ed-field"><span>种子</span><input data-field="terrainSeed" type="number" step="1" value="${this.doc.visual.terrain.seed}"></label>
      </div>
      <div class="ml-ed-section-label">道路</div>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>风格</span>
          <select data-field="roadStyle">
            ${option("cobble", this.doc.visual.roads.style, "石板")}
            ${option("dirt", this.doc.visual.roads.style, "土路")}
          </select>
        </label>
        <label class="ml-ed-field"><span>宽度</span><input data-field="roadWidth" type="number" min="0.6" max="6" step="0.1" value="${this.doc.visual.roads.width}"></label>
      </div>
      <div class="ml-ed-section-label">地基</div>
      <div class="ml-ed-kind">${foundationCount} 块地基 · 地图范围 ${((bounds.maxX - bounds.minX) / 10).toFixed(1)} × ${((bounds.maxZ - bounds.minZ) / 10).toFixed(1)} 米</div>
      <div class="ml-ed-row">
        <button class="ml-ed-btn" data-action="add-foundation">添加地基</button>
        <button class="ml-ed-btn" data-action="add-island">添加浮空岛</button>
      </div>
      <p class="ml-ed-note">地基是地图的实体：向外扩展会扩大地图，抬高地基会得到浮空岛。选中地基后可移动、改尺寸和高度。</p>
      <div class="ml-ed-section-label">网格笔刷</div>
      <div class="ml-ed-kind">${this.doc.navigation === "grid" && this.doc.grid ? `${this.doc.grid.width} × ${this.doc.grid.height} 格 · ${this.doc.grid.cellSizeDm / 10} 米` : "据点图模式，未启用网格"}</div>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>半径</span><input data-field="brushRadius" type="number" min="1" max="8" step="1" value="${this.brushRadius}"></label>
        <label class="ml-ed-field"><span>强度</span><input data-field="brushStrength" type="number" min="5" max="200" step="5" value="${this.brushStrength}"></label>
      </div>
      <label class="ml-ed-field"><span>地表刷</span>
        <select data-field="surfaceBrush">
          ${option(0, this.surfaceBrush, "草地")}
          ${option(1, this.surfaceBrush, "泥土")}
          ${option(2, this.surfaceBrush, "岩石")}
          ${option(3, this.surfaceBrush, "道路")}
          ${option(4, this.surfaceBrush, "浅水")}
          ${option(6, this.surfaceBrush, "雪地")}
          ${option(7, this.surfaceBrush, "沙地")}
          ${option(8, this.surfaceBrush, "桥面")}
          ${option(9, this.surfaceBrush, "楼梯")}
        </select>
      </label>
      <label class="ml-ed-check"><input data-field="navPreview" type="checkbox" ${this.navPreview ? "checked" : ""}><span>显示可走范围</span></label>
      ${packRows ? `<div class="ml-ed-pack-list">${packRows}</div>` : ""}
      <div class="ml-ed-meta">目标：占领全部产兵据点<br>时限：15 分钟<br>资产包：${assetRegistry.counts().packs} 个${missing > 0 ? ` · ${missing} 个装饰缺失` : ""}</div>
      <p class="ml-ed-note">从左侧拖入地形、树木与场景装饰；拖动装饰可移动，选中后可旋转和缩放。</p>
      <p class="ml-ed-note">地形和装饰只影响画面，不进入模拟与回放；据点仍然决定道路与行军。</p>
    `;
  }

  private bindInspector(): void {
    for (const field of this.inspector.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]")) {
      field.addEventListener("change", () => {
        const name = field.dataset.field;
        if (!name) return;
        const value = field instanceof HTMLInputElement && field.type === "checkbox" ? String(field.checked) : field.value;
        const siteId = field.dataset.site;
        const propId = field.dataset.prop;
        const roadId = field.dataset.road;
        const foundationId = field.dataset.foundation;
        if (siteId) this.changeSiteField(siteId, name, value);
        else if (propId) this.changePropField(propId, name, value);
        else if (roadId) this.changeRoadField(roadId, name, value);
        else if (foundationId) this.changeFoundationField(foundationId, name, value);
        else this.changeMapField(name, value);
      });
    }
    this.inspector.querySelector<HTMLElement>("[data-action=delete-foundation]")?.addEventListener("click", () => {
      if (this.selection?.kind === "foundation") this.removeFoundationById(this.selection.id);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=foundation-duplicate]")?.addEventListener("click", () => {
      this.duplicateSelectedFoundation();
    });
    this.inspector.querySelector<HTMLElement>("[data-action=foundation-up]")?.addEventListener("click", () => {
      this.nudgeFoundationElevation(1);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=foundation-down]")?.addEventListener("click", () => {
      this.nudgeFoundationElevation(-1);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=foundation-focus]")?.addEventListener("click", () => {
      const foundation = this.selectedFoundation();
      if (!foundation) return;
      this.scene?.focusOn(foundation.pos[0] / 10, foundation.pos[1] / 10);
      this.view = this.scene?.getViewState() ?? this.view;
      this.drawOverlay();
    });
    this.inspector.querySelector<HTMLElement>("[data-action=add-foundation]")?.addEventListener("click", () => {
      this.setTool("foundation");
      this.setPaletteMode("foundation");
    });
    this.inspector.querySelector<HTMLElement>("[data-action=add-island]")?.addEventListener("click", () => {
      this.setTool("island");
      this.setPaletteMode("foundation");
    });
    this.inspector.querySelector<HTMLElement>("[data-action=delete]")?.addEventListener("click", () => {
      if (this.selection?.kind === "site") this.removeSiteById(this.selection.id);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=delete-prop]")?.addEventListener("click", () => {
      if (this.selection?.kind === "prop") this.removePropById(this.selection.id);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=delete-road]")?.addEventListener("click", () => {
      if (this.selection?.kind === "road") this.removeRoadById(this.selection.id);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=reverse-road]")?.addEventListener("click", () => {
      const road = this.selectedRoad();
      if (!road) return;
      const next = cloneDocument(this.doc);
      const target = next.roads.find((entry) => entry.id === road.id);
      if (!target) return;
      const from = target.from;
      target.from = target.to;
      target.to = from;
      if (target.path) target.path.reverse();
      this.commit(next, "已反转道路", { roadOnly: true });
    });
    this.inspector.querySelector<HTMLElement>("[data-action=straight-road]")?.addEventListener("click", () => {
      const road = this.selectedRoad();
      if (!road) return;
      this.commit(updateRoad(this.doc, road.id, { path: undefined }), "已拉直道路", { roadOnly: true });
    });
    for (const button of this.inspector.querySelectorAll<HTMLElement>("[data-pack-remove]")) {
      button.addEventListener("click", () => {
        const packId = button.dataset.packRemove;
        if (packId) void this.removeAssetPack(packId);
      });
    }
  }

  private async removeAssetPack(packId: string): Promise<void> {
    if (!window.confirm("移除资产包后，使用其中资产的地图会显示缺失。确定移除？")) return;
    await assetRegistry.removePack(packId);
    this.renderAssetPalette();
    this.renderInspector();
    this.rebuild(true);
    this.notice("资产包已移除");
  }

  private changeRoadField(id: string, field: string, value: string): void {
    if (field === "widthM") {
      const widthM = Math.max(0.6, Math.min(6, Number(value) || 1.6));
      this.commit(updateRoad(this.doc, id, { widthDm: Math.round(widthM * 10) }), "已修改道路宽度", { roadOnly: true });
    }
  }

  private changeSiteField(id: CityId, field: string, value: string): void {
    const site = this.doc.sites.find((entry) => entry.id === id);
    if (!site) return;
    if (field === "kind") {
      const kind = value as SiteKind;
      if (isProductionSiteKind(site.kind) && !isProductionSiteKind(kind) && this.doc.sites.filter((entry) => isProductionSiteKind(entry.kind)).length <= 1) {
        this.notice("地图至少需要保留一个产兵据点");
        this.renderInspector();
        return;
      }
      this.commit(updateSite(this.doc, id, { kind }), "已修改据点类型", { siteOnly: true });
      return;
    }
    if (field === "owner") {
      this.commit(updateSite(this.doc, id, { owner: Number(value) as Owner }), "已修改归属", { siteOnly: true });
      return;
    }
    if (field === "level") {
      this.commit(updateSite(this.doc, id, { level: Number(value) as 1 | 2 | 3 }), "已修改等级", { siteOnly: true });
      return;
    }
    if (field === "pop") {
      this.commit(updateSite(this.doc, id, { pop: Number(value) }), "已修改驻军", { siteOnly: true });
      return;
    }
    if (field === "stance") {
      this.commit(updateSite(this.doc, id, { stance: value as Stance }), "已修改驻守状态", { siteOnly: true });
      return;
    }
    if (field === "watch") {
      if (!value) {
        this.commit(updateSite(this.doc, id, { watch: undefined }), "已清除监视道路", { siteOnly: true });
      } else {
        const [from, to] = value.split("|");
        this.commit(updateSite(this.doc, id, { watch: [from, to] }), "已设置监视道路", { siteOnly: true });
      }
      return;
    }
    if (field === "visualAssetId") {
      this.commit(
        updateSite(this.doc, id, { visualAssetId: value || undefined }),
        value ? "已更换建筑外观" : "已恢复默认外观",
      );
      return;
    }
    if (field === "visualRotation") {
      this.commit(updateSite(this.doc, id, { visualRotation: Number(value) || 0 }), "已修改外观朝向");
      return;
    }
    if (field === "visualScale") {
      this.commit(updateSite(this.doc, id, { visualScale: Number(value) || 1 }), "已修改外观缩放");
    }
  }

  private changePropField(id: string, field: string, value: string): void {
    if (field === "rotation") {
      this.commit(updateProp(this.doc, id, { rotation: Number(value) || 0 }), "已修改装饰朝向", { propsOnly: true });
      return;
    }
    if (field === "scale") {
      this.commit(updateProp(this.doc, id, { scale: Number(value) || 1 }), "已修改装饰缩放", { propsOnly: true });
    }
  }

  private changeMapField(field: string, value: string): void {
    if (field === "name") {
      this.commit(updateDocument(this.doc, { name: value.trim() || "未命名地图" }), "已修改地图名称");
      return;
    }
    if (field === "width" || field === "height") {
      const size: [number, number] = [
        field === "width" ? Number(value) || this.doc.size[0] : this.doc.size[0],
        field === "height" ? Number(value) || this.doc.size[1] : this.doc.size[1],
      ];
      size[0] = Math.max(100, Math.min(2000, Math.round(size[0])));
      size[1] = Math.max(100, Math.min(2000, Math.round(size[1])));
      this.commit(updateDocument(this.doc, { size }), "已修改地图尺寸");
      return;
    }
    if (field === "transit") {
      this.commit(updateDocument(this.doc, { transit: value === "open" ? "open" : "friendly" }), "已修改通行规则");
      return;
    }
    if (field === "climbCm") {
      const climb = Math.max(10, Math.min(200, Math.round(Number(value) || 60)));
      this.commit(updateDocument(this.doc, { climbCm: climb }), "已修改坡度上限");
      return;
    }
    if (field === "terrainStyle") {
      this.commit(updateTerrain(this.doc, { style: value as TerrainStyle }), "已修改地貌风格", { terrainOnly: true });
      return;
    }
    if (field === "terrainAmplitude") {
      this.commit(updateTerrain(this.doc, { amplitude: Number(value) || 1 }), "已修改地形起伏", { terrainOnly: true });
      return;
    }
    if (field === "terrainSeed") {
      this.commit(updateTerrain(this.doc, { seed: Math.round(Number(value) || 0) }), "已修改地形种子", { terrainOnly: true });
      return;
    }
    if (field === "roadStyle") {
      this.commit(updateRoadVisual(this.doc, { style: value as RoadStyle }), "已修改道路风格", { roadOnly: true });
      return;
    }
    if (field === "roadWidth") {
      this.commit(updateRoadVisual(this.doc, { width: Number(value) || 1.6 }), "已修改道路宽度", { roadOnly: true });
      return;
    }
    if (field === "brushRadius") {
      this.brushRadius = Math.max(1, Math.min(8, Math.round(Number(value) || 2)));
      this.drawOverlay();
      return;
    }
    if (field === "brushStrength") {
      this.brushStrength = Math.max(5, Math.min(200, Math.round(Number(value) || 20)));
      return;
    }
    if (field === "surfaceBrush") {
      this.surfaceBrush = Math.max(0, Math.min(9, Math.round(Number(value) || 0)));
      return;
    }
    if (field === "navPreview") {
      this.navPreview = value === "true";
      this.scene?.setNavPreview(this.navPreview);
      this.updateGridControls();
      this.drawOverlay();
      return;
    }
  }

  private renderStatus(): void {
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error");
    const warnings = this.compiled.diagnostics.filter((entry) => entry.severity === "warning");
    const missing = this.doc.visual.props.filter((prop) => !assetRegistry.has(prop.assetId)).length;
    const missingText = missing > 0 ? ` · ${missing} 个资产缺失` : "";
    this.statusEl.textContent = errors.length > 0
      ? `${errors.length} 个错误 · ${warnings.length} 个警告`
      : warnings.length > 0
        ? `可试玩 · ${warnings.length} 个警告${missingText}`
        : `地图有效${missingText}`;
    this.statusEl.className = `ml-ed-status ${errors.length > 0 ? "error" : "ok"}`;
    this.diagnosticsEl.innerHTML = this.compiled.diagnostics
      .slice(0, 4)
      .map((entry) => `<span title="${escapeHtml(entry.message)}">${entry.severity === "error" ? "×" : "·"} ${escapeHtml(entry.message)}</span>`)
      .join("");
    this.playButton.disabled = errors.length > 0 || !this.preview;
    this.undoButton.disabled = this.undoStack.length === 0;
    this.redoButton.disabled = this.redoStack.length === 0;
  }

  private syncTop(): void {
    const label = this.options.root.querySelector("#ml-ed-map-label");
    if (label) label.textContent = `${documentLabel(this.doc)} · ${this.doc.sites.length} 据点 · ${this.doc.visual.props.length} 装饰`;
  }

  private notice(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("on"), 1800);
  }

  private async saveDocument(): Promise<void> {
    try {
      const text = serializeDocument(this.doc);
      const result = await saveMapText(text, documentLabel(this.doc));
      if (result) {
        this.dirty = false;
        this.notice("地图已保存");
      }
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "地图保存失败");
    }
  }

  private async openDocument(): Promise<void> {
    if (this.dirty && !window.confirm("当前草稿还没保存，确定载入其他地图？")) return;
    try {
      const opened = await openMapText();
      if (!opened) return;
      const parsed = parseDocument(JSON.parse(opened.text));
      this.doc = parsed.document;
      this.undoStack = [];
      this.redoStack = [];
      this.selection = null;
      this.dirty = false;
      this.rebuild(false);
      this.notice(`已载入 ${opened.name}`);
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "地图文件无法读取");
    }
  }

  private newDocument(): void {
    if (this.dirty && !window.confirm("当前草稿还没保存，确定新建地图？")) return;
    this.doc = createStarterDocument();
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.dirty = false;
    this.rebuild(false);
    this.notice("已新建地图");
  }

  private playtest(): void {
    const full = compileDocument(this.doc);
    this.compiled = full;
    const errors = full.diagnostics.filter((entry) => entry.severity === "error");
    this.renderStatus();
    if (errors.length > 0 || !this.preview) {
      this.notice(errors[0]?.message ?? "先修复地图错误再试玩");
      return;
    }
    this.options.onPlaytest(full.map, full.visual);
  }

  private requestExit(): void {
    if (this.dirty && !window.confirm("当前草稿还没保存，确定返回主菜单？")) return;
    this.suspend();
    this.options.onExit();
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const delta = Math.min(100, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    if (this.scene && this.preview) this.scene.update(this.preview, delta);
    this.drawOverlay();
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawOverlay(): void {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.overlay.width !== Math.round(width * dpr) || this.overlay.height !== Math.round(height * dpr)) {
      this.overlay.width = Math.round(width * dpr);
      this.overlay.height = Math.round(height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    if (!this.scene) return;

    const local = (point: { x: number; y: number }): { x: number; y: number } => ({
      x: point.x - rect.left,
      y: point.y - rect.top,
    });

    const sitePoint = (site: SiteDraft, y = 0.55): { x: number; y: number } | null => {
      const projected = this.scene?.projectGround(site.pos[0], site.pos[1], y);
      return projected ? local(projected) : null;
    };

    this.drawFoundations();

    if (this.drag?.moved && this.drag.ground) {
      const site = this.doc.sites.find((entry) => entry.id === this.drag?.id);
      const from = site ? sitePoint(site) : null;
      const to = this.scene.projectGround(this.drag.ground[0], this.drag.ground[1], 0.55);
      if (from && to) {
        const target = local(to);
        this.ctx.save();
        this.ctx.setLineDash([5, 5]);
        this.ctx.strokeStyle = "#d8c49c";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
        this.ctx.restore();
        this.drawPin(target.x, target.y, "#d8c49c");
      }
    }

    if (this.propDrag?.moved && this.propDrag.ground) {
      const prop = this.doc.visual.props.find((entry) => entry.id === this.propDrag?.id);
      const from = prop ? this.scene.projectGround(prop.pos[0], prop.pos[1], 0.5) : null;
      const to = this.scene.projectGround(this.propDrag.ground[0], this.propDrag.ground[1], 0.5);
      if (from && to) {
        const a = local(from);
        const b = local(to);
        this.ctx.save();
        this.ctx.setLineDash([4, 4]);
        this.ctx.strokeStyle = "#9fc7a4";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.moveTo(a.x, a.y);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
        this.ctx.restore();
        this.drawPin(b.x, b.y, "#9fc7a4");
      }
    }

    if (this.roadFrom && this.pointer.ground) {
      const site = this.doc.sites.find((entry) => entry.id === this.roadFrom);
      const from = site ? sitePoint(site) : null;
      const to = this.scene.projectGround(this.pointer.ground[0], this.pointer.ground[1], 0.55);
      if (from && to) {
        const target = local(to);
        this.ctx.save();
        this.ctx.setLineDash([8, 5]);
        this.ctx.strokeStyle = "#c6a36a";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(from.x, from.y);
        this.ctx.lineTo(target.x, target.y);
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    if ((isProductionSiteKind(this.tool as SiteKind) || this.tool === "granary" || this.tool === "outpost") && this.pointer.ground) {
      const projected = this.scene.projectGround(this.pointer.ground[0], this.pointer.ground[1], 0.55);
      if (projected) {
        const point = local(projected);
        this.ctx.save();
        this.ctx.strokeStyle = toolColor(this.tool);
        this.ctx.fillStyle = "rgba(198,163,106,.12)";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
        this.drawPin(point.x, point.y, toolColor(this.tool));
      }
    }

    if (this.tool === "asset" && this.activeAsset && this.pointer.ground) {
      const info = assetRegistry.info(this.activeAsset);
      const projected = this.scene.projectGround(this.pointer.ground[0], this.pointer.ground[1], 0.4);
      if (projected) {
        const point = local(projected);
        const radius = Math.max(12, Math.min(52, (info?.footprint ?? 2) * 4));
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(159,199,164,.85)";
        this.ctx.fillStyle = "rgba(159,199,164,.12)";
        this.ctx.lineWidth = 1.5;
        this.ctx.setLineDash([4, 4]);
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
        this.drawPin(point.x, point.y, "#9fc7a4");
      }
    }

    if (this.roadDraw) {
      const points = this.roadDraw.points.slice();
      if (this.roadDraw.ground) {
        const last = points[points.length - 1];
        if (Math.hypot(this.roadDraw.ground[0] - last[0], this.roadDraw.ground[1] - last[1]) > 1) {
          points.push(this.roadDraw.ground);
        }
      }
      const screen = points
        .map((point) => this.scene?.projectGround(point[0], point[1], 0.5))
        .filter((point): point is { x: number; y: number } => point !== null && point !== undefined)
        .map((point) => local(point));
      if (screen.length >= 2) {
        this.ctx.save();
        this.ctx.lineCap = "round";
        this.ctx.lineJoin = "round";
        this.ctx.strokeStyle = "rgba(8,12,9,.72)";
        this.ctx.lineWidth = 8;
        this.ctx.beginPath();
        this.ctx.moveTo(screen[0].x, screen[0].y);
        for (let index = 1; index < screen.length; index += 1) this.ctx.lineTo(screen[index].x, screen[index].y);
        this.ctx.stroke();
        this.ctx.strokeStyle = "#d8c49c";
        this.ctx.lineWidth = 3;
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    const roadSelection = this.selectedRoad();
    if (roadSelection) {
      const points = this.roadPoints(roadSelection).map((point) => [point[0], point[1]] as [number, number]);
      if (this.roadPointDrag && this.roadPointDrag.index < points.length) {
        points[this.roadPointDrag.index] = this.roadPointDrag.ground;
      }
      const screen = points
        .map((point) => this.scene?.projectGround(point[0], point[1], 0.5))
        .filter((point): point is { x: number; y: number } => point !== null && point !== undefined)
        .map((point) => local(point));
      if (screen.length >= 2) {
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(127,215,232,.9)";
        this.ctx.lineWidth = 2;
        this.ctx.setLineDash([6, 4]);
        this.ctx.beginPath();
        this.ctx.moveTo(screen[0].x, screen[0].y);
        for (let index = 1; index < screen.length; index += 1) this.ctx.lineTo(screen[index].x, screen[index].y);
        this.ctx.stroke();
        this.ctx.restore();
      }
      for (let index = 0; index < screen.length; index += 1) {
        const point = screen[index];
        this.ctx.save();
        this.ctx.fillStyle = "#0d1410";
        this.ctx.strokeStyle = "#7fd7e8";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    if (this.pathPoints && this.pathPoints.length > 1) {
      this.ctx.save();
      this.ctx.strokeStyle = "#7fd7e8";
      this.ctx.lineWidth = 2.5;
      this.ctx.setLineDash([]);
      this.ctx.beginPath();
      let started = false;
      for (const point of this.pathPoints) {
        const projected = this.scene.projectGround(point[0], point[1], 0.45);
        if (!projected) continue;
        const localPoint = local(projected);
        if (!started) {
          this.ctx.moveTo(localPoint.x, localPoint.y);
          started = true;
        } else {
          this.ctx.lineTo(localPoint.x, localPoint.y);
        }
      }
      this.ctx.stroke();
      const last = this.pathPoints[this.pathPoints.length - 1];
      const end = this.scene.projectGround(last[0], last[1], 0.45);
      if (end) this.drawPin(local(end).x, local(end).y, "#7fd7e8");
      this.ctx.restore();
    }

    if (this.pathFrom && this.doc.grid) {
      const centerDm = gridCellCenter(this.doc.grid, this.doc.size, this.pathFrom);
      const projected = this.scene.projectGround(centerDm[0], centerDm[1], 0.45);
      if (projected) {
        const point = local(projected);
        this.ctx.save();
        this.ctx.strokeStyle = "#7fd7e8";
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    if (isGridTool(this.tool) && this.pointer.ground && this.doc.grid) {
      const cell = gridCellFromGround(this.doc, this.pointer.ground);
      if (cell) {
        const centerDm = gridCellCenter(this.doc.grid, this.doc.size, cell);
        const projected = this.scene.projectGround(centerDm[0], centerDm[1], 0.3);
        const edgeDm: [number, number] = [
          centerDm[0] + this.brushRadius * this.doc.grid.cellSizeDm,
          centerDm[1],
        ];
        const edge = this.scene.projectGround(edgeDm[0], edgeDm[1], 0.3);
        if (projected && edge) {
          const point = local(projected);
          const edgePoint = local(edge);
          const radius = Math.max(8, Math.hypot(edgePoint.x - point.x, edgePoint.y - point.y));
          this.ctx.save();
          this.ctx.setLineDash([4, 4]);
          this.ctx.strokeStyle = toolColor(this.tool);
          this.ctx.fillStyle = "rgba(198,163,106,.10)";
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
          this.ctx.fill();
          this.ctx.stroke();
          this.ctx.restore();
        }
        if (this.gridStroke && this.tool === "ramp") {
          const startDm = gridCellCenter(this.doc.grid, this.doc.size, this.gridStroke.start);
          const start = this.scene.projectGround(startDm[0], startDm[1], 0.3);
          if (start) {
            const a = local(start);
            const b = local(projected ?? start);
            this.ctx.save();
            this.ctx.setLineDash([7, 5]);
            this.ctx.strokeStyle = "#d1b78f";
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(a.x, a.y);
            this.ctx.lineTo(b.x, b.y);
            this.ctx.stroke();
            this.ctx.restore();
          }
        }
      }
    }

    const selected = this.selectedProp();
    if (selected) {
      const projected = this.scene.projectGround(selected.pos[0], selected.pos[1], 0.5);
      if (projected) {
        const point = local(projected);
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(198,163,106,.95)";
        this.ctx.lineWidth = 1.5;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 13, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
      }
    }

    const hovered = this.pickSite(this.pointer.x, this.pointer.y);
    if (hovered) {
      const site = this.doc.sites.find((entry) => entry.id === hovered);
      const point = site ? sitePoint(site, 1.6) : null;
      if (point) {
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(232,222,201,.55)";
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.arc(point.x, point.y, 9, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
      }
    } else {
      const hoveredProp = this.pickProp(this.pointer.x, this.pointer.y);
      if (hoveredProp) {
        const prop = this.doc.visual.props.find((entry) => entry.id === hoveredProp);
        const point = prop ? this.scene.projectGround(prop.pos[0], prop.pos[1], 0.5) : null;
        if (point) {
          const localPoint = local(point);
          this.ctx.save();
          this.ctx.strokeStyle = "rgba(159,199,164,.7)";
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.arc(localPoint.x, localPoint.y, 10, 0, Math.PI * 2);
          this.ctx.stroke();
          this.ctx.restore();
        }
      }
    }
  }

  private drawFoundations(): void {
    if (!this.scene) return;
    for (const foundation of this.doc.visual.foundations) {
      let preview = foundation;
      if (this.foundationDrag?.id === foundation.id && this.foundationDrag.moved) {
        preview = { ...foundation, pos: this.foundationDrag.previewPos };
      }
      if (this.foundationResize?.id === foundation.id && this.foundationResize.moved) {
        const rect = this.foundationResize.rect;
        preview = {
          ...foundation,
          pos: [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2],
          size: [rect.maxX - rect.minX, rect.maxZ - rect.minZ],
        };
      }
      const quad = this.foundationQuad(preview);
      if (!quad) continue;
      const selected = this.selection?.kind === "foundation" && this.selection.id === foundation.id;
      const floating = preview.elevation !== 0;
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.moveTo(quad[0].x, quad[0].y);
      for (let index = 1; index < quad.length; index += 1) this.ctx.lineTo(quad[index].x, quad[index].y);
      this.ctx.closePath();
      this.ctx.fillStyle = selected ? "rgba(201,168,106,.10)" : "rgba(201,168,106,.03)";
      this.ctx.fill();
      this.ctx.setLineDash(selected ? [] : [6, 5]);
      this.ctx.lineWidth = selected ? 2 : 1;
      this.ctx.strokeStyle = selected ? "#e6c987" : floating ? "rgba(143,182,216,.45)" : "rgba(201,168,106,.3)";
      this.ctx.stroke();
      this.ctx.restore();

      const center = this.scene.projectGround(preview.pos[0], preview.pos[1], 0.6);
      if (center) {
        const point = {
          x: center.x - this.canvas.getBoundingClientRect().left,
          y: center.y - this.canvas.getBoundingClientRect().top,
        };
        const size = `${(preview.size[0] / 10).toFixed(0)}×${(preview.size[1] / 10).toFixed(0)}`;
        const height = preview.elevation === 0 ? "" : ` · ${preview.elevation > 0 ? "+" : ""}${preview.elevation.toFixed(1)}m`;
        const text = `${preview.id} · ${size}${height}`;
        this.ctx.save();
        this.ctx.font = "11px 'Segoe UI', sans-serif";
        const width = this.ctx.measureText(text).width + 10;
        this.ctx.fillStyle = "rgba(10,15,11,.72)";
        this.ctx.fillRect(point.x - width / 2, point.y - 9, width, 18);
        this.ctx.fillStyle = selected ? "#f0dcae" : "rgba(232,215,180,.7)";
        this.ctx.textAlign = "center";
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(text, point.x, point.y);
        this.ctx.restore();
      }

      if (selected) {
        for (const corner of quad) {
          this.ctx.save();
          this.ctx.fillStyle = "#0d1410";
          this.ctx.strokeStyle = "#e6c987";
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.rect(corner.x - 5, corner.y - 5, 10, 10);
          this.ctx.fill();
          this.ctx.stroke();
          this.ctx.restore();
        }
        for (let edge = 0; edge < 4; edge += 1) {
          const a = quad[edge];
          const b = quad[(edge + 1) % 4];
          const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          this.ctx.save();
          this.ctx.fillStyle = "#0d1410";
          this.ctx.strokeStyle = "rgba(230,201,135,.8)";
          this.ctx.lineWidth = 1;
          this.ctx.beginPath();
          this.ctx.moveTo(middle.x, middle.y - 4);
          this.ctx.lineTo(middle.x + 4, middle.y);
          this.ctx.lineTo(middle.x, middle.y + 4);
          this.ctx.lineTo(middle.x - 4, middle.y);
          this.ctx.closePath();
          this.ctx.fill();
          this.ctx.stroke();
          this.ctx.restore();
        }
      }
    }
    if (this.tool === "select" && !this.foundationDrag && !this.foundationResize) {
      const hovered = this.pickFoundation(this.pointer.x, this.pointer.y);
      if (hovered && !(this.selection?.kind === "foundation" && this.selection.id === hovered)) {
        const foundation = this.doc.visual.foundations.find((entry) => entry.id === hovered);
        const quad = foundation ? this.foundationQuad(foundation) : null;
        if (quad) {
          this.ctx.save();
          this.ctx.setLineDash([4, 4]);
          this.ctx.strokeStyle = "rgba(230,201,135,.75)";
          this.ctx.lineWidth = 1.5;
          this.ctx.beginPath();
          this.ctx.moveTo(quad[0].x, quad[0].y);
          for (let index = 1; index < quad.length; index += 1) this.ctx.lineTo(quad[index].x, quad[index].y);
          this.ctx.closePath();
          this.ctx.stroke();
          this.ctx.restore();
        }
      }
    }
  }

  private drawPin(x: number, y: number, color: string): void {
    this.ctx.save();
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    this.ctx.moveTo(x - 5, y);
    this.ctx.lineTo(x + 5, y);
    this.ctx.moveTo(x, y - 5);
    this.ctx.lineTo(x, y + 5);
    this.ctx.stroke();
    this.ctx.restore();
  }
}
