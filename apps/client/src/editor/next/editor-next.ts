import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  Button,
  LabelGroup,
  NumericInput,
  SelectInput,
  TextInput,
  TreeView,
  TreeViewItem,
} from "@playcanvas/pcui";
import "@playcanvas/pcui/styles";
import {
  GRID_UNIT_RADIUS_CM,
  UNIT_PROFILES,
  createGame,
  createUnitNavGrid,
  isProductionSiteKind,
  isUpgradableSiteKind,
} from "@marchlands/sim";
import type { CityId, MapDef, Ruleset, SimState, SiteKind, UnitKind } from "@marchlands/sim";
import type { NavGrid } from "@marchlands/nav";
import { SITE_KIND_OPTIONS, siteKindLabel } from "../../game/site-kind";
import {
  addFoundation,
  addProp,
  addRoad,
  addSite,
  applyGridBrush,
  clampPosition,
  cloneDocument,
  compileDocument,
  convertToGrid,
  createGridDocument,
  createStarterDocument,
  documentBounds,
  duplicateFoundation,
  foundationAt,
  foundationContains,
  foundationDepth,
  foundationRect,
  gridCellFromGround,
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
  watchCandidates,
} from "@marchlands/map-authoring";
import type {
  CompileResult,
  FoundationBoundsDm,
  FoundationShape,
  GridBrushMode,
  MapDocument,
  MapVisual,
  PropDraft,
  SiteDraft,
} from "@marchlands/map-authoring";
import { assetRegistry } from "../../game/asset-registry";
import { BattleScene } from "../../game/scene";
import { openAssetPackFile, openMapText, openModelFiles, openTextureFiles, saveAssetPackFile, saveMapText } from "../map-io";
import { buildBuiltinAssetPack } from "../../game/asset-pack-export";
import { convertObjToPack } from "../../game/obj-import";
import {
  customMaterialList,
  loadCustomMaterials,
  removeCustomMaterial,
  saveCustomMaterial,
} from "../../game/custom-materials";
import "./next.css";

type NextTool = "select" | "move" | "rotate" | "scale" | "place" | "road" | "terrain";
type Selection = { kind: "foundation" | "site" | "prop" | "road"; id: string } | null;
type LibraryTab = "site" | "decor" | "terrain" | "foundation";

interface EditorNextOptions {
  root: HTMLElement;
  rules: Ruleset;
  onPlaytest: (map: MapDef, visual: MapVisual) => void;
  onExit: () => void;
}

interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
}

const TOOL_LABELS: Record<NextTool, string> = {
  select: "选择",
  move: "移动",
  rotate: "旋转",
  scale: "缩放",
  place: "放置",
  road: "道路",
  terrain: "地形",
};

const AUTOSAVE_KEY = "marchlands.editor.autosave.v1";

const FOUNDATION_PRESETS: Array<{
  id: string;
  label: string;
  desc: string;
  shape: FoundationShape;
  size: [number, number];
  elevation: number;
}> = [
  { id: "round-small", label: "小圆岛", desc: "30×30", shape: "round", size: [300, 300], elevation: 0 },
  { id: "mesa-large", label: "方山", desc: "50×50", shape: "mesa", size: [500, 500], elevation: 0 },
  { id: "ridge-long", label: "长岛", desc: "80×35", shape: "mesa", size: [800, 350], elevation: 0 },
  { id: "spire-float", label: "尖峰浮岛", desc: "40×40 · Y14", shape: "spire", size: [400, 400], elevation: 14 },
  { id: "terrace-mid", label: "梯田", desc: "60×50", shape: "terrace", size: [600, 500], elevation: 0 },
  { id: "root-mid", label: "根岛", desc: "70×60", shape: "root", size: [700, 600], elevation: 0 },
];

const FOUNDATION_SHAPE_OPTIONS: Array<{ id: FoundationShape; label: string; desc: string }> = [
  { id: "plateau", label: "高原", desc: "宽缓起伏" },
  { id: "mesa", label: "方山", desc: "陡壁平顶" },
  { id: "spire", label: "尖峰", desc: "收窄长根" },
  { id: "terrace", label: "梯田", desc: "分层台地" },
  { id: "root", label: "根系", desc: "扭曲岩根" },
  { id: "round", label: "圆岛", desc: "浑圆轮廓" },
];

interface SelectInputProto {
  _updateInputFieldsVisibility: (...args: unknown[]) => void;
  _labelValue?: unknown;
  _timeoutLabelValueTabIndex?: number | null;
  destroy: () => void;
  __mlnxGuarded?: boolean;
}

function guardPcuiTabIndex(start: object): void {
  let proto: object | null = start;
  while (proto) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "tabIndex");
    const setter = descriptor?.set;
    if (descriptor && setter && descriptor.configurable) {
      Object.defineProperty(proto, "tabIndex", {
        ...descriptor,
        set(this: { dom?: HTMLElement | null }, value: number): void {
          if (!this.dom) return;
          setter.call(this, value);
        },
      });
      return;
    }
    proto = Object.getPrototypeOf(proto);
  }
}

function guardPcuiSelectLifecycle(): void {
  guardPcuiTabIndex(SelectInput.prototype);
  const proto = SelectInput.prototype as unknown as SelectInputProto;
  if (proto.__mlnxGuarded) return;
  const original = proto._updateInputFieldsVisibility;
  if (typeof original !== "function") return;
  proto._updateInputFieldsVisibility = function guarded(this: SelectInputProto, ...args: unknown[]): void {
    if (!this._labelValue) return;
    if ((this._labelValue as { dom?: unknown }).dom === null) return;
    original.apply(this, args);
  };
  const originalDestroy = proto.destroy;
  proto.destroy = function guardedDestroy(this: SelectInputProto): void {
    if (this._timeoutLabelValueTabIndex) {
      cancelAnimationFrame(this._timeoutLabelValueTabIndex);
      this._timeoutLabelValueTabIndex = null;
    }
    originalDestroy.apply(this, []);
  };
  proto.__mlnxGuarded = true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function snapDm(value: number, step: number = 5): number {
  return Math.round(value / step) * step;
}

const TEMPLATE = [
  '<div id="mlnx-root">',
  '  <header class="mlnx-top">',
  '    <button class="mlnx-back" id="mlnx-back">返回</button>',
  '    <div class="mlnx-title">地图编辑器</div>',
  '    <div class="mlnx-map-label" id="mlnx-map-label"></div>',
  '    <div class="mlnx-spacer"></div>',
  '    <div class="mlnx-actions">',
  '      <button class="mlnx-btn" id="mlnx-new">新建</button>',
  '      <button class="mlnx-btn" id="mlnx-open">载入</button>',
  '      <button class="mlnx-btn" id="mlnx-save">保存</button>',
  '      <button class="mlnx-btn" id="mlnx-undo">撤销</button>',
  '      <button class="mlnx-btn" id="mlnx-redo">重做</button>',
  '      <button class="mlnx-btn" id="mlnx-view">对局视角</button>',
  '      <button class="mlnx-btn primary" id="mlnx-play">试玩</button>',
  '    </div>',
  '  </header>',
  '  <div class="mlnx-body">',
  '    <nav class="mlnx-rail" id="mlnx-rail">',
  '      <button class="mlnx-tool active" data-tool="select"><b>V</b><span>选择</span></button>',
  '      <button class="mlnx-tool" data-tool="move"><b>W</b><span>移动</span></button>',
  '      <button class="mlnx-tool" data-tool="rotate"><b>R</b><span>旋转</span></button>',
  '      <button class="mlnx-tool" data-tool="scale"><b>T</b><span>缩放</span></button>',
  '      <button class="mlnx-tool" data-tool="place"><b>B</b><span>放置</span></button>',
  '      <button class="mlnx-tool" data-tool="road"><b>P</b><span>道路</span></button>',
  '      <button class="mlnx-tool" data-tool="terrain"><b>G</b><span>地形</span></button>',
  '    </nav>',
  '    <aside class="mlnx-left mlnx-pcui">',
  '      <div class="mlnx-left-head">',
  '        <input class="mlnx-search" id="mlnx-search" placeholder="搜索对象或资产">',
  '        <div class="mlnx-tabs" id="mlnx-tabs"></div>',
  '      </div>',
  '      <div class="mlnx-left-content" id="mlnx-left-content"></div>',
  '    </aside>',
  '    <main class="mlnx-stage">',
  '      <canvas class="mlnx-canvas" id="mlnx-canvas"></canvas>',
  '      <div class="mlnx-view-info" id="mlnx-view-info"></div>',
  '      <div class="mlnx-toast" id="mlnx-toast"></div>',
  '    </main>',
  '    <aside class="mlnx-inspector mlnx-pcui" id="mlnx-inspector"></aside>',
  '  </div>',
  '  <footer class="mlnx-status" id="mlnx-status"></footer>',
  '</div>',
].join("\n");

const REACH_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** 从一格洪泛出该兵种能走到的所有格子；和派兵用同一套 NavGrid.canStep。 */
function floodCells(nav: NavGrid, start: number, coverage: Uint8Array): Uint8Array {
  const cells = new Uint8Array(nav.cellCount);
  const queue = new Int32Array(nav.cellCount);
  let head = 0;
  let tail = 0;
  cells[start] = 1;
  queue[tail] = start;
  tail += 1;
  while (head < tail) {
    const current = queue[head];
    head += 1;
    const cx = nav.cellX(current);
    const cz = nav.cellZ(current);
    for (const [dx, dz] of REACH_NEIGHBOURS) {
      const nx = cx + dx;
      const nz = cz + dz;
      if (!nav.inBounds(nx, nz)) continue;
      const next = nav.index(nx, nz);
      if (cells[next] === 1) continue;
      if (!nav.isWalkable(next, coverage)) continue;
      if (!nav.canStep(current, next, coverage)) continue;
      cells[next] = 1;
      queue[tail] = next;
      tail += 1;
    }
  }
  return cells;
}

export class EditorNext {
  private readonly options: EditorNextOptions;
  private doc: MapDocument = createStarterDocument();
  private compiled: CompileResult = compileDocument(this.doc, { validateNavigation: false });
  private preview: SimState | null = null;
  private scene: BattleScene | null = null;
  private terrainPassability = false;
  private terrainReachable = false;
  private reachUnit: UnitKind = "barbarian";
  private reachFrom: string | null = null;
  private reachMesh: THREE.Mesh | null = null;
  private rampPreview: THREE.Line | null = null;
  private orbit: OrbitControls | null = null;
  private gizmo: TransformControls | null = null;
  private editorRoot: THREE.Group | null = null;
  private proxyRoot: THREE.Group | null = null;
  private handleRoot: THREE.Group | null = null;
  private roadHandleRoot: THREE.Group | null = null;
  private roadSelectionRoot: THREE.Group | null = null;
  private roadPointDrag: { id: string; index: number; mesh: THREE.Mesh } | null = null;
  private faceDrag: {
    id: string;
    face: "east" | "west" | "north" | "south";
    rect: FoundationBoundsDm;
    ghost: THREE.Mesh;
  } | null = null;
  private readonly proxies: THREE.Object3D[] = [];
  private selectedProxy: THREE.Object3D | null = null;
  private tree: TreeView | null = null;
  private treeItems = new Map<string, TreeViewItem>();
  private inspectorTop: Array<{ destroy?: () => void }> = [];
  private tool: NextTool = "select";
  private selection: Selection = null;
  private libraryTab: LibraryTab = "site";
  private activeSiteKind: SiteKind = "barbarian";
  private activeAssetId: string | null = null;
  private activeFoundationKind: "platform" | "island" = "platform";
  private activeFoundationShape: FoundationShape = "plateau";
  private toolElevation = 0;
  private query = "";
  private running = false;
  private raf = 0;
  private lastFrame = 0;
  private dirty = false;
  private undoStack: MapDocument[] = [];
  private redoStack: MapDocument[] = [];
  private drag: { start: [number, number]; current: [number, number]; ghost: THREE.Mesh } | null = null;
  private roadDraw: { points: [number, number][]; from?: CityId; to?: CityId; line: THREE.Line } | null = null;
  private terrainBrush: GridBrushMode = "raise";
  private brushRadius = 2;
  private scatterCount = 6;
  private brushStrength = 20;
  private surfaceBrush = 0;
  private gridStroke: {
    before: MapDocument;
    document: MapDocument;
    lastCell: [number, number];
    startCell: [number, number];
    changed: boolean;
  } | null = null;
  private pointer: { x: number; y: number; ground: [number, number] | null } = { x: 0, y: 0, ground: null };
  private resizeObserver: ResizeObserver | null = null;
  private toastTimer = 0;
  private mounted = false;
  private disposed = false;
  private inspectorFrame = 0;
  private materialsLoaded = false;
  private gizmoDirty = false;
  private cameraState: CameraState | null = null;

  private canvas!: HTMLCanvasElement;
  private leftContent!: HTMLElement;
  private tabsEl!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private inspectorEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private mapLabelEl!: HTMLElement;
  private viewInfoEl!: HTMLElement;
  private undoBtn!: HTMLButtonElement;
  private redoBtn!: HTMLButtonElement;

  constructor(options: EditorNextOptions) {
    this.options = options;
  }

  open(): void {
    if (!this.mounted) {
      this.mount();
      this.restoreAutosave();
      this.mounted = true;
    }
    this.startScene();
    this.renderAll();
    this.ensureCustomMaterials();
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
    this.disposed = true;
    if (this.inspectorFrame) cancelAnimationFrame(this.inspectorFrame);
    this.inspectorFrame = 0;
    this.suspend();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    this.disposeScene();
    this.tree?.destroy();
    this.tree = null;
    document.getElementById("mlnx-root")?.remove();
  }

  private mount(): void {
    guardPcuiSelectLifecycle();
    this.options.root.innerHTML = TEMPLATE;
    this.canvas = document.getElementById("mlnx-canvas") as HTMLCanvasElement;
    this.leftContent = document.getElementById("mlnx-left-content") as HTMLElement;
    this.tabsEl = document.getElementById("mlnx-tabs") as HTMLElement;
    this.searchEl = document.getElementById("mlnx-search") as HTMLInputElement;
    this.inspectorEl = document.getElementById("mlnx-inspector") as HTMLElement;
    this.statusEl = document.getElementById("mlnx-status") as HTMLElement;
    this.toastEl = document.getElementById("mlnx-toast") as HTMLElement;
    this.mapLabelEl = document.getElementById("mlnx-map-label") as HTMLElement;
    this.viewInfoEl = document.getElementById("mlnx-view-info") as HTMLElement;
    this.undoBtn = document.getElementById("mlnx-undo") as HTMLButtonElement;
    this.redoBtn = document.getElementById("mlnx-redo") as HTMLButtonElement;

    document.getElementById("mlnx-back")?.addEventListener("click", () => this.requestExit());
    document.getElementById("mlnx-new")?.addEventListener("click", () => this.newDocument());
    document.getElementById("mlnx-open")?.addEventListener("click", () => void this.openDocument());
    document.getElementById("mlnx-save")?.addEventListener("click", () => void this.saveDocument());
    this.undoBtn.addEventListener("click", () => this.undo());
    this.redoBtn.addEventListener("click", () => this.redo());
    document.getElementById("mlnx-play")?.addEventListener("click", () => this.playtest());
    document.getElementById("mlnx-view")?.addEventListener("click", () => this.resetCamera());
    for (const button of document.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool as NextTool | undefined;
        if (tool) this.setTool(tool);
      });
    }
    this.searchEl.addEventListener("input", () => {
      this.query = this.searchEl.value.trim();
      if (this.tool === "place") this.renderLibrary();
      else this.renderOutline();
    });
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (this.roadDraw) this.cancelRoad();
    });
    this.canvas.addEventListener("dblclick", (event) => {
      if (this.tool === "road" && this.roadDraw) {
        this.finishRoad();
        return;
      }
      if (this.selection?.kind === "road" && (this.tool === "select" || this.tool === "move")) {
        this.insertRoadPoint(event.clientX, event.clientY);
      }
    });
    window.addEventListener("keydown", this.onKeyDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas.parentElement ?? this.canvas);
    this.tree = new TreeView({ allowDrag: false, allowReordering: false, allowRenaming: false });
    this.tree.dom.style.width = "100%";
    this.tree.on("select", (item: TreeViewItem) => {
      const selection = (item as unknown as { __selection?: Selection }).__selection;
      if (selection) this.select(selection);
    });
    this.updateViewInfo();
  }

  private restoreAutosave(): void {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return;
      this.doc = parseDocument(JSON.parse(text)).document;
      this.compiled = compileDocument(this.doc, { validateNavigation: false });
      this.dirty = false;
    } catch {
      this.doc = createStarterDocument();
      this.compiled = compileDocument(this.doc, { validateNavigation: false });
    }
  }

  private startScene(): void {
    this.disposeScene();
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    this.preview = this.createPreview();
    try {
      this.scene = new BattleScene(this.canvas, this.compiled.map, this.compiled.visual);
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "场景创建失败");
      return;
    }
    this.scene.setEditorMode(true);
    this.scene.setNavPreview(this.terrainPassability);
    if (this.preview) this.scene.update(this.preview, 0);
    const camera = this.scene.getEditorCamera();
    const scene3 = this.scene.getEditorScene();
    const bounds = documentBounds(this.doc);
    const centerX = (bounds.minX + bounds.maxX) / 20;
    const centerZ = (bounds.minZ + bounds.maxZ) / 20;
    const radius = Math.max(20, (bounds.maxX - bounds.minX) / 20, (bounds.maxZ - bounds.minZ) / 20);
    const reach = radius + 24;
    camera.position.set(centerX + reach * 0.9, reach * 1.25, centerZ + reach * 1.5);
    const orbit = new OrbitControls(camera, this.canvas);
    orbit.target.set(centerX, 0, centerZ);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.screenSpacePanning = false;
    orbit.minDistance = 2;
    orbit.maxDistance = radius * 10;
    orbit.maxPolarAngle = Math.PI / 2 - 0.03;
    orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as unknown as typeof orbit.mouseButtons;
    orbit.update();
    this.orbit = orbit;
    this.updateOrbitButtons();

    this.editorRoot = new THREE.Group();
    this.editorRoot.name = "editor-helpers";
    scene3.add(this.editorRoot);
    const gridSize = Math.min(600, Math.max(240, radius * 6));
    const grid = new THREE.GridHelper(gridSize, Math.max(40, Math.round(gridSize / 2)), 0x3b4a3f, 0x223026);
    grid.position.y = 0.02;
    const gridMaterial = grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.2;
    gridMaterial.depthWrite = false;
    this.editorRoot.add(grid);
    const axes = new THREE.AxesHelper(12);
    axes.position.set(0, 0.03, 0);
    this.editorRoot.add(axes);
    this.updateReachOverlay();

    this.proxyRoot = new THREE.Group();
    this.proxyRoot.name = "editor-proxies";
    scene3.add(this.proxyRoot);
    this.handleRoot = new THREE.Group();
    this.handleRoot.name = "editor-handles";
    scene3.add(this.handleRoot);
    this.roadHandleRoot = new THREE.Group();
    this.roadHandleRoot.name = "editor-road-handles";
    scene3.add(this.roadHandleRoot);
    this.roadSelectionRoot = new THREE.Group();
    this.roadSelectionRoot.name = "editor-road-selection";
    scene3.add(this.roadSelectionRoot);

    const gizmo = new TransformControls(camera, this.canvas);
    gizmo.setSize(0.45);
    gizmo.setTranslationSnap(0.5);
    gizmo.setRotationSnap(THREE.MathUtils.degToRad(15));
    gizmo.setScaleSnap(0.1);
    gizmo.addEventListener("dragging-changed", (event) => {
      const value = (event as unknown as { value: boolean }).value;
      if (this.orbit) this.orbit.enabled = !value;
    });
    gizmo.addEventListener("mouseDown", () => {
      this.gizmoDirty = false;
    });
    gizmo.addEventListener("objectChange", () => {
      this.gizmoDirty = true;
      if (this.selection?.kind === "site" && this.selectedProxy) {
        const euler = new THREE.Euler().setFromQuaternion(this.selectedProxy.quaternion, "YXZ");
        this.scene?.previewSiteRotation(
          this.selection.id,
          (euler.x * 180) / Math.PI,
          (euler.y * 180) / Math.PI,
          (euler.z * 180) / Math.PI,
        );
      }
      this.updateViewInfo();
    });
    gizmo.addEventListener("mouseUp", () => {
      if (this.gizmoDirty) this.commitGizmo();
    });
    scene3.add(gizmo.getHelper());
    this.gizmo = gizmo;

    if (this.cameraState) {
      camera.position.set(this.cameraState.position[0], this.cameraState.position[1], this.cameraState.position[2]);
      orbit.target.set(this.cameraState.target[0], this.cameraState.target[1], this.cameraState.target[2]);
      orbit.update();
      this.cameraState = null;
    }
    this.syncProxies();
    this.attachGizmo();
    this.resize();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlnxSelection = () => this.selection;
      (window as unknown as Record<string, unknown>).__mlnxDoc = () => this.doc;
      (window as unknown as Record<string, unknown>).__mlnxProject = (xM: number, yM: number, zM: number) => {
        const active = this.scene?.getEditorCamera();
        const rect = this.canvas.getBoundingClientRect();
        if (!active) return null;
        const point = new THREE.Vector3(xM, yM, zM).project(active);
        return {
          x: rect.left + ((point.x + 1) / 2) * rect.width,
          y: rect.top + ((1 - point.y) / 2) * rect.height,
        };
      };
      (window as unknown as Record<string, unknown>).__mlnxCamera = () => {
        const active = this.scene?.getEditorCamera();
        const activeOrbit = this.orbit;
        return active && activeOrbit
          ? {
              position: [active.position.x, active.position.y, active.position.z],
              target: [activeOrbit.target.x, activeOrbit.target.y, activeOrbit.target.z],
              fov: active.fov,
            }
          : null;
      };
      (window as unknown as Record<string, unknown>).__mlnxFog = () => {
        const fog = this.scene?.getEditorScene().fog;
        return fog && "near" in fog ? { near: fog.near, far: fog.far } : null;
      };
      (window as unknown as Record<string, unknown>).__mlnxAtmosphere = () => {
        const atmosphere = this.scene?.getEditorScene().getObjectByName("atmosphere");
        return atmosphere ? atmosphere.uuid : null;
      };
      (window as unknown as Record<string, unknown>).__mlnxRoadMarker = () => this.roadSelectionRoot?.children.length ?? 0;
      (window as unknown as Record<string, unknown>).__mlnxSiteRotation = (id: string) =>
        this.scene?.siteModelRotation(id) ?? null;
      (window as unknown as Record<string, unknown>).__mlnxSiteEuler = (id: string) =>
        this.scene?.siteModelEuler(id) ?? null;
      (window as unknown as Record<string, unknown>).__mlnxGizmo = () => {
        if (!this.gizmo) return null;
        const gizmo = this.gizmo as unknown as { mode?: string; axis?: string | null; visible?: boolean };
        return { mode: gizmo.mode ?? null, axis: gizmo.axis ?? null, visible: gizmo.visible ?? null };
      };
    }
  }

  private ensureCustomMaterials(): void {
    if (this.materialsLoaded) return;
    this.materialsLoaded = true;
    void loadCustomMaterials().then(() => {
      if (this.disposed) return;
      if (this.doc.visual.terrain.material?.startsWith("custom.") && this.scene) {
        this.compiled = compileDocument(this.doc, { validateNavigation: false });
        this.scene.updateTerrain(this.compiled.map, this.compiled.visual);
        this.syncProxies();
      }
      this.scheduleInspectorRender();
    });
  }

  private disposeScene(): void {
    this.gizmo?.detach();
    this.gizmo?.dispose();
    this.gizmo = null;
    this.roadDraw = null;
    this.gridStroke = null;
    this.orbit?.dispose();
    this.orbit = null;
    this.scene?.dispose();
    this.scene = null;
    this.editorRoot = null;
    this.proxyRoot = null;
    this.handleRoot = null;
    this.roadHandleRoot = null;
    this.roadSelectionRoot = null;
    this.roadPointDrag = null;
    this.faceDrag = null;
    this.reachMesh = null;
    this.rampPreview = null;
    this.proxies.length = 0;
    this.selectedProxy = null;
    this.treeItems.clear();
  }

  private createPreview(): SimState | null {
    try {
      if (this.compiled.map.cities.length === 0) return null;
      return createGame(this.compiled.map, 1, this.options.rules);
    } catch {
      return null;
    }
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    const delta = Math.min(100, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    this.orbit?.update();
    if (this.scene) {
      if (this.preview) this.scene.update(this.preview, delta);
      else this.scene.renderEditor();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private resize(): void {
    this.scene?.resizeEditor();
  }

  private renderAll(): void {
    this.renderTree();
    this.renderTabs();
    this.renderLeftPanel();
    this.renderInspector();
    this.updateTop();
    this.updateStatus();
  }

  private renderTabs(): void {
    if (this.tool !== "place") {
      const label = this.tool === "road" ? "道路" : this.tool === "terrain" ? "地形" : "大纲";
      this.tabsEl.innerHTML = '<span class="mlnx-group-label" style="margin:0;padding:6px 2px">' + label + "</span>";
      return;
    }
    const tabs: Array<{ id: LibraryTab; label: string }> = [
      { id: "site", label: "据点" },
      { id: "decor", label: "装饰" },
      { id: "terrain", label: "地形" },
      { id: "foundation", label: "地基" },
    ];
    let html = "";
    for (const tab of tabs) {
      html += '<button class="mlnx-tab' + (tab.id === this.libraryTab ? " active" : "") + '" data-tab="' + tab.id + '">' + tab.label + "</button>";
    }
    this.tabsEl.innerHTML = html;
    for (const button of this.tabsEl.querySelectorAll<HTMLElement>("[data-tab]")) {
      button.addEventListener("click", () => {
        const tab = button.dataset.tab as LibraryTab | undefined;
        if (!tab) return;
        this.libraryTab = tab;
        this.renderTabs();
        this.renderLibrary();
      });
    }
  }

  private renderLeftPanel(): void {
    this.renderTabs();
    if (this.tool === "place") this.renderLibrary();
    else if (this.tool === "road") this.renderRoadPanel();
    else if (this.tool === "terrain") this.renderTerrainPanel();
    else this.renderOutline();
  }

  private renderOutline(): void {
    if (!this.tree) return;
    this.leftContent.replaceChildren();
    this.leftContent.appendChild(this.tree.dom);
    this.applyOutlineFilter();
  }

  private applyOutlineFilter(): void {
    if (!this.tree) return;
    const query = this.query.toLowerCase();
    const childrenOf = (item: TreeViewItem): TreeViewItem[] => {
      const result: TreeViewItem[] = [];
      item.forEachChild((child) => {
        if (child instanceof TreeViewItem) result.push(child);
      });
      return result;
    };
    const setVisible = (item: TreeViewItem, visible: boolean): void => {
      item.hidden = !visible;
      for (const child of childrenOf(item)) setVisible(child, visible);
    };
    const visit = (item: TreeViewItem, queryText: string): boolean => {
      const selfMatch = queryText.length === 0 || item.text.toLowerCase().includes(queryText);
      let childMatch = false;
      for (const child of childrenOf(item)) {
        if (visit(child, queryText)) childMatch = true;
      }
      if (selfMatch) {
        // 分组命中时展示整组，单项命中时只展示自己
        for (const child of childrenOf(item)) setVisible(child, true);
        if (queryText.length > 0) item.open = true;
      }
      const visible = selfMatch || childMatch;
      item.hidden = !visible;
      return visible;
    };
    this.tree.forEachChild((child) => {
      if (child instanceof TreeViewItem) visit(child, query);
    });
  }

  private renderTree(): void {
    if (!this.tree) return;
    this.treeItems.clear();
    this.tree.clearTreeItems();
    const foundationNode = new TreeViewItem({ text: "地基 (" + this.doc.visual.foundations.length + ")", open: true });
    for (const foundation of this.doc.visual.foundations) {
      const rect = foundationRect(foundation);
      const width = ((rect.maxX - rect.minX) / 10).toFixed(0);
      const depth = ((rect.maxZ - rect.minZ) / 10).toFixed(0);
      const item = new TreeViewItem({ text: foundation.id + " · " + width + "×" + depth + " · Y" + foundation.elevation.toFixed(1) });
      const selection: Selection = { kind: "foundation", id: foundation.id };
      (item as unknown as { __selection?: Selection }).__selection = selection;
      this.treeItems.set(foundation.id, item);
      foundationNode.append(item);
    }
    const siteNode = new TreeViewItem({ text: "据点 (" + this.doc.sites.length + ")", open: true });
    for (const site of this.doc.sites) {
      const kind = siteKindLabel(site.kind);
      const item = new TreeViewItem({ text: site.id + " · " + kind + " · L" + site.level });
      const selection: Selection = { kind: "site", id: site.id };
      (item as unknown as { __selection?: Selection }).__selection = selection;
      this.treeItems.set(site.id, item);
      siteNode.append(item);
    }
    const roadNode = new TreeViewItem({ text: "道路 (" + this.doc.roads.length + ")", open: true });
    for (const road of this.doc.roads) {
      const ends = road.from && road.to ? road.from + " ↔ " + road.to : "自由道路";
      const item = new TreeViewItem({ text: road.id + " · " + ends });
      const selection: Selection = { kind: "road", id: road.id };
      (item as unknown as { __selection?: Selection }).__selection = selection;
      this.treeItems.set(road.id, item);
      roadNode.append(item);
    }
    const propNode = new TreeViewItem({ text: "装饰 (" + this.doc.visual.props.length + ")", open: false });
    for (const prop of this.doc.visual.props) {
      const info = assetRegistry.info(prop.assetId);
      const item = new TreeViewItem({ text: prop.id + " · " + (info?.label ?? prop.assetId) });
      const selection: Selection = { kind: "prop", id: prop.id };
      (item as unknown as { __selection?: Selection }).__selection = selection;
      this.treeItems.set(prop.id, item);
      propNode.append(item);
    }
    this.tree.append(foundationNode);
    this.tree.append(siteNode);
    this.tree.append(roadNode);
    this.tree.append(propNode);
    this.applyOutlineFilter();
    this.syncTreeSelection();
  }

  private syncTreeSelection(): void {
    if (!this.tree) return;
    this.tree.traverse((item) => {
      const selection = (item as unknown as { __selection?: Selection }).__selection;
      const same = Boolean(
        selection && this.selection && selection.kind === this.selection.kind && selection.id === this.selection.id,
      );
      if (same) {
        item.parentsOpen = true;
        if (!item.selected) item.selected = true;
      }
    });
  }

  private renderLibrary(): void {
    this.leftContent.replaceChildren();
    if (this.tool !== "place") return;
    const search = this.query.toLowerCase();
    if (this.libraryTab === "foundation") {
      const host = document.createElement("div");
      let html = '<div class="mlnx-group-label">平台</div><div class="mlnx-library-grid">';
      html += '<button class="mlnx-asset' + (this.activeFoundationKind === "platform" ? " active" : "") + '" data-foundation-kind="platform">平台<small>地面高度</small></button>';
      html += '<button class="mlnx-asset' + (this.activeFoundationKind === "island" ? " active" : "") + '" data-foundation-kind="island">浮空岛<small>抬高平台</small></button>';
      html += "</div>";
      html += '<div class="mlnx-group-label">外形</div><div class="mlnx-library-grid">';
      for (const option of FOUNDATION_SHAPE_OPTIONS) {
        html +=
          '<button class="mlnx-asset' +
          (this.activeFoundationShape === option.id ? " active" : "") +
          '" data-foundation-shape="' +
          option.id +
          '">' +
          option.label +
          "<small>" +
          option.desc +
          "</small></button>";
      }
      html += "</div>";
      if (this.doc.navigation !== "grid") {
        html += '<div class="mlnx-group-label">快速添加</div><div class="mlnx-library-grid">';
        for (const preset of FOUNDATION_PRESETS) {
          html +=
            '<button class="mlnx-asset" data-foundation-preset="' +
            preset.id +
            '">' +
            preset.label +
            "<small>" +
            preset.desc +
            "</small></button>";
        }
        html += "</div>";
      }
      html += '<div class="mlnx-group-label">顶面高度</div>';
      html += '<input class="mlnx-search" id="mlnx-foundation-y" type="number" step="0.5" value="' + this.toolElevation + '" style="height:26px">';
      html += '<p class="mlnx-note">在地图上按住左键拖出矩形。外形会随尺寸拉伸；平台会与相邻地基合并，浮空岛是独立平台。</p>';
      host.innerHTML = html;
      this.leftContent.appendChild(host);
      for (const button of host.querySelectorAll<HTMLElement>("[data-foundation-kind]")) {
        button.addEventListener("click", () => {
          const kind = button.dataset.foundationKind as "platform" | "island" | undefined;
          if (!kind) return;
          this.activeFoundationKind = kind;
          this.toolElevation = kind === "island" ? Math.max(4, this.toolElevation || 12) : 0;
          this.renderLibrary();
        });
      }
      for (const button of host.querySelectorAll<HTMLElement>("[data-foundation-shape]")) {
        button.addEventListener("click", () => {
          const shape = button.dataset.foundationShape as FoundationShape | undefined;
          if (!shape) return;
          this.activeFoundationShape = shape;
          this.renderLibrary();
        });
      }
      for (const button of host.querySelectorAll<HTMLElement>("[data-foundation-preset]")) {
        button.addEventListener("click", () => {
          const preset = FOUNDATION_PRESETS.find((entry) => entry.id === button.dataset.foundationPreset);
          if (preset) this.addFoundationPreset(preset);
        });
      }
      const yInput = host.querySelector<HTMLInputElement>("#mlnx-foundation-y");
      yInput?.addEventListener("change", () => {
        const value = Number(yInput.value);
        if (Number.isFinite(value)) this.toolElevation = Math.max(-50, Math.min(200, value));
      });
      this.renderPackControls();
      return;
    }
    if (this.libraryTab === "site") {
      const kinds = SITE_KIND_OPTIONS;
      const host = document.createElement("div");
      host.className = "mlnx-library-grid";
      let html = "";
      for (const entry of kinds) {
        html += '<button class="mlnx-asset' + (this.activeSiteKind === entry.kind ? " active" : "") + '" data-site-kind="' + entry.kind + '">' + entry.label + "<small>" + entry.desc + "</small></button>";
      }
      host.innerHTML = html;
      this.leftContent.appendChild(host);
      for (const button of host.querySelectorAll<HTMLElement>("[data-site-kind]")) {
        button.addEventListener("click", () => {
          const kind = button.dataset.siteKind as SiteKind | undefined;
          if (!kind) return;
          this.activeSiteKind = kind;
          this.activeAssetId = null;
          this.renderLibrary();
        });
      }
      this.renderPackControls();
      return;
    }
    const kind = this.libraryTab === "decor" ? "prop" : "terrain";
    const assets = assetRegistry
      .list(kind)
      .filter((asset) => !search || asset.label.toLowerCase().includes(search) || asset.id.toLowerCase().includes(search));
    const host = document.createElement("div");
    host.className = "mlnx-library-grid";
    if (assets.length === 0) {
      host.innerHTML = '<div class="mlnx-empty">没有匹配的资产</div>';
    } else {
      let html = "";
      for (const asset of assets.slice(0, 240)) {
        html +=
          '<button class="mlnx-asset' +
          (this.activeAssetId === asset.id ? " active" : "") +
          '" data-asset-id="' +
          escapeHtml(asset.id) +
          '">' +
          escapeHtml(asset.label) +
          "<small>" +
          (asset.source === "pack" ? "资产包" : "内置") +
          "</small></button>";
      }
      host.innerHTML = html;
    }
    this.leftContent.appendChild(host);
    for (const button of host.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.assetId;
        if (!id) return;
        this.activeAssetId = id;
        this.renderLibrary();
      });
    }
    this.renderPackControls();
  }

  private renderPackControls(): void {
    const packRow = document.createElement("div");
    packRow.className = "mlnx-actions-row";
    packRow.innerHTML =
      '<button class="mlnx-btn" id="mlnx-pack-import">导入资产包</button>' +
      '<button class="mlnx-btn" id="mlnx-pack-export">导出内置包</button>';
    this.leftContent.appendChild(packRow);
    packRow.querySelector("#mlnx-pack-import")?.addEventListener("click", () => void this.importAssetPack());
    packRow.querySelector("#mlnx-pack-export")?.addEventListener("click", () => void this.exportBuiltinPack());
    const objRow = document.createElement("div");
    objRow.className = "mlnx-actions-row";
    objRow.innerHTML =
      '<button class="mlnx-btn" id="mlnx-obj-import">导入 OBJ</button>' +
      '<button class="mlnx-btn" id="mlnx-obj-folder">OBJ 文件夹</button>' +
      '<button class="mlnx-btn" id="mlnx-unit-obj">导入单位</button>';
    this.leftContent.appendChild(objRow);
    objRow.querySelector("#mlnx-obj-import")?.addEventListener("click", () => void this.importObj(false));
    objRow.querySelector("#mlnx-obj-folder")?.addEventListener("click", () => void this.importObj(true));
    objRow.querySelector("#mlnx-unit-obj")?.addEventListener("click", () => void this.importObj(false, "unit"));
    const objNote = document.createElement("p");
    objNote.className = "mlnx-note";
    objNote.textContent = "OBJ 会连同 MTL 与贴图一起烘焙成 GLB；按当前标签页导入为装饰/据点/地基/地形，单位在地图设置里导入。";
    this.leftContent.appendChild(objNote);
    const packs = assetRegistry.packList;
    if (packs.length > 0) {
      const list = document.createElement("div");
      list.className = "mlnx-pack-list";
      for (const pack of packs) {
        const row = document.createElement("div");
        row.className = "mlnx-pack-row";
        const label = document.createElement("span");
        label.textContent = pack.name;
        const remove = document.createElement("button");
        remove.textContent = "移除";
        remove.addEventListener("click", () => void this.removeAssetPack(pack.id));
        row.append(label, remove);
        list.appendChild(row);
      }
      this.leftContent.appendChild(list);
    }
  }

  private addFoundationPreset(preset: (typeof FOUNDATION_PRESETS)[number]): void {
    if (this.doc.navigation === "grid") {
      this.notice("网格地图只能保留一块地基，请直接改现有地基的外形");
      return;
    }
    const bounds = documentBounds(this.doc);
    const gap = 30;
    const pos: [number, number] = [bounds.maxX + preset.size[0] / 2 + gap, (bounds.minZ + bounds.maxZ) / 2];
    const result = addFoundation(this.doc, {
      pos,
      size: preset.size,
      elevation: preset.elevation,
      shape: preset.shape,
    });
    this.activeFoundationKind = preset.elevation > 0 ? "island" : "platform";
    this.activeFoundationShape = preset.shape;
    this.toolElevation = preset.elevation;
    this.selection = { kind: "foundation", id: result.foundation.id };
    this.commit(result.document, "已添加" + preset.label, { terrain: true, sites: true });
    this.renderLibrary();
    this.focusSelection();
  }

  private async removeAssetPack(id: string): Promise<void> {
    if (!window.confirm("移除资产包后，使用其中资产的地图会显示缺失。确定移除？")) return;
    await assetRegistry.removePack(id);
    this.renderLibrary();
    this.renderInspector();
    this.scene?.updateProps(this.compiled.visual);
    this.syncProxies();
    this.notice("资产包已移除");
  }

  private async importAssetPack(): Promise<void> {
    const opened = await openAssetPackFile();
    if (!opened) return;
    this.notice("正在导入资产包…");
    try {
      const result = await assetRegistry.loadPack(opened.bytes, { persist: true, fileName: opened.name });
      this.renderLibrary();
      this.notice("已导入 " + result.manifest.name + " · " + result.count + " 个资产");
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "资产包无法读取");
    }
  }

  private async importObj(directory: boolean, forcedKind?: "foundation" | "building" | "terrain" | "prop" | "unit"): Promise<void> {
    const files = await openModelFiles(directory);
    if (files.length === 0) return;
    const kind: "foundation" | "building" | "terrain" | "prop" | "unit" =
      forcedKind ??
      (this.libraryTab === "foundation"
        ? "foundation"
        : this.libraryTab === "site"
          ? "building"
          : this.libraryTab === "terrain"
            ? "terrain"
            : "prop");
    this.notice("正在转换 OBJ…");
    try {
      const result = await convertObjToPack(files, kind);
      const loaded = await assetRegistry.loadPack(result.bytes, { persist: true, fileName: result.fileName });
      if (kind !== "unit") {
        this.activeAssetId = result.assetId;
        this.renderLibrary();
        requestAnimationFrame(() => {
          const active = this.leftContent.querySelector<HTMLElement>(".mlnx-asset.active");
          active?.scrollIntoView({ block: "center" });
        });
      }
      this.scheduleInspectorRender();
      this.notice("已导入 " + result.label + " · " + result.footprint + " × " + result.height + " 米 · " + loaded.count + " 个资产");
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "OBJ 转换失败");
    }
  }

  private scatterFoundation(id: string): void {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
    if (!foundation) return;
    const all = assetRegistry.list("prop");
    const trees = all.filter((asset) => asset.tags.includes("树木"));
    const plants = all.filter((asset) => asset.tags.includes("草木"));
    const rocks = all.filter((asset) => asset.tags.includes("岩石"));
    const pickAsset = () => {
      const roll = Math.random();
      const pool = roll < 0.58 ? trees : roll < 0.78 ? plants : rocks;
      const fallback = pool.length > 0 ? pool : all;
      return fallback[Math.floor(Math.random() * fallback.length)] ?? null;
    };
    const rect = foundationRect(foundation);
    let next = this.doc;
    let added = 0;
    for (let index = 0; index < this.scatterCount; index += 1) {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const x = rect.minX + 15 + Math.random() * Math.max(1, rect.maxX - rect.minX - 30);
        const z = rect.minZ + 15 + Math.random() * Math.max(1, rect.maxZ - rect.minZ - 30);
        if (!foundationContains(foundation, x, z)) continue;
        if (this.roadAtGround(x, z, 4)) continue;
        if (next.sites.some((site) => Math.hypot(site.pos[0] - x, site.pos[1] - z) < 50)) continue;
        const blocked = next.visual.props.some((prop) => {
          const info = assetRegistry.info(prop.assetId);
          const radius = Math.max(12, (info?.footprint ?? 1.5) * prop.scale * 5);
          return Math.hypot(prop.pos[0] - x, prop.pos[1] - z) < radius + 14;
        });
        if (blocked) continue;
        const asset = pickAsset();
        if (!asset) break;
        const result = addProp(
          next,
          asset.id,
          [Math.round(x), Math.round(z)],
          Math.round(Math.random() * 360),
          0.88 + Math.random() * 0.24,
        );
        next = result.document;
        added += 1;
        break;
      }
    }
    if (added === 0) {
      this.notice("这块地基没有足够的空闲位置补景");
      return;
    }
    this.commit(next, "已补景 " + added + " 个装饰", { props: true });
  }

  private async importFoundationMaterial(foundationId: string, directory: boolean): Promise<void> {
    const files = await openTextureFiles(directory);
    if (files.length === 0) return;
    this.notice("正在导入地基贴图…");
    try {
      const record = await saveCustomMaterial(files);
      this.commit(
        updateFoundation(this.doc, foundationId, { material: record.id }),
        "已导入地基材质 " + record.label,
        { terrain: true, sites: true },
      );
      this.scheduleInspectorRender();
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "地基贴图导入失败");
    }
  }

  private async removeFoundationMaterial(foundationId: string): Promise<void> {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === foundationId);
    if (!foundation?.material) return;
    await removeCustomMaterial(foundation.material);
    this.commit(updateFoundation(this.doc, foundationId, { material: undefined }), "已移除自定义地基材质", {
      terrain: true,
      sites: true,
    });
  }

  private async exportBuiltinPack(): Promise<void> {
    try {
      const pack = await buildBuiltinAssetPack();
      const saved = await saveAssetPackFile(pack.bytes, "Marchlands-Builtin-" + pack.count + ".mlpack");
      this.notice(saved ? "已导出 " + pack.count + " 个内置模型" : "已取消导出");
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "内置资产包导出失败");
    }
  }

  private renderRoadPanel(): void {
    this.leftContent.replaceChildren();
    const host = document.createElement("div");
    host.innerHTML =
      '<div class="mlnx-group-label">绘制道路</div>' +
      '<p class="mlnx-note">在地图上点击加点，点据点会自动吸附。Enter 完成，Esc 取消。</p>' +
      '<div class="mlnx-actions-row">' +
      '<button class="mlnx-btn" id="mlnx-road-finish">完成</button>' +
      '<button class="mlnx-btn" id="mlnx-road-cancel">取消</button>' +
      "</div>" +
      '<div class="mlnx-group-label">当前默认宽度</div>' +
      '<div class="mlnx-sub">' + this.doc.visual.roads.width.toFixed(1) + " 米 · 选中道路后在检查器里调整</div>";
    this.leftContent.appendChild(host);
    host.querySelector("#mlnx-road-finish")?.addEventListener("click", () => this.finishRoad());
    host.querySelector("#mlnx-road-cancel")?.addEventListener("click", () => this.cancelRoad());
  }

  private renderTerrainPanel(): void {
    this.leftContent.replaceChildren();
    if (this.doc.navigation !== "grid" || !this.doc.grid) {
      const host = document.createElement("div");
      host.innerHTML =
        '<div class="mlnx-group-label">网格地形</div>' +
        '<p class="mlnx-note">当前是据点图。转换为网格地图后可以用笔刷抬高、压低、刷水与阻挡。</p>' +
        '<label class="mlnx-switch">宽 <input id="mlnx-grid-w" type="number" min="20" max="300" step="5" value="70"></label>' +
        '<label class="mlnx-switch">高 <input id="mlnx-grid-h" type="number" min="20" max="300" step="5" value="70"></label>' +
        '<label class="mlnx-switch">格宽 <select class="mlnx-search" id="mlnx-grid-cell">' +
        '<option value="5">0.5 米</option><option value="10" selected>1 米</option><option value="20">2 米</option><option value="25">2.5 米</option><option value="50">5 米</option>' +
        '</select></label>' +
        '<button class="mlnx-btn" id="mlnx-convert-grid">转换为网格地图</button>' +
        '<button class="mlnx-btn" id="mlnx-new-grid">新建网格地图</button>';
      this.leftContent.appendChild(host);
      host.querySelector("#mlnx-convert-grid")?.addEventListener("click", () => {
        if (!window.confirm("转换为网格地图会创建与地图同心的网格地基，确定继续？")) return;
        const cellInput = host.querySelector<HTMLSelectElement>("#mlnx-grid-cell");
        const cellSizeDm = Math.max(5, Math.round(Number(cellInput?.value) || 10));
        try {
          this.commit(convertToGrid(this.doc, { cellSizeDm }), "已转换为网格地图", { rebuild: true });
        } catch (error) {
          this.notice(error instanceof Error ? error.message : "转换失败");
          return;
        }
        this.setTool("terrain");
        this.notice("已转换为网格地图 · 格宽 " + (cellSizeDm / 10).toFixed(1) + " 米，选择笔刷开始刷地形");
      });
      host.querySelector("#mlnx-new-grid")?.addEventListener("click", () => {
        if (this.dirty && !window.confirm("当前草稿还没保存，确定新建网格地图？")) return;
        const widthInput = host.querySelector<HTMLInputElement>("#mlnx-grid-w");
        const heightInput = host.querySelector<HTMLInputElement>("#mlnx-grid-h");
        const cellInput = host.querySelector<HTMLSelectElement>("#mlnx-grid-cell");
        const cellSizeDm = Math.max(5, Math.round(Number(cellInput?.value) || 10));
        const stepM = cellSizeDm / 10;
        // 地图尺寸必须能被格宽整除：向上取整到一格，免得格子被裁掉半格。
        const rawWidth = Math.max(20, Math.min(300, Number(widthInput?.value) || 70));
        const rawHeight = Math.max(20, Math.min(300, Number(heightInput?.value) || 70));
        const widthM = Math.ceil(rawWidth / stepM) * stepM;
        const heightM = Math.ceil(rawHeight / stepM) * stepM;
        const size: [number, number] = [Math.round(widthM * 10), Math.round(heightM * 10)];
        this.doc = createGridDocument(size, { cellSizeDm });
        this.undoStack = [];
        this.redoStack = [];
        this.selection = null;
        this.dirty = false;
        this.rebuildScene();
        this.renderAll();
        this.setTool("terrain");
        this.notice("已新建网格地图 " + widthM + " × " + heightM + " 米 · 格宽 " + stepM.toFixed(1) + " 米");
      });
      return;
    }
    const brushes: Array<{ id: GridBrushMode; label: string }> = [
      { id: "raise", label: "抬高" },
      { id: "lower", label: "压低" },
      { id: "smooth", label: "平滑" },
      { id: "ramp", label: "坡道" },
      { id: "cliff", label: "悬崖" },
      { id: "water", label: "水面" },
      { id: "surface", label: "地表" },
      { id: "blocker", label: "阻挡" },
      { id: "passable", label: "可走" },
    ];
    const host = document.createElement("div");
    let html = '<div class="mlnx-group-label">笔刷</div><div class="mlnx-library-grid">';
    for (const brush of brushes) {
      html += '<button class="mlnx-asset' + (this.terrainBrush === brush.id ? " active" : "") + '" data-brush="' + brush.id + '">' + brush.label + "</button>";
    }
    html += "</div>";
    html += '<div class="mlnx-group-label">参数</div>';
    html += '<label class="mlnx-switch">半径 <input id="mlnx-brush-radius" type="number" min="1" max="8" step="1" value="' + this.brushRadius + '"></label>';
    html += '<label class="mlnx-switch">强度 <input id="mlnx-brush-strength" type="number" min="5" max="200" step="5" value="' + this.brushStrength + '"></label>';
    html += '<div class="mlnx-group-label">地表</div>';
    html += '<select class="mlnx-search" id="mlnx-surface-brush">' +
      '<option value="0">草地</option><option value="1">泥土</option><option value="2">岩石</option><option value="3">雪地</option></select>';
    const cellMeters = (this.doc.grid.cellSizeDm / 10).toFixed(1);
    html += '<div class="mlnx-group-label">网格</div>';
    html += '<div class="mlnx-sub">格宽 ' + cellMeters + ' 米 · ' + this.doc.grid.width + ' × ' + this.doc.grid.height + ' 格</div>';
    const reachSite = this.reachSite();
    html += '<div class="mlnx-group-label">可达性</div>';
    html += '<label class="mlnx-switch">兵种 <select class="mlnx-search" id="mlnx-reach-unit">' +
      Object.values(UNIT_PROFILES)
        .map((profile) => '<option value="' + profile.kind + '"' + (profile.kind === this.reachUnit ? " selected" : "") + ">" + profile.label + "</option>")
        .join("") +
      '</select></label>';
    html += '<label class="mlnx-switch">出发点 <select class="mlnx-search" id="mlnx-reach-from">' +
      this.doc.sites
        .map((site) => {
          const owner = site.owner === 1 ? "我方" : site.owner === 2 ? "敌方" : "中立";
          return '<option value="' + site.id + '"' + (site.id === reachSite?.id ? " selected" : "") + ">" + site.id + " · " + siteKindLabel(site.kind) + " · " + owner + "</option>";
        })
        .join("") +
      '</select></label>';
    html += '<button class="mlnx-btn" id="mlnx-reach-toggle">' + (this.terrainReachable ? "关闭可达范围" : "显示可达范围") + '</button>';
    html += '<div class="mlnx-actions-row"><button class="mlnx-btn" id="mlnx-terrain-undo">撤销</button><button class="mlnx-btn" id="mlnx-terrain-redo">重做</button></div>';
    html += '<p class="mlnx-note">左键拖动刷地形。坡道先点起点再拖到终点；可达范围按兵种的坡度、地表和建筑阻挡从出发点洪泛，橙色格是出发点。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。</p>';
    host.innerHTML = html;
    this.leftContent.appendChild(host);
    for (const button of host.querySelectorAll<HTMLElement>("[data-brush]")) {
      button.addEventListener("click", () => {
        const brush = button.dataset.brush as GridBrushMode | undefined;
        if (!brush) return;
        this.terrainBrush = brush;
        this.renderTerrainPanel();
      });
    }
    const radius = host.querySelector<HTMLInputElement>("#mlnx-brush-radius");
    radius?.addEventListener("change", () => {
      const value = Number(radius.value);
      if (Number.isFinite(value)) this.brushRadius = Math.max(1, Math.min(8, Math.round(value)));
    });
    const strength = host.querySelector<HTMLInputElement>("#mlnx-brush-strength");
    strength?.addEventListener("change", () => {
      const value = Number(strength.value);
      if (Number.isFinite(value)) this.brushStrength = Math.max(5, Math.min(200, Math.round(value)));
    });
    const surface = host.querySelector<HTMLSelectElement>("#mlnx-surface-brush");
    if (surface) {
      surface.value = String(this.surfaceBrush);
      surface.addEventListener("change", () => {
        this.surfaceBrush = Math.max(0, Math.min(9, Math.round(Number(surface.value) || 0)));
      });
    }
    const reachUnit = host.querySelector<HTMLSelectElement>("#mlnx-reach-unit");
    reachUnit?.addEventListener("change", () => {
      this.reachUnit = reachUnit.value as UnitKind;
      this.updateReachOverlay();
    });
    const reachFrom = host.querySelector<HTMLSelectElement>("#mlnx-reach-from");
    reachFrom?.addEventListener("change", () => {
      this.reachFrom = reachFrom.value;
      this.updateReachOverlay();
    });
    host.querySelector("#mlnx-reach-toggle")?.addEventListener("click", () => {
      this.terrainReachable = !this.terrainReachable;
      this.updateReachOverlay();
      this.renderTerrainPanel();
    });
    host.querySelector("#mlnx-terrain-undo")?.addEventListener("click", () => this.undo());
    host.querySelector("#mlnx-terrain-redo")?.addEventListener("click", () => this.redo());
  }

  private reachSite(): SiteDraft | null {
    const selected = this.reachFrom ? this.doc.sites.find((site) => site.id === this.reachFrom) : undefined;
    return selected ?? this.doc.sites.find((site) => site.owner === 1) ?? this.doc.sites[0] ?? null;
  }

  private clearReachOverlay(): void {
    const mesh = this.reachMesh;
    this.reachMesh = null;
    if (!mesh) return;
    this.editorRoot?.remove(mesh);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }

  /** 按所选兵种和出发点重建可达性叠加；地形改动后重新调用。 */
  private updateReachOverlay(): void {
    this.clearReachOverlay();
    const grid = this.doc.grid;
    if (!this.terrainReachable || !grid || !this.scene || !this.editorRoot) return;
    const site = this.reachSite();
    if (!site) return;
    const map = this.compiled.map;
    const cities = this.preview?.cities ?? [];
    const nav = createUnitNavGrid(map, cities, site.owner, this.reachUnit, site.id);
    if (!nav) return;
    const offsetX = map.size[0] * 5;
    const offsetZ = map.size[1] * 5;
    const start = nav.cellFromWorld(site.pos[0] * 10 + offsetX, site.pos[1] * 10 + offsetZ);
    if (start < 0) return;
    const coverage = nav.clearance(GRID_UNIT_RADIUS_CM);
    if (!nav.isWalkable(start, coverage)) {
      this.notice("出发点对 " + UNIT_PROFILES[this.reachUnit].label + " 不可走");
      return;
    }
    const reachable = floodCells(nav, start, coverage);
    const cellSize = grid.cellSizeDm;
    const halfX = this.doc.size[0] / 2;
    const halfZ = this.doc.size[1] / 2;
    const ground = (x: number, z: number): number => (this.scene?.groundHeight(x, z) ?? 0) + 0.1;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const reachableColor = [0.2, 0.85, 1];
    const originColor = [1, 0.72, 0.3];
    for (let index = 0; index < reachable.length; index += 1) {
      if (reachable[index] !== 1) continue;
      const cx = nav.cellX(index);
      const cz = nav.cellZ(index);
      const x0 = cx * cellSize - halfX;
      const x1 = x0 + cellSize;
      const z0 = cz * cellSize - halfZ;
      const z1 = z0 + cellSize;
      const base = positions.length / 3;
      positions.push(
        x0 / 10, ground(x0, z0), z0 / 10,
        x1 / 10, ground(x1, z0), z0 / 10,
        x0 / 10, ground(x0, z1), z1 / 10,
        x1 / 10, ground(x1, z1), z1 / 10,
      );
      const color = index === start ? originColor : reachableColor;
      for (let corner = 0; corner < 4; corner += 1) colors.push(color[0], color[1], color[2]);
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    if (indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      fog: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = "editor-reach";
    mesh.renderOrder = 6;
    this.editorRoot.add(mesh);
    this.reachMesh = mesh;
  }

  private ensureRampPreview(): THREE.Line {
    if (this.rampPreview) return this.rampPreview;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 160), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineDashedMaterial({
      color: 0xffc46b,
      dashSize: 0.7,
      gapSize: 0.45,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      fog: false,
    });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 7;
    this.editorRoot?.add(line);
    this.rampPreview = line;
    return line;
  }

  private updateRampPreview(cell: [number, number]): void {
    const stroke = this.gridStroke;
    const grid = this.doc.grid;
    if (!stroke || !grid) return;
    const line = this.ensureRampPreview();
    const halfX = this.doc.size[0] / 2;
    const halfZ = this.doc.size[1] / 2;
    const from: [number, number] = [
      (stroke.startCell[0] + 0.5) * grid.cellSizeDm - halfX,
      (stroke.startCell[1] + 0.5) * grid.cellSizeDm - halfZ,
    ];
    const to: [number, number] = [
      (cell[0] + 0.5) * grid.cellSizeDm - halfX,
      (cell[1] + 0.5) * grid.cellSizeDm - halfZ,
    ];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const steps = Math.max(1, Math.min(150, Math.ceil(length / 4)));
    const attribute = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const x = from[0] + (to[0] - from[0]) * t;
      const z = from[1] + (to[1] - from[1]) * t;
      array[index * 3] = x / 10;
      array[index * 3 + 1] = (this.scene?.groundHeight(x, z) ?? 0) + 0.28;
      array[index * 3 + 2] = z / 10;
    }
    line.geometry.setDrawRange(0, steps + 1);
    attribute.needsUpdate = true;
    line.computeLineDistances();
  }

  private clearRampPreview(): void {
    const line = this.rampPreview;
    this.rampPreview = null;
    if (!line) return;
    this.editorRoot?.remove(line);
    line.geometry.dispose();
    (line.material as THREE.Material).dispose();
  }

  private renderInspector(): void {
    this.clearInspector();
    if (!this.selection) {
      this.renderMapInspector();
      return;
    }
    const back = document.createElement("button");
    back.className = "mlnx-map-back";
    back.textContent = "← 地图设置";
    back.addEventListener("click", () => this.select(null));
    this.inspectorEl.appendChild(back);
    if (this.selection.kind === "foundation") this.renderFoundationInspector(this.selection.id);
    else if (this.selection.kind === "site") this.renderSiteInspector(this.selection.id);
    else if (this.selection.kind === "road") this.renderRoadInspector(this.selection.id);
    else this.renderPropInspector(this.selection.id);
  }

  private clearInspector(): void {
    for (const item of this.inspectorTop) {
      try {
        item.destroy?.();
      } catch {
        // ignore
      }
    }
    this.inspectorTop = [];
    this.inspectorEl.replaceChildren();
  }

  private addTop<T extends { destroy?: () => void }>(item: T): T {
    this.inspectorTop.push(item);
    return item;
  }

  private addHeading(title: string, sub: string): void {
    const heading = document.createElement("h3");
    heading.textContent = title;
    const subEl = document.createElement("div");
    subEl.className = "mlnx-sub";
    subEl.textContent = sub;
    this.inspectorEl.appendChild(heading);
    this.inspectorEl.appendChild(subEl);
  }

  private addSection(label: string): void {
    const div = document.createElement("div");
    div.className = "mlnx-sec";
    div.textContent = label;
    this.inspectorEl.appendChild(div);
  }

  private addNumber(
    label: string,
    value: number,
    onChange: (value: number) => void,
    opts: { min?: number; max?: number; step?: number; precision?: number } = {},
  ): NumericInput {
    const input = new NumericInput({
      value,
      min: opts.min,
      max: opts.max,
      step: opts.step ?? 0.5,
      precision: opts.precision ?? 1,
    });
    input.input.addEventListener("change", () => onChange(input.value));
    const group = new LabelGroup({ text: label, field: input });
    this.inspectorEl.appendChild(group.dom);
    this.addTop(group);
    return input;
  }

  private addSelect(
    label: string,
    value: string | number,
    options: Array<{ t: string; v: string | number }>,
    onChange: (value: string | number) => void,
  ): SelectInput {
    const input = new SelectInput({ options, defaultValue: value });
    input.on("change", (next: unknown) => onChange(next as string | number));
    const group = new LabelGroup({ text: label, field: input });
    this.inspectorEl.appendChild(group.dom);
    this.addTop(group);
    return input;
  }

  private addText(label: string, value: string, onChange: (value: string) => void): TextInput {
    const input = new TextInput({ value });
    input.input.addEventListener("change", () => onChange(input.value));
    const group = new LabelGroup({ text: label, field: input });
    this.inspectorEl.appendChild(group.dom);
    this.addTop(group);
    return input;
  }

  private textureMaterialOptions(): Array<{ t: string; v: string }> {
    const options: Array<{ t: string; v: string }> = [
      { t: "岩石 · rocks007", v: "rocks007" },
      { t: "泥土 · ground068", v: "ground068" },
      { t: "雪地 · snow014", v: "snow014" },
    ];
    for (const record of customMaterialList()) options.push({ t: "自定义 · " + record.label, v: record.id });
    return options;
  }

  private addButton(label: string, onClick: () => void): Button {
    const button = new Button({ text: label });
    button.on("click", onClick);
    this.inspectorEl.appendChild(button.dom);
    this.addTop(button);
    return button;
  }

  private renderMapInspector(): void {
    this.addHeading(this.doc.name || "地图设置", this.doc.sites.length + " 个据点 · " + this.doc.visual.props.length + " 个装饰 · " + this.doc.visual.foundations.length + " 块地基");
    this.addSection("地图");
    this.addText("名称", this.doc.name, (value) => {
      this.commit(updateDocument(this.doc, { name: value.trim() || "未命名地图" }), "已修改地图名称");
    });
    const bounds = documentBounds(this.doc);
    const meta = document.createElement("div");
    meta.className = "mlnx-sub";
    meta.textContent = "范围 " + ((bounds.maxX - bounds.minX) / 10).toFixed(1) + " × " + ((bounds.maxZ - bounds.minZ) / 10).toFixed(1) + " 米 · 由地基决定";
    this.inspectorEl.appendChild(meta);
    this.addSection("对局");
    const timeObjective = this.doc.objectives.find((objective) => objective.type === "time_limit");
    const timeMinutes = Math.max(1, Math.round((timeObjective?.ticks ?? 18000) / 1200));
    this.addNumber(
      "对局时间（分钟）",
      timeMinutes,
      (value) => {
        const ticks = Math.max(1, Math.round(value)) * 1200;
        const objectives = [
          ...this.doc.objectives.filter((objective) => objective.type !== "time_limit"),
          { type: "time_limit", ticks },
        ];
        this.commit(updateDocument(this.doc, { objectives }), "已修改对局时间");
      },
      { min: 1, max: 180, step: 1, precision: 0 },
    );
    this.addNumber(
      "起始金币",
      this.doc.startGold ?? 0,
      (value) => this.commit(updateDocument(this.doc, { startGold: Math.max(0, Math.round(value)) }), "已修改起始金币"),
      { min: 0, max: 99999, step: 1, precision: 0 },
    );
    this.addButton(`敌对兵团交战：${this.doc.squadCombat ? "开" : "关"}`, () => {
      this.commit(
        updateDocument(this.doc, { squadCombat: !this.doc.squadCombat }),
        "已切换敌对兵团交战",
      );
      this.renderInspector();
    });
    const climb = this.doc.climbCm ?? 60;
    this.addNumber(
      "坡度上限（厘米/格）",
      climb,
      (value) => {
        const next = Math.max(10, Math.min(200, Math.round(value)));
        this.commit(updateDocument(this.doc, { climbCm: next }), "已修改坡度上限", { rebuild: true });
      },
      { min: 10, max: 200, step: 5, precision: 0 },
    );
    const climbNote = document.createElement("div");
    climbNote.className = "mlnx-sub";
    climbNote.textContent = `每米最多爬 ${climb} 厘米，约 ${(Math.atan(climb / 100) * 180 / Math.PI).toFixed(1)}°；黄色格超过该坡度`;
    this.inspectorEl.appendChild(climbNote);
    this.addButton(`地形通行显示：${this.terrainPassability ? "开" : "关"}`, () => {
      this.terrainPassability = !this.terrainPassability;
      this.scene?.setNavPreview(this.terrainPassability);
      this.renderInspector();
    });
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error").length;
    const warnings = this.compiled.diagnostics.filter((entry) => entry.severity === "warning").length;
    const diagnostics = document.createElement("div");
    diagnostics.className = "mlnx-note";
    diagnostics.textContent = errors > 0 ? errors + " 个错误 · " + warnings + " 个警告" : warnings > 0 ? "可试玩 · " + warnings + " 个警告" : "地图有效";
    this.inspectorEl.appendChild(diagnostics);
  }

  private renderFoundationInspector(id: string): void {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
    if (!foundation) {
      this.selection = null;
      this.renderInspector();
      return;
    }
    const rect = foundationRect(foundation);
    const width = (rect.maxX - rect.minX) / 10;
    const depth = (rect.maxZ - rect.minZ) / 10;
    const thickness = foundationDepth(foundation);
    this.addHeading(
      "地基 " + foundation.id,
      "范围 " + (rect.minX / 10).toFixed(1) + ", " + (rect.minZ / 10).toFixed(1) + " → " + (rect.maxX / 10).toFixed(1) + ", " + (rect.maxZ / 10).toFixed(1) + " 米",
    );
    this.addSection("位置");
    this.addNumber(
      "X",
      foundation.pos[0] / 10,
      (value) =>
        this.commit(
          this.moveFoundationContents(id, [Math.round(value * 10), foundation.pos[1]]),
          "已移动地基",
          { terrain: true, sites: true, roads: true, props: true },
        ),
      { step: 0.5 },
    );
    this.addNumber(
      "Y",
      foundation.elevation,
      (value) => this.commit(updateFoundation(this.doc, id, { elevation: value }), "已调整地基高度", { terrain: true, sites: true }),
      { step: 0.5, min: -20, max: 200 },
    );
    this.addNumber(
      "Z",
      foundation.pos[1] / 10,
      (value) =>
        this.commit(
          this.moveFoundationContents(id, [foundation.pos[0], Math.round(value * 10)]),
          "已移动地基",
          { terrain: true, sites: true, roads: true, props: true },
        ),
      { step: 0.5 },
    );
    this.addSection("尺寸");
    this.addNumber(
      "宽",
      width,
      (value) => {
        const size = Math.max(2, value);
        const nextRect = { minX: rect.minX, maxX: rect.minX + size * 10, minZ: rect.minZ, maxZ: rect.maxZ };
        this.commit(
          updateFoundation(this.doc, id, {
            pos: [(nextRect.minX + nextRect.maxX) / 2, foundation.pos[1]],
            size: [nextRect.maxX - nextRect.minX, nextRect.maxZ - nextRect.minZ],
          }),
          "已调整地基宽度",
          { terrain: true, sites: true },
        );
      },
      { step: 0.5, min: 2, max: 400 },
    );
    this.addNumber(
      "深",
      depth,
      (value) => {
        const size = Math.max(2, value);
        const nextRect = { minX: rect.minX, maxX: rect.maxX, minZ: rect.minZ, maxZ: rect.minZ + size * 10 };
        this.commit(
          updateFoundation(this.doc, id, {
            pos: [foundation.pos[0], (nextRect.minZ + nextRect.maxZ) / 2],
            size: [nextRect.maxX - nextRect.minX, nextRect.maxZ - nextRect.minZ],
          }),
          "已调整地基深度",
          { terrain: true, sites: true },
        );
      },
      { step: 0.5, min: 2, max: 400 },
    );
    this.addNumber(
      "厚",
      thickness,
      (value) => this.commit(updateFoundation(this.doc, id, { depth: Math.max(2, Math.min(200, value)) }), "已调整地基厚度", { terrain: true, sites: true }),
      { step: 1, min: 2, max: 200 },
    );
    this.addSection("扩建");
    const actions = document.createElement("div");
    actions.className = "mlnx-actions-row";
    const expand = (dx: number, dz: number, label: string): HTMLButtonElement => {
      const button = document.createElement("button");
      button.className = "mlnx-btn";
      button.textContent = label;
      button.addEventListener("click", () => {
        const nextRect = {
          minX: rect.minX + Math.min(0, dx),
          maxX: rect.maxX + Math.max(0, dx),
          minZ: rect.minZ + Math.min(0, dz),
          maxZ: rect.maxZ + Math.max(0, dz),
        };
        this.commit(
          updateFoundation(this.doc, id, {
            pos: [(nextRect.minX + nextRect.maxX) / 2, (nextRect.minZ + nextRect.maxZ) / 2],
            size: [nextRect.maxX - nextRect.minX, nextRect.maxZ - nextRect.minZ],
          }),
          "已扩展地基",
          { terrain: true, sites: true },
        );
      });
      return button;
    };
    actions.append(expand(100, 0, "东 +10m"), expand(-100, 0, "西 +10m"), expand(0, -100, "北 +10m"), expand(0, 100, "南 +10m"));
    this.inspectorEl.appendChild(actions);
    this.addSection("地貌");
    this.addSelect(
      "风格",
      foundation.terrainStyle ?? "__none__",
      [
        { t: "跟随地图", v: "__none__" },
        { t: "边境", v: "frontier" },
        { t: "草原", v: "meadow" },
        { t: "秋林", v: "autumn" },
        { t: "灰烬", v: "ash" },
        { t: "海岸", v: "coast" },
        { t: "雪原", v: "snow" },
      ],
      (value) =>
        this.commit(
          updateFoundation(this.doc, id, { terrainStyle: value === "__none__" ? undefined : (value as never) }),
          value === "__none__" ? "已跟随地图地貌" : "已修改地基地貌",
          { terrain: true, sites: true },
        ),
    );
    this.addNumber(
      "种子",
      foundation.terrainSeed ?? this.doc.visual.terrain.seed,
      (value) =>
        this.commit(updateFoundation(this.doc, id, { terrainSeed: Math.round(value) }), "已修改地基种子", {
          terrain: true,
          sites: true,
        }),
      { step: 1, precision: 0 },
    );
    this.addNumber(
      "起伏",
      foundation.terrainAmplitude ?? this.doc.visual.terrain.amplitude,
      (value) =>
        this.commit(updateFoundation(this.doc, id, { terrainAmplitude: value }), "已修改地基起伏", {
          terrain: true,
          sites: true,
        }),
      { min: 0.2, max: 1.5, step: 0.1 },
    );
    this.addSelect(
      "地表材质",
      foundation.material ?? "__none__",
      [{ t: "跟随地图材质", v: "__none__" }, ...this.textureMaterialOptions()],
      (value) =>
        this.commit(
          updateFoundation(this.doc, id, { material: value === "__none__" ? undefined : String(value) }),
          value === "__none__" ? "已跟随地图材质" : "已更换地基材质",
          { terrain: true, sites: true },
        ),
    );
    const materialRow = document.createElement("div");
    materialRow.className = "mlnx-actions-row";
    materialRow.innerHTML =
      '<button class="mlnx-btn" id="mlnx-foundation-material">导入贴图材质</button>' +
      '<button class="mlnx-btn" id="mlnx-foundation-material-folder">贴图文件夹</button>';
    this.inspectorEl.appendChild(materialRow);
    materialRow.querySelector("#mlnx-foundation-material")?.addEventListener("click", () => void this.importFoundationMaterial(id, false));
    materialRow.querySelector("#mlnx-foundation-material-folder")?.addEventListener("click", () => void this.importFoundationMaterial(id, true));
    if (foundation.material?.startsWith("custom.")) {
      const removeMaterial = document.createElement("button");
      removeMaterial.className = "mlnx-delete";
      removeMaterial.textContent = "移除当前自定义材质";
      removeMaterial.addEventListener("click", () => void this.removeFoundationMaterial(id));
      this.inspectorEl.appendChild(removeMaterial);
    }
    const terrainNote = document.createElement("p");
    terrainNote.className = "mlnx-note";
    terrainNote.textContent = "地貌只影响这块地基；选“跟随地图”时使用地图默认。";
    this.inspectorEl.appendChild(terrainNote);
    this.addSection("外壳");
    this.addSelect(
      "外形",
      foundation.shape ?? "plateau",
      FOUNDATION_SHAPE_OPTIONS.map((option) => ({ t: option.label + " · " + option.desc, v: option.id })),
      (value) =>
        this.commit(
          updateFoundation(this.doc, id, { shape: value as FoundationShape }),
          "已更换地基外形",
          { terrain: true, sites: true },
        ),
    );
    const assets = assetRegistry
      .list("foundation")
      .filter((asset) => asset.source === "pack" || asset.id === foundation.assetId);
    const shellOptions: Array<{ t: string; v: string }> = [{ t: "程序化浮岛", v: "__none__" }];
    for (const asset of assets) shellOptions.push({ t: asset.label, v: asset.id });
    this.addSelect(
      "GLB 外壳",
      foundation.assetId ?? "__none__",
      shellOptions,
      (value) => this.commit(updateFoundation(this.doc, id, { assetId: value === "__none__" ? null : String(value) }), value === "__none__" ? "已恢复程序化浮岛" : "已设置外壳", { terrain: true, sites: true }),
    );
    this.addSection("补景");
    this.addNumber(
      "每次数量",
      this.scatterCount,
      (value) => {
        this.scatterCount = Math.max(1, Math.min(30, Math.round(value)));
        this.scheduleInspectorRender();
      },
      { min: 1, max: 30, step: 1, precision: 0 },
    );
    this.addButton("补景（" + this.scatterCount + " 个）", () => this.scatterFoundation(id));
    const scatterNote = document.createElement("p");
    scatterNote.className = "mlnx-note";
    scatterNote.textContent = "每次点击都会在这块地基的空闲位置放置真实装饰，可选中、移动和删除；点一次补一批，不会固定生成。";
    this.inspectorEl.appendChild(scatterNote);
    if (foundation.assetId) {
      this.addNumber(
        "外壳缩放",
        foundation.scale,
        (value) => this.commit(updateFoundation(this.doc, id, { scale: value }), "已调整外壳缩放", { terrain: true, sites: true }),
        { min: 0.01, max: 50, step: 0.05 },
      );
      this.addNumber(
        "外壳朝向",
        foundation.rotation,
        (value) => this.commit(updateFoundation(this.doc, id, { rotation: value }), "已调整外壳朝向", { terrain: true, sites: true }),
        { step: 5, precision: 0 },
      );
      const shellNote = document.createElement("p");
      shellNote.className = "mlnx-note";
      shellNote.textContent = "当前使用模型外壳；贴图只对程序化浮岛生效，切回“程序化浮岛”后可见。";
      this.inspectorEl.appendChild(shellNote);
    }
    this.addButton("复制地基", () => {
      const result = duplicateFoundation(this.doc, id);
      if (!result) return;
      this.selection = { kind: "foundation", id: result.foundation.id };
      this.commit(result.document, "已复制地基", { terrain: true, sites: true });
    });
    this.addButton("镜头对准", () => this.focusSelection());
    const deleteButton = document.createElement("button");
    deleteButton.className = "mlnx-delete";
    deleteButton.textContent = "删除这块地基";
    deleteButton.addEventListener("click", () => {
      if (this.doc.visual.foundations.length <= 1) {
        this.notice("至少保留一块地基");
        return;
      }
      const next = removeFoundation(this.doc, id);
      this.selection = null;
      this.commit(next, "已删除地基", { terrain: true, sites: true });
    });
    this.inspectorEl.appendChild(deleteButton);
    const note = document.createElement("p");
    note.className = "mlnx-note";
    note.textContent = "拖动视口中的 XYZ 手柄移动或抬高；扩建按钮用于向右、左、北、南扩展地图。";
    this.inspectorEl.appendChild(note);
  }

  private renderSiteInspector(id: string): void {
    const site = this.doc.sites.find((entry) => entry.id === id);
    if (!site) {
      this.selection = null;
      this.renderInspector();
      return;
    }
    const kind = siteKindLabel(site.kind);
    this.addHeading(site.id, kind + " · 坐标 " + (site.pos[0] / 10).toFixed(1) + ", " + (site.pos[1] / 10).toFixed(1));
    this.addSection("位置");
    this.addNumber("X", site.pos[0] / 10, (value) => this.commit(updateSite(this.doc, id, { pos: [Math.round(value * 10), site.pos[1]] }), "已移动据点", { sites: true }), { step: 0.5 });
    this.addNumber("Z", site.pos[1] / 10, (value) => this.commit(updateSite(this.doc, id, { pos: [site.pos[0], Math.round(value * 10)] }), "已移动据点", { sites: true }), { step: 0.5 });
    this.addSection("据点");
    this.addSelect(
      "类型",
      site.kind,
      SITE_KIND_OPTIONS.map((entry) => ({ t: entry.label + " · " + entry.desc, v: entry.kind })),
      (value) => this.commit(updateSite(this.doc, id, { kind: value as SiteKind }), "已修改据点类型", { sites: true }),
    );
    this.addSelect(
      "归属",
      site.owner,
      [
        { t: "中立", v: 0 },
        { t: "绿方", v: 1 },
        { t: "红方", v: 2 },
      ],
      (value) => this.commit(updateSite(this.doc, id, { owner: Number(value) as 0 | 1 | 2 }), "已修改归属", { sites: true }),
    );
    if (isProductionSiteKind(site.kind)) {
      if (isUpgradableSiteKind(site.kind)) {
        this.addSelect(
          "等级",
          site.level,
          [
            { t: "L1", v: 1 },
            { t: "L2", v: 2 },
            { t: "L3", v: 3 },
          ],
          (value) => this.commit(updateSite(this.doc, id, { level: Number(value) as 1 | 2 | 3 }), "已修改等级", { sites: true }),
        );
      } else {
        const note = document.createElement("p");
        note.className = "mlnx-note";
        note.textContent = "法师塔固定 L1 · 不可升级";
        this.inspectorEl.appendChild(note);
      }
      this.addNumber("驻军", site.pop, (value) => this.commit(updateSite(this.doc, id, { pop: Math.max(0, Math.round(value)) }), "已修改驻军", { sites: true }), { min: 0, max: 999, step: 1, precision: 0 });
    }
    this.addSection("外观");
    const buildings = assetRegistry.list("building");
    const buildingOptions: Array<{ t: string; v: string }> = [{ t: "默认外观", v: "__none__" }];
    for (const building of buildings) buildingOptions.push({ t: building.label, v: building.id });
    this.addSelect(
      "模型",
      site.visualAssetId ?? "__none__",
      buildingOptions,
      (value) =>
        this.commit(
          updateSite(this.doc, id, { visualAssetId: value === "__none__" ? undefined : String(value) }),
          "已修改据点外观",
          { sites: true },
        ),
    );
    this.addNumber(
      "朝向",
      site.visualRotation ?? 0,
      (value) => this.commit(updateSite(this.doc, id, { visualRotation: Math.round(value) }), "已调整据点朝向", { sites: true }),
      { step: 15, precision: 0 },
    );
    this.addNumber(
      "俯仰 X",
      site.visualRotationX ?? 0,
      (value) => this.commit(updateSite(this.doc, id, { visualRotationX: Math.round(value) }), "已调整据点俯仰", { sites: true }),
      { step: 15, precision: 0 },
    );
    this.addNumber(
      "侧倾 Z",
      site.visualRotationZ ?? 0,
      (value) => this.commit(updateSite(this.doc, id, { visualRotationZ: Math.round(value) }), "已调整据点侧倾", { sites: true }),
      { step: 15, precision: 0 },
    );
    this.addNumber(
      "缩放",
      site.visualScale ?? 1,
      (value) => this.commit(updateSite(this.doc, id, { visualScale: Math.max(0.1, Math.min(10, value)) }), "已调整据点缩放", { sites: true }),
      { min: 0.1, max: 10, step: 0.1 },
    );
    if (site.kind === "outpost") {
      this.addSection("驻兵点");
      this.addSelect(
        "状态",
        site.stance ?? "evade",
        [
          { t: "避战", v: "evade" },
          { t: "迎战", v: "engage" },
        ],
        (value) => this.commit(updateSite(this.doc, id, { stance: value as "evade" | "engage" }), "已修改驻守状态", { sites: true }),
      );
      const candidates = watchCandidates(this.doc, id);
      const watchValue = site.watch ? site.watch[0] + "|" + site.watch[1] : "__none__";
      const watchOptions: Array<{ t: string; v: string }> = [{ t: "未设置", v: "__none__" }];
      for (const road of candidates) watchOptions.push({ t: road.from + " ↔ " + road.to, v: road.from + "|" + road.to });
      this.addSelect("监视道路", watchValue, watchOptions, (value) => {
        if (value === "__none__") {
          this.commit(updateSite(this.doc, id, { watch: undefined }), "已清除监视道路", { sites: true });
          return;
        }
        const parts = String(value).split("|");
        if (parts.length === 2) {
          this.commit(updateSite(this.doc, id, { watch: [parts[0], parts[1]] }), "已设置监视道路", { sites: true });
        }
      });
    }
    this.addSection("通行");
    this.addSelect(
      "未占领时",
      site.transit ?? (this.doc.transit === "open" ? "open" : "closed"),
      [
        { t: "开放通行", v: "open" },
        { t: "禁止通行", v: "closed" },
      ],
      (value) =>
        this.commit(
          updateSite(this.doc, id, { transit: value as "open" | "closed" }),
          "已修改通行规则",
          { sites: true },
        ),
    );
    const transitNote = document.createElement("p");
    transitNote.className = "mlnx-note";
    transitNote.textContent = "该规则只在建筑中立时生效；被任意一方占领后自动变为友方通行。";
    this.inspectorEl.appendChild(transitNote);
    const deleteButton = document.createElement("button");
    deleteButton.className = "mlnx-delete";
    deleteButton.textContent = "删除这个据点";
    deleteButton.addEventListener("click", () => {
      this.selection = null;
      this.commit(removeSite(this.doc, id), "已删除据点", { sites: true });
    });
    this.inspectorEl.appendChild(deleteButton);
  }

  private renderRoadInspector(id: string): void {
    const road = this.doc.roads.find((entry) => entry.id === id);
    if (!road) {
      this.selection = null;
      this.renderInspector();
      return;
    }
    const points = road.path ?? [];
    const ends = road.from && road.to ? road.from + " ↔ " + road.to : road.from ? road.from + " → 自由端点" : road.to ? "自由端点 → " + road.to : "自由道路";
    this.addHeading("道路 " + road.id, ends + " · " + points.length + " 个控制点");
    this.addSection("道路");
    this.addSelect(
      "全图风格",
      this.doc.visual.roads.style,
      [
        { t: "石板", v: "cobble" },
        { t: "土路", v: "dirt" },
      ],
      (value) => this.commit(updateRoadVisual(this.doc, { style: value as never }), "已修改道路风格", { roads: true }),
    );
    this.addNumber(
      "本路宽度",
      (road.widthDm ?? this.doc.visual.roads.width * 10) / 10,
      (value) => this.commit(updateRoad(this.doc, id, { widthDm: Math.round(Math.max(0.6, Math.min(6, value)) * 10) }), "已修改道路宽度", { roads: true }),
      { min: 0.6, max: 6, step: 0.1 },
    );
    this.addNumber(
      "其他路默认宽度",
      this.doc.visual.roads.width,
      (value) => this.commit(updateRoadVisual(this.doc, { width: Math.max(0.6, Math.min(6, value)) }), "已修改默认道路宽度", { roads: true }),
      { min: 0.6, max: 6, step: 0.1 },
    );
    this.addButton("反向", () => {
      const next = cloneDocument(this.doc);
      const target = next.roads.find((entry) => entry.id === id);
      if (!target) return;
      const from = target.from;
      target.from = target.to;
      target.to = from;
      if (target.path) target.path.reverse();
      this.commit(next, "已反转道路", { roads: true });
    });
    if (road.path && road.path.length >= 2) {
      this.addButton("末尾加点", () => this.appendRoadPoint(id));
      this.addButton("删除末点", () => this.removeLastRoadPoint(id));
    }
    if (road.from && road.to && road.path) {
      this.addButton("拉直", () => this.commit(updateRoad(this.doc, id, { path: undefined }), "已拉直道路", { roads: true }));
    }
    const deleteButton = document.createElement("button");
    deleteButton.className = "mlnx-delete";
    deleteButton.textContent = "删除这条道路";
    deleteButton.addEventListener("click", () => {
      this.selection = null;
      this.commit(removeRoad(this.doc, id), "已删除道路", { roads: true });
    });
    this.inspectorEl.appendChild(deleteButton);
    const note = document.createElement("p");
    note.className = "mlnx-note";
    note.textContent = "选中后拖动控制点改线；这里可以改本路宽度、全图风格和其他路默认宽度；末尾加点/删除末点也在检查器里。";
    this.inspectorEl.appendChild(note);
  }

  private renderPropInspector(id: string): void {
    const prop = this.doc.visual.props.find((entry) => entry.id === id);
    if (!prop) {
      this.selection = null;
      this.renderInspector();
      return;
    }
    const info = assetRegistry.info(prop.assetId);
    this.addHeading(prop.id, (info?.label ?? "未知装饰") + " · " + (info?.source === "pack" ? "资产包" : "内置"));
    this.addSection("位置");
    this.addNumber("X", prop.pos[0] / 10, (value) => this.commit(updateProp(this.doc, id, { pos: [Math.round(value * 10), prop.pos[1]] }), "已移动装饰", { props: true }), { step: 0.5 });
    this.addNumber("Z", prop.pos[1] / 10, (value) => this.commit(updateProp(this.doc, id, { pos: [prop.pos[0], Math.round(value * 10)] }), "已移动装饰", { props: true }), { step: 0.5 });
    this.addSection("外观");
    this.addNumber("朝向", prop.rotation, (value) => this.commit(updateProp(this.doc, id, { rotation: Math.round(value) }), "已调整朝向", { props: true }), { step: 15, precision: 0 });
    this.addNumber("缩放", prop.scale, (value) => this.commit(updateProp(this.doc, id, { scale: Math.max(0.1, Math.min(10, value)) }), "已调整缩放", { props: true }), { min: 0.1, max: 10, step: 0.1 });
    const deleteButton = document.createElement("button");
    deleteButton.className = "mlnx-delete";
    deleteButton.textContent = "删除这个装饰";
    deleteButton.addEventListener("click", () => {
      this.selection = null;
      this.commit(removeProp(this.doc, id), "已删除装饰", { props: true });
    });
    this.inspectorEl.appendChild(deleteButton);
  }

  private updateOrbitButtons(): void {
    if (!this.orbit) return;
    const leftPan = this.tool === "select" || this.tool === "move";
    this.orbit.mouseButtons = {
      LEFT: leftPan ? THREE.MOUSE.PAN : null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    } as unknown as typeof this.orbit.mouseButtons;
  }

  private setTool(tool: NextTool): void {
    if (this.gridStroke && tool !== "terrain") this.finishGridStroke();
    if (this.roadDraw && tool !== "road") this.cancelRoad();
    this.tool = tool;
    this.updateOrbitButtons();
    for (const button of document.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.classList.toggle("active", button.dataset.tool === tool);
    }
    this.renderLeftPanel();
    if (tool === "road" || tool === "terrain") {
      this.gizmo?.detach();
      this.selectedProxy = null;
    } else {
      this.attachGizmo();
    }
    this.syncFoundationHandles();
    this.syncRoadHandles();
    this.syncRoadSelection();
    this.canvas.style.cursor = tool === "place" || tool === "road" || tool === "terrain" ? "crosshair" : "default";
    if (this.selection?.kind === "foundation" && (tool === "rotate" || tool === "scale")) {
      this.notice("地基的尺寸和朝向用右侧检查器修改");
    }
    if (this.selection?.kind === "site" && tool === "scale") {
      this.notice("据点不支持缩放");
    }
    this.updateViewInfo();
  }

  private select(selection: Selection): void {
    this.selection = selection;
    this.scene?.setSelected(selection?.kind === "site" ? (selection.id as CityId) : null);
    this.attachGizmo();
    this.syncFoundationHandles();
    this.syncRoadHandles();
    this.syncRoadSelection();
    this.syncTreeSelection();
    this.renderInspector();
    this.updateStatus();
    this.updateViewInfo();
  }

  private findProxy(selection: Selection): THREE.Object3D | null {
    if (!selection) return null;
    const found = this.proxies.find((proxy) => {
      const data = proxy.userData as { kind?: string; id?: string };
      return data.kind === selection.kind && data.id === selection.id;
    });
    return found ?? null;
  }

  private moveFoundationContents(
    id: string,
    nextPos: [number, number],
  ): MapDocument {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
    if (!foundation) return this.doc;
    const dx = Math.round(nextPos[0]) - foundation.pos[0];
    const dz = Math.round(nextPos[1]) - foundation.pos[1];
    const next = cloneDocument(this.doc);
    if (dx !== 0 || dz !== 0) {
      const contains = (x: number, z: number): boolean => foundationContains(foundation, x, z);
      next.sites = next.sites.map((site) =>
        contains(site.pos[0], site.pos[1])
          ? { ...site, pos: [site.pos[0] + dx, site.pos[1] + dz] as [number, number] }
          : site,
      );
      next.visual.props = next.visual.props.map((prop) =>
        contains(prop.pos[0], prop.pos[1])
          ? { ...prop, pos: [prop.pos[0] + dx, prop.pos[1] + dz] as [number, number] }
          : prop,
      );
      next.roads = next.roads.map((road) =>
        road.path
          ? {
              ...road,
              path: road.path.map((point) =>
                contains(point[0], point[1])
                  ? ([point[0] + dx, point[1] + dz] as [number, number])
                  : point,
              ),
            }
          : road,
      );
    }
    return updateFoundation(next, id, { pos: [Math.round(nextPos[0]), Math.round(nextPos[1])] });
  }

  private attachGizmo(): void {
    const gizmo = this.gizmo;
    if (!gizmo) return;
    gizmo.detach();
    this.selectedProxy = this.findProxy(this.selection);
    if (!this.selectedProxy) return;
    gizmo.attach(this.selectedProxy);
    if (this.selection?.kind === "foundation") {
      gizmo.setMode("translate");
      gizmo.showX = true;
      gizmo.showY = true;
      gizmo.showZ = true;
    } else {
      const siteSelection = this.selection?.kind === "site";
      const mode = this.tool === "rotate" ? "rotate" : this.tool === "scale" && !siteSelection ? "scale" : "translate";
      gizmo.setMode(mode);
      gizmo.showX = true;
      gizmo.showY = mode !== "translate";
      gizmo.showZ = true;
    }
  }

  private commitGizmo(): void {
    const selection = this.selection;
    const proxy = this.selectedProxy;
    if (!selection || !proxy) return;
    if (selection.kind === "foundation") {
      const foundation = this.doc.visual.foundations.find((entry) => entry.id === selection.id);
      if (!foundation) return;
      const thickness = foundationDepth(foundation);
      const pos: [number, number] = [snapDm(proxy.position.x * 10), snapDm(proxy.position.z * 10)];
      const elevation = Math.round((proxy.position.y + thickness / 2) * 10) / 10;
      const moved = this.moveFoundationContents(selection.id, pos);
      this.commit(updateFoundation(moved, selection.id, { elevation }), "已移动地基", {
        terrain: true,
        sites: true,
        roads: true,
        props: true,
      });
      return;
    }
    if (selection.kind === "site") {
      const pos: [number, number] = [snapDm(proxy.position.x * 10), snapDm(proxy.position.z * 10)];
      const patch: {
        pos: [number, number];
        visualRotation?: number;
        visualRotationX?: number;
        visualRotationZ?: number;
      } = { pos };
      if (this.tool === "rotate") {
        const degrees = (radians: number): number =>
          ((Math.round((radians * 180) / Math.PI) % 360) + 360) % 360;
        const euler = new THREE.Euler().setFromQuaternion(proxy.quaternion, "YXZ");
        patch.visualRotation = degrees(euler.y);
        patch.visualRotationX = degrees(euler.x);
        patch.visualRotationZ = degrees(euler.z);
      }
      this.commit(updateSite(this.doc, selection.id, patch), "已更新据点", { sites: true });
      return;
    }
    if (selection.kind === "prop") {
      const pos: [number, number] = [snapDm(proxy.position.x * 10), snapDm(proxy.position.z * 10)];
      if (this.roadAtGround(pos[0], pos[1])) {
        this.notice("道路上方不能放置装饰");
        this.syncProxies();
        return;
      }
      const patch: Partial<PropDraft> = { pos };
      if (this.tool === "rotate") {
        patch.rotation = ((Math.round((proxy.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
      }
      if (this.tool === "scale") {
        const prop = this.doc.visual.props.find((entry) => entry.id === selection.id);
        if (prop) patch.scale = Math.max(0.1, Math.min(10, prop.scale * proxy.scale.x));
      }
      this.commit(updateProp(this.doc, selection.id, patch), "已更新装饰", { props: true });
    }
  }

  private syncProxies(): void {
    if (!this.proxyRoot) return;
    for (const child of [...this.proxyRoot.children]) {
      this.proxyRoot.remove(child);
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    this.proxies.length = 0;
    for (const foundation of this.doc.visual.foundations) {
      const rect = foundationRect(foundation);
      const width = (rect.maxX - rect.minX) / 10;
      const depth = (rect.maxZ - rect.minZ) / 10;
      const thickness = foundationDepth(foundation);
      const fill = new THREE.MeshBasicMaterial({
        color: 0xc6a36a,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const edge = new THREE.LineBasicMaterial({ color: 0xc6a36a, transparent: true, opacity: 0.45 });
      const box = new THREE.Mesh(new THREE.BoxGeometry(width, thickness, depth), fill);
      box.position.set(foundation.pos[0] / 10, foundation.elevation + 0.02 - thickness / 2, foundation.pos[1] / 10);
      box.renderOrder = 3;
      box.userData = { kind: "foundation", id: foundation.id };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box.geometry), edge);
      box.add(edges);
      this.proxyRoot.add(box);
      this.proxies.push(box);
    }
    for (const site of this.doc.sites) {
      const height = this.scene?.groundHeight(site.pos[0], site.pos[1]) ?? 0;
      const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 6, 8), material);
      proxy.position.set(site.pos[0] / 10, height + 3, site.pos[1] / 10);
      proxy.userData = { kind: "site", id: site.id };
      this.proxyRoot.add(proxy);
      this.proxies.push(proxy);
    }
    for (const prop of this.doc.visual.props) {
      const height = this.scene?.groundHeight(prop.pos[0], prop.pos[1]) ?? 0;
      const info = assetRegistry.info(prop.assetId);
      const visualHeight = Math.max(1, (info?.height ?? 3) * prop.scale);
      const radius = Math.max(1.2, (info?.footprint ?? 1.5) * prop.scale * 0.65);
      const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
      const proxy = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, visualHeight, 8), material);
      proxy.position.set(prop.pos[0] / 10, height + visualHeight / 2, prop.pos[1] / 10);
      proxy.userData = { kind: "prop", id: prop.id };
      this.proxyRoot.add(proxy);
      this.proxies.push(proxy);
    }
    this.syncProxyHighlight();
    this.attachGizmo();
    this.syncFoundationHandles();
    this.syncRoadHandles();
    this.syncRoadSelection();
  }

  private syncProxyHighlight(): void {
    for (const proxy of this.proxies) {
      const data = proxy.userData as { kind?: string; id?: string };
      const selected = Boolean(this.selection && data.kind === this.selection.kind && data.id === this.selection.id);
      const mesh = proxy as THREE.Mesh;
      if (mesh.material instanceof THREE.MeshBasicMaterial && data.kind === "foundation") {
        mesh.material.opacity = selected ? 0.16 : 0.06;
        const edges = mesh.children.find((child) => child instanceof THREE.LineSegments) as THREE.LineSegments | undefined;
        const lineMaterial = edges?.material as THREE.LineBasicMaterial | undefined;
        if (lineMaterial) lineMaterial.opacity = selected ? 0.95 : 0.45;
      }
    }
  }

  private syncFoundationHandles(): void {
    const root = this.handleRoot;
    if (!root || this.faceDrag) return;
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    if (this.selection?.kind !== "foundation") return;
    if (this.tool === "road" || this.tool === "terrain" || this.tool === "place") return;
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === this.selection?.id);
    if (!foundation) return;
    const rect = foundationRect(foundation);
    const midX = (rect.minX + rect.maxX) / 20;
    const midZ = (rect.minZ + rect.maxZ) / 20;
    const y = foundation.elevation + 1.1;
    const handles: Array<{ face: "east" | "west" | "north" | "south"; x: number; z: number; rotation: [number, number, number] }> = [
      { face: "east", x: rect.maxX / 10, z: midZ, rotation: [0, 0, -Math.PI / 2] },
      { face: "west", x: rect.minX / 10, z: midZ, rotation: [0, 0, Math.PI / 2] },
      { face: "south", x: midX, z: rect.maxZ / 10, rotation: [Math.PI / 2, 0, 0] },
      { face: "north", x: midX, z: rect.minZ / 10, rotation: [-Math.PI / 2, 0, 0] },
    ];
    for (const handle of handles) {
      const group = new THREE.Group();
      group.position.set(handle.x, y, handle.z);
      group.userData = { face: handle.face, foundationId: foundation.id };
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 2.4, 6),
        new THREE.MeshBasicMaterial({ color: 0xe6c987, transparent: true, opacity: 0.95, depthTest: false }),
      );
      cone.rotation.set(handle.rotation[0], handle.rotation[1], handle.rotation[2]);
      cone.renderOrder = 20;
      cone.userData = { face: handle.face, foundationId: foundation.id };
      group.add(cone);
      const hit = new THREE.Mesh(
        new THREE.SphereGeometry(2.6, 8, 6),
        new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0, depthTest: false }),
      );
      hit.userData = { face: handle.face, foundationId: foundation.id };
      group.add(hit);
      root.add(group);
    }
  }

  private syncRoadHandles(): void {
    const root = this.roadHandleRoot;
    if (!root || this.roadPointDrag) return;
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    if (this.selection?.kind !== "road") return;
    if (this.tool === "road" || this.tool === "terrain" || this.tool === "place") return;
    const road = this.doc.roads.find((entry) => entry.id === this.selection?.id);
    if (!road?.path || road.path.length === 0) return;
    for (let index = 0; index < road.path.length; index += 1) {
      const point = road.path[index];
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x9fd6b0, transparent: true, opacity: 0.9, depthTest: false }),
      );
      sphere.position.set(point[0] / 10, (this.scene?.groundHeight(point[0], point[1]) ?? 0) + 0.9, point[1] / 10);
      sphere.renderOrder = 20;
      sphere.userData = { roadId: road.id, index };
      root.add(sphere);
    }
  }

  private syncRoadSelection(): void {
    const root = this.roadSelectionRoot;
    if (!root) return;
    for (const child of [...root.children]) {
      root.remove(child);
      child.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
    }
    if (this.selection?.kind !== "road") return;
    if (this.tool === "road" || this.tool === "terrain" || this.tool === "place") return;
    const road = this.doc.roads.find((entry) => entry.id === this.selection?.id);
    if (!road) return;
    let path: Array<[number, number]> | null = road.path && road.path.length >= 2
      ? road.path.map((point) => [point[0], point[1]] as [number, number])
      : null;
    if (!path && road.from && road.to) {
      const from = this.doc.sites.find((entry) => entry.id === road.from);
      const to = this.doc.sites.find((entry) => entry.id === road.to);
      if (from && to) path = [[from.pos[0], from.pos[1]], [to.pos[0], to.pos[1]]];
    }
    if (!path || path.length < 2 || !this.scene) return;
    path = this.trimRoadPath(path, road.from ? 19.5 : 0, road.to ? 19.5 : 0);
    if (path.length < 2) return;
    const points = path.map((point) => new THREE.Vector3(
      point[0] / 10,
      this.scene?.groundHeight(point[0], point[1]) ?? 0,
      point[1] / 10,
    ));
    for (const point of points) point.y += 0.28;
    // 用折线而不是 CatmullRom，保证标记、道路模型和模拟寻路是同一条线。
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let index = 1; index < points.length; index += 1) {
      curve.add(new THREE.LineCurve3(points[index - 1], points[index]));
    }
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd36b,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, Math.max(24, points.length * 12), 0.32, 8, false),
      material,
    );
    tube.renderOrder = 25;
    root.add(tube);
    for (const point of points) {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), material);
      marker.position.copy(point);
      marker.position.y += 0.18;
      marker.renderOrder = 26;
      root.add(marker);
    }
  }

  private trimRoadPath(
    path: Array<[number, number]>,
    startDm: number,
    endDm: number,
  ): Array<[number, number]> {
    if (path.length < 2) return path;
    const lengths: number[] = [0];
    let total = 0;
    for (let index = 1; index < path.length; index += 1) {
      total += Math.hypot(path[index][0] - path[index - 1][0], path[index][1] - path[index - 1][1]);
      lengths.push(total);
    }
    if (total <= startDm + endDm) return [];
    const start = Math.max(0, startDm);
    const end = total - Math.max(0, endDm);
    const result: Array<[number, number]> = [];
    for (let index = 1; index < path.length; index += 1) {
      const segmentStart = lengths[index - 1];
      const segmentEnd = lengths[index];
      const from = Math.max(segmentStart, start);
      const to = Math.min(segmentEnd, end);
      if (to <= from) continue;
      const segmentLength = segmentEnd - segmentStart;
      if (segmentLength <= 0.0001) continue;
      const first = (from - segmentStart) / segmentLength;
      const last = (to - segmentStart) / segmentLength;
      const a: [number, number] = [
        path[index - 1][0] + (path[index][0] - path[index - 1][0]) * first,
        path[index - 1][1] + (path[index][1] - path[index - 1][1]) * first,
      ];
      const b: [number, number] = [
        path[index - 1][0] + (path[index][0] - path[index - 1][0]) * last,
        path[index - 1][1] + (path[index][1] - path[index - 1][1]) * last,
      ];
      const previous = result[result.length - 1];
      if (!previous || Math.hypot(previous[0] - a[0], previous[1] - a[1]) > 0.01) result.push(a);
      result.push(b);
    }
    return result;
  }

  private pickRoadHandle(clientX: number, clientY: number): { id: string; index: number } | null {
    if (!this.scene || !this.roadHandleRoot) return null;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.roadHandleRoot.children, true);
    for (const hit of hits) {
      const data = hit.object.userData as { roadId?: string; index?: number };
      if (data.roadId !== undefined && data.index !== undefined) return { id: data.roadId, index: data.index };
    }
    return null;
  }

  private startRoadPointDrag(handle: { id: string; index: number }, pointerId: number): void {
    const mesh = this.roadHandleRoot?.children.find((child) => {
      const data = child.userData as { roadId?: string; index?: number };
      return data.roadId === handle.id && data.index === handle.index;
    }) as THREE.Mesh | undefined;
    if (!mesh) return;
    this.roadPointDrag = { id: handle.id, index: handle.index, mesh };
    if (this.orbit) this.orbit.enabled = false;
    this.canvas.setPointerCapture(pointerId);
  }

  private finishRoadPointDrag(): void {
    const drag = this.roadPointDrag;
    this.roadPointDrag = null;
    if (this.orbit) this.orbit.enabled = true;
    if (!drag || !this.pointer.ground) {
      this.syncRoadHandles();
      return;
    }
    const road = this.doc.roads.find((entry) => entry.id === drag.id);
    if (!road?.path) return;
    const path = road.path.map((point) => [point[0], point[1]] as [number, number]);
    if (drag.index < 0 || drag.index >= path.length) return;
    path[drag.index] = [snapDm(this.pointer.ground[0]), snapDm(this.pointer.ground[1])];
    this.commit(updateRoad(this.doc, road.id, { path }), "已调整道路", { roads: true });
  }

  private appendRoadPoint(id: string): void {
    const road = this.doc.roads.find((entry) => entry.id === id);
    if (!road?.path || road.path.length < 2) return;
    const path = road.path.map((entry) => [entry[0], entry[1]] as [number, number]);
    const last = path[path.length - 1];
    const prev = path[path.length - 2];
    const dx = last[0] - prev[0];
    const dz = last[1] - prev[1];
    const length = Math.hypot(dx, dz) || 1;
    path.push([last[0] + (dx / length) * 20, last[1] + (dz / length) * 20]);
    this.commit(updateRoad(this.doc, id, { path }), "已添加道路控制点", { roads: true });
  }

  private removeLastRoadPoint(id: string): void {
    const road = this.doc.roads.find((entry) => entry.id === id);
    if (!road?.path || road.path.length <= 2) {
      this.notice("道路至少保留两个控制点");
      return;
    }
    const path = road.path.map((entry) => [entry[0], entry[1]] as [number, number]);
    path.pop();
    this.commit(updateRoad(this.doc, id, { path }), "已删除道路控制点", { roads: true });
  }

  private insertRoadPoint(clientX: number, clientY: number): void {
    const road = this.doc.roads.find((entry) => entry.id === this.selection?.id);
    if (!road || !this.scene) return;
    const ground = this.scene.screenToGround(clientX, clientY);
    if (!ground) return;
    const point = clampPosition(this.doc, [snapDm(ground[0]), snapDm(ground[1])]);
    let path: [number, number][];
    if (road.path && road.path.length >= 2) {
      path = road.path.map((entry) => [entry[0], entry[1]] as [number, number]);
      let bestIndex = -1;
      let bestPoint: [number, number] | null = null;
      let bestDistance = Infinity;
      for (let index = 0; index < path.length - 1; index += 1) {
        const a = path[index];
        const b = path[index + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / lengthSq)) : 0;
        const projected: [number, number] = [a[0] + dx * t, a[1] + dz * t];
        if (Math.hypot(projected[0] - a[0], projected[1] - a[1]) < 8) continue;
        if (Math.hypot(projected[0] - b[0], projected[1] - b[1]) < 8) continue;
        const distance = Math.hypot(projected[0] - point[0], projected[1] - point[1]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
          bestPoint = projected;
        }
      }
      if (!bestPoint || bestIndex < 0 || bestDistance > 60) {
        this.notice("双击道路附近才能加点");
        return;
      }
      path.splice(bestIndex + 1, 0, bestPoint);
    } else if (road.from && road.to) {
      const from = this.doc.sites.find((entry) => entry.id === road.from);
      const to = this.doc.sites.find((entry) => entry.id === road.to);
      if (!from || !to) return;
      path = [[from.pos[0], from.pos[1]], point, [to.pos[0], to.pos[1]]];
    } else {
      this.notice("自由道路还没有控制点，先用道路工具画");
      return;
    }
    this.commit(updateRoad(this.doc, road.id, { path }), "已添加道路控制点", { roads: true });
  }

  private removeRoadPoint(id: string, index: number): void {
    const road = this.doc.roads.find((entry) => entry.id === id);
    if (!road?.path || road.path.length <= 2) {
      this.notice("道路至少保留两个控制点");
      return;
    }
    const path = road.path.map((entry) => [entry[0], entry[1]] as [number, number]);
    path.splice(index, 1);
    this.commit(updateRoad(this.doc, id, { path }), "已删除道路控制点", { roads: true });
  }

  private cancelRoadPointDrag(): void {
    this.roadPointDrag = null;
    if (this.orbit) this.orbit.enabled = true;
    this.syncRoadHandles();
  }

  private pickFaceHandle(clientX: number, clientY: number): { id: string; face: "east" | "west" | "north" | "south" } | null {
    if (!this.scene || !this.handleRoot) return null;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.handleRoot.children, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !(object.userData as { face?: string }).face) object = object.parent;
      const data = object?.userData as { face?: "east" | "west" | "north" | "south"; foundationId?: string } | undefined;
      if (data?.face && data.foundationId) return { id: data.foundationId, face: data.face };
    }
    return null;
  }

  private startFaceDrag(face: "east" | "west" | "north" | "south", id: string, pointerId: number): void {
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === id);
    if (!foundation) return;
    const rect = foundationRect(foundation);
    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 0.08, 1),
      new THREE.MeshBasicMaterial({ color: 0xe6c987, wireframe: true, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    ghost.position.set((rect.minX + rect.maxX) / 20, foundation.elevation + 0.08, (rect.minZ + rect.maxZ) / 20);
    ghost.scale.set((rect.maxX - rect.minX) / 10, 1, (rect.maxZ - rect.minZ) / 10);
    this.editorRoot?.add(ghost);
    this.faceDrag = { id, face, rect, ghost };
    if (this.orbit) this.orbit.enabled = false;
    this.canvas.setPointerCapture(pointerId);
  }

  private updateFaceDrag(clientX: number, clientY: number): void {
    const drag = this.faceDrag;
    if (!drag) return;
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === drag.id);
    if (!foundation) return;
    const point = this.groundOnPlane(clientX, clientY, foundation.elevation);
    if (!point) return;
    const snap = (value: number): number => Math.round(value / 5) * 5;
    const rect = { ...drag.rect };
    if (drag.face === "east") rect.maxX = Math.max(rect.minX + 100, snap(point[0]));
    if (drag.face === "west") rect.minX = Math.min(rect.maxX - 100, snap(point[0]));
    if (drag.face === "south") rect.maxZ = Math.max(rect.minZ + 100, snap(point[1]));
    if (drag.face === "north") rect.minZ = Math.min(rect.maxZ - 100, snap(point[1]));
    drag.rect = rect;
    drag.ghost.position.set((rect.minX + rect.maxX) / 20, foundation.elevation + 0.08, (rect.minZ + rect.maxZ) / 20);
    drag.ghost.scale.set((rect.maxX - rect.minX) / 10, 1, (rect.maxZ - rect.minZ) / 10);
    const width = ((rect.maxX - rect.minX) / 10).toFixed(1);
    const depth = ((rect.maxZ - rect.minZ) / 10).toFixed(1);
    this.viewInfoEl.innerHTML =
      '<span class="mlnx-chip">扩展地基</span><span class="mlnx-chip">' + width + " × " + depth + " 米</span>";
  }

  private finishFaceDrag(): void {
    const drag = this.faceDrag;
    this.faceDrag = null;
    if (this.orbit) this.orbit.enabled = true;
    if (!drag) return;
    this.editorRoot?.remove(drag.ghost);
    drag.ghost.geometry.dispose();
    (drag.ghost.material as THREE.Material).dispose();
    const foundation = this.doc.visual.foundations.find((entry) => entry.id === drag.id);
    if (!foundation) return;
    const before = foundationRect(foundation);
    if (before.minX === drag.rect.minX && before.minZ === drag.rect.minZ && before.maxX === drag.rect.maxX && before.maxZ === drag.rect.maxZ) {
      return;
    }
    this.commit(
      updateFoundation(this.doc, drag.id, {
        pos: [(drag.rect.minX + drag.rect.maxX) / 2, (drag.rect.minZ + drag.rect.maxZ) / 2],
        size: [drag.rect.maxX - drag.rect.minX, drag.rect.maxZ - drag.rect.minZ],
      }),
      "已扩展地基",
      { terrain: true, sites: true },
    );
  }

  private cancelFaceDrag(): void {
    const drag = this.faceDrag;
    this.faceDrag = null;
    if (this.orbit) this.orbit.enabled = true;
    if (!drag) return;
    this.editorRoot?.remove(drag.ghost);
    drag.ghost.geometry.dispose();
    (drag.ghost.material as THREE.Material).dispose();
    this.syncFoundationHandles();
  }

  private pickRoadScreen(clientX: number, clientY: number, paddingPx = 12): string | null {
    if (!this.scene) return null;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const project = (x: number, z: number): { x: number; y: number } => {
      const point = new THREE.Vector3(
        x,
        (this.scene?.groundHeight(x * 10, z * 10) ?? 0) + 0.15,
        z,
      ).project(camera);
      return {
        x: rect.left + ((point.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - point.y) / 2) * rect.height,
      };
    };
    const distanceToSegment = (
      px: number,
      py: number,
      a: { x: number; y: number },
      b: { x: number; y: number },
    ): number => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lengthSq)) : 0;
      return Math.hypot(px - (a.x + dx * t), py - (a.y + dy * t));
    };
    let best: { id: string; distance: number } | null = null;
    for (const road of this.doc.roads) {
      let path: Array<[number, number]> | null = road.path && road.path.length >= 2
        ? road.path.map((point) => [point[0], point[1]] as [number, number])
        : null;
      if (!path && road.from && road.to) {
        const from = this.doc.sites.find((entry) => entry.id === road.from);
        const to = this.doc.sites.find((entry) => entry.id === road.to);
        if (from && to) path = [[from.pos[0], from.pos[1]], [to.pos[0], to.pos[1]]];
      }
      if (!path) continue;
      let previous = project(path[0][0] / 10, path[0][1] / 10);
      for (let index = 1; index < path.length; index += 1) {
        const current = project(path[index][0] / 10, path[index][1] / 10);
        const distance = distanceToSegment(clientX, clientY, previous, current);
        if (distance <= paddingPx && (!best || distance < best.distance)) best = { id: road.id, distance };
        previous = current;
      }
    }
    return best?.id ?? null;
  }

  private pickRoad(clientX: number, clientY: number, paddingDm = 15): string | null {
    if (!this.scene) return null;
    const ground = this.scene.screenToGround(clientX, clientY);
    if (!ground) return null;
    let best: { id: string; distance: number } | null = null;
    for (const road of this.doc.roads) {
      let path: Array<[number, number]> | null = road.path && road.path.length >= 2
        ? road.path.map((point) => [point[0], point[1]] as [number, number])
        : null;
      if (!path && road.from && road.to) {
        const from = this.doc.sites.find((entry) => entry.id === road.from);
        const to = this.doc.sites.find((entry) => entry.id === road.to);
        if (from && to) path = [[from.pos[0], from.pos[1]], [to.pos[0], to.pos[1]]];
      }
      if (!path) continue;
      const threshold = (road.widthDm ?? this.doc.visual.roads.width * 10) / 2 + paddingDm;
      for (let index = 0; index < path.length - 1; index += 1) {
        const a = path[index];
        const b = path[index + 1];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const lengthSq = dx * dx + dz * dz;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((ground[0] - a[0]) * dx + (ground[1] - a[1]) * dz) / lengthSq)) : 0;
        const distance = Math.hypot(ground[0] - (a[0] + dx * t), ground[1] - (a[1] + dz * t));
        if (distance < threshold && (!best || distance < best.distance)) best = { id: road.id, distance };
      }
    }
    return best?.id ?? null;
  }

  private gizmoNearPointer(clientX: number, clientY: number): boolean {
    if (!this.gizmo?.axis || !this.selectedProxy || !this.scene) return false;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const point = this.selectedProxy.getWorldPosition(new THREE.Vector3()).project(camera);
    const x = rect.left + ((point.x + 1) / 2) * rect.width;
    const y = rect.top + ((1 - point.y) / 2) * rect.height;
    return Math.hypot(clientX - x, clientY - y) <= 120;
  }

  private roadAtGround(xDm: number, zDm: number, clearanceDm = 3): boolean {
    const distanceToSegment = (
      x: number,
      z: number,
      a: [number, number],
      b: [number, number],
    ): number => {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const lengthSq = dx * dx + dz * dz;
      const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / lengthSq)) : 0;
      return Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t));
    };
    for (const road of this.doc.roads) {
      let path: Array<[number, number]> | null = road.path && road.path.length >= 2
        ? road.path
        : null;
      if (!path && road.from && road.to) {
        const from = this.doc.sites.find((entry) => entry.id === road.from);
        const to = this.doc.sites.find((entry) => entry.id === road.to);
        if (from && to) path = [[from.pos[0], from.pos[1]], [to.pos[0], to.pos[1]]];
      }
      if (!path) continue;
      const width = (road.widthDm ?? this.doc.visual.roads.width * 10) / 2;
      for (let index = 1; index < path.length; index += 1) {
        if (distanceToSegment(xDm, zDm, path[index - 1], path[index]) <= width + clearanceDm) return true;
      }
    }
    return false;
  }

  private pickObject(clientX: number, clientY: number): Selection {
    if (!this.scene || !this.proxyRoot) return null;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(this.proxyRoot.children, true);
    for (const hit of hits) {
      let object: THREE.Object3D | null = hit.object;
      while (object && !(object.userData as { kind?: string }).kind) object = object.parent;
      if (!object) continue;
      const data = object.userData as { kind?: "foundation" | "site" | "prop"; id?: string };
      if ((data.kind === "site" || data.kind === "prop") && data.id) return { kind: data.kind, id: data.id };
    }
    return null;
  }

  private pickFoundation(clientX: number, clientY: number): Selection {
    const ground = this.scene?.screenToGround(clientX, clientY);
    if (!ground) return null;
    const foundation = foundationAt(this.doc.visual.foundations, ground[0], ground[1]);
    return foundation ? { kind: "foundation", id: foundation.id } : null;
  }

  private groundOnPlane(clientX: number, clientY: number, y: number): [number, number] | null {
    if (!this.scene) return null;
    const camera = this.scene.getEditorCamera();
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const point = new THREE.Vector3();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    if (!raycaster.ray.intersectPlane(plane, point)) return null;
    return [point.x * 10, point.z * 10];
  }

  private nearestSite(ground: [number, number], radius: number): SiteDraft | null {
    let best: SiteDraft | null = null;
    let bestDistance = radius;
    for (const site of this.doc.sites) {
      const distance = Math.hypot(site.pos[0] - ground[0], site.pos[1] - ground[1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = site;
      }
    }
    return best;
  }

  private handleRoadClick(ground: [number, number]): void {
    const point = clampPosition(this.doc, ground);
    if (!this.roadDraw) {
      const site = this.nearestSite(point, 60);
      const start: [number, number] = site ? [site.pos[0], site.pos[1]] : point;
      const line = this.createRoadLine();
      this.roadDraw = { points: [start], ...(site ? { from: site.id } : {}), line };
      this.editorRoot?.add(line);
      this.updateRoadPreview(point);
      this.notice("点击继续加点，Enter 完成，Esc 取消");
      return;
    }
    const site = this.nearestSite(point, 45);
    const next: [number, number] = site ? [site.pos[0], site.pos[1]] : point;
    this.roadDraw.points.push(next);
    if (site && site.id !== this.roadDraw.from) this.roadDraw.to = site.id;
    this.updateRoadPreview(next);
  }

  private createRoadLine(): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 512), 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.LineBasicMaterial({ color: 0xe6c987, transparent: true, opacity: 0.95, depthWrite: false });
    const line = new THREE.Line(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = 5;
    return line;
  }

  private updateRoadPreview(cursor: [number, number] | null): void {
    const draw = this.roadDraw;
    if (!draw) return;
    const points = draw.points.slice();
    if (cursor) points.push(cursor);
    const attribute = draw.line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    const count = Math.min(points.length, 512);
    for (let index = 0; index < count; index += 1) {
      const point = points[index];
      array[index * 3] = point[0] / 10;
      array[index * 3 + 1] = (this.scene?.groundHeight(point[0], point[1]) ?? 0) + 0.15;
      array[index * 3 + 2] = point[1] / 10;
    }
    draw.line.geometry.setDrawRange(0, count);
    attribute.needsUpdate = true;
  }

  private finishRoad(): void {
    const draw = this.roadDraw;
    if (!draw) {
      this.notice("先在地图上点几个点再完成");
      return;
    }
    this.roadDraw = null;
    this.editorRoot?.remove(draw.line);
    draw.line.geometry.dispose();
    (draw.line.material as THREE.Material).dispose();
    const points: [number, number][] = [];
    for (const point of draw.points) {
      const last = points[points.length - 1];
      if (last && Math.hypot(last[0] - point[0], last[1] - point[1]) < 1) continue;
      points.push(point);
    }
    if (points.length < 2) {
      this.notice("道路至少需要两个点");
      return;
    }
    const lastPoint = points[points.length - 1];
    const endSite = this.nearestSite(lastPoint, 45);
    if (endSite) points[points.length - 1] = [endSite.pos[0], endSite.pos[1]];
    const result = addRoad(this.doc, points, {
      ...(draw.from ? { from: draw.from } : {}),
      ...(endSite && endSite.id !== draw.from ? { to: endSite.id } : {}),
      widthDm: Math.round(this.doc.visual.roads.width * 10),
    });
    this.selection = { kind: "road", id: result.road.id };
    this.commit(result.document, "已绘制道路", { roads: true });
    this.setTool("select");
  }

  private cancelRoad(): void {
    const draw = this.roadDraw;
    this.roadDraw = null;
    if (draw) {
      this.editorRoot?.remove(draw.line);
      draw.line.geometry.dispose();
      (draw.line.material as THREE.Material).dispose();
    }
    this.notice("已取消道路");
    this.setTool("select");
  }

  private beginGridStroke(ground: [number, number]): void {
    const cell = gridCellFromGround(this.doc, ground);
    if (!cell) return;
    this.gridStroke = {
      before: cloneDocument(this.doc),
      document: this.doc,
      lastCell: cell,
      startCell: cell,
      changed: false,
    };
    this.applyGridAt(cell);
    if (this.terrainBrush === "ramp") this.updateRampPreview(cell);
  }

  private applyGridAt(cell: [number, number]): void {
    const stroke = this.gridStroke;
    if (!stroke) return;
    const next = applyGridBrush(stroke.document, {
      mode: this.terrainBrush,
      cell,
      radiusCells: this.brushRadius,
      strengthCm: this.terrainBrush === "cliff" ? 100 : this.brushStrength,
      startCell: stroke.startCell,
      surface: this.surfaceBrush,
    });
    if (next === stroke.document) return;
    stroke.document = next;
    stroke.changed = true;
    this.doc = next;
    this.compiled = compileDocument(next, { validateNavigation: false });
    const heightBrush =
      this.terrainBrush === "raise" ||
      this.terrainBrush === "lower" ||
      this.terrainBrush === "smooth" ||
      this.terrainBrush === "cliff" ||
      this.terrainBrush === "ramp";
    if (this.scene && heightBrush) {
      // 拖动时只刷新高度，不重建贴图、岛屿、道路和装饰；松手后再完整重建一次。
      // 地表/水面笔刷改的是烘焙贴图，拖动中不重建，松手时一次画好。
      const radius = Math.max(1, Math.min(12, Math.round(this.brushRadius)));
      const start = this.terrainBrush === "ramp" ? stroke.startCell : cell;
      const region = {
        x0: Math.min(start[0], cell[0]) - radius,
        z0: Math.min(start[1], cell[1]) - radius,
        x1: Math.max(start[0], cell[0]) + radius,
        z1: Math.max(start[1], cell[1]) + radius,
      };
      if (!this.scene.updateTerrainHeights(this.compiled.map, region)) {
        this.scene.updateTerrain(this.compiled.map, this.compiled.visual);
      }
    }
    if (this.terrainBrush === "ramp") this.updateRampPreview(cell);
  }

  private finishGridStroke(): void {
    this.clearRampPreview();
    const stroke = this.gridStroke;
    this.gridStroke = null;
    if (!stroke) return;
    if (!stroke.changed) {
      this.doc = stroke.before;
      this.updateReachOverlay();
      return;
    }
    this.undoStack.push(stroke.before);
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.doc = stroke.document;
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    this.preview = this.createPreview();
    this.scene?.updateTerrain(this.compiled.map, this.compiled.visual);
    this.syncProxies();
    this.updateReachOverlay();
    this.renderTree();
    this.renderInspector();
    this.updateTop();
    this.updateStatus();
    this.autosave();
    this.notice("已修改网格地形");
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.scene) return;
    if (this.gizmoNearPointer(event.clientX, event.clientY)) {
      if (this.orbit) this.orbit.enabled = false;
      return;
    }
    if (this.tool === "place" && this.libraryTab === "foundation") {
      const point = this.groundOnPlane(event.clientX, event.clientY, this.toolElevation);
      if (!point) return;
      const start: [number, number] = [snapDm(point[0]), snapDm(point[1])];
      const ghost = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.12, 1),
        new THREE.MeshBasicMaterial({ color: 0xc6a36a, wireframe: true, transparent: true, opacity: 0.8, depthWrite: false }),
      );
      ghost.position.set(start[0] / 10, this.toolElevation + 0.06, start[1] / 10);
      this.editorRoot?.add(ghost);
      this.drag = { start, current: start, ghost };
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (this.tool === "road") {
      const ground = this.scene.screenToGround(event.clientX, event.clientY);
      if (ground) this.handleRoadClick(ground);
      return;
    }
    if (this.tool === "terrain") {
      if (this.doc.navigation !== "grid" || !this.doc.grid) {
        this.notice("先转换为网格地图再刷地形");
        return;
      }
      const ground = this.scene.screenToGround(event.clientX, event.clientY);
      if (!ground) return;
      this.beginGridStroke(ground);
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (this.selection?.kind === "foundation") {
      const face = this.pickFaceHandle(event.clientX, event.clientY);
      if (face) {
        this.startFaceDrag(face.face, face.id, event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (this.selection?.kind === "road") {
      const handle = this.pickRoadHandle(event.clientX, event.clientY);
      if (handle) {
        if (event.altKey) {
          this.removeRoadPoint(handle.id, handle.index);
          event.preventDefault();
          return;
        }
        this.startRoadPointDrag(handle, event.pointerId);
        event.preventDefault();
        return;
      }
    }
    if (this.tool === "select" || this.tool === "move" || this.tool === "rotate" || this.tool === "scale") {
      const hit = this.pickObject(event.clientX, event.clientY);
      // 道路端点落在据点里；据点优先，否则点击路端会选中道路。
      if (hit?.kind === "site") {
        this.select(hit);
      } else {
        const strictRoad = this.pickRoadScreen(event.clientX, event.clientY, 12);
        if (strictRoad) {
          this.select({ kind: "road", id: strictRoad });
        } else if (hit) {
          this.select(hit);
        } else {
          const roadId = this.pickRoad(event.clientX, event.clientY);
          if (roadId) this.select({ kind: "road", id: roadId });
          else this.select(this.pickFoundation(event.clientX, event.clientY));
        }
      }
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const ground = this.scene?.screenToGround(event.clientX, event.clientY) ?? null;
    this.pointer = { x: event.clientX, y: event.clientY, ground };
    if (this.faceDrag) {
      this.updateFaceDrag(event.clientX, event.clientY);
      return;
    }
    if (this.roadPointDrag) {
      if (ground) {
        this.roadPointDrag.mesh.position.set(ground[0] / 10, (this.scene?.groundHeight(ground[0], ground[1]) ?? 0) + 0.9, ground[1] / 10);
      }
      this.updateStatus();
      return;
    }
    if (this.drag) {
      const point = this.groundOnPlane(event.clientX, event.clientY, this.toolElevation);
      if (point) {
        this.drag.current = [snapDm(point[0]), snapDm(point[1])];
        this.updateGhost();
      }
      this.updateStatus();
      return;
    }
    if (this.roadDraw) {
      this.updateRoadPreview(ground);
      this.updateStatus();
      return;
    }
    if (this.gridStroke) {
      const cell = ground ? gridCellFromGround(this.doc, ground) : null;
      if (cell && (cell[0] !== this.gridStroke.lastCell[0] || cell[1] !== this.gridStroke.lastCell[1])) {
        this.gridStroke.lastCell = cell;
        this.applyGridAt(cell);
      }
      this.updateStatus();
      return;
    }
    this.updateViewInfo();
  };

  private readonly onPointerUp = (): void => {
    if (!this.faceDrag && !this.roadPointDrag) {
      if (this.orbit) this.orbit.enabled = true;
    }
    if (this.roadPointDrag) {
      this.finishRoadPointDrag();
      return;
    }
    if (this.faceDrag) {
      this.finishFaceDrag();
      return;
    }
    if (this.gridStroke) {
      this.finishGridStroke();
      return;
    }
    if (this.drag) {
      const drag = this.drag;
      this.drag = null;
      this.editorRoot?.remove(drag.ghost);
      drag.ghost.geometry.dispose();
      (drag.ghost.material as THREE.Material).dispose();
      const minX = Math.min(drag.start[0], drag.current[0]);
      const maxX = Math.max(drag.start[0], drag.current[0]);
      const minZ = Math.min(drag.start[1], drag.current[1]);
      const maxZ = Math.max(drag.start[1], drag.current[1]);
      const width = maxX - minX;
      const depth = maxZ - minZ;
      const center: [number, number] = [Math.round((minX + maxX) / 2), Math.round((minZ + maxZ) / 2)];
      const size: [number, number] = [Math.max(200, Math.round(width)), Math.max(200, Math.round(depth))];
      const result = addFoundation(this.doc, {
        pos: center,
        size,
        elevation: this.toolElevation,
        shape: this.activeFoundationShape,
      });
      this.selection = { kind: "foundation", id: result.foundation.id };
      this.commit(result.document, "已添加地基", { terrain: true, sites: true });
      this.setTool("move");
      return;
    }
    if (this.tool === "place" && this.libraryTab !== "foundation" && this.pointer.ground) {
      const x = this.pointer.ground[0];
      const z = this.pointer.ground[1];
      if (!this.hasGround(x, z)) {
        this.notice("这里不在地基上，先添加一块地基");
        return;
      }
      if (this.libraryTab === "site") {
        const tooClose = this.doc.sites.some((site) => Math.hypot(site.pos[0] - x, site.pos[1] - z) < 80);
        if (tooClose) {
          this.notice("两个据点至少间隔 8 米");
          return;
        }
        const result = addSite(this.doc, this.activeSiteKind, [Math.round(x), Math.round(z)], 0);
        this.selection = { kind: "site", id: result.site.id };
        this.commit(result.document, "已放置 " + siteKindLabel(this.activeSiteKind), { sites: true });
        return;
      }
      const assetId = this.activeAssetId;
      if (!assetId) {
        this.notice("先在左侧选择资产");
        return;
      }
      if (this.roadAtGround(x, z)) {
        this.notice("道路上方不能放置装饰");
        return;
      }
      const result = addProp(this.doc, assetId, [Math.round(x), Math.round(z)], 0, 1);
      this.selection = { kind: "prop", id: result.prop.id };
      this.commit(result.document, "已放置装饰", { props: true });
    }
  };

  private updateGhost(): void {
    if (!this.drag) return;
    const drag = this.drag;
    const width = Math.max(0.5, Math.abs(drag.current[0] - drag.start[0]) / 10);
    const depth = Math.max(0.5, Math.abs(drag.current[1] - drag.start[1]) / 10);
    drag.ghost.scale.set(width, 1, depth);
    drag.ghost.position.set(
      (drag.start[0] + drag.current[0]) / 20,
      this.toolElevation + 0.06,
      (drag.start[1] + drag.current[1]) / 20,
    );
  }

  private hasGround(xDm: number, zDm: number): boolean {
    return this.doc.visual.foundations.some((foundation) => foundationContains(foundation, xDm, zDm));
  }

  private commit(
    next: MapDocument,
    message: string,
    options: { terrain?: boolean; sites?: boolean; props?: boolean; roads?: boolean; rebuild?: boolean } = {},
  ): void {
    if (serializeDocument(next) === serializeDocument(this.doc)) return;
    this.undoStack.push(cloneDocument(this.doc));
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack = [];
    this.doc = next;
    this.dirty = true;
    if (this.selection) {
      const kind = this.selection.kind;
      const exists =
        kind === "foundation"
          ? this.doc.visual.foundations.some((entry) => entry.id === this.selection?.id)
          : kind === "site"
            ? this.doc.sites.some((entry) => entry.id === this.selection?.id)
            : kind === "road"
              ? this.doc.roads.some((entry) => entry.id === this.selection?.id)
              : this.doc.visual.props.some((entry) => entry.id === this.selection?.id);
      if (!exists) this.selection = null;
    }
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    this.preview = this.createPreview();
    if (options.rebuild || !this.scene) {
      this.rebuildScene();
    } else {
      if (options.terrain) {
        this.scene.updateTerrain(this.compiled.map, this.compiled.visual);
        this.updateReachOverlay();
      }
      if (options.sites) {
        this.updateSitesScene();
        this.updateReachOverlay();
      }
      if (options.props) this.scene.updateProps(this.compiled.visual);
      if (options.roads) this.scene.updateRoads(this.compiled.map, this.compiled.visual);
      this.syncProxies();
      this.attachGizmo();
    }
    this.renderTree();
    this.scheduleInspectorRender();
    this.updateTop();
    this.updateStatus();
    this.updateViewInfo();
    this.autosave();
    this.notice(message);
  }

  private scheduleInspectorRender(): void {
    if (this.inspectorFrame) cancelAnimationFrame(this.inspectorFrame);
    // 选项的 change 事件先于 SelectInput.close()，而 close 会再排一个 rAF 恢复 tabIndex。
    // 延后两帧再重建检查器，避免在它恢复 tabIndex 之前销毁控件。
    this.inspectorFrame = requestAnimationFrame(() => {
      this.inspectorFrame = requestAnimationFrame(() => {
        this.inspectorFrame = 0;
        if (!this.disposed) this.renderInspector();
      });
    });
  }

  private updateSitesScene(): void {
    if (!this.scene) return;
    if (this.preview) this.scene.updateSites(this.compiled.map, this.compiled.visual, this.preview);
  }

  private rebuildScene(): void {
    const camera = this.scene?.getEditorCamera();
    const orbit = this.orbit;
    if (camera && orbit) {
      this.cameraState = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [orbit.target.x, orbit.target.y, orbit.target.z],
      };
    }
    this.startScene();
    this.renderTree();
    this.renderInspector();
    this.updateTop();
    this.updateStatus();
  }

  private undo(): void {
    const previous = this.undoStack.pop();
    if (!previous) return;
    this.redoStack.push(cloneDocument(this.doc));
    this.doc = previous;
    this.dirty = true;
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    this.preview = this.createPreview();
    this.selection = null;
    this.rebuildScene();
    this.notice("已撤销");
  }

  private redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(cloneDocument(this.doc));
    this.doc = next;
    this.dirty = true;
    this.compiled = compileDocument(this.doc, { validateNavigation: false });
    this.preview = this.createPreview();
    this.selection = null;
    this.rebuildScene();
    this.notice("已重做");
  }

  private updateTop(): void {
    this.mapLabelEl.textContent =
      (this.doc.name || "未命名地图") +
      " · " +
      this.doc.sites.length +
      " 据点 · " +
      this.doc.visual.props.length +
      " 装饰 · " +
      this.doc.visual.foundations.length +
      " 地基";
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;
  }

  private updateStatus(): void {
    const ground = this.pointer.ground;
    const coords = ground
      ? "X " + (ground[0] / 10).toFixed(1) + "  Y " + (this.scene?.groundHeight(ground[0], ground[1]) ?? 0).toFixed(1) + "  Z " + (ground[1] / 10).toFixed(1)
      : "X -  Y -  Z -";
    const selection = this.selection
      ? "选择: " +
        (this.selection.kind === "foundation"
          ? "地基"
          : this.selection.kind === "site"
            ? "据点"
            : this.selection.kind === "road"
              ? "道路"
              : "装饰") +
        " " +
        this.selection.id
      : "未选择";
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error").length;
    const warnings = this.compiled.diagnostics.filter((entry) => entry.severity === "warning").length;
    const diagnostics =
      errors > 0
        ? '<span class="bad">' + errors + " 错误</span>"
        : warnings > 0
          ? "<span>" + warnings + " 警告</span>"
          : '<span class="ok">地图有效</span>';
    this.statusEl.innerHTML =
      "<span>" +
      escapeHtml(coords) +
      "</span><span>" +
      escapeHtml(TOOL_LABELS[this.tool]) +
      "</span><span>" +
      escapeHtml(selection) +
      '</span><span class="sp"></span>' +
      diagnostics;
  }

  private updateViewInfo(): void {
    if (!this.viewInfoEl) return;
    const tool = TOOL_LABELS[this.tool];
    const selection = this.selection
      ? (this.selection.kind === "foundation"
          ? "地基 "
          : this.selection.kind === "site"
            ? "据点 "
            : this.selection.kind === "road"
              ? "道路 "
              : "装饰 ") + this.selection.id
      : "未选择";
    const hint =
      this.tool === "place"
        ? "左键拖拽/点击放置"
        : this.tool === "road"
          ? "点击加点 · Enter 完成 · Esc 取消"
          : this.tool === "terrain"
            ? "左键拖动刷地形 · 网格图专用"
            : this.tool === "rotate"
              ? "拖动圆环旋转 · 右键环绕 · 中键平移"
              : this.tool === "scale"
                ? "拖动轴缩放 · 右键环绕 · 中键平移"
                : "右键环绕 · 中键平移 · 滚轮缩放";
    this.viewInfoEl.innerHTML =
      '<span class="mlnx-chip">' + escapeHtml(tool) + '</span><span class="mlnx-chip">' + escapeHtml(selection) + '</span><span class="mlnx-chip">' + escapeHtml(hint) + "</span>";
  }

  private focusSelection(): void {
    if (!this.selection || !this.scene || !this.orbit) return;
    const proxy = this.findProxy(this.selection);
    if (!proxy) return;
    this.orbit.target.copy(proxy.position);
    const camera = this.scene.getEditorCamera();
    const offset = camera.position.clone().sub(this.orbit.target);
    const foundation =
      this.selection.kind === "foundation"
        ? this.doc.visual.foundations.find((entry) => entry.id === this.selection?.id)
        : null;
    const span = foundation ? Math.max(foundation.size[0], foundation.size[1]) / 10 : 24;
    const distance = Math.max(60, span * 1.8, offset.length() * 0.55);
    offset.setLength(distance);
    camera.position.copy(this.orbit.target).add(offset);
    this.orbit.update();
  }

  private resetCamera(): void {
    if (!this.scene || !this.orbit) return;
    const bounds = documentBounds(this.doc);
    const centerX = (bounds.minX + bounds.maxX) / 20;
    const centerZ = (bounds.minZ + bounds.maxZ) / 20;
    const radius = Math.max(20, (bounds.maxX - bounds.minX) / 20, (bounds.maxZ - bounds.minZ) / 20);
    const distance = radius * 3.1;
    const pitch = (28 * Math.PI) / 180;
    const yaw = (12 * Math.PI) / 180;
    const camera = this.scene.getEditorCamera();
    this.orbit.target.set(centerX, 0, centerZ);
    camera.position.set(
      centerX + Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(pitch) * distance,
      centerZ + Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.orbit.update();
    this.notice("已切到对局视角");
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.running) return;
    const target = event.target as HTMLElement | null;
    // 只有文本输入保留原生撤销；数字框、下拉框聚焦时 Ctrl+Z 仍要撤销地图编辑。
    const tag = target?.tagName;
    const inputType = tag === "INPUT" ? (target as HTMLInputElement).type : "";
    if (tag === "TEXTAREA" || (tag === "INPUT" && inputType !== "number" && inputType !== "range" && inputType !== "checkbox")) {
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) this.redo();
        else this.undo();
        return;
      }
      if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        this.redo();
        return;
      }
      if (event.key.toLowerCase() === "d" && this.selection?.kind === "foundation") {
        event.preventDefault();
        const result = duplicateFoundation(this.doc, this.selection.id);
        if (!result) return;
        this.selection = { kind: "foundation", id: result.foundation.id };
        this.commit(result.document, "已复制地基", { terrain: true, sites: true });
        return;
      }
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (!this.selection) return;
      event.preventDefault();
      if (this.selection.kind === "foundation") {
        if (this.doc.visual.foundations.length <= 1) {
          this.notice("至少保留一块地基");
          return;
        }
        const next = removeFoundation(this.doc, this.selection.id);
        this.selection = null;
        this.commit(next, "已删除地基", { terrain: true, sites: true });
      } else if (this.selection.kind === "site") {
        const next = removeSite(this.doc, this.selection.id);
        this.selection = null;
        this.commit(next, "已删除据点", { sites: true });
      } else if (this.selection.kind === "road") {
        const next = removeRoad(this.doc, this.selection.id);
        this.selection = null;
        this.commit(next, "已删除道路", { roads: true });
      } else {
        const next = removeProp(this.doc, this.selection.id);
        this.selection = null;
        this.commit(next, "已删除装饰", { props: true });
      }
      return;
    }
    if (event.key === "Enter" && this.roadDraw) {
      event.preventDefault();
      this.finishRoad();
      return;
    }
    if (event.key === "Escape" && this.roadPointDrag) {
      event.preventDefault();
      this.cancelRoadPointDrag();
      return;
    }
    if (event.key === "Escape" && this.faceDrag) {
      event.preventDefault();
      this.cancelFaceDrag();
      return;
    }
    if (event.key === "Escape" && this.gridStroke) {
      event.preventDefault();
      this.finishGridStroke();
      return;
    }
    if (event.key === "Escape" && this.roadDraw) {
      event.preventDefault();
      this.cancelRoad();
      return;
    }
    if (event.key === "Escape") {
      this.select(null);
      this.setTool("select");
      return;
    }
    if (event.key === "PageUp" || event.key === "PageDown") {
      if (this.selection?.kind === "foundation") {
        const foundation = this.doc.visual.foundations.find((entry) => entry.id === this.selection?.id);
        if (!foundation) return;
        event.preventDefault();
        const delta = event.key === "PageUp" ? 1 : -1;
        this.commit(updateFoundation(this.doc, foundation.id, { elevation: foundation.elevation + delta }), "已调整地基高度", { terrain: true, sites: true });
      }
      return;
    }
    if (event.key.toLowerCase() === "f") {
      this.focusSelection();
      return;
    }
    // R 旋转与经典编辑器一致；E 保留为旋转别名，T 为缩放。
    const shortcuts: Record<string, NextTool> = { v: "select", w: "move", e: "rotate", r: "rotate", t: "scale", b: "place", p: "road", g: "terrain" };
    const tool = shortcuts[event.key.toLowerCase()];
    if (tool) {
      event.preventDefault();
      this.setTool(tool);
    }
  };

  private async saveDocument(): Promise<void> {
    try {
      const result = await saveMapText(serializeDocument(this.doc), this.doc.name || "map");
      if (result) {
        this.dirty = false;
        this.notice("地图已保存");
      }
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "保存失败");
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
      this.rebuildScene();
      this.renderAll();
      this.notice("已载入 " + opened.name);
    } catch (error) {
      this.notice(error instanceof Error ? error.message : "地图无法读取");
    }
  }

  private newDocument(): void {
    if (this.dirty && !window.confirm("当前草稿还没保存，确定新建地图？")) return;
    this.doc = createStarterDocument();
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
    this.dirty = false;
    this.rebuildScene();
    this.renderAll();
    this.notice("已新建地图");
  }

  private playtest(): void {
    const full = compileDocument(this.doc);
    const errors = full.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0) {
      this.notice("先修正地图错误再试玩");
      return;
    }
    this.compiled = full;
    this.options.onPlaytest(full.map, full.visual);
  }

  private requestExit(): void {
    if (this.dirty && !window.confirm("当前草稿还没保存，确定返回主菜单？")) return;
    this.suspend();
    this.options.onExit();
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeDocument(this.doc));
    } catch {
      // ignore
    }
  }

  private notice(message: string): void {
    this.toastEl.textContent = message;
    this.toastEl.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove("on"), 1800);
  }
}


