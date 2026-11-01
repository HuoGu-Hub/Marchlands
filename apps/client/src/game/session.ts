import { createAi, createGame, step } from "@marchlands/sim";
import type {
  AiController,
  CityId,
  CityState,
  Command,
  MapDef,
  Ruleset,
  SimState,
} from "@marchlands/sim";
import { audio } from "../audio";
import { BattleScene } from "./scene";

const FIXED_STEP = 50;
const REASONS: Record<string, string> = {
  unknown_city: "城镇不存在",
  unknown_target: "目标不存在",
  same_city: "不能派往本城",
  not_owned: "不是你的城镇",
  too_few_troops: "守军不足两人",
  no_route: "没有可行路线",
  max_level: "已达最高等级",
  insufficient_pop: "人口不足",
  not_upgradable: "该据点不能升级",
  not_outpost: "只有临时驻兵点可以切换状态",
  invalid_stance: "无效的驻守状态",
  game_finished: "对局已结束",
};

export interface GameSessionOptions {
  canvas: HTMLCanvasElement;
  hud: HTMLElement;
  map: MapDef;
  rules: Ruleset;
  onFinish: (state: SimState) => void;
  onToast: (text: string) => void;
  onSelect: (cityId: CityId | null) => void;
}

export class GameSession {
  private readonly options: GameSessionOptions;
  private readonly timeScale: number;
  private readonly ai: AiController;
  private scene: BattleScene;
  private state: SimState;
  private selected: CityId | null = null;
  private commands: Command[] = [];
  private accumulator = 0;
  private lastTime = 0;
  private raf = 0;
  private paused = false;
  private finished = false;
  private disposed = false;

  constructor(options: GameSessionOptions) {
    this.options = options;
    const requested = Number(new URLSearchParams(window.location.search).get("speed") ?? "1");
    this.timeScale = import.meta.env.DEV ? Math.max(1, Math.min(20, Number.isFinite(requested) ? requested : 1)) : 1;
    this.ai = createAi(2);
    this.state = createGame(options.map, Math.floor(Math.random() * 1_000_000_000), options.rules);
    this.scene = new BattleScene(options.canvas, options.map);
    this.bindInput();
    this.select("c1");
    this.updateHud();
  }

  start(): void {
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

  restart(): void {
    this.scene.dispose();
    this.state = createGame(this.options.map, Math.floor(Math.random() * 1_000_000_000), this.options.rules);
    this.scene = new BattleScene(this.options.canvas, this.options.map);
    this.selected = null;
    this.commands = [];
    this.accumulator = 0;
    this.lastTime = performance.now();
    this.paused = false;
    this.finished = false;
    this.select("c1");
    this.updateHud();
  }

  getCity(id: CityId): CityState | undefined {
    return this.state.cities.find((city) => city.id === id);
  }

  select(id: CityId): void {
    const city = this.getCity(id);
    if (!city || city.owner !== 1) return;
    this.selected = id;
    this.scene.setSelected(id);
    this.options.onSelect(id);
    if (city.kind === "outpost") {
      this.options.onToast("R 切换迎战 / 避战");
    } else if (city.kind === "granary") {
      const speed = Math.round(this.state.rules.granary.speedBonusMilli / 10);
      const strength = Math.round(this.state.rules.granary.strengthBonusMilli / 10);
      this.options.onToast(`粮仓：行军速度 +${speed}% · 战斗力 +${strength}%`);
    }
  }

  clearSelection(): void {
    this.selected = null;
    this.scene.setSelected(null);
    this.options.onSelect(null);
  }

  upgradeSelected(): void {
    if (!this.selected) {
      this.options.onToast("先选择己方城镇");
      return;
    }
    const city = this.getCity(this.selected);
    if (city?.kind !== "town") {
      this.options.onToast("该据点不能升级");
      return;
    }
    this.commands.push({ type: "upgrade", city: this.selected });
  }

  toggleStance(): void {
    if (!this.selected) {
      this.options.onToast("先选择己方临时驻兵点");
      return;
    }
    const city = this.getCity(this.selected);
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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("keydown", this.onKeyDown);
    this.options.canvas.removeEventListener("click", this.onClick);
    this.options.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.options.canvas.removeEventListener("wheel", this.onWheel);
    this.scene.dispose();
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(250, Math.max(0, now - this.lastTime));
    this.lastTime = now;

    if (!this.paused) {
      this.accumulator += delta * this.timeScale;
      let steps = 0;
      while (this.accumulator >= FIXED_STEP && steps < 8) {
        this.tick();
        this.accumulator -= FIXED_STEP;
        steps += 1;
      }
      if (steps === 8) this.accumulator = 0;
    }

    this.scene.update(this.state, delta);
    this.raf = requestAnimationFrame(this.frame);
  };

  private tick(): void {
    if (this.state.status !== "playing") return;
    const commands: Command[] = [];
    if (this.state.tick % 40 === 0) commands.push(...this.ai.decide(this.state));
    commands.push(...this.commands);
    this.commands = [];

    const result = step(this.state, commands);
    this.state = result.state;
    if (result.rejected.length > 0) {
      this.options.onToast(REASONS[result.rejected[0].reason] ?? "指令无效");
    }
    this.handleEvents();
    this.updateHud();
    if (this.selected) this.options.onSelect(this.selected);

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
      }
    }
  }

  private updateHud(): void {
    const cities = this.state.cities.filter((city) => city.owner === 1 && city.kind === "town");
    const pop = this.state.cities
      .filter((city) => city.owner === 1)
      .reduce((sum, city) => sum + city.pop, 0);
    const gold = this.state.players.find((player) => player.id === 1)?.gold ?? 0;
    this.setText("hud-cities", String(cities.length));
    this.setText("hud-pop", String(pop));
    this.setText("hud-gold", String(gold));
    this.setText("hud-timer", this.formatTime(this.state.tick));
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
    this.options.canvas.addEventListener("click", this.onClick);
    this.options.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.options.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("keydown", this.onKeyDown);
  }

  private readonly onClick = (event: MouseEvent): void => {
    if (this.paused || this.finished) return;
    const cityId = this.scene.pickCity(event.clientX, event.clientY, this.state);
    if (!cityId) {
      this.clearSelection();
      return;
    }
    const city = this.getCity(cityId);
    if (!city) return;

    if (!this.selected) {
      if (city.owner === 1) this.select(cityId);
      else this.options.onToast("先选择己方城镇");
      return;
    }
    if (cityId === this.selected) return;
    if (city.owner === 1) {
      this.select(cityId);
      return;
    }
    this.commands.push({ type: "send", from: this.selected, to: cityId });
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    this.clearSelection();
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.scene.zoomBy(event.deltaY > 0 ? -0.06 : 0.06);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.scene.rotate(1);
    if (event.key === "e" || event.key === "E") this.scene.rotate(-1);
    if ((event.key === "r" || event.key === "R") && !this.paused && !this.finished) {
      this.toggleStance();
    }
  };
}
