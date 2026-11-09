import { buildClearanceMask } from "./clearance";
import { sampleHeightCm } from "./height";
import { clampInt, divRound } from "./math";
import {
  DEFAULT_NAV_RULES,
  surfaceProfile,
  type NavRules,
  type SurfaceProfile,
} from "./surface";

export interface NavGridData {
  readonly cellSizeCm: number;
  readonly width: number;
  readonly height: number;
  readonly heightCm: ArrayLike<number>;
  readonly surface: ArrayLike<number>;
  readonly blocked?: ArrayLike<number>;
  readonly walkableOverride?: ArrayLike<number>;
  readonly rules?: Partial<NavRules>;
}

export interface NavPoint {
  readonly xCm: number;
  readonly zCm: number;
  readonly heightCm: number;
}

const DIAGONAL_RATIO = 1414;
const INT16_MIN = -32768;
const INT16_MAX = 32767;
const CLEARANCE_CACHE_LIMIT = 8;

function maskFrom(source: ArrayLike<number> | undefined, count: number): Uint8Array {
  const mask = new Uint8Array(count);
  if (!source) return mask;
  for (let index = 0; index < count; index += 1) mask[index] = source[index] ? 1 : 0;
  return mask;
}

interface CostFloor {
  readonly straight: number;
  readonly diagonal: number;
}

export class NavGrid {
  readonly width: number;
  readonly height: number;
  readonly cellSizeCm: number;
  readonly rules: NavRules;
  readonly minStraightCost: number;
  readonly minDiagonalCost: number;

  private readonly heights: Int16Array;
  /**
   * 每格最陡的一步，千分比。只用于展示与判断"这块地陡不陡"；
   * 能不能走过去只看相邻两格之间的真实坡度，见 canStep。
   */
  private readonly slopes: Float32Array;
  private readonly surfaces: Uint8Array;
  private readonly blockedMask: Uint8Array;
  private readonly overrideMask: Uint8Array;
  private readonly diagonalRunCm: number;
  private readonly clearanceCache = new Map<number, Uint8Array>();

  constructor(data: NavGridData) {
    if (!Number.isInteger(data.width) || data.width <= 0) throw new Error("nav grid width must be a positive integer");
    if (!Number.isInteger(data.height) || data.height <= 0) throw new Error("nav grid height must be a positive integer");
    if (!Number.isInteger(data.cellSizeCm) || data.cellSizeCm <= 0) {
      throw new Error("nav grid cellSizeCm must be a positive integer");
    }

    const count = data.width * data.height;
    if (data.heightCm.length !== count) {
      throw new Error("nav grid heightCm length mismatch: " + data.heightCm.length + " != " + count);
    }
    if (data.surface.length !== count) {
      throw new Error("nav grid surface length mismatch: " + data.surface.length + " != " + count);
    }
    if (data.blocked && data.blocked.length !== count) {
      throw new Error("nav grid blocked length mismatch: " + data.blocked.length + " != " + count);
    }
    if (data.walkableOverride && data.walkableOverride.length !== count) {
      throw new Error("nav grid walkableOverride length mismatch: " + data.walkableOverride.length + " != " + count);
    }

    this.width = data.width;
    this.height = data.height;
    this.cellSizeCm = data.cellSizeCm;
    this.rules = { ...DEFAULT_NAV_RULES, ...data.rules };
    this.diagonalRunCm = Math.max(1, Math.round((data.cellSizeCm * DIAGONAL_RATIO) / 1000));
    this.heights = new Int16Array(count);
    this.surfaces = new Uint8Array(count);
    for (let index = 0; index < count; index += 1) {
      this.heights[index] = clampInt(Math.round(data.heightCm[index]), INT16_MIN, INT16_MAX);
      this.surfaces[index] = clampInt(Math.round(data.surface[index]), 0, 255);
    }
    this.slopes = new Float32Array(count);
    for (let z = 0; z < this.height; z += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const index = this.index(x, z);
        const here = this.heights[index];
        let steepest = 0;
        if (x + 1 < this.width) steepest = Math.max(steepest, Math.abs(this.heights[index + 1] - here));
        if (x > 0) steepest = Math.max(steepest, Math.abs(this.heights[index - 1] - here));
        if (z + 1 < this.height) steepest = Math.max(steepest, Math.abs(this.heights[index + this.width] - here));
        if (z > 0) steepest = Math.max(steepest, Math.abs(this.heights[index - this.width] - here));
        this.slopes[index] = (steepest * 1000) / this.cellSizeCm;
      }
    }
    this.blockedMask = maskFrom(data.blocked, count);
    this.overrideMask = maskFrom(data.walkableOverride, count);

    const floor = this.computeCostFloor();
    this.minStraightCost = floor.straight;
    this.minDiagonalCost = floor.diagonal;
  }

  get cellCount(): number {
    return this.width * this.height;
  }

  get sizeWidthCm(): number {
    return this.width * this.cellSizeCm;
  }

  get sizeHeightCm(): number {
    return this.height * this.cellSizeCm;
  }

  index(x: number, z: number): number {
    return z * this.width + x;
  }

  cellX(index: number): number {
    return index % this.width;
  }

  cellZ(index: number): number {
    return Math.floor(index / this.width);
  }

  inBounds(x: number, z: number): boolean {
    return x >= 0 && z >= 0 && x < this.width && z < this.height;
  }

  cellFromWorld(xCm: number, zCm: number): number {
    const x = Math.floor(xCm / this.cellSizeCm);
    const z = Math.floor(zCm / this.cellSizeCm);
    return this.inBounds(x, z) ? this.index(x, z) : -1;
  }

  cellFromWorldClamped(xCm: number, zCm: number): number {
    const x = clampInt(Math.floor(xCm / this.cellSizeCm), 0, this.width - 1);
    const z = clampInt(Math.floor(zCm / this.cellSizeCm), 0, this.height - 1);
    return this.index(x, z);
  }

  centerOf(cell: number): NavPoint {
    const half = Math.floor(this.cellSizeCm / 2);
    return {
      xCm: this.cellX(cell) * this.cellSizeCm + half,
      zCm: this.cellZ(cell) * this.cellSizeCm + half,
      heightCm: this.heights[cell],
    };
  }

  heightCm(cell: number): number {
    return this.heights[cell];
  }

  /** 该格最陡的一步，千分比；1000 就是 45 度。 */
  slopePermille(cell: number): number {
    return this.slopes[cell];
  }

  /** 该格本身是否陡到站不住；通行判定仍以相邻两格的坡度为谁。 */
  isSteep(cell: number): boolean {
    return this.slopes[cell] > this.rules.maxSlopePermille;
  }

  surface(cell: number): number {
    return this.surfaces[cell];
  }

  profile(cell: number): SurfaceProfile {
    return surfaceProfile(this.surfaces[cell]);
  }

  isBlocked(cell: number): boolean {
    return this.blockedMask[cell] === 1;
  }

  isOverridden(cell: number): boolean {
    return this.overrideMask[cell] === 1;
  }

  baseWalkable(cell: number): boolean {
    if (this.overrideMask[cell] === 1) return true;
    if (this.blockedMask[cell] === 1) return false;
    return surfaceProfile(this.surfaces[cell]).walkable;
  }

  isWalkable(cell: number, coverage?: Uint8Array): boolean {
    if (cell < 0 || cell >= this.cellCount) return false;
    if (coverage) return coverage[cell] === 1;
    return this.baseWalkable(cell);
  }

  clearance(radiusCm: number): Uint8Array {
    const radius = Math.max(0, Math.floor(radiusCm));
    const cached = this.clearanceCache.get(radius);
    if (cached) return cached;
    const mask = buildClearanceMask(this, radius);
    if (this.clearanceCache.size >= CLEARANCE_CACHE_LIMIT) this.clearanceCache.clear();
    this.clearanceCache.set(radius, mask);
    return mask;
  }

  /**
   * 派生一张只多挡几个格子的网格。
   * 地形、坡度和地表数组只读共享，不再重新解码或扫描整张地图；
   * 用于同一张地图按阵营、目标城市派生，避免每次派兵重建 NavGrid。
   */
  withBlockedCells(cells: readonly number[]): NavGrid {
    const blocked = this.blockedMask.slice();
    const override = this.overrideMask.slice();
    for (const cell of cells) {
      if (cell < 0 || cell >= this.cellCount) continue;
      blocked[cell] = 1;
      override[cell] = 0;
    }
    return Object.assign(Object.create(NavGrid.prototype), this, {
      blockedMask: blocked,
      overrideMask: override,
      clearanceCache: new Map<number, Uint8Array>(),
    }) as NavGrid;
  }

  stepSlopePermille(from: number, to: number): number {
    const delta = this.heights[to] - this.heights[from];
    const diagonal = this.cellX(from) !== this.cellX(to) && this.cellZ(from) !== this.cellZ(to);
    const run = diagonal ? this.diagonalRunCm : this.cellSizeCm;
    return Math.floor((Math.abs(delta) * 1000) / run);
  }

  canStep(from: number, to: number, coverage?: Uint8Array): boolean {
    if (from === to) return false;
    const fx = this.cellX(from);
    const fz = this.cellZ(from);
    const tx = this.cellX(to);
    const tz = this.cellZ(to);
    const dx = tx - fx;
    const dz = tz - fz;
    if (Math.abs(dx) > 1 || Math.abs(dz) > 1) return false;
    if (!this.isWalkable(from, coverage) || !this.isWalkable(to, coverage)) return false;

    // 只比坡度：这段路的高差 / 水平距离超过兵种上限就走不过去。
    // 不再有"单格高差"这第二条判据，格子尺寸换了规则也跟着换。
    if (this.stepSlopePermille(from, to) > this.rules.maxSlopePermille) return false;

    const diagonal = dx !== 0 && dz !== 0;
    if (diagonal) {
      const sideA = this.index(fx + dx, fz);
      const sideB = this.index(fx, fz + dz);
      if (!this.isWalkable(sideA, coverage) || !this.isWalkable(sideB, coverage)) return false;
      const heightFrom = this.heights[from];
      const heightTo = this.heights[to];
      const heightA = this.heights[sideA];
      const heightB = this.heights[sideB];
      const maxRise = (this.rules.maxSlopePermille * this.cellSizeCm) / 1000;
      if (Math.abs(heightA - heightFrom) > maxRise) return false;
      if (Math.abs(heightTo - heightA) > maxRise) return false;
      if (Math.abs(heightB - heightFrom) > maxRise) return false;
      if (Math.abs(heightTo - heightB) > maxRise) return false;
    }
    return true;
  }

  stepCost(from: number, to: number): number {
    const diagonal = this.cellX(from) !== this.cellX(to) && this.cellZ(from) !== this.cellZ(to);
    const base = diagonal ? this.rules.diagonalCost : this.rules.straightCost;
    const run = diagonal ? this.diagonalRunCm : this.cellSizeCm;
    const delta = this.heights[to] - this.heights[from];
    const slope = this.slopeCostPermille(delta, run);
    const surface = surfaceProfile(this.surfaces[to]).costPermille;
    return Math.max(1, divRound(base * slope * surface, 1000000));
  }

  nearestWalkable(cell: number, coverage?: Uint8Array, maxRadiusCells = 16): number | null {
    if (cell < 0 || cell >= this.cellCount) return null;
    if (this.isWalkable(cell, coverage)) return cell;
    const cx = this.cellX(cell);
    const cz = this.cellZ(cell);
    for (let radius = 1; radius <= maxRadiusCells; radius += 1) {
      let best = -1;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const candidate = this.index(nx, nz);
          if (!this.isWalkable(candidate, coverage)) continue;
          const distance = dx * dx + dz * dz;
          if (distance < bestDistance || (distance === bestDistance && candidate < best)) {
            best = candidate;
            bestDistance = distance;
          }
        }
      }
      if (best >= 0) return best;
    }
    return null;
  }

  heightCmAtXZ(xCm: number, zCm: number): number {
    return sampleHeightCm(this.heights, this.width, this.height, this.cellSizeCm, xCm, zCm);
  }

  surfaceAtXZ(xCm: number, zCm: number): number {
    return this.surfaces[this.cellFromWorldClamped(xCm, zCm)];
  }

  private slopeCostPermille(delta: number, runCm: number): number {
    if (delta === 0) return 1000;
    const slope = Math.floor((Math.abs(delta) * 1000) / runCm);
    if (delta > 0) return 1000 + Math.floor((slope * this.rules.uphillScale) / 1000);
    return Math.max(this.rules.minDownhillPermille, 1000 - Math.floor((slope * this.rules.downhillScale) / 1000));
  }

  private computeCostFloor(): CostFloor {
    let minSurface = 1000;
    for (let index = 0; index < this.cellCount; index += 1) {
      if (!this.baseWalkable(index)) continue;
      const cost = surfaceProfile(this.surfaces[index]).costPermille;
      if (cost < minSurface) minSurface = cost;
    }

    let minSlope = 1000;
    const probes: ReadonlyArray<readonly [number, number, number]> = [
      [1, 0, this.cellSizeCm],
      [0, 1, this.cellSizeCm],
      [1, 1, this.diagonalRunCm],
      [1, -1, this.diagonalRunCm],
    ];
    for (let z = 0; z < this.height; z += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const from = this.index(x, z);
        for (const probe of probes) {
          const nx = x + probe[0];
          const nz = z + probe[1];
          if (!this.inBounds(nx, nz)) continue;
          const delta = this.heights[this.index(nx, nz)] - this.heights[from];
          const multiplier = this.slopeCostPermille(delta, probe[2]);
          if (multiplier < minSlope) minSlope = multiplier;
        }
      }
    }

    return {
      straight: Math.max(1, Math.floor((this.rules.straightCost * minSurface * minSlope) / 1000000)),
      diagonal: Math.max(1, Math.floor((this.rules.diagonalCost * minSurface * minSlope) / 1000000)),
    };
  }
}
