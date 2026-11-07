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

/** 以格为单位的矩形，闭区间。 */
export interface GridCellRect {
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
}

/** 以顶点为单位的矩形，闭区间。 */
export interface GridVertexRect {
  readonly i0: number;
  readonly j0: number;
  readonly i1: number;
  readonly j1: number;
}

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
  /** 每顶点的草岩交界扰动，0 到 1；交给材质做插值，省掉逐像素噪声。 */
  readonly rockDithers: Float32Array;
  readonly minY: number;
  readonly maxY: number;
  /** 显示面上的高度，世界米；与三角面一致。 */
  heightAt(x: number, z: number): number;
  /**
   * 重新读取格高并刷新显示面。
   *
   * 只重算高度场和受影响矩形的顶点，不重建材质、贴图或岛屿。
   * 返回需要重算法线的顶点矩形。不传 cells 时刷新整张地图。
   */
  refresh(heightCmAt: (x: number, z: number) => number, cells?: GridCellRect): GridVertexRect;
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

/** 一行四个样本的双三次插值。单独抽出来是为了不在每个顶点上分配数组。 */
function sampleRow(
  heights: Float32Array,
  width: number,
  i0: number,
  w0: number,
  w1: number,
  w2: number,
  w3: number,
  j: number,
): number {
  const base = j * width;
  const a = heights[base + clampIndex(i0 - 1, width)];
  const b = heights[base + clampIndex(i0, width)];
  const c = heights[base + clampIndex(i0 + 1, width)];
  const d = heights[base + clampIndex(i0 + 2, width)];
  const value = a * w0 + b * w1 + c * w2 + d * w3;
  // 双三次插值会过冲：平台边缘会鼓出一个包、崖脚会凹下去。
  // 每一轴都夹回参与插值的样本范围，得到单调的连续坡。
  const low = a < b ? (a < c ? (a < d ? a : d) : c < d ? c : d) : b < c ? (b < d ? b : d) : c < d ? c : d;
  const high = a > b ? (a > c ? (a > d ? a : d) : c > d ? c : d) : b > c ? (b > d ? b : d) : c > d ? c : d;
  return value < low ? low : value > high ? high : value;
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
  const smoothing = Math.max(0, Math.min(6, Math.round(options.smoothing ?? 2)));

  const cells = width * height;
  const rawHeights = new Float32Array(cells);
  let heights = new Float32Array(cells);
  let slopeGrid = new Float32Array(cells);

  const readHeights = (heightCmAt: (x: number, z: number) => number, rect?: GridCellRect): void => {
    const x0 = rect ? Math.max(0, rect.x0) : 0;
    const z0 = rect ? Math.max(0, rect.z0) : 0;
    const x1 = rect ? Math.min(width - 1, rect.x1) : width - 1;
    const z1 = rect ? Math.min(height - 1, rect.z1) : height - 1;
    for (let z = z0; z <= z1; z += 1) {
      const row = z * width;
      for (let x = x0; x <= x1; x += 1) rawHeights[row + x] = heightCmAt(x, z) / 100;
    }
  };

  const rebuildFields = (): void => {
    // 格子高度的边界是一圈 1 米锯齿：崖顶轮廓直接照着格子边画，就成了台阶。
    // 显示高度场先做高斯平滑，把轮廓摊圆；寻路仍然用原始格高，互不影响。
    heights = rawHeights;
    for (let pass = 0; pass < smoothing; pass += 1) heights = blurHeights(heights, width, height);
    slopeGrid = new Float32Array(cells);
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
  };

  const noise = createNoise2D(seeded(seed ^ 0x9e3779b9));
  const warpNoise = createNoise2D(seeded(seed * 3 + 17));
  const ridgeNoise = createNoise2D(seeded(seed * 7 + 53));

  /** 格心高度的双三次采样，t 为格内偏移；越界按边缘格复制。 */
  const sampleBase = (x: number, z: number): number => {
    const u = (x - originX) / cellSizeM - 0.5;
    const v = (z - originZ) / cellSizeM - 0.5;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    const tu = u - i0;
    const tv = v - j0;
    const tu2 = tu * tu;
    const tu3 = tu2 * tu;
    const wu0 = 0.5 * (-tu3 + 2 * tu2 - tu);
    const wu1 = 0.5 * (3 * tu3 - 5 * tu2 + 2);
    const wu2 = 0.5 * (-3 * tu3 + 4 * tu2 + tu);
    const wu3 = 0.5 * (tu3 - tu2);
    const tv2 = tv * tv;
    const tv3 = tv2 * tv;
    const wv0 = 0.5 * (-tv3 + 2 * tv2 - tv);
    const wv1 = 0.5 * (3 * tv3 - 5 * tv2 + 2);
    const wv2 = 0.5 * (-3 * tv3 + 4 * tv2 + tv);
    const wv3 = 0.5 * (tv3 - tv2);

    const rowA = sampleRow(heights, width, i0, wu0, wu1, wu2, wu3, clampIndex(j0 - 1, height));
    const rowB = sampleRow(heights, width, i0, wu0, wu1, wu2, wu3, clampIndex(j0, height));
    const rowC = sampleRow(heights, width, i0, wu0, wu1, wu2, wu3, clampIndex(j0 + 1, height));
    const rowD = sampleRow(heights, width, i0, wu0, wu1, wu2, wu3, clampIndex(j0 + 2, height));
    const lowAB = rowA < rowB ? rowA : rowB;
    const lowCD = rowC < rowD ? rowC : rowD;
    const highAB = rowA > rowB ? rowA : rowB;
    const highCD = rowC > rowD ? rowC : rowD;
    const low = lowAB < lowCD ? lowAB : lowCD;
    const high = highAB > highCD ? highAB : highCD;
    const output = rowA * wv0 + rowB * wv1 + rowC * wv2 + rowD * wv3;
    return output < low ? low : output > high ? high : output;
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
    // 平地跳过噪声：地图上大部分格子是平的，这三层噪声占了重建时间的两成。
    // 平地本来也只有 4 厘米振幅，细节层的法线贴图足够补。
    if (steep < 0.01) return sampleBase(x, z);

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

  /** 草岩交界的逐顶点扰动，材质直接插值使用，避免逐像素哈希噪声。 */
  const ditherAt = (x: number, z: number): number =>
    Math.max(0, Math.min(1, 0.5 + noise(x * 0.37 + 11.3, z * 0.37 - 7.1) * 0.5));

  const cols = width * samples + 1;
  const rows = height * samples + 1;
  const positions = new Float32Array(cols * rows * 3);
  const rockDithers = new Float32Array(cols * rows);
  const step = cellSizeM / samples;

  const writeVertices = (i0: number, j0: number, i1: number, j1: number): void => {
    for (let row = j0; row <= j1; row += 1) {
      const z = originZ + row * step;
      for (let col = i0; col <= i1; col += 1) {
        const x = originX + col * step;
        const offset = (row * cols + col) * 3;
        positions[offset] = x;
        positions[offset + 1] = heightAt(x, z);
        positions[offset + 2] = z;
        rockDithers[row * cols + col] = ditherAt(x, z);
      }
    }
  };

  readHeights(input.heightCmAt);
  rebuildFields();
  writeVertices(0, 0, cols - 1, rows - 1);

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

  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 1; index < positions.length; index += 3) {
    const y = positions[index];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const refresh = (heightCmAt: (x: number, z: number) => number, cellsRect?: GridCellRect): GridVertexRect => {
    if (!cellsRect) {
      readHeights(heightCmAt);
      rebuildFields();
      writeVertices(0, 0, cols - 1, rows - 1);
      return { i0: 0, j0: 0, i1: cols - 1, j1: rows - 1 };
    }
    readHeights(heightCmAt, cellsRect);
    rebuildFields();
    // 双三次插值要看到左右各两格，顶点矩形比格矩形多留三格。
    const i0 = Math.max(0, Math.floor((cellsRect.x0 - 3) * samples));
    const j0 = Math.max(0, Math.floor((cellsRect.z0 - 3) * samples));
    const i1 = Math.min(cols - 1, Math.ceil((cellsRect.x1 + 3) * samples));
    const j1 = Math.min(rows - 1, Math.ceil((cellsRect.z1 + 3) * samples));
    writeVertices(i0, j0, i1, j1);
    return { i0, j0, i1, j1 };
  };

  return {
    width,
    height,
    cellSizeM,
    cols,
    rows,
    positions,
    indices,
    rockDithers,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    heightAt,
    refresh,
  };
}
