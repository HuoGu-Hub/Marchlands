import { PRODUCTION_SITE_KINDS, UNIT_PROFILES } from "@marchlands/sim";
import type { Ruleset, UnitKind } from "@marchlands/sim";
import type { GameSession } from "./session";

const STYLE_ID = "ml-dev-tuner-style";

const UNIT_LABELS: Record<UnitKind, string> = {
  barbarian: "野蛮人",
  warrior: "精锐战士",
  ranger: "游侠",
  archer: "弓箭手",
  mage: "法师",
  cavalry: "骑兵",
};

type MutableUnitProfile = {
  attackRangeCm: number;
  maxSlopePermille: number;
};

const UNIT_DEFAULTS: Record<UnitKind, MutableUnitProfile> = Object.fromEntries(
  PRODUCTION_SITE_KINDS.map((kind) => {
    const profile = UNIT_PROFILES[kind] as unknown as MutableUnitProfile;
    return [kind, { attackRangeCm: profile.attackRangeCm, maxSlopePermille: profile.maxSlopePermille }];
  }),
) as Record<UnitKind, MutableUnitProfile>;

interface NumberFieldOptions {
  key: string;
  get: () => number;
  set: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
}

interface Field {
  input: HTMLInputElement;
  get: () => number;
  min: number;
  max: number;
  digits: number;
}

const STYLE = [
  ".ml-dev-toggle {",
  "  position: fixed;",
  "  top: 72px;",
  "  right: 12px;",
  "  z-index: 130;",
  "  min-height: 28px;",
  "  padding: 0 10px;",
  "  border: 1px solid rgba(214, 178, 106, 0.38);",
  "  background: rgba(12, 17, 13, 0.92);",
  "  color: #d6b26a;",
  "  font: 11px/1.2 \"Microsoft YaHei\", \"Segoe UI\", sans-serif;",
  "  letter-spacing: 0.12em;",
  "  cursor: pointer;",
  "}",
  ".ml-dev-toggle:hover, .ml-dev-toggle.on {",
  "  border-color: rgba(214, 178, 106, 0.8);",
  "  color: #f2e6c8;",
  "}",
  ".ml-dev-panel {",
  "  position: fixed;",
  "  top: 106px;",
  "  right: 12px;",
  "  z-index: 129;",
  "  width: min(370px, calc(100vw - 24px));",
  "  max-height: calc(100vh - 170px);",
  "  overflow: auto;",
  "  padding: 12px 14px 14px;",
  "  border: 1px solid rgba(214, 178, 106, 0.32);",
  "  background: linear-gradient(180deg, rgba(18, 25, 19, 0.97), rgba(9, 13, 10, 0.98));",
  "  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.42);",
  "  color: #ece6d6;",
  "  font: 12px/1.45 \"Microsoft YaHei\", \"Segoe UI\", sans-serif;",
  "}",
  ".ml-dev-head {",
  "  display: flex;",
  "  align-items: baseline;",
  "  gap: 8px;",
  "  margin-bottom: 4px;",
  "}",
  ".ml-dev-head b {",
  "  font: 600 15px/1.2 Georgia, \"Songti SC\", serif;",
  "  letter-spacing: 0.08em;",
  "  color: #f2e6c8;",
  "}",
  ".ml-dev-badge {",
  "  color: #d6b26a;",
  "  font-size: 10px;",
  "  letter-spacing: 0.18em;",
  "}",
  ".ml-dev-close {",
  "  margin-left: auto;",
  "  border: 0;",
  "  background: none;",
  "  color: rgba(236, 230, 214, 0.6);",
  "  font-size: 18px;",
  "  line-height: 1;",
  "  cursor: pointer;",
  "}",
  ".ml-dev-close:hover { color: #f2e6c8; }",
  ".ml-dev-intro, .ml-dev-status {",
  "  margin: 0 0 8px;",
  "  color: rgba(236, 230, 214, 0.5);",
  "  font-size: 11px;",
  "}",
  ".ml-dev-status {",
  "  min-height: 14px;",
  "  margin: 8px 0 0;",
  "  color: rgba(214, 178, 106, 0.8);",
  "  font-size: 10px;",
  "}",
  ".ml-dev-panel details {",
  "  border-top: 1px solid rgba(214, 178, 106, 0.16);",
  "  padding: 6px 0 2px;",
  "}",
  ".ml-dev-panel summary {",
  "  padding: 4px 0;",
  "  color: #d6b26a;",
  "  font-size: 11px;",
  "  letter-spacing: 0.12em;",
  "  cursor: pointer;",
  "  list-style: none;",
  "}",
  ".ml-dev-panel summary::-webkit-details-marker { display: none; }",
  ".ml-dev-panel summary::before {",
  "  content: \"▸\";",
  "  display: inline-block;",
  "  width: 12px;",
  "  color: rgba(214, 178, 106, 0.7);",
  "}",
  ".ml-dev-panel details[open] summary::before { content: \"▾\"; }",
  ".ml-dev-row {",
  "  display: grid;",
  "  grid-template-columns: minmax(0, 1fr) 82px 42px;",
  "  align-items: center;",
  "  gap: 6px;",
  "  min-height: 27px;",
  "  padding: 0 2px;",
  "}",
  ".ml-dev-row:hover { background: rgba(255, 255, 255, 0.035); }",
  ".ml-dev-row > span:first-child {",
  "  color: rgba(236, 230, 214, 0.8);",
  "  font-size: 11px;",
  "  white-space: nowrap;",
  "  overflow: hidden;",
  "  text-overflow: ellipsis;",
  "}",
  ".ml-dev-row input {",
  "  width: 100%;",
  "  min-width: 0;",
  "  height: 23px;",
  "  padding: 0 5px;",
  "  border: 1px solid rgba(214, 178, 106, 0.22);",
  "  background: rgba(255, 255, 255, 0.04);",
  "  color: #f2ead7;",
  "  font: 11px/1 ui-monospace, \"Cascadia Mono\", Consolas, monospace;",
  "  font-variant-numeric: tabular-nums;",
  "  text-align: right;",
  "}",
  ".ml-dev-row input:focus {",
  "  outline: none;",
  "  border-color: rgba(214, 178, 106, 0.72);",
  "  background: rgba(214, 178, 106, 0.08);",
  "}",
  ".ml-dev-unit {",
  "  color: rgba(236, 230, 214, 0.42);",
  "  font-size: 10px;",
  "  white-space: nowrap;",
  "}",
  ".ml-dev-note {",
  "  margin: 4px 0 2px;",
  "  color: rgba(236, 230, 214, 0.42);",
  "  font-size: 10px;",
  "  line-height: 1.5;",
  "}",
  ".ml-dev-actions {",
  "  display: flex;",
  "  gap: 8px;",
  "  margin-top: 10px;",
  "  padding-top: 10px;",
  "  border-top: 1px solid rgba(214, 178, 106, 0.2);",
  "}",
  ".ml-dev-actions button {",
  "  min-height: 26px;",
  "  padding: 0 10px;",
  "  border: 1px solid rgba(214, 178, 106, 0.26);",
  "  background: rgba(255, 255, 255, 0.03);",
  "  color: rgba(236, 230, 214, 0.8);",
  "  font: 11px/1 \"Microsoft YaHei\", sans-serif;",
  "  letter-spacing: 0.08em;",
  "  cursor: pointer;",
  "}",
  ".ml-dev-actions button:hover {",
  "  border-color: rgba(214, 178, 106, 0.7);",
  "  color: #f2e6c8;",
  "}",
].join("\n");

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class DevTuner {
  private readonly session: GameSession;
  private readonly toggle: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly body: HTMLElement;
  private readonly status: HTMLElement;
  private readonly fields: Field[] = [];
  private readonly defaults: { rules: Ruleset };
  private scheduled = false;
  private open = false;

  constructor(session: GameSession) {
    this.session = session;
    this.defaults = {
      rules: JSON.parse(JSON.stringify(session.getRules())) as Ruleset,
    };

    this.ensureStyle();
    this.toggle = document.createElement("button");
    this.toggle.type = "button";
    this.toggle.id = "ml-dev-toggle";
    this.toggle.className = "ml-dev-toggle";
    this.toggle.title = "打开数值调参（F2）";
    this.toggle.textContent = "DEV 调参";

    this.panel = document.createElement("section");
    this.panel.id = "ml-dev-panel";
    this.panel.className = "ml-dev-panel";
    this.panel.setAttribute("aria-label", "开发数值调参");
    this.panel.hidden = true;

    const head = document.createElement("div");
    head.className = "ml-dev-head";
    const title = document.createElement("b");
    title.textContent = "数值调参";
    const badge = document.createElement("span");
    badge.className = "ml-dev-badge";
    badge.textContent = "DEV ONLY";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ml-dev-close";
    close.setAttribute("aria-label", "关闭调参面板");
    close.textContent = "×";
    close.addEventListener("click", () => this.setOpen(false));
    head.append(title, badge, close);

    const intro = document.createElement("p");
    intro.className = "ml-dev-intro";
    intro.textContent = "改动立即写入当前对局；导出后替换 packages/sim/src/balance.json。";

    this.body = document.createElement("div");
    this.status = document.createElement("p");
    this.status.className = "ml-dev-status";
    this.panel.append(head, intro, this.body, this.status);

    const actions = document.createElement("div");
    actions.className = "ml-dev-actions";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "导出 balance.json";
    exportButton.addEventListener("click", () => this.exportBalance());
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "重置为开局值";
    reset.addEventListener("click", () => this.reset());
    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.textContent = "关闭";
    collapse.addEventListener("click", () => this.setOpen(false));
    actions.append(exportButton, reset, collapse);
    this.panel.append(actions);

    this.build();

    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    this.panel.addEventListener("keydown", (event) => event.stopPropagation());
    this.panel.addEventListener("keyup", (event) => event.stopPropagation());
    this.panel.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.panel.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });
    window.addEventListener("keydown", this.onKeyDown);
    document.body.append(this.toggle, this.panel);
  }

  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.toggle.remove();
    this.panel.remove();
    this.fields.length = 0;
    document.getElementById(STYLE_ID)?.remove();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "F2") return;
    event.preventDefault();
    this.setOpen(!this.open);
  };

  private setOpen(open: boolean): void {
    this.open = open;
    this.panel.hidden = !open;
    this.toggle.classList.toggle("on", open);
    this.toggle.textContent = open ? "收起调参" : "DEV 调参";
  }

  private ensureStyle(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.append(style);
  }

  private build(): void {
    const rules = this.session.getRules();
    const tickHz = rules.tickHz;

    const globalRows: HTMLElement[] = [];
    globalRows.push(
      this.numberField("派兵比例", {
        key: "sendRatio",
        get: () => rules.sendRatio * 100,
        set: (value) => { rules.sendRatio = value / 100; },
        min: 10,
        max: 100,
        step: 5,
        unit: "%",
      }),
    );
    globalRows.push(
      this.numberField("行军速度", {
        key: "speed",
        get: () => rules.speedDmPerSecond / 10,
        set: (value) => { rules.speedDmPerSecond = value * 10; },
        min: 1,
        max: 12,
        step: 0.1,
        unit: "米/秒",
        digits: 1,
      }),
    );
    globalRows.push(
      this.numberField("对局时长", {
        key: "maxTicks",
        get: () => rules.maxTicks / tickHz / 60,
        set: (value) => { rules.maxTicks = Math.round(value * 60 * tickHz); },
        min: 1,
        max: 60,
        step: 1,
        unit: "分钟",
      }),
    );
    globalRows.push(
      this.numberField("粮草携带", {
        key: "supply.carry",
        get: () => rules.supply.carryTicks / tickHz,
        set: (value) => { rules.supply.carryTicks = Math.round(value * tickHz); },
        min: 5,
        max: 300,
        step: 5,
        unit: "秒",
      }),
    );
    globalRows.push(
      this.numberField("断粮间隔", {
        key: "supply.interval",
        get: () => rules.supply.starveIntervalTicks / tickHz,
        set: (value) => { rules.supply.starveIntervalTicks = Math.round(value * tickHz); },
        min: 1,
        max: 120,
        step: 1,
        unit: "秒",
      }),
    );
    globalRows.push(
      this.numberField("断粮损失", {
        key: "supply.loss",
        get: () => rules.supply.starveLoss,
        set: (value) => { rules.supply.starveLoss = Math.round(value); },
        min: 1,
        max: 20,
        step: 1,
        unit: "人",
      }),
    );
    this.addSection("全局", globalRows, true);

    const unitRows: HTMLElement[] = [];
    for (const kind of PRODUCTION_SITE_KINDS) {
      const profile = UNIT_PROFILES[kind] as unknown as MutableUnitProfile;
      const label = UNIT_LABELS[kind];
      unitRows.push(
        this.numberField(label + " 攻击距离", {
          key: "unit." + kind + ".range",
          get: () => profile.attackRangeCm / 100,
          set: (value) => { profile.attackRangeCm = value * 100; },
          min: 0.5,
          max: 12,
          step: 0.1,
          unit: "米",
          digits: 1,
        }),
      );
      unitRows.push(
        this.numberField(label + " 最大坡度", {
          key: "unit." + kind + ".slope",
          get: () => profile.maxSlopePermille,
          set: (value) => { profile.maxSlopePermille = Math.round(value); },
          min: 100,
          max: 1000,
          step: 10,
          unit: "‰",
        }),
      );
    }
    this.addSection("兵团", unitRows, true, "坡度改动对已生成的寻路缓存不生效，重开对局后完全生效。");

    const levelRows: HTMLElement[] = [];
    for (let index = 0; index < rules.levels.length; index += 1) {
      const prefix = "L" + (index + 1);
      levelRows.push(
        this.numberField(prefix + " 人口上限", {
          key: "level." + index + ".maxPop",
          get: () => rules.levels[index].maxPop,
          set: (value) => { rules.levels[index].maxPop = Math.round(value); },
          min: 5,
          max: 200,
          step: 5,
          unit: "人",
        }),
      );
      levelRows.push(
        this.numberField(prefix + " 升级消耗", {
          key: "level." + index + ".cost",
          get: () => rules.levels[index].upgradeCost,
          set: (value) => { rules.levels[index].upgradeCost = Math.round(value); },
          min: 1,
          max: 100,
          step: 1,
          unit: "人",
        }),
      );
      levelRows.push(
        this.numberField(prefix + " 防御系数", {
          key: "level." + index + ".defense",
          get: () => rules.levels[index].defense,
          set: (value) => { rules.levels[index].defense = value; },
          min: 0.5,
          max: 3,
          step: 0.05,
          unit: "×",
          digits: 2,
        }),
      );
      levelRows.push(
        this.numberField(prefix + " 金币/秒", {
          key: "level." + index + ".gold",
          get: () => (rules.levels[index].goldMilli * tickHz) / 1000,
          set: (value) => { rules.levels[index].goldMilli = Math.round((value * 1000) / tickHz); },
          min: 0,
          max: 20,
          step: 0.5,
          unit: "金",
          digits: 1,
        }),
      );
    }
    this.addSection("建筑等级", levelRows, false);

    const granaryRows: HTMLElement[] = [];
    granaryRows.push(
      this.numberField("容量", {
        key: "granary.capacity",
        get: () => rules.granary.capacity,
        set: (value) => { rules.granary.capacity = Math.round(value); },
        min: 1,
        max: 300,
        step: 5,
        unit: "人",
      }),
    );
    granaryRows.push(
      this.numberField("防御系数", {
        key: "granary.defense",
        get: () => rules.granary.defenseMilli / 1000,
        set: (value) => { rules.granary.defenseMilli = Math.round(value * 1000); },
        min: 0.5,
        max: 3,
        step: 0.05,
        unit: "×",
        digits: 2,
      }),
    );
    granaryRows.push(
      this.numberField("行军速度加成", {
        key: "granary.speed",
        get: () => rules.granary.speedBonusMilli / 10,
        set: (value) => { rules.granary.speedBonusMilli = Math.round(value * 10); },
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
      }),
    );
    granaryRows.push(
      this.numberField("战斗力加成", {
        key: "granary.strength",
        get: () => rules.granary.strengthBonusMilli / 10,
        set: (value) => { rules.granary.strengthBonusMilli = Math.round(value * 10); },
        min: 0,
        max: 100,
        step: 5,
        unit: "%",
      }),
    );
    this.addSection("粮仓", granaryRows, false);

    const outpostRows: HTMLElement[] = [];
    outpostRows.push(
      this.numberField("容量", {
        key: "outpost.capacity",
        get: () => rules.outpost.capacity,
        set: (value) => { rules.outpost.capacity = Math.round(value); },
        min: 1,
        max: 300,
        step: 5,
        unit: "人",
      }),
    );
    outpostRows.push(
      this.numberField("防御系数", {
        key: "outpost.defense",
        get: () => rules.outpost.defenseMilli / 1000,
        set: (value) => { rules.outpost.defenseMilli = Math.round(value * 1000); },
        min: 0.5,
        max: 3,
        step: 0.05,
        unit: "×",
        digits: 2,
      }),
    );
    outpostRows.push(
      this.numberField("保护时间", {
        key: "outpost.grace",
        get: () => rules.outpost.graceTicks / tickHz,
        set: (value) => { rules.outpost.graceTicks = Math.round(value * tickHz); },
        min: 0,
        max: 120,
        step: 5,
        unit: "秒",
      }),
    );
    outpostRows.push(
      this.numberField("衰减间隔", {
        key: "outpost.decayInterval",
        get: () => rules.outpost.decayIntervalTicks / tickHz,
        set: (value) => { rules.outpost.decayIntervalTicks = Math.round(value * tickHz); },
        min: 1,
        max: 60,
        step: 1,
        unit: "秒",
      }),
    );
    outpostRows.push(
      this.numberField("每次衰减", {
        key: "outpost.decay",
        get: () => rules.outpost.decayPerInterval,
        set: (value) => { rules.outpost.decayPerInterval = Math.round(value); },
        min: 1,
        max: 20,
        step: 1,
        unit: "人",
      }),
    );
    this.addSection("驻兵点", outpostRows, false);

    const mageRows: HTMLElement[] = [];
    mageRows.push(
      this.numberField("射程", {
        key: "mage.range",
        get: () => rules.mageTower.rangeCm / 100,
        set: (value) => { rules.mageTower.rangeCm = value * 100; },
        min: 1,
        max: 15,
        step: 0.5,
        unit: "米",
        digits: 1,
      }),
    );
    mageRows.push(
      this.numberField("攻击间隔", {
        key: "mage.interval",
        get: () => rules.mageTower.intervalTicks / tickHz,
        set: (value) => { rules.mageTower.intervalTicks = Math.round(value * tickHz); },
        min: 0.5,
        max: 15,
        step: 0.5,
        unit: "秒",
        digits: 1,
      }),
    );
    mageRows.push(
      this.numberField("单发伤害", {
        key: "mage.damage",
        get: () => rules.mageTower.damage,
        set: (value) => { rules.mageTower.damage = Math.round(value); },
        min: 1,
        max: 50,
        step: 1,
        unit: "人",
      }),
    );
    this.addSection("法师塔", mageRows, false);

    const arrowRows: HTMLElement[] = [];
    arrowRows.push(
      this.numberField("射程", {
        key: "arrow.range",
        get: () => rules.arrowTower.rangeCm / 100,
        set: (value) => { rules.arrowTower.rangeCm = value * 100; },
        min: 1,
        max: 15,
        step: 0.5,
        unit: "米",
        digits: 1,
      }),
    );
    arrowRows.push(
      this.numberField("攻击间隔", {
        key: "arrow.interval",
        get: () => rules.arrowTower.intervalTicks / tickHz,
        set: (value) => { rules.arrowTower.intervalTicks = Math.round(value * tickHz); },
        min: 0.1,
        max: 5,
        step: 0.1,
        unit: "秒",
        digits: 1,
      }),
    );
    arrowRows.push(
      this.numberField("单发伤害", {
        key: "arrow.damage",
        get: () => rules.arrowTower.damage,
        set: (value) => { rules.arrowTower.damage = Math.round(value); },
        min: 1,
        max: 20,
        step: 1,
        unit: "人",
      }),
    );
    this.addSection("箭塔", arrowRows, false, "箭塔至少要有 1 名驻军才会射箭。");
  }

  private addSection(title: string, rows: HTMLElement[], open: boolean, note?: string): void {
    const details = document.createElement("details");
    details.open = open;
    const summary = document.createElement("summary");
    summary.textContent = title;
    details.append(summary, ...rows);
    if (note) {
      const text = document.createElement("p");
      text.className = "ml-dev-note";
      text.textContent = note;
      details.append(text);
    }
    this.body.append(details);
  }

  private numberField(
    label: string,
    options: NumberFieldOptions,
  ): HTMLElement {
    const row = document.createElement("label");
    row.className = "ml-dev-row";
    const name = document.createElement("span");
    name.textContent = label;
    const input = document.createElement("input");
    input.type = "number";
    input.min = String(options.min);
    input.max = String(options.max);
    input.step = String(options.step);
    input.dataset.devField = options.key;
    input.setAttribute("aria-label", label);
    const digits = options.digits ?? this.digitsFor(options.step);
    input.value = this.format(options.get(), digits);
    const unit = document.createElement("span");
    unit.className = "ml-dev-unit";
    unit.textContent = options.unit ?? "";
    row.append(name, input, unit);

    const read = (): number => {
      const raw = input.value.trim();
      const parsed = raw === "" ? options.min : Number(raw);
      return clamp(Number.isFinite(parsed) ? parsed : options.min, options.min, options.max);
    };
    input.addEventListener("input", () => {
      if (input.value.trim() === "") return;
      options.set(read());
      this.scheduleApply();
    });
    input.addEventListener("change", () => {
      const value = read();
      options.set(value);
      input.value = this.format(value, digits);
      this.scheduleApply();
    });
    input.addEventListener("keydown", (event) => event.stopPropagation());
    this.fields.push({ input, get: options.get, min: options.min, max: options.max, digits });
    return row;
  }

  private digitsFor(step: number): number {
    if (step >= 1) return 0;
    if (step >= 0.1) return 1;
    return 2;
  }

  private format(value: number, digits: number): string {
    return String(Number(value.toFixed(digits)));
  }

  private scheduleApply(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.session.applyTuning();
    });
  }

  private syncFields(): void {
    for (const field of this.fields) {
      field.input.value = this.format(clamp(field.get(), field.min, field.max), field.digits);
    }
  }

  private exportBalance(): void {
    const rules = JSON.parse(JSON.stringify(this.session.getBalanceRules())) as Ruleset;
    const units = Object.fromEntries(
      PRODUCTION_SITE_KINDS.map((kind) => {
        const profile = UNIT_PROFILES[kind] as unknown as MutableUnitProfile;
        return [kind, { attackRangeCm: profile.attackRangeCm, maxSlopePermille: profile.maxSlopePermille }];
      }),
    ) as Record<UnitKind, MutableUnitProfile>;
    const text = JSON.stringify({ rules, units }, null, 2) + "\n";
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "balance.json";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status.textContent = "已导出 balance.json；行军速度已还原为基础值。";
  }

  private reset(): void {
    const rules = this.session.getRules();
    Object.assign(rules, JSON.parse(JSON.stringify(this.defaults.rules)) as Ruleset);
    for (const kind of PRODUCTION_SITE_KINDS) {
      const profile = UNIT_PROFILES[kind] as unknown as MutableUnitProfile;
      const def = UNIT_DEFAULTS[kind];
      profile.attackRangeCm = def.attackRangeCm;
      profile.maxSlopePermille = def.maxSlopePermille;
    }
    this.syncFields();
    this.session.applyTuning();
  }
}
