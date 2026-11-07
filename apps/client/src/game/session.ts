import { createAi, createGame, step } from "@marchlands/sim";
import type { MapVisual } from "@marchlands/map-authoring";
import type {
  AiController,
  AiTuning,
  CityId,
  CityState,
  Command,
  GridReach,
  MapDef,
  Ruleset,
  SimState,
  SquadStance,
  SquadState,
} from "@marchlands/sim";
import {
  canDispatchFrom,
  createUnitNavGrid,
  isProductionSiteKind,
  planGridRoute,
  reachableGridCells,
  reachableGridCities,
  sendReachableTargets,
  siteUnitKind,
} from "@marchlands/sim";
import { audio } from "../audio";
import { assetRegistry } from "./asset-registry";
import { RouteOverlay } from "./route-overlay";
import { synthesizeGrid } from "./nav-synthesis";
import type { DragArrowView, PlannedAssignment } from "./route-overlay";
import { BattleScene } from "./scene";

const FIXED_STEP = 50;
const PLAN_CANCEL_WINDOW = 500;
/** 开局倒计时与镜头推进时长。 */
const INTRO_MS = 3600;
const REASONS: Record<string, string> = {
  unknown_city: "据点不存在",
  unknown_target: "目标不存在",
  same_city: "不能派往本城",
  not_owned: "不是你的据点",
  not_producer: "该据点不产兵",
  too_few_troops: "守军不足两人",
  no_route: "没有可行路线：中立或敌方据点阻断了道路",
  max_level: "已达最高等级",
  insufficient_pop: "人口不足",
  not_upgradable: "该据点不能升级",
  not_outpost: "只有临时驻兵点可以切换状态",
  invalid_stance: "无效的驻守状态",
  unknown_squad: "兵团不存在",
  squad_arrived: "兵团已经抵达",
  invalid_via: "该路线无法从下一个路口接入",
  game_finished: "对局已结束",
};

export interface GameSessionOptions {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  map: MapDef;
  visual?: MapVisual | null;
  /** 开场前选定的兵团皮肤：兵种 → 资产 id。 */
  unitSkins?: Record<string, string>;
  /** 本局敌军的行为参数，缺省为标准难度。 */
  aiTuning?: AiTuning;
  rules: Ruleset;
  onFinish: (state: SimState) => void;
  onToast: (text: string) => void;
  onSelect: (cityId: CityId | null, count: number) => void;
  /** 第一帧真正画到屏幕上之后再开局，用来隐藏建场与首次编译的停顿。 */
  onReady?: () => void;
}

export class GameSession {
  private readonly options: GameSessionOptions;
  private readonly timeScale: number;
  private readonly ai: AiController;
  private scene: BattleScene;
  private routeOverlay: RouteOverlay;
  private state: SimState;
  private simMap: MapDef;
  private selected: CityId[] = [];
  private selectedSquad: string | null = null;
  private dispatchStance: SquadStance = "guard";
  private gridReach = new Map<CityId, GridReach>();
  private gridFocus: GridReach | null = null;
  private multiSelect = false;
  private plan: PlannedAssignment[] = [];
  private lastPlanClick: { index: number; at: number } | null = null;
  private reachKey = "";
  private reachTargets: CityId[] = [];
  private commands: Command[] = [];
  /** AI 一次决策可能产生十几条派兵；摊到后续帧执行，避免单帧寻路卡顿。 */
  private aiQueue: Command[] = [];
  private aiCommandsThisFrame = 0;
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private paused = false;
  private finished = false;
  private disposed = false;
  private dragging = false;
  private dragMoved = false;
  private dispatchDrag = false;
  private dispatchSource: CityId | null = null;
  private planDragSources: CityId[] = [];
  private dragPreviewFrame = 0;
  private dragPreviewPoint: { x: number; y: number } | null = null;
  private pathUpdateAt = 0;
  private pathSelection = "";
  private clashTextAt = 0;
  private suppressClick = false;
  private dragX = 0;
  private dragY = 0;
  private dragStartX = 0;
  private dragStartY = 0;
  private readonly introDisabled: boolean;
  private ready = false;
  private introActive = false;
  private introElapsed = 0;
  private introHideTimer = 0;
  private readonly introRoot: HTMLElement | null;
  private readonly introShade: HTMLElement | null;
  private readonly introCount: HTMLElement | null;
  private readonly introLabel: HTMLElement | null;

  constructor(options: GameSessionOptions) {
    this.options = options;
    const params = new URLSearchParams(window.location.search);
    this.introDisabled = import.meta.env.DEV && params.get("intro") === "0";
    const requested = Number(params.get("speed") ?? "1");
    this.timeScale = import.meta.env.DEV ? Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 1)) : 1;
    this.ai = createAi(2, options.aiTuning);
    this.scene = new BattleScene(options.canvas, options.map, options.visual ?? null, options.unitSkins ?? {});
    this.simMap = synthesizeGrid(options.map, this.scene);
    this.state = createGame(this.simMap, Math.floor(Math.random() * 1_000_000_000), this.slowRules());
    this.routeOverlay = new RouteOverlay({
      canvas: options.canvas,
      scene: this.scene,
      map: options.map,
    });
    this.bindInput();
    this.updateHud();
    this.syncDispatchStance();
    this.introRoot = options.hud.querySelector<HTMLElement>("#match-intro");
    this.introShade = options.hud.querySelector<HTMLElement>("#match-intro-shade");
    this.introCount = options.hud.querySelector<HTMLElement>("#match-intro-count");
    this.introLabel = options.hud.querySelector<HTMLElement>("#match-intro-label");
  }

  private slowRules() {
    if (!this.options.rules) return undefined;
    return {
      ...this.options.rules,
      speedDmPerSecond: Math.max(1, this.options.rules.speedDmPerSecond * 0.7),
    };
  }

  start(): void {
    this.ready = this.introDisabled;
    if (this.introDisabled) {
      this.beginIntro();
      // 开发用 intro=0 直接进对局，没有准备帧；在首帧前补一次 ready 通知。
      requestAnimationFrame(() => {
        if (this.disposed) return;
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__mlReadyAt = performance.now();
        }
        this.options.onReady?.();
      });
    }
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    if (this.finished) return;
    this.paused = false;
    this.lastTime = performance.now();
    this.accumulator = 0;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** 开局倒计时是否仍在进行。 */
  isIntroActive(): boolean {
    return this.introActive;
  }

  private scheduleReachPreparation(): void {
    const run = (): void => {
      if (!this.disposed) this.scene.prepareReachableCells(this.state.map);
    };
    const idle = window.requestIdleCallback;
    if (idle) idle(run, { timeout: 2500 });
    else window.setTimeout(run, 400);
  }

  private beginIntro(): void {
    if (this.introDisabled) return;
    const home = this.state.cities.find((city) => city.owner === 1);
    if (!home) return;
    this.introActive = true;
    this.introElapsed = 0;
    if (this.introShade) this.introShade.style.opacity = "1";
    this.scene.startIntro(home.pos[0] / 10, home.pos[1] / 10, INTRO_MS);
    if (!this.introRoot) return;
    window.clearTimeout(this.introHideTimer);
    this.introRoot.hidden = false;
    this.introRoot.classList.remove("done", "preparing");
    requestAnimationFrame(() => {
      if (this.introActive) this.introRoot?.classList.add("on");
    });
    this.updateIntroUi(true);
  }

  private updateIntroUi(force = false): void {
    const progress = Math.min(1, this.introElapsed / INTRO_MS);
    if (this.introShade) this.introShade.style.opacity = String(Math.max(0, 1 - progress));
    if (!this.introCount) return;
    const remaining = INTRO_MS - this.introElapsed;
    const label = remaining > 2600 ? "3" : remaining > 1600 ? "2" : remaining > 600 ? "1" : "开始";
    if (!force && this.introCount.textContent === label) return;
    this.introCount.textContent = label;
    if (this.introLabel) this.introLabel.textContent = label === "开始" ? "" : "部署";
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.introCount.animate(
      [
        { opacity: 0.25, transform: "scale(1.16)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 240, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }

  /** 结束倒计时：镜头落位并开始模拟；click / wheel 可直接跳过。 */
  private finishIntro(): void {
    if (!this.introActive) return;
    this.introActive = false;
    this.scene.skipIntro();
    this.accumulator = 0;
    if (this.introShade) this.introShade.style.opacity = "0";
    if (!this.introRoot) return;
    this.introRoot.classList.remove("on");
    this.introRoot.classList.add("done");
    this.introHideTimer = window.setTimeout(() => {
      if (this.introRoot && !this.introActive) this.introRoot.hidden = true;
    }, 280);
  }

  restart(): void {
    this.routeOverlay.dispose();
    this.scene.dispose();
    this.scene = new BattleScene(this.options.canvas, this.options.map, this.options.visual ?? null, this.options.unitSkins ?? {});
    this.simMap = synthesizeGrid(this.options.map, this.scene);
    this.state = createGame(this.simMap, Math.floor(Math.random() * 1_000_000_000), this.slowRules());
    this.scene.prepareReachableCells(this.state.map);
    this.routeOverlay = new RouteOverlay({
      canvas: this.options.canvas,
      scene: this.scene,
      map: this.options.map,
    });
    this.selected = [];
    this.selectedSquad = null;
    this.multiSelect = false;
    this.plan = [];
    this.lastPlanClick = null;
    this.reachKey = "";
    this.reachTargets = [];
    this.commands = [];
    this.aiQueue = [];
    this.aiCommandsThisFrame = 0;
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.paused = false;
    this.finished = false;
    const home = this.state.cities.find((city) => city.owner === 1);
    if (home) this.select(home.id);
    this.updateHud();
    this.updatePlanUi();
    this.beginIntro();
  }

  getCity(id: CityId): CityState | undefined {
    return this.state.cities.find((city) => city.id === id);
  }

  getSquad(id: string): SquadState | undefined {
    return this.state.squads.find((squad) => squad.id === id);
  }

  /** 当前选中的己方据点；最后选中或最后追加的一座作为面板主目标。 */
  private get primary(): CityId | null {
    return this.selected.length > 0 ? this.selected[this.selected.length - 1] : null;
  }

  select(id: CityId): void {
    const city = this.getCity(id);
    if (!city || city.owner !== 1) return;
    this.selectedSquad = null;
    this.setSelection([id]);
    this.announceCity(city);
  }

  /** 批量指定：把据点加入或移出当前编组；已分配到目标的据点会先退回编组。 */
  togglePending(id: CityId): void {
    const city = this.getCity(id);
    if (!city || city.owner !== 1) return;
    this.selectedSquad = null;
    this.removeFromPlan(id);
    if (this.selected.includes(id)) this.setSelection(this.selected.filter((entry) => entry !== id));
    else this.setSelection([...this.selected, id]);
  }

  /** 兵团优先按模型命中；点不到模型时再退回路线层圆点。 */
  private pickSquadAt(clientX: number, clientY: number): string | null {
    return this.scene.pickSquad(clientX, clientY) ?? this.routeOverlay.pickSquad(this.state, clientX, clientY);
  }

  selectSquad(id: string): void {
    const squad = this.getSquad(id);
    if (!squad || squad.owner !== 1) return;
    this.selectedSquad = squad.id;
    this.scene.setSelectedSquad(squad.id);
    this.setSelection([]);
    this.syncSquadPanel();
  }

  clearSelection(): void {
    this.selectedSquad = null;
    this.scene.setSelectedSquad(null);
    this.setSelection([]);
    this.setSquadPanelVisible(false);
  }

  /** 出兵姿态：之后所有据点派兵都按这个姿态生成兵团。 */
  setDispatchStance(stance: SquadStance): void {
    if (this.dispatchStance === stance) return;
    this.dispatchStance = stance;
    this.syncDispatchStance();
  }

  /** 改选中兵团的姿态；已经出发的兵团立即生效。 */
  setSelectedSquadStance(stance: SquadStance): void {
    const squad = this.selectedSquad;
    if (!squad) return;
    const current = this.getSquad(squad);
    if (!current || current.stance === stance) return;
    this.commands.push({ type: "setSquadStance", squad, stance });
  }

  private syncDispatchStance(): void {
    this.syncStanceButtons("#city-stance", this.dispatchStance);
  }

  private syncStanceButtons(selector: string, active: SquadStance): void {
    this.options.hud
      .querySelectorAll<HTMLButtonElement>(`${selector} [data-stance]`)
      .forEach((button) => {
        button.classList.toggle("on", button.dataset.stance === active);
      });
  }

  private setSquadPanelVisible(visible: boolean): void {
    this.options.hud.querySelector<HTMLElement>("#squad-panel")?.classList.toggle("on", visible);
  }

  private syncSquadPanel(): void {
    const id = this.selectedSquad;
    const squad = id ? this.getSquad(id) : null;
    if (!squad) {
      this.setSquadPanelVisible(false);
      return;
    }
    this.setSquadPanelVisible(true);
    this.setText(
      "squad-state",
      squad.engagedWith
        ? squad.stance === "forced"
          ? "交战中 · 继续行军"
          : "交战中 · 停止"
        : squad.stance === "forced"
          ? "强行军向目的地"
          : "警戒行军",
    );
    this.syncStanceButtons("#squad-stance", squad.stance);
  }

  upgradeSelected(): void {
    const id = this.primary;
    if (!id) {
      this.options.onToast("先选择己方产兵据点");
      return;
    }
    const city = this.getCity(id);
    if (!city || !isProductionSiteKind(city.kind)) {
      this.options.onToast("该据点不能升级");
      return;
    }
    this.commands.push({ type: "upgrade", city: id });
  }

  toggleTransit(): void {
    const id = this.primary;
    if (!id) return;
    const city = this.getCity(id);
    if (!city || city.owner === 0) {
      this.options.onToast("中立据点不能切换通行状态");
      return;
    }
    this.commands.push({
      type: "setTransit",
      city: city.id,
      mode: city.transit === "open" ? "intercept" : "release",
    });
  }

  toggleStance(): void {
    const id = this.primary;
    if (!id) {
      this.options.onToast("先选择己方临时驻兵点");
      return;
    }
    const city = this.getCity(id);
    if (!city || city.owner !== 1 || city.kind !== "outpost") {
      this.options.onToast("只有己方临时驻兵点可以切换状态");
      return;
    }
    this.commands.push({
      type: "setStance",
      city: city.id,
      stance: city.stance === "engage" ? "evade" : "engage",
    });
  }

  private setSelection(ids: CityId[]): void {
    this.selected = ids;
    // 选择一变，上一条路线预览就不再对应当前编组。
    this.scene.setPreviewPath(null);
    if (ids.length > 0) this.setSquadPanelVisible(false);
    this.scene.setSelected(ids);
    this.refreshReach(true);
    this.options.onSelect(this.primary, ids.length);
    this.updatePlanUi();
  }

  private announceCity(city: CityState): void {
    if (city.kind === "outpost") {
      this.options.onToast("R 切换迎战 / 避战");
    } else if (city.kind === "granary") {
      const speed = Math.round(this.state.rules.granary.speedBonusMilli / 10);
      const strength = Math.round(this.state.rules.granary.strengthBonusMilli / 10);
      this.options.onToast(`粮仓：行军速度 +${speed}% · 战斗力 +${strength}%`);
    }
  }

  /** 标注当前选择可以派兵抵达的据点与网格。 */
  private refreshReach(force = false): void {
    const signature = `${this.selected.join(",")}|${this.state.cities
      .map(
        (city) =>
          `${city.id}:${city.owner}:${city.transit ?? ""}:${canDispatchFrom(city) ? 1 : 0}`,
      )
      .join(",")}`;
    if (!force && signature === this.reachKey) return;
    this.reachKey = signature;
    const selected = new Set(this.selected);
    // 只显示最后点选的那座建筑的可达范围，避免多选时把几座城的范围混在一起。
    const focus = this.primary;

    if (this.state.nav) {
      // 只算当前显示的那座；其余编组据点在派兵/分配时按需再算，避免多选越点越卡。
      this.gridReach.clear();
      const focusReach = focus ? reachableGridCells(this.state, focus) : null;
      if (focus && focusReach) this.gridReach.set(focus, focusReach);
      this.gridFocus = focusReach;
      this.reachTargets = this.gridFocus && focus
        ? reachableGridCities(this.state, focus, this.gridFocus)
            .filter((id) => !selected.has(id) && this.getCity(id)?.owner !== 1)
            .sort()
        : [];
      this.scene.setReachable([]);
      this.scene.setReachableCells(this.gridFocus, this.reachTargets);
    } else {
      this.gridReach.clear();
      this.gridFocus = null;
      const targets = new Set<CityId>();
      if (focus) {
        for (const target of sendReachableTargets(this.state, focus)) {
          if (!selected.has(target)) targets.add(target);
        }
      }
      this.reachTargets = [...targets].filter((id) => this.getCity(id)?.owner !== 1).sort();
      this.scene.setReachableCells(null, []);
      this.scene.setReachable(this.reachTargets);
    }

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlReach = {
        selected: this.selected.slice(),
        focus,
        targets: this.reachTargets.slice(),
        gridCells: this.gridFocus
          ? this.gridFocus.cells.reduce((sum, value) => sum + value, 0)
          : 0,
      };
    }
  }

  /** 目标建筑是否可达；网格地图直接用洪泛结果判断，不再逐城跑 A*。 */
  private reachCities(id: CityId): CityId[] {
    if (!this.state.nav) return sendReachableTargets(this.state, id);
    const reach = this.gridReach.get(id) ?? reachableGridCells(this.state, id);
    return reach ? reachableGridCities(this.state, id, reach) : [];
  }

  /** 同时向目标派兵；无法出发的据点单独说明原因。 */
  private sendTo(to: CityId): void {
    const sources = this.selected.filter((id) => id !== to);
    if (sources.length === 0) return;
    let sent = 0;
    let problem = "";
    for (const id of sources) {
      const from = this.getCity(id);
      if (!from || from.owner !== 1) continue;
      if (!canDispatchFrom(from)) {
        if (!problem) problem = `${id} 守军不足`;
        continue;
      }
      if (!this.reachCities(id).includes(to)) {
        if (!problem) problem = `${id} 路线被阻断`;
        continue;
      }
      this.commands.push({ type: "send", from: id, to, stance: this.dispatchStance });
      sent += 1;
    }
    if (sent === 0) {
      this.options.onToast(problem || "无法派兵");
      return;
    }
    if (sent < sources.length && problem) this.options.onToast(`${sent} 座发兵 · ${problem}`);
    else if (sent > 1) this.options.onToast(`${sent} 座据点同时发兵`);
    this.setSelection([]);
  }

  /** Ctrl 单击切换单/多选模式。 */
  private toggleMultiSelect(): void {
    if (this.paused || this.finished) return;
    if (this.multiSelect) this.exitMultiSelect();
    else this.enterMultiSelect();
  }

  /** 进入多选：清空单选，重新编组，等按钮确认派遣。 */
  private enterMultiSelect(): void {
    if (this.multiSelect) return;
    this.multiSelect = true;
    this.selectedSquad = null;
    this.plan = [];
    this.lastPlanClick = null;
    this.routeOverlay.setPlan([]);
    this.setSelection([]);
  }

  /** 退出多选：未派遣的任务一并取消，当前编组保留为普通选择。 */
  private exitMultiSelect(): void {
    if (!this.multiSelect) return;
    const cancelled = this.plan.length;
    this.multiSelect = false;
    this.plan = [];
    this.lastPlanClick = null;
    this.routeOverlay.setPlan([]);
    this.updatePlanUi();
    if (cancelled > 0) this.options.onToast(`已退出多选 · ${cancelled} 组任务已取消`);
  }

  /** “派遣”按钮：确认发出所有编组，仍留在多选模式。 */
  dispatchSelectedPlan(): void {
    if (!this.multiSelect || this.plan.length === 0 || this.paused || this.finished) return;
    const plan = this.plan;
    this.plan = [];
    this.lastPlanClick = null;
    this.routeOverlay.setPlan([]);
    this.updatePlanUi();
    const sent = this.dispatchPlan(plan, true);
    if (sent > 0) this.setSelection([]);
  }

  /** 双击箭头取消一组任务。 */
  private cancelPlanGroup(index: number): void {
    const group = this.plan[index];
    if (!group) return;
    this.plan = this.plan.filter((_, entry) => entry !== index);
    this.lastPlanClick = null;
    this.routeOverlay.setPlan(this.plan);
    this.updatePlanUi();
    this.options.onToast(`已取消 ${group.sources.length} 座 → ${group.to ?? "网格"}`);
  }

  /** 点击敌方据点：把编组里能抵达的据点登记到该目标，其余留在编组里继续指定。 */
  private assignPlanCity(to: CityId): void {
    if (this.selected.length === 0) {
      this.options.onToast("先点击己方据点编组");
      return;
    }
    const sources: CityId[] = [];
    const left: CityId[] = [];
    for (const id of this.selected) {
      if (id === to) continue;
      if (this.reachCities(id).includes(to)) sources.push(id);
      else left.push(id);
    }
    if (sources.length === 0) {
      this.options.onToast(`无法抵达 ${to}`);
      return;
    }
    this.plan.push({ sources, to });
    this.lastPlanClick = null;
    this.routeOverlay.setPlan(this.plan);
    this.setSelection(left);
    this.options.onToast(
      left.length > 0
        ? `${sources.length} 座据点 → ${to} · ${left.length} 座无法抵达`
        : `${sources.length} 座据点 → ${to}`,
    );
  }

  /** 点击浅绿网格：把编组里能抵达该格的据点登记到网格目标。 */
  private assignPlanCell(xCm: number, zCm: number, index: number): void {
    if (this.selected.length === 0) {
      this.options.onToast("先点击己方据点编组");
      return;
    }
    const sources: CityId[] = [];
    const left: CityId[] = [];
    for (const id of this.selected) {
      const reach = this.gridReach.get(id) ?? reachableGridCells(this.state, id);
      if (reach && reach.cells[index] === 1) sources.push(id);
      else left.push(id);
    }
    if (sources.length === 0) {
      this.options.onToast("无法抵达该网格");
      return;
    }
    this.plan.push({ sources, cell: [xCm, zCm] });
    this.lastPlanClick = null;
    this.routeOverlay.setPlan(this.plan);
    this.setSelection(left);
    this.options.onToast(
      left.length > 0
        ? `${sources.length} 座据点 → 网格 · ${left.length} 座无法抵达`
        : `${sources.length} 座据点 → 网格`,
    );
  }

  /** 把据点从已指定的目标中撤回，便于重新编组。 */
  private removeFromPlan(id: CityId): void {
    let changed = false;
    const next: PlannedAssignment[] = [];
    for (const group of this.plan) {
      if (!group.sources.includes(id)) {
        next.push(group);
        continue;
      }
      changed = true;
      const sources = group.sources.filter((source) => source !== id);
      if (sources.length > 0) {
        next.push({
          sources,
          ...(group.to !== undefined ? { to: group.to } : {}),
          ...(group.cell ? { cell: [group.cell[0], group.cell[1]] as [number, number] } : {}),
        });
      }
    }
    if (!changed) return;
    this.plan = next;
    this.routeOverlay.setPlan(this.plan);
  }

  /** 所有编组的发兵命令在同一 tick 入队，抵达时序与多选同时发兵一致。 */
  private dispatchPlan(plan: PlannedAssignment[], announce = false): number {
    if (plan.length === 0) return 0;
    let sent = 0;
    let problem = "";
    for (const group of plan) {
      for (const id of group.sources) {
        const from = this.getCity(id);
        if (!from || from.owner !== 1) continue;
        if (!canDispatchFrom(from)) {
          if (!problem) problem = `${id} 守军不足`;
          continue;
        }
        if (group.cell) {
          const reach = reachableGridCells(this.state, id);
          const index = this.cellIndexAt(group.cell[0], group.cell[1]);
          if (!reach || index < 0 || reach.cells[index] !== 1) {
            if (!problem) problem = `${id} 无法抵达该网格`;
            continue;
          }
          this.commands.push({
            type: "sendCell",
            from: id,
            xCm: group.cell[0],
            zCm: group.cell[1],
            stance: this.dispatchStance,
          });
          sent += 1;
          continue;
        }
        if (group.to === undefined) continue;
        if (!this.reachCities(id).includes(group.to)) {
          if (!problem) problem = `${id} 路线被阻断`;
          continue;
        }
        this.commands.push({ type: "send", from: id, to: group.to, stance: this.dispatchStance });
        sent += 1;
      }
    }
    if (sent === 0) {
      this.options.onToast(problem || "无法派兵");
      return 0;
    }
    if (problem) this.options.onToast(`${sent} 座发兵 · ${problem}`);
    else if (sent > 1) this.options.onToast(`${sent} 座据点同时发兵`);
    else if (announce) this.options.onToast("1 座据点已派遣");
    return sent;
  }

  private updatePlanUi(): void {
    this.syncDispatchButton();
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlPlan = {
        multiSelect: this.multiSelect,
        pending: this.selected.slice(),
        groups: this.plan.map((group) => ({
          sources: group.sources.slice(),
          ...(group.to !== undefined ? { to: group.to } : {}),
          ...(group.cell ? { cell: [group.cell[0], group.cell[1]] as [number, number] } : {}),
        })),
        arcs: this.plan.map((_, index) => this.routeOverlay.planMidpoint(index)),
      };
    }
    if (!this.multiSelect) {
      this.setPlanHint("");
      return;
    }
    const pending = this.selected.length;
    const groups = this.plan.length;
    const focus = this.primary;
    if (pending > 0 && groups > 0) {
      this.setPlanHint(`多选模式 · 当前 ${focus} · 待指定 ${pending} 座 · 已指定 ${groups} 组 · 点击“派遣”发兵`);
    } else if (pending > 0) {
      this.setPlanHint(`多选模式 · 当前 ${focus} · 已编组 ${pending} 座 · 点击敌方据点或浅绿网格指定目标`);
    } else if (groups > 0) {
      this.setPlanHint(`多选模式 · 已指定 ${groups} 组 · 点击“派遣”发兵`);
    } else {
      this.setPlanHint("多选模式 · 点击己方据点编组，再点敌方据点或浅绿网格指定目标 · Ctrl 退出");
    }
  }

  private syncDispatchButton(): void {
    const button = this.options.hud.querySelector<HTMLButtonElement>("#btn-dispatch");
    if (!button) return;
    button.classList.toggle("on", this.multiSelect);
    button.disabled = this.plan.length === 0 || this.paused || this.finished;
  }

  private setPlanHint(text: string): void {
    const node = this.options.hud.querySelector("#plan-hint");
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("on", text.length > 0);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cancelDragPreview();
    window.clearTimeout(this.introHideTimer);
    if (this.introRoot) {
      this.introRoot.hidden = true;
      this.introRoot.classList.remove("on", "done", "preparing");
    }
    this.multiSelect = false;
    this.plan = [];
    this.lastPlanClick = null;
    this.setPlanHint("");
    this.syncDispatchButton();
    window.removeEventListener("keydown", this.onKeyDown);
    this.options.canvas.removeEventListener("click", this.onClick);
    this.options.canvas.removeEventListener("dblclick", this.onDoubleClick);
    this.options.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.options.canvas.removeEventListener("wheel", this.onWheel);
    this.options.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
    window.removeEventListener("blur", this.onWindowBlur);
    this.routeOverlay.dispose();
    this.scene.dispose();
  }

  /**
   * 把一条地图坐标折线栅格化成格心；兵团路线和单击预览共用，
   * 保证预览看到的就是出兵后实际会铺出来的格子。
   */
  private rasterizeRoute(
    path: ReadonlyArray<readonly [number, number]>,
    startIndex: number,
    nav: NonNullable<SimState["nav"]>,
    offsetX: number,
    offsetZ: number,
  ): Array<[number, number]> {
    if (path.length === 0) return [];
    const cells: Array<[number, number]> = [];
    const seen = new Set<number>();
    const add = (xCm: number, zCm: number): void => {
      const index = nav.cellFromWorld(xCm + offsetX, zCm + offsetZ);
      if (index < 0 || seen.has(index)) return;
      seen.add(index);
      const center = nav.centerOf(index);
      cells.push([center.xCm - offsetX, center.zCm - offsetZ]);
    };
    const step = Math.max(1, nav.cellSizeCm * 0.5);
    const sampleLine = (x0: number, z0: number, x1: number, z1: number): void => {
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
      for (let k = 1; k <= steps; k += 1) {
        add(x0 + ((x1 - x0) * k) / steps, z0 + ((z1 - z0) * k) / steps);
      }
    };
    const start = Math.max(0, Math.min(path.length - 1, startIndex));
    const [firstX, firstZ] = path[start];
    add(firstX, firstZ);
    for (let index = start; index < path.length - 1; index += 1) {
      const [x0, z0] = path[index];
      const [x1, z1] = path[index + 1];
      sampleLine(x0, z0, x1, z1);
    }
    return cells;
  }

  /** 把一支兵团实际行走折线栅格化成格心。 */
  private squadPathCells(
    squad: SquadState,
    nav: NonNullable<SimState["nav"]>,
    offsetX: number,
    offsetZ: number,
  ): Array<[number, number]> {
    if (!squad.gridPath || squad.gridPath.length === 0 || squad.xCm === undefined || squad.zCm === undefined) {
      return [];
    }
    // 先把整段路线栅格化，再按兵团当前所在格切片，避免随移动反复抖动。
    const start = Math.max(0, (squad.gridIndex ?? 0) - 1);
    const cells = this.rasterizeRoute(squad.gridPath, start, nav, offsetX, offsetZ);
    if (cells.length === 0) return cells;
    const squadIndex = nav.cellFromWorld(squad.xCm + offsetX, squad.zCm + offsetZ);
    let current = cells.findIndex(
      ([xCm, zCm]) => nav.cellFromWorld(xCm + offsetX, zCm + offsetZ) === squadIndex,
    );
    if (current < 0) {
      let best = Number.POSITIVE_INFINITY;
      cells.forEach(([xCm, zCm], index) => {
        const distance = (xCm - squad.xCm!) ** 2 + (zCm - squad.zCm!) ** 2;
        if (distance < best) {
          best = distance;
          current = index;
        }
      });
    }
    return cells.slice(current + 1);
  }

  /** 场上每支己方兵团都显示剩余路线，选中那支更亮。 */
  private updateSquadPaths(): void {
    // 路线高亮只是辅助信息，按 5 Hz 刷新；每帧重栅格化几十条长路径会拖垮后期帧率。
    const selection = this.selectedSquad ?? "";
    const now = performance.now();
    if (now - this.pathUpdateAt < 200 && selection === this.pathSelection) return;
    this.pathUpdateAt = now;
    this.pathSelection = selection;
    const nav = this.state.nav;
    if (!nav) {
      this.scene.setSquadPaths([], 100);
      return;
    }
    const offsetX = this.state.map.size[0] * 5;
    const offsetZ = this.state.map.size[1] * 5;
    const paths: Array<{ id: string; cells: Array<[number, number]>; selected: boolean }> = [];
    for (const squad of this.state.squads) {
      if (squad.owner !== 1) continue;
      const cells = this.squadPathCells(squad, nav, offsetX, offsetZ);
      if (cells.length === 0) continue;
      paths.push({ id: squad.id, cells, selected: squad.id === this.selectedSquad });
    }
    this.scene.setSquadPaths(paths, nav.cellSizeCm);
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    if (!this.ready) {
      // 第一帧把地形、建筑与材质真正画出来；这期间的停顿由准备画面盖住。
      this.scene.update(this.state, 0);
      this.routeOverlay.render(this.state, this.selectedSquad);
      // 建筑 GLB 在首帧后异步解析，几百毫秒才落位。等它们完成再撤准备画面，
      // 否则进入对局半秒后会卡一下。加载期间画面被遮罩盖住，帧率不受影响。
      void assetRegistry.whenBuildsIdle().then(() => {
        if (this.disposed) return;
        this.scene.update(this.state, 0);
        this.routeOverlay.render(this.state, this.selectedSquad);
        this.ready = true;
        if (import.meta.env.DEV) {
          (window as unknown as Record<string, unknown>).__mlReadyAt = performance.now();
        }
        this.options.onReady?.();
        this.beginIntro();
        this.scheduleReachPreparation();
        this.lastTime = performance.now();
        this.raf = requestAnimationFrame(this.frame);
      });
      return;
    }
    const delta = Math.min(250, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.aiCommandsThisFrame = 0;

    if (this.introActive) {
      if (!this.paused) {
        this.introElapsed += delta;
        this.updateIntroUi();
        if (this.introElapsed >= INTRO_MS) this.finishIntro();
      }
    } else if (!this.paused) {
      this.accumulator += delta * this.timeScale;
      let steps = 0;
      // 高倍速下帧率低时允许多补几步，避免 15:00 的对局拖到超时。
      while (this.accumulator >= FIXED_STEP && steps < 32) {
        this.tick();
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === 32) this.accumulator = 0;
    }

    this.updateSquadPaths();
    this.scene.update(this.state, this.paused ? 0 : delta);
    this.routeOverlay.render(this.state, this.selectedSquad);
    this.raf = requestAnimationFrame(this.frame);
  };

  private tick(): void {
    if (this.state.status !== "playing") return;
    const playerCommands = this.commands;
    this.commands = [];
    const commands: Command[] = [];
    if (this.state.tick % 40 === 0) this.aiQueue.push(...this.ai.decide(this.state));
    // 每帧最多执行少量 AI 指令：一条派兵要跑一次 A*，
    // 十几条挤在同一个 tick 里会直接卡住半秒，和玩家有没有操作无关。
    const budget = Math.max(1, Math.min(4, Math.ceil(this.timeScale / 4)));
    while (this.aiQueue.length > 0 && this.aiCommandsThisFrame < budget) {
      commands.push(this.aiQueue.shift() as Command);
      this.aiCommandsThisFrame += 1;
    }
    commands.push(...playerCommands);

    const result = step(this.state, commands);
    this.state = result.state;
    // 只提示玩家自己的指令被拒；AI 的 no_route 不该弹给玩家。
    const rejection = result.rejected.find((entry) => playerCommands.includes(entry.command));
    if (rejection) {
      this.options.onToast(REASONS[rejection.reason] ?? "指令无效");
    }
    if (this.selectedSquad && !this.getSquad(this.selectedSquad)) {
      this.clearSelection();
    }
    const owned = this.selected.filter((id) => this.getCity(id)?.owner === 1);
    const lostSelection = owned.length !== this.selected.length;
    if (lostSelection) {
      this.selected = owned;
      this.scene.setSelected(owned);
      this.refreshReach(true);
    } else {
      this.refreshReach();
    }
    this.handleEvents();
    this.updateHud();
    if (this.selectedSquad) this.syncSquadPanel();
    if (this.selected.length > 0) this.options.onSelect(this.primary, this.selected.length);
    else if (lostSelection) this.options.onSelect(null, 0);
    if (lostSelection && this.multiSelect) this.updatePlanUi();

    if (this.state.status === "finished" && !this.finished) {
      this.finished = true;
      this.paused = true;
      if (this.state.winner === 1) audio.win();
      else if (this.state.winner === 2) audio.lose();
      this.options.onFinish(this.state);
    }
  }

  private handleEvents(): void {
    for (const event of this.state.events) {
      if (event.type === "cityCaptured") {
        const side = event.toOwner === 1 ? "已占领" : "已失守";
        if (event.toOwner === 1) {
          audio.capture();
          this.floatText(event.cityId, "占领", "gold");
        } else {
          audio.lostCity();
          this.floatText(event.cityId, "失守", "loss");
        }
        this.options.onToast(`${event.cityId} ${side}`);
      } else if (event.type === "combatResolved" && !event.captured) {
        this.floatText(event.cityId, `-${event.defenderLoss}`, event.attacker === 1 ? "loss" : "gain");
        if (event.attacker === 1) this.options.onToast(`${event.cityId} 进攻失利`);
      } else if (event.type === "upgradeCompleted") {
        const city = this.getCity(event.cityId);
        if (city?.owner === 1) {
          audio.upgrade();
          this.floatText(event.cityId, "升级", "gold");
        }
      } else if (event.type === "squadSpawned" && this.getCity(event.from)?.owner === 1) {
        audio.send();
      } else if (event.type === "stanceChanged") {
        this.options.onToast(
          `${event.cityId} ${event.stance === "engage" ? "迎战" : "避战"}`,
        );
      } else if (event.type === "squadStarved" && event.owner === 1) {
        this.options.onToast(
          event.destroyed
            ? `${event.squadId} 断粮溃散`
            : `${event.squadId} 断粮 - ${event.loss} 兵`,
        );
      } else if (event.type === "squadStanceChanged") {
        if (this.selectedSquad === event.squadId) this.syncSquadPanel();
      } else if (event.type === "squadClashed") {
        this.showClashLosses(event);
      }
    }
  }

  private updateHud(): void {
    const cities = this.state.cities.filter((city) => city.owner === 1 && isProductionSiteKind(city.kind));
    const pop = this.state.cities
      .filter((city) => city.owner === 1)
      .reduce((sum, city) => sum + city.pop, 0);
    const gold = this.state.players.find((player) => player.id === 1)?.gold ?? 0;
    this.setText("hud-cities", String(cities.length));
    this.setText("hud-pop", String(pop));
    this.setText("hud-gold", String(gold));
    this.setText("hud-timer", this.formatTime(this.state.tick));
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlSquads = {
        total: this.state.squads.length,
        own: this.state.squads.filter((squad) => squad.owner === 1).length,
        squads: this.state.squads.map((squad) => ({
          id: squad.id,
          owner: squad.owner,
          count: squad.count,
          stance: squad.stance,
          engaged: squad.engagedWith ?? null,
          xCm: squad.xCm,
          zCm: squad.zCm,
        })),
      };
    }
  }

  private showClashLosses(event: {
    attacker: string;
    defender: string;
    attackerLoss: number;
    defenderLoss: number;
    attackerOwner: number;
    defenderOwner: number;
  }): void {
    const now = performance.now();
    if (now - this.clashTextAt < 320) return;
    this.clashTextAt = now;
    if (event.attackerLoss > 0) {
      this.floatSquadText(
        event.attacker,
        `-${event.attackerLoss}`,
        event.attackerOwner === 1 ? "loss" : "gain",
      );
    }
    if (event.defenderLoss > 0) {
      this.floatSquadText(
        event.defender,
        `-${event.defenderLoss}`,
        event.defenderOwner === 1 ? "loss" : "gain",
      );
    }
  }

  private floatSquadText(squadId: string, text: string, tone: "gain" | "loss" | "gold"): void {
    const squad = this.getSquad(squadId);
    if (!squad || squad.xCm === undefined || squad.zCm === undefined) return;
    const point = this.scene.projectGround(squad.xCm / 10, squad.zCm / 10, 1.1);
    if (!point) return;
    const node = document.createElement("div");
    node.className = `float-text ${tone}`;
    node.textContent = text;
    node.style.left = `${Math.round(point.x)}px`;
    node.style.top = `${Math.round(point.y)}px`;
    this.options.hud.appendChild(node);
    window.setTimeout(() => node.remove(), 1100);
  }

  private floatText(cityId: CityId, text: string, tone: "gain" | "loss" | "gold"): void {
    const point = this.scene.projectCity(cityId);
    if (!point) return;
    const node = document.createElement("div");
    node.className = `float-text ${tone}`;
    node.textContent = text;
    node.style.left = `${Math.round(point.x)}px`;
    node.style.top = `${Math.round(point.y)}px`;
    this.options.hud.appendChild(node);
    window.setTimeout(() => node.remove(), 1100);
  }

  private setText(id: string, text: string): void {
    const node = this.options.hud.querySelector(`#${id}`);
    if (node) node.textContent = text;
  }

  private formatTime(ticks: number): string {
    const total = Math.floor(ticks / 20);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private bindInput(): void {
    this.options.canvas.style.cursor = "grab";
    this.options.canvas.addEventListener("click", this.onClick);
    this.options.canvas.addEventListener("dblclick", this.onDoubleClick);
    this.options.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.options.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.options.canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
    window.addEventListener("blur", this.onWindowBlur);
    window.addEventListener("keydown", this.onKeyDown);
  }

  private retargetSquad(to: CityId, via?: CityId): void {
    if (!this.selectedSquad) return;
    const squad = this.getSquad(this.selectedSquad);
    if (!squad) {
      this.clearSelection();
      return;
    }
    this.commands.push({ type: "retarget", squad: squad.id, to, via });
    this.options.onToast(via ? `${squad.id} 改走 ${via}` : `${squad.id} 改道 ${to}`);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    if (this.introActive) this.finishIntro();
    this.cancelDragPreview();
    // 按下鼠标就开始新的操作，上一条预览路线先撤掉；单击后需要时再重画。
    this.scene.setPreviewPath(null);
    this.dragMoved = false;
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    // 多选状态下从已编组建筑本体拖出，整组箭头指向目的地。
    if (this.multiSelect && !this.selectedSquad && this.selected.length > 0) {
      const nearest = this.scene.nearestCity(event.clientX, event.clientY, this.state);
      if (nearest && nearest.distance <= 72 && this.selected.includes(nearest.id)) {
        this.planDragSources = this.selected.slice();
        this.options.canvas.style.cursor = "crosshair";
        return;
      }
    }
    // 单选状态下从当前建筑本体拖出，直接拉出派兵箭头，不进入平移。
    if (!this.multiSelect && !this.selectedSquad && this.selected.length > 0) {
      const focus = this.primary;
      const nearest = this.scene.nearestCity(event.clientX, event.clientY, this.state);
      if (focus && nearest && nearest.id === focus && nearest.distance <= 72) {
        this.dispatchDrag = true;
        this.dispatchSource = focus;
        this.options.canvas.style.cursor = "crosshair";
        return;
      }
    }
    this.dragging = true;
    this.options.canvas.style.cursor = "grabbing";
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (this.planDragSources.length > 0) {
      if ((event.buttons & 1) === 0) {
        this.cancelPlanDrag();
        return;
      }
      if (
        !this.dragMoved &&
        Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) < 10
      ) {
        return;
      }
      this.dragMoved = true;
      this.queueDragPreview(event.clientX, event.clientY);
      return;
    }
    if (this.dispatchDrag) {
      if ((event.buttons & 1) === 0) {
        this.cancelDispatchDrag();
        return;
      }
      if (
        !this.dragMoved &&
        Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) < 10
      ) {
        return;
      }
      this.dragMoved = true;
      if (this.dispatchSource) this.queueDragPreview(event.clientX, event.clientY);
      return;
    }
    if (!this.dragging) return;
    // 松开鼠标时没收到 pointerup（例如在窗口外松开）时，这里兜底退出拖拽。
    if ((event.buttons & 1) === 0) {
      this.dragging = false;
      this.options.canvas.style.cursor = "grab";
      return;
    }
    const dx = event.clientX - this.dragX;
    const dy = event.clientY - this.dragY;
    if (!this.dragMoved && Math.hypot(event.clientX - this.dragStartX, event.clientY - this.dragStartY) < 10) {
      return;
    }
    this.dragMoved = true;
    this.dragX = event.clientX;
    this.dragY = event.clientY;
    this.scene.panBy(dx, dy);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.planDragSources.length > 0) {
      const moved = this.dragMoved;
      this.cancelDragPreview();
      this.planDragSources = [];
      this.routeOverlay.setDragArrows(null);
      this.options.canvas.style.cursor = "grab";
      if (moved) {
        this.suppressClick = true;
        window.setTimeout(() => { this.suppressClick = false; }, 0);
        const target = this.planTargetAt(event.clientX, event.clientY);
        if (target?.city) this.assignPlanCity(target.city);
        else if (target?.cell) this.assignPlanCell(target.cell.xCm, target.cell.zCm, target.cell.index);
        else this.options.onToast("拖到可抵达的据点或网格");
      }
      return;
    }
    if (this.dispatchDrag) {
      const moved = this.dragMoved;
      const source = this.dispatchSource;
      this.cancelDragPreview();
      this.dispatchDrag = false;
      this.dispatchSource = null;
      this.routeOverlay.setDragArrow(null);
      this.options.canvas.style.cursor = "grab";
      if (moved) {
        this.suppressClick = true;
        window.setTimeout(() => { this.suppressClick = false; }, 0);
        const target = this.dispatchTargetAt(event.clientX, event.clientY, source);
        if (target) this.dispatchSingle(target);
        else this.options.onToast("拖到可抵达的据点或网格");
      }
      return;
    }
    if (!this.dragging) return;
    this.dragging = false;
    this.options.canvas.style.cursor = "grab";
    if (this.dragMoved) {
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 0);
    }
  };

  private readonly onWindowBlur = (): void => {
    this.cancelDragPreview();
    this.cancelPlanDrag();
    this.cancelDispatchDrag();
    this.dragging = false;
    this.dragMoved = false;
    this.suppressClick = false;
    this.options.canvas.style.cursor = "grab";
  };

  private queueDragPreview(clientX: number, clientY: number): void {
    this.dragPreviewPoint = { x: clientX, y: clientY };
    if (this.dragPreviewFrame) return;
    this.dragPreviewFrame = requestAnimationFrame(() => {
      this.dragPreviewFrame = 0;
      const point = this.dragPreviewPoint;
      this.dragPreviewPoint = null;
      if (!point) return;
      if (this.planDragSources.length > 0) {
        this.routeOverlay.setDragArrows(this.planDragViews(point.x, point.y));
      } else if (this.dispatchDrag && this.dispatchSource) {
        this.routeOverlay.setDragArrow(this.dragArrowView(point.x, point.y));
      }
    });
  }

  private cancelDragPreview(): void {
    if (this.dragPreviewFrame) cancelAnimationFrame(this.dragPreviewFrame);
    this.dragPreviewFrame = 0;
    this.dragPreviewPoint = null;
  }

  private cancelPlanDrag(): void {
    if (this.planDragSources.length === 0) return;
    this.cancelDragPreview();
    this.planDragSources = [];
    this.dragMoved = false;
    this.routeOverlay.setDragArrows(null);
    this.options.canvas.style.cursor = "grab";
  }

  private cancelDispatchDrag(): void {
    if (!this.dispatchDrag) return;
    this.cancelDragPreview();
    this.dispatchDrag = false;
    this.dispatchSource = null;
    this.dragMoved = false;
    this.routeOverlay.setDragArrow(null);
    this.options.canvas.style.cursor = "grab";
  }

  private clickDuringMultiSelect(cityId: CityId): void {
    const city = this.getCity(cityId);
    if (!city) return;
    this.lastPlanClick = null;
    if (city.owner === 1) this.togglePending(cityId);
    else this.assignPlanCity(cityId);
  }

  private cellIndexAt(xCm: number, zCm: number): number {
    const nav = this.state.nav;
    if (!nav) return -1;
    const offsetX = this.state.map.size[0] * 5;
    const offsetZ = this.state.map.size[1] * 5;
    return nav.cellFromWorld(xCm + offsetX, zCm + offsetZ);
  }

  /** 屏幕点击落在哪一格，返回格心地图坐标（厘米）。 */
  private gridCellAt(
    clientX: number,
    clientY: number,
    preview = false,
  ): { index: number; xCm: number; zCm: number } | null {
    const nav = this.state.nav;
    if (!nav) return null;
    // 统一走精确拾取：拖拽预览原来用平面近似，遇到陡坡目标会跳。
    void preview;
    const point = this.scene.screenToGround(clientX, clientY);
    if (!point) return null;
    const offsetX = this.state.map.size[0] * 5;
    const offsetZ = this.state.map.size[1] * 5;
    const index = nav.cellFromWorld(point[0] * 10 + offsetX, point[1] * 10 + offsetZ);
    if (index < 0) return null;
    const center = nav.centerOf(index);
    return { index, xCm: center.xCm - offsetX, zCm: center.zCm - offsetZ };
  }

  /** 该格是否落在某个可抵达建筑的占地内。 */
  private cellCityAt(xCm: number, zCm: number): CityId | null {
    for (const id of this.reachTargets) {
      const city = this.getCity(id);
      if (!city) continue;
      const radius = (city.footprintCm ?? 800) / 2;
      if (Math.hypot(city.pos[0] * 10 - xCm, city.pos[1] * 10 - zCm) <= radius) return id;
    }
    return null;
  }

  private cellTargetAt(
    clientX: number,
    clientY: number,
    preview = false,
  ): { city?: CityId; cell?: { index: number; xCm: number; zCm: number } } | null {
    const cell = this.gridCellAt(clientX, clientY, preview);
    if (!cell) return null;
    const cityId = this.cellCityAt(cell.xCm, cell.zCm);
    return cityId ? { city: cityId } : { cell };
  }

  /** 多选拖拽时目标也可以是友方建筑。 */
  private planTargetAt(
    clientX: number,
    clientY: number,
    preview = false,
  ): { city?: CityId; cell?: { index: number; xCm: number; zCm: number } } | null {
    const nearest = this.scene.nearestCity(clientX, clientY, this.state);
    if (nearest && nearest.distance <= 72) return { city: nearest.id };
    return this.cellTargetAt(clientX, clientY, preview);
  }

  /** 同一批选中的每座建筑各一条箭头，目标只画一次标记。 */
  private planDragViews(clientX: number, clientY: number): DragArrowView[] {
    const target = this.planTargetAt(clientX, clientY, true);
    if (!target) return [];
    let to: { x: number; y: number } | null = null;
    let marker: { ring?: { x: number; y: number }; square?: Array<{ x: number; y: number }> } = {};
    if (target.city) {
      const city = this.getCity(target.city);
      if (!city) return [];
      const ring = this.scene.projectGround(city.pos[0], city.pos[1], 0.5);
      if (!ring) return [];
      to = ring;
      marker = { ring };
    } else if (target.cell) {
      const sizeCm = this.gridFocus?.nav.cellSizeCm ?? 100;
      const half = sizeCm / 20;
      const x = target.cell.xCm / 10;
      const z = target.cell.zCm / 10;
      const corners = [
        [x - half, z - half],
        [x + half, z - half],
        [x + half, z + half],
        [x - half, z + half],
      ].map(([px, pz]) => this.scene.projectGround(px, pz, 0.08));
      const center = this.scene.projectGround(x, z, 0.12);
      if (!center) return [];
      to = center;
      const square = corners.every((point): point is { x: number; y: number } => point !== null)
        ? corners
        : undefined;
      marker = { ...(square ? { square } : {}), ring: center };
    }
    if (!to) return [];
    const views: DragArrowView[] = [];
    for (const id of this.planDragSources) {
      const city = this.getCity(id);
      if (!city) continue;
      const from = this.scene.projectGround(city.pos[0], city.pos[1], 3.6);
      if (!from) continue;
      views.push({ fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
    }
    if (views.length > 0) Object.assign(views[0], marker);
    return views;
  }

  /** 双击/拖拽释放的位置解析成据点或网格目标。 */
  private dispatchTargetAt(
    clientX: number,
    clientY: number,
    dragSource: CityId | null = null,
    preview = false,
  ): { city?: CityId; cell?: { index: number; xCm: number; zCm: number } } | null {
    const nearest = this.scene.nearestCity(clientX, clientY, this.state);
    const nearCity = nearest ? this.getCity(nearest.id) : undefined;
    if (nearest && nearCity?.owner === 1 && nearest.distance <= 72) {
      // 从建筑拖出时，落在建筑附近的格子仍可作为目标；落在建筑本体上则不算。
      if (dragSource && nearest.id === dragSource && nearest.distance > 28) {
        return this.cellTargetAt(clientX, clientY, preview);
      }
      // 拖到自己以外的友方建筑表示增援。
      if (dragSource && nearest.id !== dragSource) return { city: nearest.id };
      return null;
    }
    if (nearest && nearCity && nearest.distance <= 72) return { city: nearest.id };
    const cell = this.cellTargetAt(clientX, clientY, preview);
    if (cell) return cell;
    if (nearest && nearCity && nearCity.owner !== 1) return { city: nearest.id };
    return null;
  }

  /** 用当前相机投影出箭头起点和目标框，转动视角后仍然和鼠标对齐。 */
  private dragArrowView(clientX: number, clientY: number): DragArrowView | null {
    const source = this.dispatchSource;
    if (!source) return null;
    const city = this.getCity(source);
    if (!city) return null;
    const from = this.scene.projectGround(city.pos[0], city.pos[1], 3.6);
    if (!from) return null;
    const target = this.dispatchTargetAt(clientX, clientY, source, true);
    if (target?.cell) {
      const sizeCm = this.gridFocus?.nav.cellSizeCm ?? 100;
      const half = sizeCm / 20;
      const x = target.cell.xCm / 10;
      const z = target.cell.zCm / 10;
      const corners = [
        [x - half, z - half],
        [x + half, z - half],
        [x + half, z + half],
        [x - half, z + half],
      ].map(([px, pz]) => this.scene.projectGround(px, pz, 0.08));
      const center = this.scene.projectGround(x, z, 0.08);
      if (center) {
        const square = corners.every((point): point is { x: number; y: number } => point !== null)
          ? corners
          : undefined;
        return {
          fromX: from.x,
          fromY: from.y,
          // 箭头落在格心而不是鼠标像素上：准星、方框和箭尖指向同一格。
          toX: center.x,
          toY: center.y,
          ...(square ? { square } : {}),
          ring: center,
        };
      }
    }
    if (target?.city) {
      const targetCity = this.getCity(target.city);
      if (targetCity) {
        const ring = this.scene.projectGround(targetCity.pos[0], targetCity.pos[1], 0.5);
        if (ring) return { fromX: from.x, fromY: from.y, toX: ring.x, toY: ring.y, ring };
      }
    }
    return { fromX: from.x, fromY: from.y, toX: clientX, toY: clientY };
  }

  private dispatchSingle(target: { city?: CityId; cell?: { index: number; xCm: number; zCm: number } }): void {
    if (target.city) {
      this.sendTo(target.city);
      return;
    }
    if (target.cell) this.sendToCell(target.cell);
  }

  private clickCellDuringMultiSelect(cell: { index: number; xCm: number; zCm: number }): void {
    const cityId = this.cellCityAt(cell.xCm, cell.zCm);
    if (cityId) {
      this.clickDuringMultiSelect(cityId);
      return;
    }
    if (this.gridFocus && this.gridFocus.cells[cell.index] === 1) {
      this.assignPlanCell(cell.xCm, cell.zCm, cell.index);
      return;
    }
    if (this.selected.length > 0) this.options.onToast("无法抵达该网格");
  }

  /** 单选模式下直接向网格派兵，所有选中据点在同一 tick 出发。 */
  private sendToCell(cell: { index: number; xCm: number; zCm: number }): void {
    const sources = this.selected;
    if (sources.length === 0) return;
    let sent = 0;
    let problem = "";
    for (const id of sources) {
      const from = this.getCity(id);
      if (!from || from.owner !== 1) continue;
      if (!canDispatchFrom(from)) {
        if (!problem) problem = `${id} 守军不足`;
        continue;
      }
      const reach = this.gridReach.get(id) ?? reachableGridCells(this.state, id);
      if (!reach || reach.cells[cell.index] !== 1) {
        if (!problem) problem = `${id} 无法抵达该网格`;
        continue;
      }
      this.commands.push({
        type: "sendCell",
        from: id,
        xCm: cell.xCm,
        zCm: cell.zCm,
        stance: this.dispatchStance,
      });
      sent += 1;
    }
    if (sent === 0) {
      this.options.onToast(problem || "无法抵达该网格");
      return;
    }
    if (sent < sources.length && problem) this.options.onToast(`${sent} 座发兵 · ${problem}`);
    else if (sent > 1) this.options.onToast(`${sent} 座据点同时发兵`);
    this.setSelection([]);
  }

  /** 选中建筑后单击目的地，按实际行军路线铺出同样的绿格，不派兵。 */
  private previewRouteTo(xCm: number, zCm: number, destination?: CityId): void {
    const nav = this.state.nav;
    const city = this.getCity(this.selected[0]);
    if (!nav || !city) return;
    // 没有驻军的据点派不出兵团，也就不画实际路线。
    if (!canDispatchFrom(city)) {
      this.scene.setPreviewPath(null);
      return;
    }
    const unitKind = siteUnitKind(city.kind) ?? "barbarian";
    // 和 sim 派兵时用的是同一张兵种导航图：非己方据点会挡路，兵种地形限制也一致。
    const unitNav = createUnitNavGrid(this.state.map, this.state.cities, city.owner, unitKind, destination);
    if (!unitNav) return;
    const origin: [number, number] = [city.pos[0] * 10, city.pos[1] * 10];
    const route = planGridRoute(this.state.map, unitNav, origin, [xCm, zCm], 40, unitKind);
    if (!route) {
      this.scene.setPreviewPath(null);
      this.options.onToast("这里走不过去");
      return;
    }
    const offsetX = this.state.map.size[0] * 5;
    const offsetZ = this.state.map.size[1] * 5;
    // 和 sim 里兵团实际携带的网格路径一致：出发点 + A* 折线。
    const cells = this.rasterizeRoute([origin, ...route.points], 0, unitNav, offsetX, offsetZ);
    this.scene.setPreviewPath(cells, unitNav.cellSizeCm);
  }

  private clickCity(cityId: CityId): void {
    const city = this.getCity(cityId);
    if (!city) return;
    if (city.owner === 1) {
      this.select(cityId);
      return;
    }
    if (this.selected.length === 0) {
      this.options.onToast("先选择己方据点");
      return;
    }
    this.sendTo(cityId);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.suppressClick) { this.suppressClick = false; return; }
    if (this.paused || this.finished) return;
    if (this.multiSelect) {
      // 点击落在据点本体上时优先操作据点，避免箭头或网格盖住建筑。
      const nearest = this.scene.nearestCity(event.clientX, event.clientY, this.state);
      if (nearest && nearest.distance <= 20) {
        this.clickDuringMultiSelect(nearest.id);
        return;
      }
      const groupIndex = this.routeOverlay.pickPlan(event.clientX, event.clientY);
      if (groupIndex !== null) {
        const now = performance.now();
        if (
          this.lastPlanClick &&
          this.lastPlanClick.index === groupIndex &&
          now - this.lastPlanClick.at < PLAN_CANCEL_WINDOW
        ) {
          this.lastPlanClick = null;
          this.cancelPlanGroup(groupIndex);
        } else {
          this.lastPlanClick = { index: groupIndex, at: now };
        }
        return;
      }
      this.lastPlanClick = null;
      // 箭头优先；己方建筑用较宽的命中范围，避免点标签时落到格子上。
      const nearCity = nearest ? this.getCity(nearest.id) : undefined;
      if (nearest && nearCity && (nearCity.owner === 1 ? nearest.distance <= 72 : nearest.distance <= 36)) {
        this.clickDuringMultiSelect(nearest.id);
        return;
      }
      const cell = this.gridCellAt(event.clientX, event.clientY);
      if (cell) {
        this.clickCellDuringMultiSelect(cell);
        return;
      }
      if (nearest && nearest.distance < 72) this.clickDuringMultiSelect(nearest.id);
      return;
    }
    if (this.selectedSquad) {
      const otherId = this.pickSquadAt(event.clientX, event.clientY);
      if (otherId) {
        if (otherId === this.selectedSquad) return;
        const other = this.getSquad(otherId);
        if (other?.owner === 1) {
          this.selectSquad(other.id);
          return;
        }
        this.options.onToast("只能指挥己方兵团");
        return;
      }
    }
    if (!this.selectedSquad) {
      const squadId = this.pickSquadAt(event.clientX, event.clientY);
      if (squadId) {
        const squad = this.getSquad(squadId);
        if (squad?.owner === 1) {
          this.selectSquad(squad.id);
          return;
        }
        this.options.onToast("只能指挥己方兵团");
        return;
      }
    }
    const nearest = this.scene.nearestCity(event.clientX, event.clientY, this.state);
    const cityId = nearest && nearest.distance < 72 ? nearest.id : null;

    if (this.selectedSquad) {
      const squad = this.getSquad(this.selectedSquad);
      if (!squad) {
        this.clearSelection();
        return;
      }
      if (cityId) {
        if (cityId === squad.to) {
          this.options.onToast("兵团已在该目的地");
          return;
        }
        this.retargetSquad(cityId);
        return;
      }
      const via = this.routeOverlay.pickBranch(this.state, squad, event.clientX, event.clientY);
      if (via) {
        this.retargetSquad(squad.to, via);
        return;
      }
      const cell = this.gridCellAt(event.clientX, event.clientY);
      if (cell && this.state.nav) {
        this.commands.push({ type: "retargetCell", squad: squad.id, xCm: cell.xCm, zCm: cell.zCm });
        this.options.onToast(`${squad.id} 改道 网格`);
        return;
      }
      this.clearSelection();
      return;
    }

    const nearCity = nearest ? this.getCity(nearest.id) : undefined;
    if (nearest && nearCity && nearCity.owner === 1 && nearest.distance <= 72) {
      this.clickCity(nearest.id);
      return;
    }

    // 单击只用于选择；敌方据点和网格都要双击，或从建筑拖拽箭头才派兵。
    // 选中一座己方建筑时，单击目的地会先画出这张行走路线预览。
    const cell = this.gridCellAt(event.clientX, event.clientY);
    if (this.selected.length === 1) {
      // 和双击派兵的判定顺序一致：先认据点，再认网格。
      if (cityId) {
        const target = this.getCity(cityId);
        if (target) this.previewRouteTo(target.pos[0] * 10, target.pos[1] * 10, target.id);
        return;
      }
      if (cell) {
        this.previewRouteTo(cell.xCm, cell.zCm);
        return;
      }
    }
    if (cell) return;
    if (cityId) return;

    this.clearSelection();
  };

  private readonly onDoubleClick = (event: MouseEvent): void => {
    if (this.suppressClick) return;
    if (this.paused || this.finished || this.multiSelect || this.selectedSquad) return;
    if (this.selected.length === 0) return;
    const target = this.dispatchTargetAt(event.clientX, event.clientY);
    if (target) this.dispatchSingle(target);
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    if (this.multiSelect) {
      const hadTasks = this.plan.length > 0;
      this.plan = [];
      this.lastPlanClick = null;
      this.routeOverlay.setPlan([]);
      this.setSelection([]);
      this.options.onToast(hadTasks ? "已清空本次多选任务" : "已清空编组");
      return;
    }
    this.clearSelection();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (this.introActive) {
      this.finishIntro();
      return;
    }
    this.scene.zoomBy(event.deltaY > 0 ? -0.06 : 0.06);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Control" || event.key === "Meta") {
      if (!event.repeat) this.toggleMultiSelect();
      return;
    }
    if (event.key === "q" || event.key === "Q") this.scene.rotate(1);
    if (event.key === "e" || event.key === "E") this.scene.rotate(-1);
    if ((event.key === "r" || event.key === "R") && !this.paused && !this.finished) {
      this.toggleStance();
    }
  };
}
