import { blockedTransit, routeOptions } from "@marchlands/sim";
import type { CityId, MapDef, SimState, SquadState } from "@marchlands/sim";

interface CityProjection {
  projectCity(id: CityId): { x: number; y: number } | null;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface RouteOverlayOptions {
  canvas: HTMLCanvasElement;
  scene: CityProjection;
  map: MapDef;
}

// BattleScene.projectCity projects every site at this height.
const REF_Y = 4.8;
const GROUND_Y = 0.55;
const SQUAD_Y = 0.95;

class ScreenProjector {
  private coefficients: [number, number, number, number, number, number] | null = null;
  private vertical = 0;

  update(scene: CityProjection, map: MapDef, originX: number, originY: number): boolean {
    const ata = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const atu = [0, 0, 0];
    const atv = [0, 0, 0];
    let samples = 0;

    for (const city of map.cities) {
      const projected = scene.projectCity(city.id);
      if (!projected) continue;
      const x = city.pos[0] / 10;
      const z = city.pos[1] / 10;
      const u = projected.x - originX;
      const v = projected.y - originY;
      const row = [x, z, 1];
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) ata[i][j] += row[i] * row[j];
        atu[i] += row[i] * u;
        atv[i] += row[i] * v;
      }
      samples += 1;
    }
    if (samples < 3) {
      this.coefficients = null;
      return false;
    }

    const u = solve3(ata, atu);
    const v = solve3(ata, atv);
    if (!u || !v) {
      this.coefficients = null;
      return false;
    }
    this.coefficients = [u[0], u[1], u[2], v[0], v[1], v[2]];

    const m11 = u[0] * u[0] + u[1] * u[1];
    const m12 = u[0] * v[0] + u[1] * v[1];
    const m22 = v[0] * v[0] + v[1] * v[1];
    const trace = m11 + m22;
    const det = m11 * m22 - m12 * m12;
    const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
    const major = Math.max(0, (trace + disc) / 2);
    const minor = Math.max(0, (trace - disc) / 2);
    this.vertical = Math.sqrt(Math.max(0, major - minor));
    return true;
  }

  point(x: number, z: number, y: number): ScreenPoint | null {
    const coefficients = this.coefficients;
    if (!coefficients) return null;
    const [a, b, c, d, e, f] = coefficients;
    return {
      x: a * x + b * z + c,
      y: d * x + e * z + f + this.vertical * (REF_Y - y),
    };
  }
}

function determinant(matrix: number[][]): number {
  const [a, b, c] = matrix[0];
  const [d, e, f] = matrix[1];
  const [g, h, i] = matrix[2];
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function replaceColumn(matrix: number[][], column: number, values: number[]): number[][] {
  return matrix.map((row, index) => row.map((value, col) => (col === column ? values[index] : value)));
}

function solve3(matrix: number[][], values: number[]): number[] | null {
  const det = determinant(matrix);
  if (Math.abs(det) < 1e-8) return null;
  return [0, 1, 2].map((column) => determinant(replaceColumn(matrix, column, values)) / det);
}

function distanceToSegment(x: number, y: number, a: ScreenPoint, b: ScreenPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(x - a.x, y - a.y);
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSquared));
  return Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy));
}

function distanceToPolyline(x: number, y: number, points: ScreenPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length - 1; index += 1) {
    best = Math.min(best, distanceToSegment(x, y, points[index], points[index + 1]));
  }
  if (points.length === 1) best = Math.hypot(x - points[0].x, y - points[0].y);
  return best;
}

export class RouteOverlay {
  private readonly gameCanvas: HTMLCanvasElement;
  private readonly scene: CityProjection;
  private readonly map: MapDef;
  private readonly sites = new Map<CityId, { x: number; z: number }>();
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly panel: HTMLDivElement;
  private readonly style: HTMLStyleElement;
  private readonly projector = new ScreenProjector();
  private readonly panelRefs: Record<string, HTMLElement> = {};
  private width = 0;
  private height = 0;
  private pixelRatio = 0;
  private rect = { left: 0, top: 0 };
  private panelVisible = false;

  constructor(options: RouteOverlayOptions) {
    this.gameCanvas = options.canvas;
    this.scene = options.scene;
    this.map = options.map;
    for (const city of options.map.cities) {
      this.sites.set(city.id, { x: city.pos[0] / 10, z: city.pos[1] / 10 });
    }

    const style = document.createElement("style");
    style.textContent = `
      .ml-route-layer { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
      .ml-squad-card { position: absolute; left: 18px; bottom: 74px; width: 258px; padding: 11px 14px 12px; border: 1px solid rgba(232,215,180,.2); border-radius: 6px; background: linear-gradient(180deg, rgba(18,24,18,.92), rgba(11,15,12,.94)); color: #efe7d3; font: 12px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; letter-spacing: .02em; pointer-events: none; opacity: 0; visibility: hidden; transform: translateY(4px); transition: opacity .16s ease, transform .16s ease, visibility .16s; z-index: 3; box-shadow: 0 10px 32px rgba(0,0,0,.28); }
      .ml-squad-card.on { opacity: 1; visibility: visible; transform: translateY(0); }
      .ml-squad-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding-bottom: 6px; border-bottom: 1px solid rgba(232,215,180,.12); }
      .ml-squad-head b { font-size: 13px; letter-spacing: .08em; color: #f4e6bd; }
      .ml-squad-head span { font-size: 16px; font-weight: 700; color: #9fe3ad; }
      .ml-squad-row { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; color: #bfb7a3; }
      .ml-squad-row b { color: #efe7d3; font-weight: 600; }
      .ml-supply-track { height: 4px; margin-top: 9px; background: rgba(255,255,255,.09); overflow: hidden; border-radius: 2px; }
      .ml-supply-track i { display: block; height: 100%; width: 100%; background: #7ec98b; transition: width .2s linear, background .2s linear; }
      .ml-squad-hint { margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(232,215,180,.1); color: #8e8a7b; font-size: 11px; line-height: 1.5; }
      .ml-squad-warn { color: #e49a70 !important; }
    `;
    document.head.appendChild(style);
    this.style = style;

    const page = options.canvas.parentElement;
    if (!page) throw new Error("game canvas has no parent");

    this.canvas = document.createElement("canvas");
    this.canvas.className = "ml-route-layer";
    const context = this.canvas.getContext("2d");
    if (!context) throw new Error("missing 2d context");
    this.context = context;
    page.insertBefore(this.canvas, options.canvas.nextSibling);

    this.panel = document.createElement("div");
    this.panel.className = "ml-squad-card";
    this.panel.innerHTML = [
      '<div class="ml-squad-head"><b data-role="id">—</b><span data-role="count">0</span></div>',
      '<div class="ml-squad-row"><span>目的地</span><b data-role="dest">—</b></div>',
      '<div class="ml-squad-row"><span>预计抵达</span><b data-role="eta">—</b></div>',
      '<div class="ml-supply-track"><i data-role="supply-bar"></i></div>',
      '<div class="ml-squad-row"><span data-role="supply">—</span><b data-role="starve"></b></div>',
      '<div class="ml-squad-hint">点击暗色路线改道 · 点击据点改目的地<br>右键取消选择</div>',
    ].join("");
    page.appendChild(this.panel);
    for (const node of this.panel.querySelectorAll<HTMLElement>("[data-role]")) {
      if (node.dataset.role) this.panelRefs[node.dataset.role] = node;
    }

    this.resize();
  }

  render(state: SimState, selectedSquadId: string | null): void {
    this.resize();
    this.projector.update(this.scene, this.map, this.rect.left, this.rect.top);
    const context = this.context;
    context.clearRect(0, 0, this.width, this.height);

    const selected = selectedSquadId
      ? state.squads.find((squad) => squad.id === selectedSquadId)
      : undefined;

    if (selected) {
      this.drawOwnSquadDot(selected, state);
    } else {
      for (const squad of state.squads) {
        if (squad.owner !== 1) continue;
        const point = this.squadPoint(squad, state);
        if (!point) continue;
        context.beginPath();
        context.arc(point.x, point.y, 5, 0, Math.PI * 2);
        context.fillStyle = "rgba(137,220,158,.22)";
        context.fill();
      }
    }

    if (!selected) {
      this.setPanel(null, state);
      return;
    }

    this.drawRoutes(selected, state);
    this.drawOwnSquadDot(selected, state);
    this.setPanel(selected, state);
  }

  pickSquad(state: SimState, clientX: number, clientY: number): string | null {
    this.resize();
    this.projector.update(this.scene, this.map, this.rect.left, this.rect.top);
    const x = clientX - this.rect.left;
    const y = clientY - this.rect.top;
    let best: string | null = null;
    let bestDistance = 24;
    for (const squad of state.squads) {
      const point = this.squadPoint(squad, state);
      if (!point) continue;
      const distance = Math.hypot(x - point.x, y - point.y);
      if (distance < bestDistance) {
        best = squad.id;
        bestDistance = distance;
      }
    }
    return best;
  }

  pickBranch(state: SimState, squad: SquadState, clientX: number, clientY: number): CityId | null {
    this.resize();
    this.projector.update(this.scene, this.map, this.rect.left, this.rect.top);
    const x = clientX - this.rect.left;
    const y = clientY - this.rect.top;
    let best: CityId | null = null;
    let bestDistance = 14;
    for (const option of routeOptions(state.graph, squad, blockedTransit(state, squad.owner, squad.to))) {
      if (option.current) continue;
      const points = option.path
        .map((id) => this.sitePoint(id, GROUND_Y))
        .filter((point): point is ScreenPoint => point !== null);
      const distance = distanceToPolyline(x, y, points);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = option.via;
      }
    }
    return best;
  }

  dispose(): void {
    this.canvas.remove();
    this.panel.remove();
    this.style.remove();
  }

  private resize(): void {
    const parent = this.gameCanvas.parentElement;
    if (!parent) return;
    this.rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (width === this.width && height === this.height && pixelRatio === this.pixelRatio) return;
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(width * pixelRatio);
    this.canvas.height = Math.round(height * pixelRatio);
    this.context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    this.rect = this.canvas.getBoundingClientRect();
  }

  private sitePoint(id: CityId, y: number): ScreenPoint | null {
    const site = this.sites.get(id);
    if (!site) return null;
    return this.projector.point(site.x, site.z, y);
  }

  private squadPoint(squad: SquadState, state: SimState): ScreenPoint | null {
    const from = this.sites.get(squad.path[squad.pathIndex]);
    const to = this.sites.get(squad.path[squad.pathIndex + 1]);
    if (!from || !to) return null;
    const duration = squad.legEndTick - squad.legStartTick;
    const t = duration <= 0 ? 1 : Math.max(0, Math.min(1, (state.tick - squad.legStartTick) / duration));
    return this.projector.point(
      from.x + (to.x - from.x) * t,
      from.z + (to.z - from.z) * t,
      SQUAD_Y,
    );
  }

  private drawOwnSquadDot(squad: SquadState, state: SimState): void {
    const point = this.squadPoint(squad, state);
    if (!point) return;
    const context = this.context;
    context.beginPath();
    context.arc(point.x, point.y, 14, 0, Math.PI * 2);
    context.strokeStyle = "rgba(232,200,131,.85)";
    context.lineWidth = 1.5;
    context.stroke();
    context.beginPath();
    context.arc(point.x, point.y, 3.2, 0, Math.PI * 2);
    context.fillStyle = "#f0d28d";
    context.fill();
  }

  private drawRoutes(squad: SquadState, state: SimState): void {
    const context = this.context;
    const start = this.squadPoint(squad, state);
    const currentPoints: ScreenPoint[] = start ? [start] : [];
    for (let index = squad.pathIndex + 1; index < squad.path.length; index += 1) {
      const point = this.sitePoint(squad.path[index], GROUND_Y);
      if (point) currentPoints.push(point);
    }
    if (currentPoints.length >= 2) {
      this.stroke(currentPoints, "rgba(8,12,9,.72)", 7, []);
      this.stroke(currentPoints, "rgba(133,226,157,.95)", 3.2, []);
      const end = currentPoints[currentPoints.length - 1];
      this.diamond(end, "rgba(133,226,157,.95)");
    }

    for (const option of routeOptions(state.graph, squad, blockedTransit(state, squad.owner, squad.to))) {
      if (option.current) continue;
      const points = option.path
        .map((id) => this.sitePoint(id, GROUND_Y))
        .filter((point): point is ScreenPoint => point !== null);
      if (points.length < 2) continue;
      this.stroke(points, "rgba(8,12,9,.5)", 5, []);
      context.setLineDash([6, 7]);
      this.stroke(points, "rgba(226,208,165,.36)", 2, []);
      context.setLineDash([]);
      const anchor = points[0];
      context.beginPath();
      context.arc(anchor.x, anchor.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = "rgba(226,208,165,.55)";
      context.fill();
    }
  }

  private stroke(points: ScreenPoint[], color: string, width: number, dash: number[]): void {
    const context = this.context;
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(points[index].x, points[index].y);
    }
    context.setLineDash(dash);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
    context.setLineDash([]);
  }

  private diamond(point: ScreenPoint, color: string): void {
    const context = this.context;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(Math.PI / 4);
    context.fillStyle = color;
    context.fillRect(-4, -4, 8, 8);
    context.restore();
  }

  private setPanel(squad: SquadState | null, state: SimState): void {
    if (!squad) {
      if (this.panelVisible) {
        this.panel.classList.remove("on");
        this.panelVisible = false;
      }
      return;
    }
    if (!this.panelVisible) {
      this.panel.classList.add("on");
      this.panelVisible = true;
    }
    const id = this.panelRefs.id;
    const count = this.panelRefs.count;
    const dest = this.panelRefs.dest;
    const eta = this.panelRefs.eta;
    const supply = this.panelRefs.supply;
    const starve = this.panelRefs.starve;
    const bar = this.panelRefs["supply-bar"];
    if (id) id.textContent = squad.id;
    if (count) count.textContent = `${squad.count} 兵`;
    if (dest) dest.textContent = squad.to;
    if (eta) eta.textContent = `${Math.max(0, Math.ceil((squad.arrivalTick - state.tick) / 20))}s`;

    const carry = Math.max(1, state.rules.supply.carryTicks);
    const supplySeconds = Math.ceil(squad.supplyLeft / 20);
    const ratio = Math.max(0, Math.min(1, squad.supplyLeft / carry));
    if (bar) {
      bar.style.width = `${Math.round(ratio * 100)}%`;
      bar.style.background = ratio > 0.45 ? "#7ec98b" : ratio > 0.2 ? "#d9b56f" : "#d97a5f";
    }
    if (supply) {
      supply.textContent = squad.supplyLeft > 0 ? `粮草 ${supplySeconds}s` : "断粮";
      supply.classList.toggle("ml-squad-warn", squad.supplyLeft <= 0);
    }
    if (starve) {
      if (squad.supplyLeft > 0) {
        starve.textContent = "";
        starve.classList.remove("ml-squad-warn");
      } else {
        const interval = Math.round(state.rules.supply.starveIntervalTicks / 20);
        starve.textContent = `每 ${interval}s -${state.rules.supply.starveLoss}`;
        starve.classList.add("ml-squad-warn");
      }
    }
  }
}
