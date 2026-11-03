import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  BooleanInput,
  Button,
  LabelGroup,
  NumericInput,
  SelectInput,
  TextInput,
  TreeView,
  TreeViewItem,
} from "@playcanvas/pcui";
import "@playcanvas/pcui/styles";
import { createGame } from "@marchlands/sim";
import type { CityId, MapDef, Ruleset, SimState, SiteKind } from "@marchlands/sim";
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
  updateScatter,
  updateSite,
  updateTerrain,
  watchCandidates,
} from "@marchlands/map-authoring";
import type { CompileResult, GridBrushMode, MapDocument, MapVisual, PropDraft, SiteDraft } from "@marchlands/map-authoring";
import { assetRegistry } from "../../game/asset-registry";
import { BattleScene } from "../../game/scene";
import { openAssetPackFile, openMapText, saveAssetPackFile, saveMapText } from "../map-io";
import { buildBuiltinAssetPack } from "../../game/asset-pack-export";
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
  '      <button class="mlnx-tool" data-tool="rotate"><b>E</b><span>旋转</span></button>',
  '      <button class="mlnx-tool" data-tool="scale"><b>R</b><span>缩放</span></button>',
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

export class EditorNext {
  private readonly options: EditorNextOptions;
  private doc: MapDocument = createStarterDocument();
  private compiled: CompileResult = compileDocument(this.doc, { validateNavigation: false });
  private preview: SimState | null = null;
  private scene: BattleScene | null = null;
  private orbit: OrbitControls | null = null;
  private gizmo: TransformControls | null = null;
  private editorRoot: THREE.Group | null = null;
  private proxyRoot: THREE.Group | null = null;
  private readonly proxies: THREE.Object3D[] = [];
  private selectedProxy: THREE.Object3D | null = null;
  private tree: TreeView | null = null;
  private treeItems = new Map<string, TreeViewItem>();
  private inspectorTop: Array<{ destroy?: () => void }> = [];
  private tool: NextTool = "select";
  private selection: Selection = null;
  private libraryTab: LibraryTab = "site";
  private activeSiteKind: SiteKind = "town";
  private activeAssetId: string | null = null;
  private activeFoundationKind: "platform" | "island" = "platform";
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
  private brushStrength = 20;
  private surfaceBrush = 0;
  private gridStroke: {
    before: MapDocument;
    document: MapDocument;
    lastCell: [number, number];
    startCell: [number, number];
    changed: boolean;
  } | null = null;
  private brushRing: THREE.Mesh | null = null;
  private pointer: { x: number; y: number; ground: [number, number] | null } = { x: 0, y: 0, ground: null };
  private resizeObserver: ResizeObserver | null = null;
  private toastTimer = 0;
  private mounted = false;
  private disposed = false;
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
    this.suspend();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    this.disposeScene();
    this.tree?.destroy();
    this.tree = null;
    document.getElementById("mlnx-root")?.remove();
  }

  private mount(): void {
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
    this.canvas.addEventListener("dblclick", () => {
      if (this.tool === "road" && this.roadDraw) this.finishRoad();
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
    orbit.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE } as unknown as typeof orbit.mouseButtons;
    orbit.update();
    this.orbit = orbit;

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

    this.proxyRoot = new THREE.Group();
    this.proxyRoot.name = "editor-proxies";
    scene3.add(this.proxyRoot);

    const gizmo = new TransformControls(camera, this.canvas);
    gizmo.setSize(1.05);
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
    }
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
      const kind = site.kind === "town" ? "城镇" : site.kind === "granary" ? "粮仓" : "驻兵点";
      const item = new TreeViewItem({ text: site.id + " · " + kind + " · L" + site.level });
      const selection: Selection = { kind: "site", id: site.id };
      (item as unknown as { __selection?: Selection }).__selection = selection;
      this.treeItems.set(site.id, item);
      siteNode.append(item);
    }
    const roadNode = new TreeViewItem({ text: "道路 (" + this.doc.roads.length + ")", open: false });
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
      html += '<div class="mlnx-group-label">顶面高度</div>';
      html += '<input class="mlnx-search" id="mlnx-foundation-y" type="number" step="0.5" value="' + this.toolElevation + '" style="height:26px">';
      html += '<p class="mlnx-note">在地图上按住左键拖出矩形。平台会与相邻地基合并；浮空岛是独立平台。</p>';
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
      const yInput = host.querySelector<HTMLInputElement>("#mlnx-foundation-y");
      yInput?.addEventListener("change", () => {
        const value = Number(yInput.value);
        if (Number.isFinite(value)) this.toolElevation = Math.max(-50, Math.min(200, value));
      });
      return;
    }
    if (this.libraryTab === "site") {
      const kinds: Array<{ kind: SiteKind; label: string; desc: string }> = [
        { kind: "town", label: "城镇", desc: "产兵 · 可升级" },
        { kind: "granary", label: "粮仓", desc: "增幅 · 叶子据点" },
        { kind: "outpost", label: "驻兵点", desc: "监视一条路" },
      ];
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
    const packRow = document.createElement("div");
    packRow.className = "mlnx-actions-row";
    packRow.innerHTML =
      '<button class="mlnx-btn" id="mlnx-pack-import">导入资产包</button>' +
      '<button class="mlnx-btn" id="mlnx-pack-export">导出内置包</button>';
    this.leftContent.appendChild(packRow);
    packRow.querySelector("#mlnx-pack-import")?.addEventListener("click", () => void this.importAssetPack());
    packRow.querySelector("#mlnx-pack-export")?.addEventListener("click", () => void this.exportBuiltinPack());
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
      '<div class="mlnx-group-label">当前宽度</div>' +
      '<div class="mlnx-sub">' + this.doc.visual.roads.width.toFixed(1) + " 米 · 在右侧地图设置调整</div>";
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
        '<button class="mlnx-btn" id="mlnx-convert-grid">转换为网格地图</button>' +
        '<button class="mlnx-btn" id="mlnx-new-grid">新建网格地图</button>';
      this.leftContent.appendChild(host);
      host.querySelector("#mlnx-convert-grid")?.addEventListener("click", () => {
        if (!window.confirm("转换为网格地图会创建与地图同心的网格地基，确定继续？")) return;
        this.commit(convertToGrid(this.doc), "已转换为网格地图", { rebuild: true });
        this.setTool("terrain");
        this.notice("已转换为网格地图，选择笔刷开始刷地形");
      });
      host.querySelector("#mlnx-new-grid")?.addEventListener("click", () => {
        if (this.dirty && !window.confirm("当前草稿还没保存，确定新建网格地图？")) return;
        this.doc = createGridDocument();
        this.undoStack = [];
        this.redoStack = [];
        this.selection = null;
        this.dirty = false;
        this.rebuildScene();
        this.renderAll();
        this.setTool("terrain");
        this.notice("已新建网格地图");
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
    html += '<p class="mlnx-note">左键拖动刷地形。坡道先点起点再拖到终点；笔刷只影响画面与网格导航。</p>';
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
  }

  private renderInspector(): void {
    this.clearInspector();
    if (!this.selection) {
      this.renderMapInspector();
      return;
    }
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
    this.addSection("地貌");
    this.addSelect(
      "风格",
      this.doc.visual.terrain.style,
      [
        { t: "边境", v: "frontier" },
        { t: "草原", v: "meadow" },
        { t: "秋林", v: "autumn" },
        { t: "灰烬", v: "ash" },
        { t: "海岸", v: "coast" },
        { t: "雪原", v: "snow" },
      ],
      (value) => this.commit(updateTerrain(this.doc, { style: value as never }), "已修改地貌", { terrain: true, sites: true }),
    );
    this.addNumber(
      "起伏",
      this.doc.visual.terrain.amplitude,
      (value) => this.commit(updateTerrain(this.doc, { amplitude: Math.max(0.2, Math.min(3.2, value)) }), "已修改起伏", { terrain: true, sites: true }),
      { min: 0.2, max: 3.2, step: 0.1 },
    );
    this.addNumber(
      "种子",
      this.doc.visual.terrain.seed,
      (value) => this.commit(updateTerrain(this.doc, { seed: Math.round(value) }), "已修改种子", { terrain: true, sites: true }),
      { step: 1, precision: 0 },
    );
    this.addSection("道路");
    this.addSelect(
      "风格",
      this.doc.visual.roads.style,
      [
        { t: "石板", v: "cobble" },
        { t: "土路", v: "dirt" },
      ],
      (value) => this.commit(updateRoadVisual(this.doc, { style: value as never }), "已修改道路风格", { roads: true }),
    );
    this.addNumber(
      "宽度",
      this.doc.visual.roads.width,
      (value) => this.commit(updateRoadVisual(this.doc, { width: Math.max(0.6, Math.min(6, value)) }), "已修改道路宽度", { roads: true }),
      { min: 0.6, max: 6, step: 0.1 },
    );
    const scatter = new BooleanInput({ value: this.doc.visual.scatter });
    scatter.on("change", () => {
      this.commit(updateScatter(this.doc, scatter.value), scatter.value ? "已开启自动补景" : "已关闭自动补景", { rebuild: true });
    });
    const scatterGroup = new LabelGroup({ text: "自动补景", field: scatter });
    this.inspectorEl.appendChild(scatterGroup.dom);
    this.addTop(scatterGroup);
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
      (value) => this.commit(updateFoundation(this.doc, id, { pos: [Math.round(value * 10), foundation.pos[1]] }), "已移动地基", { terrain: true, sites: true }),
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
      (value) => this.commit(updateFoundation(this.doc, id, { pos: [foundation.pos[0], Math.round(value * 10)] }), "已移动地基", { terrain: true, sites: true }),
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
    this.addSection("外壳");
    const assets = assetRegistry.list("foundation");
    const shellOptions: Array<{ t: string; v: string }> = [{ t: "程序化浮岛", v: "" }];
    for (const asset of assets) shellOptions.push({ t: asset.label, v: asset.id });
    this.addSelect(
      "模型",
      foundation.assetId ?? "",
      shellOptions,
      (value) => this.commit(updateFoundation(this.doc, id, { assetId: value ? String(value) : null }), value ? "已设置外壳" : "已恢复程序化浮岛", { terrain: true, sites: true }),
    );
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
    const kind = site.kind === "town" ? "城镇" : site.kind === "granary" ? "粮仓" : "驻兵点";
    this.addHeading(site.id, kind + " · 坐标 " + (site.pos[0] / 10).toFixed(1) + ", " + (site.pos[1] / 10).toFixed(1));
    this.addSection("位置");
    this.addNumber("X", site.pos[0] / 10, (value) => this.commit(updateSite(this.doc, id, { pos: [Math.round(value * 10), site.pos[1]] }), "已移动据点", { sites: true }), { step: 0.5 });
    this.addNumber("Z", site.pos[1] / 10, (value) => this.commit(updateSite(this.doc, id, { pos: [site.pos[0], Math.round(value * 10)] }), "已移动据点", { sites: true }), { step: 0.5 });
    this.addSection("据点");
    this.addSelect(
      "类型",
      site.kind,
      [
        { t: "城镇", v: "town" },
        { t: "粮仓", v: "granary" },
        { t: "驻兵点", v: "outpost" },
      ],
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
    if (site.kind === "town") {
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
      this.addNumber("驻军", site.pop, (value) => this.commit(updateSite(this.doc, id, { pop: Math.max(0, Math.round(value)) }), "已修改驻军", { sites: true }), { min: 0, max: 999, step: 1, precision: 0 });
    }
    this.addSection("外观");
    const buildings = assetRegistry.list("building");
    const buildingOptions: Array<{ t: string; v: string }> = [{ t: "默认外观", v: "" }];
    for (const building of buildings) buildingOptions.push({ t: building.label, v: building.id });
    this.addSelect(
      "模型",
      site.visualAssetId ?? "",
      buildingOptions,
      (value) =>
        this.commit(
          updateSite(this.doc, id, { visualAssetId: value ? String(value) : undefined }),
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
      const watchValue = site.watch ? site.watch[0] + "|" + site.watch[1] : "";
      const watchOptions: Array<{ t: string; v: string }> = [{ t: "未设置", v: "" }];
      for (const road of candidates) watchOptions.push({ t: road.from + " ↔ " + road.to, v: road.from + "|" + road.to });
      this.addSelect("监视道路", watchValue, watchOptions, (value) => {
        if (!value) {
          this.commit(updateSite(this.doc, id, { watch: undefined }), "已清除监视道路", { sites: true });
          return;
        }
        const parts = String(value).split("|");
        if (parts.length === 2) {
          this.commit(updateSite(this.doc, id, { watch: [parts[0], parts[1]] }), "已设置监视道路", { sites: true });
        }
      });
    }
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
    this.addNumber(
      "宽度",
      (road.widthDm ?? this.doc.visual.roads.width * 10) / 10,
      (value) => this.commit(updateRoad(this.doc, id, { widthDm: Math.round(Math.max(0.6, Math.min(6, value)) * 10) }), "已修改道路宽度", { roads: true }),
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
    note.textContent = "用道路工具点击加点绘制；这里可以改宽度、反向和删除。";
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

  private setTool(tool: NextTool): void {
    if (this.gridStroke && tool !== "terrain") this.finishGridStroke();
    if (this.roadDraw && tool !== "road") this.cancelRoad();
    this.tool = tool;
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
      this.commit(updateFoundation(this.doc, selection.id, { pos, elevation }), "已移动地基", { terrain: true, sites: true });
      return;
    }
    if (selection.kind === "site") {
      const pos: [number, number] = [snapDm(proxy.position.x * 10), snapDm(proxy.position.z * 10)];
      const patch: { pos: [number, number]; visualRotation?: number } = { pos };
      if (this.tool === "rotate") {
        patch.visualRotation = ((Math.round((proxy.rotation.y * 180) / Math.PI) % 360) + 360) % 360;
      }
      this.commit(updateSite(this.doc, selection.id, patch), "已更新据点", { sites: true });
      return;
    }
    if (selection.kind === "prop") {
      const pos: [number, number] = [snapDm(proxy.position.x * 10), snapDm(proxy.position.z * 10)];
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
      const radius = Math.max(0.8, (info?.footprint ?? 1.5) * prop.scale * 0.5);
      const material = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
      const proxy = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 6), material);
      proxy.position.set(prop.pos[0] / 10, height + radius, prop.pos[1] / 10);
      proxy.userData = { kind: "prop", id: prop.id };
      this.proxyRoot.add(proxy);
      this.proxies.push(proxy);
    }
    this.syncProxyHighlight();
    this.attachGizmo();
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

  private pick(clientX: number, clientY: number): Selection {
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
      if (data.kind && data.id) return { kind: data.kind, id: data.id };
    }
    return null;
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
    this.scene?.updateTerrain(this.compiled.map, this.compiled.visual);
    this.syncProxies();
  }

  private finishGridStroke(): void {
    const stroke = this.gridStroke;
    this.gridStroke = null;
    if (!stroke) return;
    if (!stroke.changed) {
      this.doc = stroke.before;
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
    this.renderTree();
    this.renderInspector();
    this.updateTop();
    this.updateStatus();
    this.autosave();
    this.notice("已修改网格地形");
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.scene) return;
    if (this.gizmo?.axis) return;
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
    if (this.tool === "select" || this.tool === "move" || this.tool === "rotate" || this.tool === "scale") {
      const hit = this.pick(event.clientX, event.clientY);
      this.select(hit);
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const ground = this.scene?.screenToGround(event.clientX, event.clientY) ?? null;
    this.pointer = { x: event.clientX, y: event.clientY, ground };
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
      const result = addFoundation(this.doc, { pos: center, size, elevation: this.toolElevation });
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
        const kind = this.activeSiteKind === "town" ? "城镇" : this.activeSiteKind === "granary" ? "粮仓" : "驻兵点";
        this.commit(result.document, "已放置 " + kind, { sites: true });
        return;
      }
      const assetId = this.activeAssetId;
      if (!assetId) {
        this.notice("先在左侧选择资产");
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
      if (options.terrain) this.scene.updateTerrain(this.compiled.map, this.compiled.visual);
      if (options.sites) this.updateSitesScene();
      if (options.props) this.scene.updateProps(this.compiled.visual);
      if (options.roads) this.scene.updateRoads(this.compiled.map, this.compiled.visual);
      this.syncProxies();
      this.attachGizmo();
    }
    this.renderTree();
    this.renderInspector();
    this.updateTop();
    this.updateStatus();
    this.updateViewInfo();
    this.autosave();
    this.notice(message);
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
    const distance = Math.max(12, offset.length() * 0.55);
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
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
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
    const shortcuts: Record<string, NextTool> = { v: "select", w: "move", e: "rotate", r: "scale", b: "place", p: "road", g: "terrain" };
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


