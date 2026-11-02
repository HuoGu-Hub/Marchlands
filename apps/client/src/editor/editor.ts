import { createGame } from "@marchlands/sim";
import type { CityId, MapDef, Owner, Ruleset, SimState, SiteKind, Stance } from "@marchlands/sim";
import {
  TERRAIN_STYLES,
  addProp,
  addSite,
  cloneDocument,
  compileDocument,
  connect,
  createStarterDocument,
  disconnect,
  documentLabel,
  moveProp,
  moveSite,
  parseDocument,
  removeProp,
  removeSite,
  serializeDocument,
  updateDocument,
  updateProp,
  updateRoadVisual,
  updateScatter,
  updateSite,
  updateTerrain,
  updateUnitVisual,
  watchCandidates,
} from "@marchlands/map-authoring";
import type {
  CompileResult,
  MapDocument,
  MapVisual,
  PropDraft,
  RoadStyle,
  SiteDraft,
  TerrainStyle,
} from "@marchlands/map-authoring";
import { buildBuiltinAssetPack } from "../game/asset-pack-export";
import { assetRegistry } from "../game/asset-registry";
import { BattleScene } from "../game/scene";
import type { SceneViewState } from "../game/scene";
import { openAssetPackFile, openMapText, saveAssetPackFile, saveMapText } from "./map-io";
import "./editor.css";

type Tool = "select" | SiteKind | "road" | "erase" | "asset";

type Selection = { kind: "site"; id: CityId } | { kind: "prop"; id: string } | null;

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

const TOOL_LABEL: Record<Tool, string> = {
  select: "选择 / 移动",
  town: "城镇",
  granary: "粮仓",
  outpost: "驻兵点",
  road: "道路",
  erase: "删除",
  asset: "放置装饰",
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
      <button class="ml-ed-piece tool" data-tool="road" draggable="false"><i></i><b>道路</b><span>连两个据点</span></button>
      <button class="ml-ed-piece tool" data-tool="erase" draggable="false"><i></i><b>删除</b><span>点据点、道路或装饰</span></button>
      <div class="ml-ed-section-label">据点</div>
      <button class="ml-ed-piece" data-tool="town" draggable="true"><i class="town"></i><b>城镇</b><span>产兵 · 可升级</span></button>
      <button class="ml-ed-piece" data-tool="granary" draggable="true"><i class="granary"></i><b>粮仓</b><span>增幅 · 叶子据点</span></button>
      <button class="ml-ed-piece" data-tool="outpost" draggable="true"><i class="outpost"></i><b>驻兵点</b><span>监视一条路</span></button>
      <div class="ml-ed-section-label">地形</div>
      <div class="ml-ed-asset-grid" id="ml-ed-terrain-grid"></div>
      <div class="ml-ed-section-label">装饰</div>
      <div id="ml-ed-prop-groups"></div>
      <div class="ml-ed-section-label">资产包</div>
      <div class="ml-ed-pack-actions">
        <button class="ml-ed-btn" id="ml-ed-import-pack">导入 .mlpack</button>
        <button class="ml-ed-btn" id="ml-ed-export-pack">导出内置包</button>
      </div>
      <div class="ml-ed-pack-status" id="ml-ed-pack-status"></div>
    </aside>
    <main class="ml-ed-stage">
      <canvas id="ml-ed-canvas"></canvas>
      <canvas id="ml-ed-overlay"></canvas>
      <div class="ml-ed-stage-badge" id="ml-ed-badge">选择工具开始</div>
      <div class="ml-ed-stage-hint">拖拽地形或装饰到地图 · R 旋转 · [ ] 缩放 · 右键拖动 · 滚轮缩放 · Q/E 旋转</div>
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
  return kind === "town" ? "城镇" : kind === "granary" ? "粮仓" : "驻兵点";
}

function toolColor(tool: Tool): string {
  if (tool === "town") return "#c6a36a";
  if (tool === "granary") return "#9fbd72";
  if (tool === "outpost") return "#d07a58";
  if (tool === "road") return "#9cae9c";
  if (tool === "erase") return "#b95332";
  return "#d8ccb8";
}

export class EditorController {
  private readonly options: EditorOptions;
  private doc: MapDocument = createStarterDocument();
  private compiled: CompileResult = compileDocument(this.doc);
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

  private canvas!: HTMLCanvasElement;
  private overlay!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private inspector!: HTMLElement;
  private statusEl!: HTMLElement;
  private diagnosticsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private badgeEl!: HTMLElement;
  private terrainGrid!: HTMLElement;
  private propGroups!: HTMLElement;
  private packStatus!: HTMLElement;
  private playButton!: HTMLButtonElement;
  private undoButton!: HTMLButtonElement;
  private redoButton!: HTMLButtonElement;

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
    this.propGroups = this.options.root.querySelector("#ml-ed-prop-groups") as HTMLElement;
    this.packStatus = this.options.root.querySelector("#ml-ed-pack-status") as HTMLElement;
    this.playButton = this.options.root.querySelector("#ml-ed-play") as HTMLButtonElement;
    this.undoButton = this.options.root.querySelector("#ml-ed-undo") as HTMLButtonElement;
    this.redoButton = this.options.root.querySelector("#ml-ed-redo") as HTMLButtonElement;
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

    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.addEventListener("click", () => {
        const tool = button.dataset.tool as Tool | undefined;
        if (tool) this.setTool(tool);
      });
      button.addEventListener("dragstart", (event) => {
        const tool = button.dataset.tool;
        if (tool !== "town" && tool !== "granary" && tool !== "outpost") return;
        event.dataTransfer?.setData("text/ml-site-kind", tool);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
      });
    }

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);
    this.canvas.addEventListener("click", this.onClick);
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
  }

  private restoreAutosave(): void {
    try {
      const text = localStorage.getItem(AUTOSAVE_KEY);
      if (!text) return;
      const parsed = parseDocument(JSON.parse(text));
      this.doc = parsed.document;
      this.compiled = compileDocument(this.doc);
      this.dirty = false;
      this.notice("已恢复上次草稿");
    } catch {
      this.doc = createStarterDocument();
      this.compiled = compileDocument(this.doc);
    }
  }

  private rebuild(preserveView: boolean): void {
    const view = preserveView ? this.scene?.getViewState() ?? this.view : null;
    this.compiled = compileDocument(this.doc);
    if (this.selection?.kind === "site" && !this.doc.sites.some((site) => site.id === this.selection?.id)) {
      this.selection = null;
    }
    if (this.selection?.kind === "prop" && !this.doc.visual.props.some((prop) => prop.id === this.selection?.id)) {
      this.selection = null;
    }

    let preview: SimState | null = null;
    const hasTown = this.compiled.map.cities.some((city) => city.kind === "town");
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
      this.scene = scene;
      this.view = scene.getViewState();
    }

    this.autosave();
    this.renderInspector();
    this.renderStatus();
    this.syncTop();
    this.drawOverlay();
  }

  private autosave(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeDocument(this.doc));
    } catch {
      // localStorage can be unavailable in a locked profile
    }
  }

  private commit(next: MapDocument, message: string): void {
    if (serializeDocument(next) === serializeDocument(this.doc)) return;
    this.undoStack.push(cloneDocument(this.doc));
    if (this.undoStack.length > 50) this.undoStack.shift();
    this.redoStack = [];
    this.doc = next;
    this.dirty = true;
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
    this.tool = tool;
    if (tool !== "asset") this.activeAsset = null;
    this.roadFrom = null;
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-tool]")) {
      button.classList.toggle("active", button.dataset.tool === tool);
    }
    for (const button of this.options.root.querySelectorAll<HTMLElement>("[data-asset-id]")) {
      button.classList.toggle("active", this.tool === "asset" && button.dataset.assetId === this.activeAsset);
    }
    this.canvas.style.cursor = tool === "select" ? "grab" : tool === "erase" ? "not-allowed" : "crosshair";
    this.badgeEl.textContent = TOOL_LABEL[tool];
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
    const result = addProp(this.doc, assetId, pos, 0, 1);
    this.selection = { kind: "prop", id: result.prop.id };
    this.commit(result.document, `已放置 ${assetRegistry.info(assetId)?.label ?? "装饰"}`);
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
    const tooClose = this.doc.sites.some((site) => Math.hypot(site.pos[0] - pos[0], site.pos[1] - pos[1]) < 80);
    if (tooClose) {
      this.notice("两个据点至少间隔 8 米");
      return;
    }
    const result = addSite(this.doc, kind, pos, 0);
    this.selection = { kind: "site", id: result.site.id };
    this.commit(result.document, `已放置 ${kindLabel(kind)}`);
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

  private pickRoad(clientX: number, clientY: number): [CityId, CityId] | null {
    if (!this.scene) return null;
    const point = { x: clientX, y: clientY };
    let best: [CityId, CityId] | null = null;
    let bestDistance = 12;
    for (const road of this.doc.roads) {
      const a = this.doc.sites.find((site) => site.id === road.from);
      const b = this.doc.sites.find((site) => site.id === road.to);
      if (!a || !b) continue;
      const pa = this.scene.projectGround(a.pos[0], a.pos[1], 1);
      const pb = this.scene.projectGround(b.pos[0], b.pos[1], 1);
      if (!pa || !pb) continue;
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const lengthSq = dx * dx + dy * dy;
      if (lengthSq < 1) continue;
      const t = Math.max(0, Math.min(1, ((point.x - pa.x) * dx + (point.y - pa.y) * dy) / lengthSq));
      const distance = Math.hypot(point.x - (pa.x + dx * t), point.y - (pa.y + dy * t));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [road.from, road.to];
      }
    }
    return best;
  }

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

  private selectedProp(): PropDraft | null {
    if (this.selection?.kind !== "prop") return null;
    return this.doc.visual.props.find((prop) => prop.id === this.selection?.id) ?? null;
  }

  private removeSiteById(id: CityId): void {
    const site = this.doc.sites.find((entry) => entry.id === id);
    if (!site) return;
    const towns = this.doc.sites.filter((entry) => entry.kind === "town").length;
    if (site.kind === "town" && towns <= 1) {
      this.notice("地图至少需要保留一座城镇");
      return;
    }
    if (this.selection?.kind === "site" && this.selection.id === id) this.selection = null;
    this.commit(removeSite(this.doc, id), `已删除 ${id}`);
  }

  private removePropById(id: string): void {
    const prop = this.doc.visual.props.find((entry) => entry.id === id);
    if (!prop) return;
    if (this.selection?.kind === "prop" && this.selection.id === id) this.selection = null;
    this.commit(removeProp(this.doc, id), `已删除装饰 ${prop.id}`);
  }

  private removeRoad(road: [CityId, CityId]): void {
    const next = disconnect(this.doc, road[0], road[1]);
    if (serializeDocument(next) === serializeDocument(this.doc)) {
      this.notice("没有移除道路");
      return;
    }
    this.commit(next, "已移除道路");
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
    if (kind !== "town" && kind !== "granary" && kind !== "outpost") return;
    this.setTool(kind);
    this.addAt(kind, ground);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.scene || event.button === 1 || event.button === 2) {
      this.pan = { x: event.clientX, y: event.clientY, moved: false };
      this.pointerId = event.pointerId;
      this.canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    this.pointer = { x: event.clientX, y: event.clientY, ground: this.scene.screenToGround(event.clientX, event.clientY) };
    if (this.tool === "select") {
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
    if (this.drag) {
      if (this.drag.moved && this.drag.ground) {
        this.commit(moveSite(this.doc, this.drag.id, this.drag.ground), `已移动 ${this.drag.id}`);
        this.suppressClick = true;
      }
      this.drag = null;
    }
    if (this.propDrag) {
      if (this.propDrag.moved && this.propDrag.ground) {
        this.commit(moveProp(this.doc, this.propDrag.id, this.propDrag.ground), `已移动装饰 ${this.propDrag.id}`);
        this.suppressClick = true;
      }
      this.propDrag = null;
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
      if (this.tool === "select") this.notice("先放置一座城镇");
      return;
    }
    const ground = this.scene.screenToGround(event.clientX, event.clientY);
    if (!ground) return;

    if (this.tool === "asset") {
      if (this.activeAsset) this.addAssetAt(this.activeAsset, ground);
      else this.notice("先从左侧选择地形或装饰");
      return;
    }

    if (this.tool === "town" || this.tool === "granary" || this.tool === "outpost") {
      this.addAt(this.tool, ground);
      return;
    }

    if (this.tool === "road") {
      const hit = this.pickSite(event.clientX, event.clientY);
      if (!hit) {
        this.notice("点一个据点作为道路起点");
        return;
      }
      if (!this.roadFrom) {
        this.roadFrom = hit;
        this.notice(`道路起点 ${hit}，再点另一个据点`);
        this.drawOverlay();
        return;
      }
      if (this.roadFrom === hit) {
        this.roadFrom = null;
        this.notice("已取消道路起点");
        this.drawOverlay();
        return;
      }
      const next = connect(this.doc, this.roadFrom, hit);
      if (serializeDocument(next) === serializeDocument(this.doc)) {
        this.notice("这两点之间已经有路");
      } else {
        this.commit(next, `已连接 ${this.roadFrom} → ${hit}`);
      }
      this.roadFrom = null;
      this.drawOverlay();
      return;
    }

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
      if (road) this.removeRoad(road);
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
    if (target && (target.tagName === "INPUT" || target.tagName === "SELECT" || target.tagName === "TEXTAREA")) {
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
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.selection?.kind === "site") {
        event.preventDefault();
        this.removeSiteById(this.selection.id);
      } else if (this.selection?.kind === "prop") {
        event.preventDefault();
        this.removePropById(this.selection.id);
      }
      return;
    }
    if (event.key.toLowerCase() === "r") {
      const prop = this.selectedProp();
      if (prop) {
        event.preventDefault();
        this.commit(updateProp(this.doc, prop.id, { rotation: prop.rotation + (event.shiftKey ? -15 : 15) }), "已旋转装饰");
      }
      return;
    }
    if (event.key === "[" || event.key === "]") {
      const prop = this.selectedProp();
      if (prop) {
        event.preventDefault();
        const scale = prop.scale + (event.key === "]" ? 0.1 : -0.1);
        this.commit(updateProp(this.doc, prop.id, { scale }), "已缩放装饰");
      }
      return;
    }
    if (event.key === "Escape") {
      this.roadFrom = null;
      this.selectSite(null);
      this.setTool("select");
      return;
    }
    if (event.key.toLowerCase() === "q") this.scene?.rotate(-1);
    if (event.key.toLowerCase() === "e") this.scene?.rotate(1);
  };

  private renderInspector(): void {
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
      candidates.push({ from: site.watch?.[0] ?? "", to: site.watch?.[1] ?? "" });
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
          ${option("town", site.kind, "城镇")}
          ${option("granary", site.kind, "粮仓")}
          ${option("outpost", site.kind, "驻兵点")}
        </select>
      </label>
      <label class="ml-ed-field"><span>归属</span>
        <select data-site="${site.id}" data-field="owner">
          ${option(0, site.owner, "中立")}
          ${option(1, site.owner, "绿方")}
          ${option(2, site.owner, "红方")}
        </select>
      </label>
      ${site.kind === "town" ? `
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

  private mapSettingsHtml(): string {
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error").length;
    const missing = this.doc.visual.props.filter((prop) => !assetRegistry.has(prop.assetId)).length;
    const unitAssets = assetRegistry.list("unit");
    const packRows = assetRegistry.packList
      .map(
        (pack) => `<div class="ml-ed-pack-row"><span>${escapeHtml(pack.name)}</span><button data-pack-remove="${escapeHtml(pack.id)}">移除</button></div>`,
      )
      .join("");
    return `
      <h3>地图设置</h3>
      <div class="ml-ed-kind">${this.doc.sites.length} 个据点 · ${this.doc.visual.props.length} 个装饰 · ${errors} 个错误</div>
      <label class="ml-ed-field"><span>地图名称</span><input data-field="name" value="${escapeHtml(this.doc.name)}"></label>
      <div class="ml-ed-row">
        <label class="ml-ed-field"><span>宽</span><input data-field="width" type="number" min="100" max="2000" step="10" value="${this.doc.size[0]}"></label>
        <label class="ml-ed-field"><span>高</span><input data-field="height" type="number" min="100" max="2000" step="10" value="${this.doc.size[1]}"></label>
      </div>
      <label class="ml-ed-field"><span>通行规则</span>
        <select data-field="transit">
          ${option("friendly", this.doc.transit, "友方通行")}
          ${option("open", this.doc.transit, "开放通行")}
        </select>
      </label>
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
      <label class="ml-ed-check"><input data-field="scatter" type="checkbox" ${this.doc.visual.scatter ? "checked" : ""}><span>自动补树、石头与草丛</span></label>
      <div class="ml-ed-section-label">单位外观</div>
      <label class="ml-ed-field"><span>绿方兵团</span>
        <select data-field="unitPlayer1">
          ${option("", this.doc.visual.units.player1 ?? "", "默认程序化单位")}
          ${unitAssets.map((asset) => option(asset.id, this.doc.visual.units.player1 ?? "", `${asset.label}${asset.source === "pack" ? " · 资产包" : ""}`)).join("")}
        </select>
      </label>
      <label class="ml-ed-field"><span>红方兵团</span>
        <select data-field="unitPlayer2">
          ${option("", this.doc.visual.units.player2 ?? "", "默认程序化单位")}
          ${unitAssets.map((asset) => option(asset.id, this.doc.visual.units.player2 ?? "", `${asset.label}${asset.source === "pack" ? " · 资产包" : ""}`)).join("")}
        </select>
      </label>
      ${unitAssets.length === 0 ? `<p class="ml-ed-note">当前没有单位资产。导入含 unit 资产的 .mlpack 后，可在这里替换兵团外观。</p>` : ""}
      ${packRows ? `<div class="ml-ed-pack-list">${packRows}</div>` : ""}
      <div class="ml-ed-meta">目标：占领全部城镇<br>时限：15 分钟<br>资产包：${assetRegistry.counts().packs} 个${missing > 0 ? ` · ${missing} 个装饰缺失` : ""}</div>
      <p class="ml-ed-note">从左侧拖入地形、树木与城镇装饰；拖动装饰可移动，选中后可旋转和缩放。</p>
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
        if (siteId) this.changeSiteField(siteId, name, value);
        else if (propId) this.changePropField(propId, name, value);
        else this.changeMapField(name, value);
      });
    }
    this.inspector.querySelector<HTMLElement>("[data-action=delete]")?.addEventListener("click", () => {
      if (this.selection?.kind === "site") this.removeSiteById(this.selection.id);
    });
    this.inspector.querySelector<HTMLElement>("[data-action=delete-prop]")?.addEventListener("click", () => {
      if (this.selection?.kind === "prop") this.removePropById(this.selection.id);
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

  private changeSiteField(id: CityId, field: string, value: string): void {
    const site = this.doc.sites.find((entry) => entry.id === id);
    if (!site) return;
    if (field === "kind") {
      const kind = value as SiteKind;
      if (site.kind === "town" && kind !== "town" && this.doc.sites.filter((entry) => entry.kind === "town").length <= 1) {
        this.notice("地图至少需要保留一座城镇");
        this.renderInspector();
        return;
      }
      this.commit(updateSite(this.doc, id, { kind }), "已修改据点类型");
      return;
    }
    if (field === "owner") {
      this.commit(updateSite(this.doc, id, { owner: Number(value) as Owner }), "已修改归属");
      return;
    }
    if (field === "level") {
      this.commit(updateSite(this.doc, id, { level: Number(value) as 1 | 2 | 3 }), "已修改等级");
      return;
    }
    if (field === "pop") {
      this.commit(updateSite(this.doc, id, { pop: Number(value) }), "已修改驻军");
      return;
    }
    if (field === "stance") {
      this.commit(updateSite(this.doc, id, { stance: value as Stance }), "已修改驻守状态");
      return;
    }
    if (field === "watch") {
      if (!value) {
        this.commit(updateSite(this.doc, id, { watch: undefined }), "已清除监视道路");
      } else {
        const [from, to] = value.split("|");
        this.commit(updateSite(this.doc, id, { watch: [from, to] }), "已设置监视道路");
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
      this.commit(updateProp(this.doc, id, { rotation: Number(value) || 0 }), "已修改装饰朝向");
      return;
    }
    if (field === "scale") {
      this.commit(updateProp(this.doc, id, { scale: Number(value) || 1 }), "已修改装饰缩放");
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
    if (field === "terrainStyle") {
      this.commit(updateTerrain(this.doc, { style: value as TerrainStyle }), "已修改地貌风格");
      return;
    }
    if (field === "terrainAmplitude") {
      this.commit(updateTerrain(this.doc, { amplitude: Number(value) || 1 }), "已修改地形起伏");
      return;
    }
    if (field === "terrainSeed") {
      this.commit(updateTerrain(this.doc, { seed: Math.round(Number(value) || 0) }), "已修改地形种子");
      return;
    }
    if (field === "roadStyle") {
      this.commit(updateRoadVisual(this.doc, { style: value as RoadStyle }), "已修改道路风格");
      return;
    }
    if (field === "roadWidth") {
      this.commit(updateRoadVisual(this.doc, { width: Number(value) || 1.6 }), "已修改道路宽度");
      return;
    }
    if (field === "scatter") {
      this.commit(updateScatter(this.doc, value === "true"), value === "true" ? "已开启自动补景" : "已关闭自动补景");
      return;
    }
    if (field === "unitPlayer1" || field === "unitPlayer2") {
      this.commit(
        updateUnitVisual(this.doc, field === "unitPlayer1" ? "player1" : "player2", value || undefined),
        value ? "已替换兵团外观" : "已恢复默认兵团",
      );
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
    const errors = this.compiled.diagnostics.filter((entry) => entry.severity === "error");
    if (errors.length > 0 || !this.preview) {
      this.notice("先修复地图错误再试玩");
      return;
    }
    this.options.onPlaytest(this.compiled.map, this.compiled.visual);
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

    if ((this.tool === "town" || this.tool === "granary" || this.tool === "outpost") && this.pointer.ground) {
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
