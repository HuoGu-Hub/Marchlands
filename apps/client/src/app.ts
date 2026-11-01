import forestMapJson from "@marchlands/content/maps/forest01.json";
import rulesJson from "@marchlands/content/rules/1.json";
import { validateContent } from "@marchlands/content";
import type { SimState } from "@marchlands/sim";
import { audio } from "./audio";
import { GameSession } from "./game/session";
import { loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings";

type PageId = "boot" | "menu" | "briefing" | "game" | "result" | "settings";

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
      <p class="menu-desc">六十米的边境沙盘，七座城镇，一场没有退路的领地战争。派兵、行军、占领，把最后一面旗插满地图。</p>
    </div>
    <div class="menu-actions">
      <button class="btn primary" id="btn-start">开始游戏</button>
      <button class="btn" id="btn-settings">设置</button>
      <button class="btn ghost" id="btn-exit">退出</button>
      <div class="menu-foot" id="menu-version">M1 灰盒 · v0.1.0</div>
    </div>
  </div>
</section>

<section id="page-briefing" class="page">
  <div class="stage">
    <div class="panel">
      <div class="kicker">战役简报</div>
      <h2>Forest 01</h2>
      <p>你的旗帜插在西侧。东侧的红旗正在集结，五座中立城镇在等待第一个到达的人。</p>
      <ul class="brief-list">
        <li><span>目标</span><b>占领全部 7 座城镇</b></li>
        <li><span>时限</span><b>15 分钟</b></li>
        <li><span>判定</span><b>城镇数 · 人口 · 金币</b></li>
      </ul>
      <p>点击己方城镇选中，再点击目标城镇派出一半守军。到达时与守军结算，防御随等级提高。</p>
      <div class="panel-actions">
        <button class="btn primary" id="btn-brief-start">开始</button>
        <button class="btn" id="btn-brief-back">返回</button>
      </div>
    </div>
  </div>
</section>

<section id="page-game" class="page">
  <canvas id="game-canvas"></canvas>
  <div class="hud">
    <div class="hud-left">
      <div class="chip">城镇 <b id="hud-cities">1</b></div>
      <div class="chip">人口 <b id="hud-pop">30</b></div>
      <div class="chip">金币 <b id="hud-gold">0</b></div>
    </div>
    <div class="hud-right">
      <div class="timer" id="hud-timer">00:00</div>
      <button class="icon-btn" id="btn-pause">暂停</button>
    </div>
    <div class="city-panel" id="city-panel">
      <div>
        <div class="city-name"><span id="city-name">c1</span><i id="city-level">LV.3</i></div>
        <div class="city-line">守军 <b id="city-pop">30</b> / <span id="city-max">65</span> · 防御 <b id="city-defense">1.20</b></div>
      </div>
      <div class="city-actions">
        <button class="btn" id="city-upgrade">升级</button>
        <button class="btn ghost" id="btn-deselect">取消</button>
      </div>
    </div>
    <div class="toast" id="toast"></div>
    <div class="hint">左键选择与派兵 · 右键取消 · Q / E 旋转 · 滚轮缩放</div>
  </div>

  <div class="overlay" id="pause-overlay">
    <div class="panel">
      <div class="kicker">已暂停</div>
      <h2>战场静止</h2>
      <p>模拟与计时已停止，继续后从当前 tick 恢复。</p>
      <div class="panel-actions">
        <button class="btn primary" id="btn-resume">继续</button>
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
        <div class="stat"><span>城镇</span><b id="stat-cities">7</b></div>
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
      <div class="panel-actions">
        <button class="btn primary" id="btn-save-settings">保存</button>
        <button class="btn" id="btn-settings-back">返回</button>
      </div>
    </div>
  </div>
</section>

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

export class App {
  private readonly root: HTMLElement;
  private readonly content: ReturnType<typeof validateContent>;
  private settings: Settings = loadSettings();
  private session: GameSession | null = null;
  private page: PageId = "boot";
  private toastTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.content = validateContent(forestMapJson, rulesJson);
    this.root.innerHTML = TEMPLATE;
    this.bind();
    this.syncSettingsForm();
    audio.setVolume(this.settings.volume);
  }

  start(): void {
    let progress = 0;
    const status = this.el("boot-status");
    const bar = this.el("boot-progress");
    const timer = window.setInterval(() => {
      progress = Math.min(100, progress + 4 + Math.random() * 6);
      bar.style.width = `${progress}%`;
      if (progress > 35 && progress < 70) status.textContent = "正在校准镜头";
      if (progress >= 70) status.textContent = "正在连接模拟核心";
      if (progress >= 100) {
        window.clearInterval(timer);
        status.textContent = "准备就绪";
        window.setTimeout(() => this.show("menu"), 260);
      }
    }, 40);
  }

  private bind(): void {
    this.on("btn-start", "click", () => this.show("briefing"));
    this.on("btn-settings", "click", () => this.openSettings());
    this.on("btn-exit", "click", () => this.showOverlay("exit-overlay"));
    this.on("btn-brief-start", "click", () => this.startGame());
    this.on("btn-brief-back", "click", () => this.show("menu"));
    this.on("btn-pause", "click", () => this.pauseGame());
    this.on("btn-resume", "click", () => this.resumeGame());
    this.on("btn-restart", "click", () => this.showOverlay("confirm-overlay"));
    this.on("btn-confirm-no", "click", () => this.hideOverlay("confirm-overlay"));
    this.on("btn-confirm-yes", "click", () => this.restartGame());
    this.on("btn-menu", "click", () => this.backToMenu());
    this.on("btn-deselect", "click", () => this.session?.clearSelection());
    this.on("city-upgrade", "click", () => this.session?.upgradeSelected());
    this.on("btn-save-settings", "click", () => this.applySettingsForm(true));
    this.on("btn-settings-back", "click", () => {
      this.applySettingsForm(true);
      this.show("menu");
    });
    this.on("btn-exit-cancel", "click", () => this.hideOverlay("exit-overlay"));
    this.on("btn-exit-confirm", "click", () => this.exitApp());
    this.on("btn-replay", "click", () => this.startGame());
    this.on("btn-result-menu", "click", () => this.show("menu"));

    const volume = this.el("set-volume") as HTMLInputElement;
    volume.addEventListener("input", () => {
      this.el("set-volume-out").textContent = volume.value;
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
      if (target?.closest(".btn, .icon-btn")) audio.click();
    });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      if (this.page === "game") {
        if (this.isOverlayOpen("confirm-overlay")) {
          this.hideOverlay("confirm-overlay");
          return;
        }
        if (this.isOverlayOpen("pause-overlay")) this.resumeGame();
        else this.pauseGame();
        return;
      }
      if (this.page === "settings") {
        this.applySettingsForm(true);
        this.show("menu");
        return;
      }
      if (this.page === "briefing") {
        this.show("menu");
        return;
      }
      if (this.isOverlayOpen("exit-overlay")) this.hideOverlay("exit-overlay");
    }
  }

  private startGame(): void {
    this.session?.dispose();
    this.show("game");
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    const canvas = this.el("game-canvas") as HTMLCanvasElement;
    this.session = new GameSession({
      canvas,
      hud: this.root,
      map: this.content.map,
      rules: this.content.rules,
      onFinish: (state) => this.finish(state),
      onToast: (text) => this.toast(text),
      onSelect: (cityId) => this.updateCityPanel(cityId),
    });
    this.session.start();
  }

  private finish(state: SimState): void {
    const stats: ResultStats = {
      won: state.winner === 1,
      draw: state.winner === 0,
      cities: state.cities.filter((city) => city.owner === 1).length,
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
    this.hideOverlay("pause-overlay");
    this.hideOverlay("confirm-overlay");
    this.updateCityPanel(null);
    this.show("menu");
  }

  private openSettings(): void {
    this.syncSettingsForm();
    this.show("settings");
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

  private updateCityPanel(cityId: string | null): void {
    const panel = this.el("city-panel");
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
    this.el("city-name").textContent = city.id;
    this.el("city-level").textContent = `LV.${city.level}`;
    this.el("city-pop").textContent = String(city.pop);
    this.el("city-max").textContent = String(city.maxPop);
    const defense = [1, 1.1, 1.2][city.level - 1] ?? 1;
    this.el("city-defense").textContent = defense.toFixed(2);
    const cost = [15, 22, 32][city.level - 1] ?? 0;
    const button = this.el("city-upgrade") as HTMLButtonElement;
    button.textContent = city.level >= 3 ? "已满级" : `升级 · ${cost}`;
    button.disabled = city.level >= 3 || city.pop < cost;
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

  private on(id: string, type: string, handler: () => void): void {
    this.root.querySelector(`#${id}`)?.addEventListener(type, handler);
  }

  private el(id: string): HTMLElement {
    const element = this.root.querySelector<HTMLElement>(`#${id}`);
    if (!element) throw new Error(`missing element: ${id}`);
    return element;
  }
}
