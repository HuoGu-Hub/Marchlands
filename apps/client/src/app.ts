import { validateContent } from "@marchlands/content";
import { BASE_RULES, mapEntry } from "./game/map-catalog";
import { compileDocument, defaultVisualForMap, parseDocument } from "@marchlands/map-authoring";
import type { MapDocument, MapVisual } from "@marchlands/map-authoring";
import { UNIT_PROFILES, defenseMilliFor, garrisonEntries, isProductionSiteKind } from "@marchlands/sim";
import type { MapDef, SimState, SquadStance } from "@marchlands/sim";
import { CAMPAIGN, defaultLevelId, findLevel, previewUrl } from "./campaign";
import type { LevelDef, SeriesDef } from "./campaign";
import { DIFFICULTIES, difficultyDef, isDifficultyId } from "./difficulty";
import type { DifficultyId } from "./difficulty";
import { siteKindLabel } from "./game/site-kind";
import { audio } from "./audio";
import { EditorController } from "./editor/editor";
import { EditorNext } from "./editor/next/editor-next";
import { openMapText } from "./editor/map-io";
import { assetRegistry } from "./game/asset-registry";
import { art } from "./game/assets";
import { mapSketch } from "./game/map-sketch";
import { GameSession } from "./game/session";
import { UNIT_KINDS, UNIT_NAMES } from "./game/unit-models";
import { skinsForKind, unitSkinAssetId } from "./game/unit-skins";
import { UNIT_TRAITS, traitTags } from "./game/unit-traits";
import type { UnitSkinDef, UnitSkinKind } from "./game/unit-skins";
import { CREDITS } from "./credits";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";

type PageId = "boot" | "menu" | "campaign" | "series" | "editor" | "game" | "result" | "skins" | "settings" | "credits";

const TEMPLATE = `
<section id="page-boot" class="page active">
  <div class="boot-wrap">
    <div class="boot-mark">MARCH<span>LANDS</span></div>
    <div class="boot-sub">边 境 之 地</div>
    <div class="boot-bar"><i id="boot-progress"></i></div>
    <div class="boot-status" id="boot-status">正在装载地图</div>
  </div>
</section>

<section id="page-menu" class="page">
  <div class="menu-wrap">
    <div class="menu-copy">
      <div class="menu-eyebrow">A LAND GRABBER'S SEQUEL</div>
      <h1 class="menu-title">MARCH<span>LANDS</span></h1>
      <div class="menu-cn">边境之地</div>
      <div class="menu-rule"></div>
      <p class="menu-desc">六十米的边境沙盘，多座产兵据点与要地，一场没有退路的领地战争。派兵、行军、占领，把最后一面旗插满地图。</p>
    </div>
    <div class="menu-actions">
      <button class="btn primary" id="btn-start">开始游戏</button>
      <button class="btn" id="btn-skins">自定义皮肤</button>
      <button class="btn" id="btn-editor">地图编辑器</button>
      <button class="btn" id="btn-settings">设置</button>
      <button class="btn ghost" id="btn-exit">退出</button>
      <div class="menu-foot" id="menu-version">v0.2.2</div>
    </div>
  </div>
</section>

<section id="page-campaign" class="page">
  <div class="library">
    <header class="library-head">
      <button class="back-btn" id="btn-campaign-back">主菜单</button>
      <div class="library-title">
        <div class="kicker">战役</div>
        <h2>选择系列</h2>
      </div>
      <span class="library-count" id="campaign-count"></span>
    </header>
    <div class="series-grid" id="series-grid"></div>
  </div>
</section>

<section id="page-series" class="page">
  <div class="library">
    <header class="library-head">
      <button class="back-btn" id="btn-series-back">战役</button>
      <div class="library-title">
        <div class="kicker" id="series-kicker"></div>
        <h2 id="series-title"></h2>
      </div>
      <span class="library-count" id="series-count"></span>
    </header>
    <div class="level-grid" id="level-grid"></div>
    <div class="library-empty" id="series-empty" hidden>
      <p>还没有自制关卡。</p>
      <button class="btn" id="btn-empty-import">载入地图文件</button>
    </div>
    <div class="library-foot" id="series-foot" hidden>
      <button class="btn ghost" id="btn-import-map">载入地图文件</button>
    </div>
  </div>
</section>

<section id="page-editor" class="page">
  <div id="editor-root"></div>
</section>

<section id="page-game" class="page">
  <canvas id="game-canvas"></canvas>
  <div class="vignette"></div>
  <div class="hud">
    <div class="hud-left">
      <div class="res-bar">
        <div class="res-stat">
          <svg viewBox="0 0 24 24"><path d="M4 20V10l4-3 4 3v10M12 20V7l4-3 4 3v13M3 20h18" /></svg>
          <span>据点</span><b id="hud-cities">1</b>
        </div>
        <div class="res-stat">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" /></svg>
          <span>人口</span><b id="hud-pop">30</b>
        </div>
        <div class="res-stat">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" /><path d="M12 8v8M9.5 10.2c0-1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.5-2.5 1.8-2.5.8-2.5 1.8 1.1 1.7 2.5 1.7 2.5-.7 2.5-1.7" /></svg>
          <span>金币</span><b id="hud-gold">0</b>
        </div>
      </div>
    </div>
    <div class="hud-right">
      <div class="timer-card">
        <span>对局时间</span>
        <b id="hud-timer">00:00</b>
      </div>
      <button class="icon-btn" id="btn-pause">暂停</button>
    </div>
    <div class="city-panel" id="city-panel">
      <div class="city-accent" id="city-accent"></div>
      <div class="city-main">
        <div class="city-name">
          <span id="city-name">c1</span>
          <i id="city-level">LV.3</i>
          <div class="level-pips" id="city-pips"><i></i><i></i><i></i></div>
          <i id="city-multi" class="multi"></i>
        </div>
        <div class="city-line">守军 <b id="city-pop">30</b> / <span id="city-max">65</span> · 防御 <b id="city-defense">1.20</b></div>
        <div class="pop-bar"><i id="city-pop-fill"></i></div>
        <div class="city-garrison" id="city-garrison"></div>
      </div>
      <div class="city-actions">
        <button class="btn" id="city-transit">通行 · 拦截</button>
        <button class="btn" id="city-upgrade">升级</button>
        <button class="btn ghost" id="btn-deselect">取消</button>
      </div>
      <div class="city-stance" id="city-stance">
        <span>出兵姿态</span>
        <button class="stance-pill on" data-stance="guard" title="敌方兵团进入攻击范围时停下交战">警戒</button>
        <button class="stance-pill" data-stance="forced" title="不理会敌方兵团，持续向目的地行进">强行军</button>
      </div>
    </div>
    <div class="squad-panel" id="squad-panel">
      <div class="squad-main">
        <span>兵团姿态</span>
        <i id="squad-state">警戒行军</i>
      </div>
      <div class="squad-stance" id="squad-stance">
        <button class="stance-pill on" data-stance="guard">警戒</button>
        <button class="stance-pill" data-stance="forced">强行军</button>
      </div>
      <button class="btn ghost" id="btn-squad-deselect">取消</button>
    </div>
    <button class="btn primary dispatch-btn" id="btn-dispatch" disabled>派遣</button>
    <div class="toast" id="toast"></div>
    <div class="plan-hint" id="plan-hint"></div>
    <div class="hint">拖动地图 · 左键选择 · 双击或拖拽派兵 · Ctrl 切换多选 · 点“派遣”发兵 · 右键取消 · Q/E 旋转 · 滚轮缩放</div>
    <div class="match-intro" id="match-intro" hidden>
      <div class="match-intro-shade" id="match-intro-shade"></div>
      <div class="match-loading" id="match-loading">
        <span class="match-spinner"></span>
        <span class="match-loading-text">加载中</span>
      </div>
      <div class="match-intro-count" id="match-intro-count">3</div>
      <div class="match-intro-label" id="match-intro-label">部署</div>
    </div>
  </div>

  <div class="overlay" id="pause-overlay">
    <div class="panel">
      <div class="kicker">已暂停</div>
      <h2>战场静止</h2>
      <p>模拟与计时已停止，继续后从当前 tick 恢复。</p>
      <div class="panel-actions">
        <button class="btn primary" id="btn-resume">继续</button>
        <button class="btn" id="btn-editor-return" style="display:none">返回编辑器</button>
        <button class="btn" id="btn-restart">重开</button>
        <button class="btn ghost" id="btn-menu">返回主菜单</button>
      </div>
    </div>
  </div>

  <div class="overlay" id="confirm-overlay">
    <div class="panel">
      <div class="kicker">确认</div>
      <h2>重开本局</h2>
      <p>当前进度会全部丢失。</p>
      <div class="panel-actions">
        <button class="btn primary" id="btn-confirm-yes">重开</button>
        <button class="btn" id="btn-confirm-no">取消</button>
      </div>
    </div>
  </div>
</section>

<section id="page-result" class="page">
  <div class="stage">
    <div class="panel">
      <div class="kicker">战报</div>
      <h2 class="result-mark" id="result-mark">胜利</h2>
      <div class="stat-grid">
        <div class="stat"><span>产兵据点</span><b id="stat-cities">7</b></div>
        <div class="stat"><span>人口</span><b id="stat-pop">0</b></div>
        <div class="stat"><span>金币</span><b id="stat-gold">0</b></div>
        <div class="stat"><span>用时</span><b id="stat-time">00:00</b></div>
      </div>
      <p id="result-line">你控制了整片边境。</p>
      <div class="panel-actions">
        <button class="btn primary" id="btn-replay">重玩</button>
        <button class="btn" id="btn-result-menu">主菜单</button>
      </div>
    </div>
  </div>
</section>

<section id="page-skins" class="page">
  <div class="library skins-library">
    <header class="library-head">
      <button class="back-btn" id="btn-skins-back">主菜单</button>
      <div class="library-title">
        <div class="kicker">外观</div>
        <h2>自定义皮肤</h2>
      </div>
      <span class="library-count" id="skin-count"></span>
    </header>
    <div class="skin-tab-row">
      <div class="skin-tabs" id="skin-tabs" role="tablist" aria-label="兵种"></div>
      <div class="skin-tab-actions">
        <button class="skin-arrow" id="btn-skin-prev" aria-label="向左滑动">‹</button>
        <button class="skin-arrow" id="btn-skin-next" aria-label="向右滑动">›</button>
        <button class="btn ghost skin-reset" id="btn-skin-reset">恢复默认</button>
      </div>
    </div>
    <div class="skin-carousel" id="skin-carousel">
      <div class="skin-grid" id="skin-grid"></div>
    </div>
  </div>
</section>

<section id="page-settings" class="page">
  <div class="stage">
    <div class="panel">
      <div class="kicker">设置</div>
      <h2>显示与声音</h2>
      <div class="form-row">
        <label for="set-resolution">分辨率</label>
        <select id="set-resolution">
          <option value="1280x720">1280 × 720</option>
          <option value="1920x1080">1920 × 1080</option>
        </select>
      </div>
      <div class="form-row">
        <label for="set-mode">窗口模式</label>
        <select id="set-mode">
          <option value="windowed">窗口</option>
          <option value="fullscreen">全屏</option>
        </select>
      </div>
      <div class="form-row">
        <label for="set-volume">主音量</label>
        <div class="range-wrap">
          <input id="set-volume" type="range" min="0" max="100" step="1" />
          <output id="set-volume-out">70</output>
        </div>
      </div>
      <div class="form-row">
        <label for="set-language">语言</label>
        <select id="set-language" disabled>
          <option>简体中文</option>
        </select>
      </div>
      <p class="settings-note">分辨率与全屏在 Electron 客户端生效；浏览器内只保存偏好。</p>
      <div class="form-row">
        <label>素材署名</label>
        <button class="btn" id="btn-credits">查看</button>
      </div>
      <div class="panel-actions">
        <button class="btn primary" id="btn-save-settings">保存</button>
        <button class="btn" id="btn-settings-back">返回</button>
      </div>
    </div>
  </div>
</section>

<section id="page-credits" class="page">
  <div class="stage">
    <div class="panel">
      <div class="kicker">设置</div>
      <h2>素材署名</h2>
      <ul id="credits-list" class="credits-list"></ul>
      <p class="settings-note">外部素材均来自公共资源库。CC0 无需署名，CC BY 保留作者与来源。</p>
      <div class="panel-actions">
        <button class="btn" id="btn-credits-back">返回</button>
      </div>
    </div>
  </div>
</section>

<div class="overlay level-overlay" id="level-overlay">
  <div class="level-sheet" role="dialog" aria-modal="true" aria-labelledby="level-title">
    <button class="sheet-close" id="btn-level-close" aria-label="关闭">×</button>
    <div class="level-preview" id="level-preview">
      <img class="preview-blur" id="level-preview-bg" alt="" aria-hidden="true" />
      <img id="level-preview-img" alt="" />
      <div class="level-preview-empty" id="level-preview-empty" hidden>自制地图</div>
      <button class="preview-open" id="btn-preview-open">全屏查看</button>
    </div>
    <div class="level-info">
      <div class="kicker" id="level-series"></div>
      <h2 id="level-title"></h2>
      <p id="level-desc"></p>
      <ul class="level-facts">
        <li><span>目标</span><b id="level-objective"></b></li>
        <li><span>时限</span><b id="level-time"></b></li>
        <li><span>判定</span><b>据点数 · 人口 · 金币</b></li>
      </ul>
      <div class="difficulty-block">
        <div class="field-label">难度</div>
        <div class="difficulty-options" id="difficulty-options" role="radiogroup" aria-label="难度"></div>
        <p class="difficulty-hint" id="difficulty-hint"></p>
      </div>
      <div class="panel-actions">
        <button class="btn primary" id="btn-level-start">开始游戏</button>
        <button class="btn" id="btn-level-back">返回</button>
      </div>
    </div>
  </div>
</div>

<div class="overlay map-viewer" id="map-viewer" role="dialog" aria-modal="true" aria-label="地图预览">
  <button class="sheet-close viewer-close" id="btn-viewer-close" aria-label="关闭">×</button>
  <img id="map-viewer-img" alt="" />
</div>

<div class="overlay" id="exit-overlay">
  <div class="panel">
    <div class="kicker">退出</div>
    <h2>离开边境</h2>
    <p>确认关闭游戏？</p>
    <div class="panel-actions">
      <button class="btn primary" id="btn-exit-confirm">退出</button>
      <button class="btn" id="btn-exit-cancel">取消</button>
    </div>
  </div>
</div>
`;

interface ResultStats {
  won: boolean;
  draw: boolean;
  cities: number;
  pop: number;
  gold: number;
  time: string;
}

interface MapEntry {
  id: string;
  title: string;
  content: { map: MapDef; rules: typeof BASE_RULES };
  visual: MapVisual;
  description: string;
  /** 自制地图的示意图 data URL。 */
  preview?: string;
  custom?: boolean;
  document?: MapDocument;
}

interface StoredCustomMap {
  id: string;
  document: MapDocument;
}

interface RunConfig {
  mapId: string;
  difficulty: DifficultyId;
}

const CUSTOM_MAPS_KEY = "marchlands.customMaps.v1";
const CUSTOM_SERIES_ID = "custom";

export class App {
  private readonly root: HTMLElement;
  private readonly mapEntries = new Map<string, MapEntry>();
  private settings: Settings = loadSettings();
  private session: GameSession | null = null;
  private editor: EditorController | EditorNext | null = null;
  private editorKind: "classic" | "next" | null = null;
  private playtestMap: { map: MapDef; visual: MapVisual } | null = null;
  private page: PageId = "boot";
  private readonly autoStart: boolean;
  private readonly requestedMapId: string | null;
  private toastTimer = 0;
  private selection: RunConfig | null = null;
  private activeRun: RunConfig | null = null;
  private lastFocusedCard: HTMLElement | null = null;
  private skinKind: UnitSkinKind = "barbarian";

  constructor(root: HTMLElement, options: { autoStart?: boolean } = {}) {
    this.root = root;
    this.autoStart = options.autoStart === true;
    const requested = new URLSearchParams(window.location.search).get("map");
    this.requestedMapId = requested && mapEntry(requested) ? requested : null;
    this.loadBuiltinMaps();
    this.loadStoredMaps();
    this.root.innerHTML = TEMPLATE;
    this.bind();
    this.syncSettingsForm();
    this.syncCampaign();
    audio.setVolume(this.settings.volume);
  }

  start(): void {
    // 音频上下文初始化较慢，放在启动画面里完成。
    audio.prepare();
    const status = this.el("boot-status");
    const bar = this.el("boot-progress");
    status.textContent = "正在装载美术资源";
    void art
      .load((done, total) => {
        const percent = total === 0 ? 100 : Math.round((done / total) * 100);
        bar.style.width = `${percent}%`;
        status.textContent = `正在装载美术资源 ${done}/${total}`;
      })
      .then(async () => {
        assetRegistry.registerBuiltins();
        const packs = await assetRegistry.loadStoredPacks();
        bar.style.width = "100%";
        status.textContent = art.ready
          ? packs > 0
            ? `准备就绪 · ${packs} 个资产包`
            : "准备就绪"
          : "资源加载失败，使用简化美术";
        if (this.autoStart) {
          this.startLevel(
            this.activeRun ?? {
              mapId: this.requestedMapId ?? defaultLevelId(),
              difficulty: this.settings.difficulty,
            },
          );
        } else {
          window.setTimeout(() => this.show("menu"), 320);
        }
      });
  }

  private bind(): void {
    this.on("btn-start", "click", () => this.openCampaign());
    this.on("btn-editor", "click", () => this.openEditor());
    this.on("btn-settings", "click", () => this.openSettings());
    this.on("btn-skins", "click", () => this.openSkins());
    this.on("btn-skins-back", "click", () => this.show("menu"));
    this.on("btn-skin-reset", "click", () => this.resetSkin());
    this.on("btn-skin-prev", "click", () => this.scrollSkins(-1));
    this.on("btn-skin-next", "click", () => this.scrollSkins(1));
    this.bindSkinCarousel();
    this.on("btn-exit", "click", () => this.showOverlay("exit-overlay"));
    this.on("btn-campaign-back", "click", () => this.show("menu"));
    this.on("btn-series-back", "click", () => this.show("campaign"));
    this.on("btn-import-map", "click", () => void this.importMap());
    this.on("btn-empty-import", "click", () => void this.importMap());
    this.on("btn-pause", "click", () => this.pauseGame());
    this.on("btn-resume", "click", () => this.resumeGame());
    this.on("btn-editor-return", "click", () => this.returnToEditor());
    this.on("btn-restart", "click", () => this.showOverlay("confirm-overlay"));
    this.on("btn-confirm-no", "click", () => this.hideOverlay("confirm-overlay"));
    this.on("btn-confirm-yes", "click", () => this.restartGame());
    this.on("btn-menu", "click", () => this.backToMenu());
    this.on("btn-deselect", "click", () => this.session?.clearSelection());
    this.on("btn-squad-deselect", "click", () => this.session?.clearSelection());
    this.bindStance("#city-stance", (stance) => this.session?.setDispatchStance(stance));
    this.bindStance("#squad-stance", (stance) => this.session?.setSelectedSquadStance(stance));
    this.on("btn-dispatch", "click", () => this.session?.dispatchSelectedPlan());
    this.on("city-upgrade", "click", () => this.session?.upgradeSelected());
    this.on("city-transit", "click", () => this.session?.toggleTransit());
    this.on("btn-level-close", "click", () => this.closeLevelSheet());
    this.on("btn-level-back", "click", () => this.closeLevelSheet());
    this.on("btn-level-start", "click", () => this.startSelectedLevel());
    this.on("btn-preview-open", "click", () => {
      if (this.selection) this.openViewer(this.selection.mapId);
    });
    this.on("btn-viewer-close", "click", () => this.closeViewer());
    this.on("btn-credits", "click", () => this.openCredits());
    this.on("btn-credits-back", "click", () => this.show("settings"));
    this.on("btn-save-settings", "click", () => this.applySettingsForm(true));
    this.on("btn-settings-back", "click", () => {
      this.applySettingsForm(true);
      this.show("menu");
    });
    this.on("btn-exit-cancel", "click", () => this.hideOverlay("exit-overlay"));
    this.on("btn-exit-confirm", "click", () => this.exitApp());
    this.on("btn-replay", "click", () => {
      if (this.playtestMap) this.startEditorPlaytest(this.playtestMap.map, this.playtestMap.visual);
      else if (this.activeRun) this.startLevel(this.activeRun);
    });
    this.on("btn-result-menu", "click", () => {
      this.playtestMap = null;
      this.show("menu");
    });

    const volume = this.el("set-volume") as HTMLInputElement;
    volume.addEventListener("input", () => {
      this.el("set-volume-out").textContent = volume.value;
    });

    const difficulties = this.el("difficulty-options");
    difficulties.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement;
      if (input.name !== "level-difficulty" || !isDifficultyId(input.value)) return;
      this.selectDifficulty(input.value);
    });

    this.el("level-overlay").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeLevelSheet();
    });
    this.el("map-viewer").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeViewer();
    });

    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    window.addEventListener(
      "pointerdown",
      () => {
        audio.unlock();
      },
      { once: true },
    );
    this.root.addEventListener("click", (event) => {
      const target = event.target as Element | null;
      if (target?.closest(".btn, .icon-btn, .back-btn, .card")) audio.click();
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (this.isOverlayOpen("map-viewer")) {
        this.closeViewer();
        return;
      }
      if (this.isOverlayOpen("level-overlay")) {
        this.closeLevelSheet();
        return;
      }
      if (this.page === "game") {
        if (this.isOverlayOpen("confirm-overlay")) {
          this.hideOverlay("confirm-overlay");
          return;
        }
        if (this.isOverlayOpen("pause-overlay")) this.resumeGame();
        else this.pauseGame();
        return;
      }
      if (this.page === "skins") {
        this.show("menu");
        return;
      }
      if (this.page === "settings") {
        this.applySettingsForm(true);
        this.show("menu");
        return;
      }
      if (this.page === "campaign") {
        this.show("menu");
        return;
      }
      if (this.page === "series") {
        this.show("campaign");
        return;
      }
      if (this.isOverlayOpen("exit-overlay")) this.hideOverlay("exit-overlay");
    }
  }

  private openEditor(): void {
    this.session?.dispose();
    this.session = null;
    this.playtestMap = null;
    this.activeRun = null;
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    this.updateCityPanel(null);
    const kind = new URLSearchParams(window.location.search).get("editor") === "classic" ? "classic" : "next";
    if (!this.editor || this.editorKind !== kind) {
      this.editor?.dispose();
      const options = {
        root: this.el("editor-root"),
        rules: BASE_RULES,
        onPlaytest: (map: MapDef, visual: MapVisual) => this.startEditorPlaytest(map, visual),
        onExit: () => this.closeEditor(),
      };
      this.editor = kind === "next" ? new EditorNext(options) : new EditorController(options);
      this.editorKind = kind;
    }
    this.show("editor");
    this.editor.open();
  }

  private closeEditor(): void {
    this.editor?.suspend();
    this.show("menu");
  }

  private startEditorPlaytest(map: MapDef, visual: MapVisual): void {
    this.session?.dispose();
    this.editor?.suspend();
    this.playtestMap = { map, visual };
    this.activeRun = null;
    this.hideLevelSheet();
    this.show("game");
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    const canvas = this.el("game-canvas") as HTMLCanvasElement;
    this.session = new GameSession({
      canvas,
      hud: this.root,
      map,
      visual,
      unitSkins: this.settings.unitSkins,
      rules: BASE_RULES,
      onFinish: (state) => this.finish(state),
      onToast: (text) => this.toast(text),
      onSelect: (cityId, count) => this.updateCityPanel(cityId, count),
    });
    this.session.start();
    this.showEditorReturn();
  }

  private returnToEditor(): void {
    this.session?.dispose();
    this.session = null;
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    this.updateCityPanel(null);
    this.playtestMap = null;
    this.hideEditorReturn();
    this.show("editor");
    this.editor?.resume();
  }

  private showEditorReturn(): void {
    this.el("btn-editor-return").style.display = "inline-flex";
  }

  private hideEditorReturn(): void {
    this.el("btn-editor-return").style.display = "none";
  }

  private loadBuiltinMaps(): void {
    for (const series of CAMPAIGN) {
      for (const level of series.levels) {
        const source = mapEntry(level.mapId);
        if (!source) continue;
        this.mapEntries.set(level.mapId, {
          id: level.mapId,
          title: level.title,
          content: { map: source.map, rules: source.rules },
          visual: source.visual,
          description: level.blurb,
        });
      }
    }
  }

  private allSeries(): SeriesDef[] {
    const custom: LevelDef[] = [...this.mapEntries.values()]
      .filter((entry) => entry.custom)
      .map((entry) => ({ mapId: entry.id, title: entry.title, blurb: entry.description }));
    return [
      ...CAMPAIGN,
      {
        id: CUSTOM_SERIES_ID,
        chapter: "自制",
        title: "自制关卡",
        levels: custom,
      },
    ];
  }

  private openCampaign(): void {
    this.syncCampaign();
    this.show("campaign");
  }

  private syncCampaign(): void {
    const series = this.allSeries();
    const levels = series.reduce((total, item) => total + item.levels.length, 0);
    this.el("campaign-count").textContent = `${series.length} 个系列 · ${levels} 个关卡`;
    this.el("series-grid").replaceChildren(...series.map((item, index) => this.buildSeriesCard(item, index)));
  }

  private buildSeriesCard(series: SeriesDef, index: number): HTMLElement {
    const card = document.createElement("article");
    card.className = "card series-card";
    card.dataset.series = series.id;
    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "card-hit";
    hit.setAttribute(
      "aria-label",
      series.levels.length > 0 ? `${series.title}，${series.levels.length} 关` : `${series.title}，暂无关卡`,
    );
    hit.addEventListener("click", () => this.openSeries(series.id));
    card.append(hit, this.buildCardMedia(series.levels[0] ? this.levelCover(series.levels[0].mapId) : null));

    const chapter = document.createElement("span");
    chapter.className = "card-chapter";
    chapter.textContent = series.chapter || `第 ${index + 1} 章`;

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = series.title;

    const meta = document.createElement("span");
    meta.className = "card-meta";
    meta.textContent = series.levels.length > 0 ? `${series.levels.length} 关` : "暂无关卡";

    const copy = document.createElement("div");
    copy.className = "card-copy";
    copy.append(chapter, title, meta);
    card.append(copy);
    return card;
  }

  private buildLevelCard(level: LevelDef, index: number): HTMLElement {
    const entry = this.mapEntries.get(level.mapId);
    const card = document.createElement("article");
    card.className = "card level-card";
    card.dataset.level = level.mapId;
    const hit = document.createElement("button");
    hit.type = "button";
    hit.className = "card-hit";
    hit.setAttribute("aria-label", `${entry?.title ?? level.title}，查看关卡详情`);
    hit.addEventListener("click", () => this.openLevelSheet(level.mapId, hit));
    card.append(hit, this.buildCardMedia(this.levelCover(level.mapId)));

    const chapter = document.createElement("span");
    chapter.className = "card-chapter";
    chapter.textContent = `第 ${index + 1} 关`;

    const title = document.createElement("span");
    title.className = "card-title";
    title.textContent = entry?.title ?? level.title;

    const meta = document.createElement("span");
    meta.className = "card-meta";
    const towns = entry ? entry.content.map.cities.filter((city) => isProductionSiteKind(city.kind)).length : 0;
    const minutes = entry
      ? Math.round(entry.content.rules.maxTicks / entry.content.rules.tickHz / 60)
      : 0;
    meta.textContent = entry ? `${towns} 座产兵据点 · ${minutes} 分钟` : "自制地图";

    const copy = document.createElement("div");
    copy.className = "card-copy";
    copy.append(chapter, title, meta);
    card.append(copy);
    return card;
  }

  private levelCover(mapId: string): string | null {
    const entry = this.mapEntries.get(mapId);
    if (!entry) return null;
    return entry.custom ? entry.preview ?? null : previewUrl(mapId);
  }

  private buildCardMedia(cover: string | null): HTMLElement {
    const media = document.createElement("div");
    media.className = "card-media";
    if (cover) {
      const image = document.createElement("img");
      image.src = cover;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      media.append(image);
    } else {
      media.classList.add("card-media-empty");
      const label = document.createElement("span");
      label.textContent = "自制地图";
      media.append(label);
    }
    return media;
  }

  private openSeries(seriesId: string): void {
    const series = this.allSeries().find((entry) => entry.id === seriesId);
    if (!series) return;
    this.el("series-kicker").textContent = series.chapter;
    this.el("series-title").textContent = series.title;
    this.el("series-count").textContent = series.id === CUSTOM_SERIES_ID
      ? `${series.levels.length} 张自制地图`
      : `${series.levels.length} 个关卡`;
    const empty = series.levels.length === 0;
    (this.el("series-empty") as HTMLElement).hidden = !empty;
    (this.el("series-foot") as HTMLElement).hidden = series.id !== CUSTOM_SERIES_ID || empty;
    this.el("level-grid").replaceChildren(
      ...series.levels.map((level, index) => this.buildLevelCard(level, index)),
    );
    this.show("series");
  }

  private openLevelSheet(mapId: string, card: HTMLElement | null): void {
    const entry = this.mapEntries.get(mapId);
    if (!entry) return;
    this.selection = { mapId, difficulty: this.settings.difficulty };
    this.lastFocusedCard = card;
    const context = findLevel(mapId);
    this.el("level-series").textContent = context
      ? `${context.series.chapter} · ${context.series.title}`
      : "自制关卡";
    this.el("level-title").textContent = entry.title;
    this.el("level-desc").textContent = entry.description;
    const towns = entry.content.map.cities.filter((city) => isProductionSiteKind(city.kind)).length;
    const minutes = Math.round(entry.content.rules.maxTicks / entry.content.rules.tickHz / 60);
    this.el("level-objective").textContent = `占领全部 ${towns} 座产兵据点`;
    this.el("level-time").textContent = `${minutes} 分钟`;

    const image = this.el("level-preview-img") as HTMLImageElement;
    const backdrop = this.el("level-preview-bg") as HTMLImageElement;
    const cover = this.levelCover(mapId);
    const available = Boolean(cover);
    if (cover) {
      image.src = cover;
      image.alt = `${entry.title} 地图`;
      image.hidden = false;
      backdrop.src = cover;
      backdrop.hidden = false;
    } else {
      image.removeAttribute("src");
      image.alt = "";
      image.hidden = true;
      backdrop.removeAttribute("src");
      backdrop.hidden = true;
    }
    (this.el("level-preview-empty") as HTMLElement).hidden = available;
    (this.el("btn-preview-open") as HTMLButtonElement).disabled = !available;
    this.syncDifficultyOptions();
    this.showOverlay("level-overlay");
    (this.el("btn-level-start") as HTMLButtonElement).focus({ preventScroll: true });
  }

  private syncDifficultyOptions(): void {
    const selected = this.selection?.difficulty ?? this.settings.difficulty;
    const host = this.el("difficulty-options");
    host.replaceChildren(
      ...DIFFICULTIES.map((entry) => {
        const label = document.createElement("label");
        label.className = "difficulty-option";
        const input = document.createElement("input");
        input.type = "radio";
        input.name = "level-difficulty";
        input.value = entry.id;
        input.checked = entry.id === selected;
        const text = document.createElement("span");
        text.textContent = entry.label;
        label.append(input, text);
        return label;
      }),
    );
    this.el("difficulty-hint").textContent = difficultyDef(selected).hint;
  }

  private selectDifficulty(id: DifficultyId): void {
    if (!this.selection) return;
    this.selection = { ...this.selection, difficulty: id };
    this.settings = { ...this.settings, difficulty: id };
    saveSettings(this.settings);
    this.el("difficulty-hint").textContent = difficultyDef(id).hint;
  }

  private startSelectedLevel(): void {
    if (!this.selection) return;
    const config = { ...this.selection };
    this.hideLevelSheet();
    this.startLevel(config);
  }

  private closeLevelSheet(): void {
    this.hideLevelSheet();
    this.lastFocusedCard?.focus();
  }

  private hideLevelSheet(): void {
    this.hideOverlay("level-overlay");
    this.hideOverlay("map-viewer");
    this.selection = null;
  }

  private closeViewer(): void {
    this.hideOverlay("map-viewer");
    (this.el("btn-preview-open") as HTMLButtonElement).focus();
  }

  private openViewer(mapId: string): void {
    const entry = this.mapEntries.get(mapId);
    const cover = this.levelCover(mapId);
    if (!entry || !cover) return;
    const image = this.el("map-viewer-img") as HTMLImageElement;
    image.src = cover;
    image.alt = `${entry.title} 地图全屏预览`;
    this.showOverlay("map-viewer");
    (this.el("btn-viewer-close") as HTMLButtonElement).focus();
  }

  private startLevel(config: RunConfig): void {
    const entry = this.mapEntries.get(config.mapId);
    if (!entry) return;
    this.selection = null;
    this.activeRun = config;
    this.session?.dispose();
    this.editor?.suspend();
    this.playtestMap = null;
    this.hideEditorReturn();
    this.show("game");
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    const canvas = this.el("game-canvas") as HTMLCanvasElement;
    const boot = (): void => {
      if (this.activeRun !== config) return;
      this.session = new GameSession({
        canvas,
        hud: this.root,
        map: entry.content.map,
        visual: entry.visual,
        unitSkins: this.settings.unitSkins,
        aiTuning: difficultyDef(config.difficulty).ai,
        rules: entry.content.rules,
        onFinish: (state) => this.finish(state),
        onToast: (text) => this.toast(text),
        onSelect: (cityId, count) => this.updateCityPanel(cityId, count),
        onReady: () => this.clearMatchPreparing(),
      });
      this.session.start();
    };
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("intro") === "0") {
      boot();
      return;
    }
    // 先让加载画面真正画一帧，再同步建场景，避免点击后立刻定住。
    this.showMatchPreparing();
    requestAnimationFrame(() => requestAnimationFrame(boot));
  }

  private showMatchPreparing(): void {
    const intro = this.el("match-intro");
    intro.hidden = false;
    intro.classList.remove("done");
    intro.classList.add("on", "preparing");
    (this.el("match-intro-shade") as HTMLElement).style.opacity = "1";
    (this.el("match-intro-count") as HTMLElement).textContent = "3";
    (this.el("match-intro-label") as HTMLElement).textContent = "部署";
  }

  private clearMatchPreparing(): void {
    this.el("match-intro").classList.remove("preparing");
  }

  private finish(state: SimState): void {
    const stats: ResultStats = {
      won: state.winner === 1,
      draw: state.winner === 0,
      cities: state.cities.filter((city) => city.owner === 1 && isProductionSiteKind(city.kind)).length,
      pop: state.cities.filter((city) => city.owner === 1).reduce((sum, city) => sum + city.pop, 0),
      gold: state.players.find((player) => player.id === 1)?.gold ?? 0,
      time: this.formatTime(state.tick),
    };
    window.setTimeout(() => {
      this.session?.dispose();
      this.session = null;
      this.fillResult(stats);
      this.show("result");
    }, 800);
  }

  private fillResult(stats: ResultStats): void {
    const mark = this.el("result-mark");
    mark.textContent = stats.draw ? "平局" : stats.won ? "胜利" : "失败";
    mark.className = `result-mark ${stats.won ? "win" : "lose"}`;
    this.el("stat-cities").textContent = String(stats.cities);
    this.el("stat-pop").textContent = String(stats.pop);
    this.el("stat-gold").textContent = String(stats.gold);
    this.el("stat-time").textContent = stats.time;
    this.el("result-line").textContent = stats.draw
      ? "十五分钟后，双方都没能压倒对方。"
      : stats.won
        ? "你控制了整片边境。"
        : "红旗插遍了沙盘，下一次换个打法。";
  }

  private pauseGame(): void {
    if (!this.session || this.session.isPaused()) return;
    this.session.pause();
    if (this.playtestMap) this.showEditorReturn();
    else this.hideEditorReturn();
    this.showOverlay("pause-overlay");
  }

  private resumeGame(): void {
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    this.session?.resume();
  }

  private restartGame(): void {
    this.hideOverlay("confirm-overlay");
    this.hideOverlay("pause-overlay");
    this.session?.restart();
    this.updateCityPanel(null);
  }

  private backToMenu(): void {
    this.session?.dispose();
    this.session = null;
    this.editor?.suspend();
    this.playtestMap = null;
    this.activeRun = null;
    this.hideEditorReturn();
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    this.hideLevelSheet();
    this.updateCityPanel(null);
    this.show("menu");
  }

  private loadStoredMaps(): void {
    try {
      const raw = localStorage.getItem(CUSTOM_MAPS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as StoredCustomMap[];
      if (!Array.isArray(stored)) return;
      for (const entry of stored) {
        if (!entry || typeof entry.id !== "string" || !entry.document) continue;
        try {
          const parsed = parseDocument(entry.document);
          const compiled = compileDocument(parsed.document);
          if (compiled.diagnostics.some((item) => item.severity === "error")) continue;
          this.mapEntries.set(entry.id, {
            id: entry.id,
            title: parsed.document.name || "未命名地图",
            content: validateContent(compiled.map, BASE_RULES),
            visual: compiled.visual,
            description: `玩家地图 · ${parsed.document.sites.length} 个据点`,
            preview: mapSketch(compiled.map),
            custom: true,
            document: parsed.document,
          });
        } catch {
          // ignore a broken saved map
        }
      }
    } catch {
      // localStorage can be unavailable in a locked profile
    }
  }

  private saveCustomMaps(): void {
    try {
      const stored: StoredCustomMap[] = [...this.mapEntries.values()]
        .filter((entry) => entry.custom && entry.document)
        .map((entry) => ({ id: entry.id, document: entry.document as MapDocument }));
      localStorage.setItem(CUSTOM_MAPS_KEY, JSON.stringify(stored));
    } catch {
      // localStorage can be unavailable in a locked profile
    }
  }

  private addCustomMap(document: MapDocument): string {
    const compiled = compileDocument(document);
    const error = compiled.diagnostics.find((entry) => entry.severity === "error");
    if (error) throw new Error(error.message);
    const id = `custom-${Date.now().toString(36)}`;
    this.mapEntries.set(id, {
      id,
      title: document.name || "未命名地图",
      content: validateContent(compiled.map, BASE_RULES),
      visual: compiled.visual ?? defaultVisualForMap(compiled.map),
      description: `玩家地图 · ${document.sites.length} 个据点`,
      preview: mapSketch(compiled.map),
      custom: true,
      document,
    });
    this.saveCustomMaps();
    this.syncCampaign();
    return id;
  }

  private async importMap(): Promise<void> {
    try {
      const opened = await openMapText();
      if (!opened) return;
      const parsed = parseDocument(JSON.parse(opened.text));
      const id = this.addCustomMap(parsed.document);
      this.toast(`已载入 ${parsed.document.name}`);
      this.openSeries(CUSTOM_SERIES_ID);
      this.openLevelSheet(id, null);
    } catch (error) {
      this.toast(error instanceof Error ? error.message : "地图文件无法读取");
    }
  }

  private openSkins(): void {
    this.renderSkins(true);
    this.show("skins");
  }

  private renderSkins(resetScroll = false): void {
    const tabs = this.el("skin-tabs");
    tabs.replaceChildren(
      ...UNIT_KINDS.map((kind) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `skin-tab${kind === this.skinKind ? " on" : ""}`;
        button.dataset.kind = kind;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(kind === this.skinKind));
        button.textContent = UNIT_NAMES[kind];
        const tags = traitTags(UNIT_TRAITS[kind]);
        button.title = tags.length > 0 ? tags.join(" · ") : "无特殊属性";
        button.addEventListener("click", () => {
          this.skinKind = kind;
          this.renderSkins(true);
        });
        return button;
      }),
    );

    const skins = skinsForKind(this.skinKind);
    this.el("skin-count").textContent = `${UNIT_NAMES[this.skinKind]} · ${skins.length} 套可选`;
    const current = this.settings.unitSkins[this.skinKind];
    const grid = this.el("skin-grid");
    const offset = resetScroll ? 0 : grid.scrollLeft;
    grid.replaceChildren(
      ...skins.map((skin) => this.buildSkinCard(skin, current === unitSkinAssetId(skin.key))),
    );
    grid.scrollLeft = offset;
    requestAnimationFrame(() => this.updateSkinScrollState());
  }

  private bindSkinCarousel(): void {
    const grid = this.el("skin-grid");
    grid.addEventListener("scroll", () => this.updateSkinScrollState(), { passive: true });
    grid.addEventListener(
      "wheel",
      (event) => {
        if (event.deltaY === 0 || grid.scrollWidth <= grid.clientWidth + 1) return;
        event.preventDefault();
        grid.scrollLeft += event.deltaY;
      },
      { passive: false },
    );

    let down = false;
    let startX = 0;
    let startLeft = 0;
    let moved = false;
    grid.addEventListener("pointerdown", (event) => {
      if (event.pointerType !== "mouse" || event.button !== 0) return;
      down = true;
      moved = false;
      startX = event.clientX;
      startLeft = grid.scrollLeft;
    });
    grid.addEventListener("pointermove", (event) => {
      if (!down) return;
      const dx = event.clientX - startX;
      if (!moved && Math.abs(dx) < 6) return;
      if (!moved) {
        moved = true;
        // 只有真正拖动时才接管指针，普通点击仍交给卡片。
        grid.setPointerCapture(event.pointerId);
        grid.classList.add("dragging");
      }
      grid.scrollLeft = startLeft - dx;
    });
    const end = (event: PointerEvent): void => {
      if (!down) return;
      down = false;
      grid.classList.remove("dragging");
      if (grid.hasPointerCapture(event.pointerId)) grid.releasePointerCapture(event.pointerId);
    };
    grid.addEventListener("pointerup", end);
    grid.addEventListener("pointercancel", end);
    grid.addEventListener(
      "click",
      (event) => {
        if (!moved) return;
        event.preventDefault();
        event.stopPropagation();
        moved = false;
      },
      true,
    );
    window.addEventListener("resize", () => this.updateSkinScrollState());
  }

  private scrollSkins(direction: -1 | 1): void {
    const grid = this.el("skin-grid");
    const amount = Math.max(240, grid.clientWidth * 0.72);
    grid.scrollBy({ left: direction * amount, behavior: "smooth" });
  }

  private updateSkinScrollState(): void {
    const grid = this.el("skin-grid");
    const carousel = this.el("skin-carousel");
    if (!grid || !carousel) return;
    const max = grid.scrollWidth - grid.clientWidth;
    carousel.classList.toggle("can-prev", grid.scrollLeft > 4);
    carousel.classList.toggle("can-next", max > 4 && grid.scrollLeft < max - 4);
    const prev = this.el("btn-skin-prev") as HTMLButtonElement;
    const next = this.el("btn-skin-next") as HTMLButtonElement;
    prev.disabled = grid.scrollLeft <= 4;
    next.disabled = max <= 4 || grid.scrollLeft >= max - 4;
  }

  private buildSkinCard(skin: UnitSkinDef, selected: boolean): HTMLElement {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `skin-card${selected ? " selected" : ""}`;
    card.dataset.skinKey = skin.key;
    card.setAttribute("aria-pressed", String(selected));

    const media = document.createElement("span");
    media.className = "skin-card-media";
    const image = document.createElement("img");
    image.src = `${import.meta.env.BASE_URL}skins/${skin.key}.png`;
    image.alt = `${skin.label}正面照`;
    image.loading = "lazy";
    image.draggable = false;
    const check = document.createElement("span");
    check.className = "skin-card-check";
    check.textContent = "✓";
    media.append(image, check);

    const copy = document.createElement("span");
    copy.className = "skin-card-copy";
    const name = document.createElement("b");
    name.textContent = skin.label;
    const tag = document.createElement("small");
    const tags = skin.traits ? traitTags(skin.traits) : [];
    const group = skin.kind ? "默认模型" : "通用角色";
    tag.textContent = tags.length > 0 ? `${group} · ${tags.join(" · ")}` : group;
    copy.append(name, tag);
    card.append(media, copy);
    card.addEventListener("click", () => this.chooseSkin(skin));
    return card;
  }

  private chooseSkin(skin: UnitSkinDef): void {
    this.settings = {
      ...this.settings,
      unitSkins: { ...this.settings.unitSkins, [this.skinKind]: unitSkinAssetId(skin.key) },
    };
    saveSettings(this.settings);
    this.toast(`已选择 ${skin.label}`);
    this.renderSkins(false);
  }

  private resetSkin(): void {
    const fallback = DEFAULT_SETTINGS.unitSkins[this.skinKind];
    const next = { ...this.settings.unitSkins };
    if (fallback) next[this.skinKind] = fallback;
    else delete next[this.skinKind];
    this.settings = { ...this.settings, unitSkins: next };
    saveSettings(this.settings);
    this.toast(`${UNIT_NAMES[this.skinKind]}已恢复默认皮肤`);
    this.renderSkins(false);
  }

  private openSettings(): void {
    this.syncSettingsForm();
    this.show("settings");
  }

  private openCredits(): void {
    this.renderCredits();
    this.show("credits");
  }

  private renderCredits(): void {
    const list = this.el("credits-list");
    if (list.childElementCount > 0) return;
    for (const credit of CREDITS) {
      const item = document.createElement("li");
      const title = document.createElement("span");
      title.className = "credit-name";
      title.textContent = credit.name;
      const meta = document.createElement("span");
      meta.className = "credit-meta";
      const link = document.createElement("a");
      link.href = credit.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = credit.author;
      meta.append(link, ` · ${credit.license} · ${credit.usage}`);
      item.append(title, meta);
      list.append(item);
    }
  }

  private syncSettingsForm(): void {
    (this.el("set-resolution") as HTMLSelectElement).value = this.settings.resolution;
    (this.el("set-mode") as HTMLSelectElement).value = this.settings.windowMode;
    const volume = this.el("set-volume") as HTMLInputElement;
    volume.value = String(this.settings.volume);
    this.el("set-volume-out").textContent = String(this.settings.volume);
  }

  private applySettingsForm(notify: boolean): void {
    this.settings = {
      ...this.settings,
      resolution: (this.el("set-resolution") as HTMLSelectElement).value as Settings["resolution"],
      windowMode: (this.el("set-mode") as HTMLSelectElement).value as Settings["windowMode"],
      volume: Number((this.el("set-volume") as HTMLInputElement).value),
    };
    saveSettings(this.settings);
    audio.setVolume(this.settings.volume);
    this.applyWindowMode();
    if (notify) this.toast("设置已保存");
  }

  private applyWindowMode(): void {
    const host = window.marchlandsHost;
    if (host) {
      const [hostWidth, hostHeight] = this.settings.resolution.split("x").map(Number);
      void host.setFullscreen(this.settings.windowMode === "fullscreen");
      void host.setSize(hostWidth, hostHeight);
      return;
    }
    try {
      if (this.settings.windowMode === "fullscreen" && !document.fullscreenElement) {
        void document.documentElement.requestFullscreen();
      } else if (this.settings.windowMode === "windowed" && document.fullscreenElement) {
        void document.exitFullscreen();
      }
    } catch {
      // fullscreen can be blocked outside a user gesture
    }
    const [width, height] = this.settings.resolution.split("x").map(Number);
    try {
      window.resizeTo(width + 16, height + 39);
    } catch {
      // browsers ignore resizeTo for top-level tabs
    }
  }

  private exitApp(): void {
    this.hideOverlay("exit-overlay");
    if (window.marchlandsHost) {
      window.marchlandsHost.quit();
      return;
    }
    window.close();
    window.setTimeout(() => this.toast("浏览器不允许关闭窗口，请直接关闭标签页"), 120);
  }

  private updateCityPanel(cityId: string | null, count = 0): void {
    const panel = this.el("city-panel");
    const multi = this.el("city-multi");
    multi.textContent = count > 1 ? `已选 ${count} 座` : "";
    if (!cityId) {
      panel.classList.remove("on");
      return;
    }
    const city = this.session?.getCity(cityId);
    if (!city) {
      panel.classList.remove("on");
      return;
    }
    panel.classList.add("on");
    const kindLabel = siteKindLabel(city.kind);
    this.el("city-name").textContent = `${city.id} · ${kindLabel}`;
    this.el("city-level").textContent = `LV.${city.level}`;
    this.el("city-pop").textContent = String(city.pop);
    this.el("city-max").textContent = String(city.maxPop);
    const garrison = garrisonEntries(city)
      .map((entry) => `${UNIT_PROFILES[entry.kind].label} ${entry.count}`)
      .join(" · ");
    this.el("city-garrison").textContent = garrison || "无驻军";
    const accent = this.el("city-accent");
    accent.style.background = city.owner === 1 ? "#57b57a" : city.owner === 2 ? "#d0664a" : "#8d8778";
    const fill = this.el("city-pop-fill");
    fill.style.width = `${Math.round((city.pop / Math.max(1, city.maxPop)) * 100)}%`;
    fill.style.background = city.owner === 1 ? "#57b57a" : city.owner === 2 ? "#d0664a" : "#b3ab97";
    const pips = this.el("city-pips").querySelectorAll("i");
    pips.forEach((pip, index) => pip.classList.toggle("on", index < city.level));
    const defense = defenseMilliFor(city, BASE_RULES) / 1000;
    this.el("city-defense").textContent = defense.toFixed(2);
    const cost = [15, 22, 32][city.level - 1] ?? 0;
    const transit = this.el("city-transit") as HTMLButtonElement;
    const release = city.transit === "open";
    transit.textContent = release ? "通行 · 放行" : "通行 · 拦截";
    transit.disabled = city.owner === 0;
    const button = this.el("city-upgrade") as HTMLButtonElement;
    if (!isProductionSiteKind(city.kind)) {
      button.textContent = "不可升级";
      button.disabled = true;
    } else {
      button.textContent = city.level >= 3 ? "已满级" : `升级 · ${cost}`;
      button.disabled = city.level >= 3 || city.pop < cost;
    }
  }

  private formatTime(ticks: number): string {
    const total = Math.floor(ticks / 20);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  private show(page: PageId): void {
    this.page = page;
    for (const element of this.root.querySelectorAll<HTMLElement>(".page")) {
      element.classList.toggle("active", element.id === `page-${page}`);
    }
  }

  private showOverlay(id: string): void {
    this.root.querySelector(`#${id}`)?.classList.add("on");
  }

  private hideOverlay(id: string): void {
    this.root.querySelector(`#${id}`)?.classList.remove("on");
  }

  private isOverlayOpen(id: string): boolean {
    return this.root.querySelector(`#${id}`)?.classList.contains("on") ?? false;
  }

  private toast(text: string): void {
    const node = this.el("toast");
    node.textContent = text;
    node.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.classList.remove("on"), 1800);
  }

  private bindStance(selector: string, apply: (stance: SquadStance) => void): void {
    this.root.querySelector(`${selector}`)?.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-stance]");
      const stance = button?.dataset.stance;
      if (stance === "guard" || stance === "forced") apply(stance);
    });
  }

  private on(id: string, type: string, handler: () => void): void {
    this.root.querySelector(`#${id}`)?.addEventListener(type, handler);
  }

  private el(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`missing element: ${id}`);
    return element;
  }
}