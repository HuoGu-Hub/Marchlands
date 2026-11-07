import { createNoise2D } from "simplex-noise";

/**
 * 网格地形的显示面。
 *
 * 寻路用的是格心高度，显示面不能再拿它铺"一格一台阶 + 竖直墙"：
 * 那样每个格子边都是一道折线，远看就是菱形网格和方柱悬崖。
 *
 * 这里把格高当成高度场采样点，做三件事：
 *
 * 1. Catmull-Rom 双三次插值：面是连续的，格与格之间不再有折角。
 * 2. 崖面水平扰动：坡度大的地方沿噪声横向拧一下，崖线不再贴着格子边。
 * 3. 岩面起伏与层理：陡坡上叠分形噪声和横向岩层，平地只留很轻的呼吸感。
 *
 * 输出顶点为世界米制，调用方只负责法线、贴图和材质。
 * 显示高度统一走 heightAt，兵团、道路、装饰贴地不会和视觉面错位。
 */

export interface GridSurfaceInput {
  readonly width: number;
  readonly height: number;
  readonly cellSizeCm: number;
  /** 格子高度，厘米。 */
  readonly heightCmAt: (x: number, z: number) => number;
}

export interface GridSurfaceOptions {
  /** 网格左下角的世界坐标，米。 */
  readonly originX?: number;
  readonly originZ?: number;
  /** 每格细分采样数，2 表示每 0.5 米一个顶点。 */
  readonly samplesPerCell?: number;
  /** 噪声种子。 */
  readonly seed?: number;
  /** 岩面起伏振幅，米，默认 0.55。 */
  readonly relief?: number;
  /** 崖面水平扰动，米，默认 0.8。 */
  readonly warp?: number;
  /** 显示高度场的高斯平滑次数，默认 2；每多一次，崖口轮廓就圆一档。 */
  readonly smoothing?: number;
}

export interface GridSurface {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  /** 顶点列数、行数。 */
  readonly cols: number;
  readonly rows: number;
  /** 显示面顶点，世界米。 */
  readonly positions: Float32Array;
  /** 显示面三角索引。 */
  readonly indices: Uint32Array;
  readonly minY: number;
  readonly maxY: number;
  /** 显示面上的高度，世界米；与三角面一致。 */
  heightAt(x: number, z: number): number;
}

/** 崖面扰动的坡度区间，弧度正切值：0.25 约 14°，0.9 约 42°。 */
const STEEP_LOW = 0.25;
const STEEP_HIGH = 0.9;
/** 平地起伏占 relief 的比例：只够让法线有一点碎，不影响贴地和寻路。 */
const BASE_RELIEF_FRACTION = 0.08;
/** 平地的基础横向扰动，米。 */
const BASE_WARP_M = 0.02;

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(label + " must be a positive integer");
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 可复现的随机源，simplex-noise 只要求 random()。 */
function seeded(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function clampIndex(value: number, limit: number): number {
  return value < 0 ? 0 : value >= limit ? limit - 1 : value;
}

function catmullRom(t: number): [number, number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * (-t3 + 2 * t2 - t),
    0.5 * (3 * t3 - 5 * t2 + 2),
    0.5 * (-3 * t3 + 4 * t2 + t),
    0.5 * (t3 - t2),
  ];
}

/** 可分离的 1-2-1 平滑，边界复制；只用于显示高度场。 */
function blurHeights(source: Float32Array, width: number, height: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  for (let z = 0; z < height; z += 1) {
    const row = z * width;
    for (let x = 0; x < width; x += 1) {
      const left = source[row + (x > 0 ? x - 1 : 0)];
      const right = source[row + (x + 1 < width ? x + 1 : width - 1)];
      horizontal[row + x] = left * 0.25 + source[row + x] * 0.5 + right * 0.25;
    }
  }
  const output = new Float32Array(source.length);
  for (let z = 0; z < height; z += 1) {
    const above = (z > 0 ? z - 1 : 0) * width;
    const below = (z + 1 < height ? z + 1 : height - 1) * width;
    const row = z * width;
    for (let x = 0; x < width; x += 1) {
      output[row + x] = horizontal[above + x] * 0.25 + horizontal[row + x] * 0.5 + horizontal[below + x] * 0.25;
    }
  }
  return output;
}

export function buildGridSurface(
  input: GridSurfaceInput,
  options: GridSurfaceOptions = {},
): GridSurface {
  const { width, height } = input;
  assertInteger(width, "grid width");
  assertInteger(height, "grid height");
  if (!Number.isFinite(input.cellSizeCm) || input.cellSizeCm <= 0) {
    throw new Error("grid cellSizeCm must be positive");
  }
  const cellSizeM = input.cellSizeCm / 100;
  const originX = options.originX ?? 0;
  const originZ = options.originZ ?? 0;
  const samples = Math.max(1, Math.min(6, Math.round(options.samplesPerCell ?? 2)));
  const relief = Math.max(0, options.relief ?? 0.55);
  const warp = Math.max(0, options.warp ?? 0.8);
  const seed = Math.round(options.seed ?? 20261123);

  const cells = width * height;
  let heights = new Float32Array(cells);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      heights[z * width + x] = input.heightCmAt(x, z) / 100;
    }
  }
  // 格子高度的边界是一圈 1 米锯齿：崖顶轮廓直接照着格子边画，就成了台阶。
  // 显示高度场先做高斯平滑，把轮廓摊圆；寻路仍然用原始格高，互不影响。
  const smoothing = Math.max(0, Math.min(6, Math.round(options.smoothing ?? 2)));
  for (let pass = 0; pass < smoothing; pass += 1) heights = blurHeights(heights, width, height);

  // 每格的坡度（最大单步高差 / 格宽）。只当权重用：崖面附近扰动大，平地几乎不动。
  const slopeGrid = new Float32Array(cells);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const here = heights[index];
      let steepest = 0;
      if (x + 1 < width) steepest = Math.max(steepest, Math.abs(heights[index + 1] - here));
      if (x > 0) steepest = Math.max(steepest, Math.abs(heights[index - 1] - here));
      if (z + 1 < height) steepest = Math.max(steepest, Math.abs(heights[index + width] - here));
      if (z > 0) steepest = Math.max(steepest, Math.abs(heights[index - width] - here));
      slopeGrid[index] = steepest / cellSizeM;
    }
  }

  const noise = createNoise2D(seeded(seed ^ 0x9e3779b9));
  const warpNoise = createNoise2D(seeded(seed * 3 + 17));
  const ridgeNoise = createNoise2D(seeded(seed * 7 + 53));

  /** 格心高度的双三次采样，t 为格内偏移；越界按边缘格复制。 */
  const sampleBase = (x: number, z: number): number => {
    const u = (x - originX) / cellSizeM - 0.5;
    const v = (z - originZ) / cellSizeM - 0.5;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const wx = catmullRom(u - i0);
    const wz = catmullRom(v - j0);
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    const rows: number[] = [];
    for (let row = 0; row < 4; row += 1) {
      const j = clampIndex(j0 - 1 + row, height);
      const base = j * width;
      let value = 0;
      let low = Number.POSITIVE_INFINITY;
      let high = Number.NEGATIVE_INFINITY;
      for (let col = 0; col < 4; col += 1) {
        const i = clampIndex(i0 - 1 + col, width);
        const sample = heights[base + i];
        value += sample * wx[col];
        if (sample < low) low = sample;
        if (sample > high) high = sample;
      }
      // 双三次插值会过冲：平台边缘会鼓出一个包、崖脚会凹下去。
      // 每一轴都夹回参与插值的样本范围，得到单调的连续坡。
      value = Math.max(low, Math.min(high, value));
      rows.push(value);
      if (value < min) min = value;
      if (value > max) max = value;
    }
    let output = 0;
    for (let row = 0; row < 4; row += 1) output += rows[row] * wz[row];
    return Math.max(min, Math.min(max, output));
  };

  /** 坡度场的双线性采样。 */
  const sampleSlope = (x: number, z: number): number => {
    const u = (x - originX) / cellSizeM - 0.5;
    const v = (z - originZ) / cellSizeM - 0.5;
    const x0 = clampIndex(Math.floor(u), width);
    const z0 = clampIndex(Math.floor(v), height);
    const x1 = Math.min(width - 1, x0 + 1);
    const z1 = Math.min(height - 1, z0 + 1);
    const tx = Math.max(0, Math.min(1, u - Math.floor(u)));
    const tz = Math.max(0, Math.min(1, v - Math.floor(v)));
    const top = slopeGrid[z0 * width + x0] * (1 - tx) + slopeGrid[z0 * width + x1] * tx;
    const bottom = slopeGrid[z1 * width + x0] * (1 - tx) + slopeGrid[z1 * width + x1] * tx;
    return top * (1 - tz) + bottom * tz;
  };

  const heightAt = (x: number, z: number): number => {
    const steep = smoothstep(STEEP_LOW, STEEP_HIGH, sampleSlope(x, z));
    // 崖面沿横向拧一下：采样点偏开格子边，崖线因此不是直的。
    const warpAmount = warp * (BASE_WARP_M + steep);
    const wx = warpNoise(x * 0.145, z * 0.145) * warpAmount;
    const wz = warpNoise(x * 0.145 + 31.7, z * 0.145 - 12.3) * warpAmount;
    const base = sampleBase(x + wx, z + wz);
    // 分形起伏：平地上只有默认振幅的十分之一，崖面才铺满。
    const fine =
      noise(x * 0.095, z * 0.095) * 0.58 +
      noise(x * 0.31, z * 0.31) * 0.28 +
      noise(x * 0.93, z * 0.93) * 0.14;
    const amplitude = relief * (BASE_RELIEF_FRACTION + steep);
    // 横向层理：只有陡坡才看得出，像岩层被风化出一条条棱。
    const strata = relief * 0.2 * steep * Math.sin(base * 2.35 + ridgeNoise(x * 0.19, z * 0.19) * 2.6);
    return base + fine * amplitude + strata;
  };

  const cols = width * samples + 1;
  const rows = height * samples + 1;
  const positions = new Float32Array(cols * rows * 3);
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const step = cellSizeM / samples;
  for (let row = 0; row < rows; row += 1) {
    const z = originZ + row * step;
    for (let col = 0; col < cols; col += 1) {
      const x = originX + col * step;
      const y = heightAt(x, z);
      const offset = (row * cols + col) * 3;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = z;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const indices = new Uint32Array(width * samples * height * samples * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + cols;
      const c = a + 1;
      const d = b + 1;
      // 朝上：(a, b, c) 与 (c, b, d)。
      indices[cursor] = a;
      indices[cursor + 1] = b;
      indices[cursor + 2] = c;
      indices[cursor + 3] = c;
      indices[cursor + 4] = b;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  return {
    width,
    height,
    cellSizeM,
    cols,
    rows,
    positions,
    indices,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    heightAt,
  };
}
