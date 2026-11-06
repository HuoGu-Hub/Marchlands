/**
 * 网格地形的显示面。
 *
 * 寻路用的是格心高度。直接拿它插值会把一格的高差摊成 45°~70° 的斜坡，
 * 从远处看是一道陡坡而不是墙。这里把同一份格高整理成"台阶 + 竖直墙面"：
 *
 * - 缓坡：格角取四周"非崖顶"格的均值，相邻格共享顶点，表面连续。
 * - 崖顶：处在陡壁高侧的格子单独铺平顶，矮的一侧不参与均值，
 *   崖脚不会被拉起来，墙从底到顶是一整面。
 *
 * 补墙逐个边比较两端顶面的实际高差，顶面怎么拆都不会留下裂缝。
 * 输出顶点坐标为世界米制，调用方只负责贴图和材质。
 */

/** 相邻格高差达到这个值就算陡壁，和寻路阈值、编辑器悬崖笔刷保持一致。 */
export const CLIFF_THRESHOLD_CM = 120;

/** 缺口小于这个值不补墙，避免缓坡共享顶点时产生发丝墙。 */
const WALL_EPSILON_M = 0.01;

export interface GridSurfaceInput {
  readonly width: number;
  readonly height: number;
  readonly cellSizeCm: number;
  /** 格子高度，厘米。 */
  readonly heightCmAt: (x: number, z: number) => number;
}

export interface GridSurfaceOptions {
  /** 陡壁阈值，厘米，默认 120。 */
  readonly cliffThresholdCm?: number;
  /** 网格左下角的世界坐标，米。 */
  readonly originX?: number;
  readonly originZ?: number;
}

/** 一段陡壁：两端各记录顶面和底面的高度，相邻墙段在格角处共用同一对值。 */
export interface GridSurfaceWall {
  /** 边界起点，世界米。 */
  readonly ax: number;
  readonly az: number;
  /** 边界终点，世界米。 */
  readonly bx: number;
  readonly bz: number;
  /** 起点处的顶面、底面高度，米。 */
  readonly top0: number;
  readonly bottom0: number;
  /** 终点处的顶面、底面高度，米。 */
  readonly top1: number;
  readonly bottom1: number;
  /** 从高侧指向低侧的单位水平法线。 */
  readonly nx: number;
  readonly nz: number;
}

export interface GridSurface {
  readonly width: number;
  readonly height: number;
  readonly cellSizeM: number;
  /** 每格四角高度，米，顺序为 (x,z)、(x+1,z)、(x,z+1)、(x+1,z+1)。 */
  readonly cellCornerHeights: Float32Array;
  /** 显示面顶点，世界米。 */
  readonly positions: Float32Array;
  /** 显示面三角索引。 */
  readonly indices: Uint32Array;
  readonly walls: readonly GridSurfaceWall[];
  /** 墙面段数，等于 walls.length。 */
  readonly cliffEdges: number;
  /** 显示面上的高度，世界米；和网格的三角面一致。 */
  heightAt(x: number, z: number): number;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(label + " must be a positive integer");
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
  const thresholdCm = options.cliffThresholdCm ?? CLIFF_THRESHOLD_CM;
  const originX = options.originX ?? 0;
  const originZ = options.originZ ?? 0;
  const cells = width * height;

  // 高度统一按厘米存，阈值比较不受浮点误差影响。
  const heights = new Float32Array(cells);
  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      heights[z * width + x] = input.heightCmAt(x, z);
    }
  }

  // 陡壁高侧的格子：只判定"比邻格高出阈值"的那一格，矮的一侧不动。
  const cliffTop = new Uint8Array(cells);
  for (let cz = 0; cz < height; cz += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const cell = cz * width + cx;
      const here = heights[cell];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
        if (here - heights[nz * width + nx] >= thresholdCm) {
          cliffTop[cell] = 1;
          break;
        }
      }
    }
  }

  const cellCornerHeights = new Float32Array(cells * 4);
  const cellVertices = new Int32Array(cells * 4);
  cellVertices.fill(-1);
  const positions: number[] = [];
  const indices: number[] = [];
  const smoothVertices = new Map<number, number>();
  const topVertices = new Map<number, number>();

  for (let j = 0; j <= height; j += 1) {
    for (let i = 0; i <= width; i += 1) {
      const cornerIndex = j * (width + 1) + i;
      // 格角四周的四格：(i-1,j-1)、(i,j-1)、(i-1,j)、(i,j)。
      const nodeCell = [-1, -1, -1, -1];
      const nodeSlot = [-1, -1, -1, -1];
      const addNode = (node: number, cx: number, cz: number, slot: number): void => {
        if (cx < 0 || cz < 0 || cx >= width || cz >= height) return;
        nodeCell[node] = cz * width + cx;
        nodeSlot[node] = slot;
      };
      addNode(0, i - 1, j - 1, 3);
      addNode(1, i, j - 1, 2);
      addNode(2, i - 1, j, 1);
      addNode(3, i, j, 0);

      // 缓坡均值只算非崖顶格；崖顶格不参与，崖脚就不会被拉高。
      let sum = 0;
      let count = 0;
      let mask = 0;
      for (let node = 0; node < 4; node += 1) {
        const cell = nodeCell[node];
        if (cell < 0 || cliffTop[cell]) continue;
        sum += heights[cell];
        count += 1;
        mask |= 1 << node;
      }
      const averageCm = count > 0 ? sum / count : 0;
      const smoothKey = cornerIndex * 16 + mask;
      let smoothVertex = -1;
      if (count > 0) {
        smoothVertex = smoothVertices.get(smoothKey) ?? -1;
        if (smoothVertex < 0) {
          smoothVertex = positions.length / 3;
          positions.push(originX + i * cellSizeM, averageCm / 100, originZ + j * cellSizeM);
          smoothVertices.set(smoothKey, smoothVertex);
        }
      }

      for (let node = 0; node < 4; node += 1) {
        const cell = nodeCell[node];
        if (cell < 0) continue;
        const index = cell * 4 + nodeSlot[node];
        if (cliffTop[cell]) {
          // 崖顶整格平铺，四个角只和自己有关，墙才能从底到顶封住。
          const key = cell * 4 + nodeSlot[node];
          let vertex = topVertices.get(key);
          if (vertex === undefined) {
            vertex = positions.length / 3;
            positions.push(originX + i * cellSizeM, heights[cell] / 100, originZ + j * cellSizeM);
            topVertices.set(key, vertex);
          }
          cellVertices[index] = vertex;
          cellCornerHeights[index] = heights[cell] / 100;
        } else {
          cellVertices[index] = smoothVertex;
          cellCornerHeights[index] = averageCm / 100;
        }
      }
    }
  }

  for (let cz = 0; cz < height; cz += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const base = (cz * width + cx) * 4;
      const v0 = cellVertices[base];
      const v1 = cellVertices[base + 1];
      const v2 = cellVertices[base + 2];
      const v3 = cellVertices[base + 3];
      if (v0 < 0 || v1 < 0 || v2 < 0 || v3 < 0) {
        throw new Error("grid surface corner missing at cell " + cx + "," + cz);
      }
      // 逆时针朝上：(v0,v2,v1) 与 (v1,v2,v3)。
      indices.push(v0, v2, v1, v1, v2, v3);
    }
  }

  // 每个格角取四格的最高/最低顶面：所有墙段共用同一对端点，接缝不会裂。
  const cornerTop = new Float32Array((width + 1) * (height + 1));
  const cornerBottom = new Float32Array((width + 1) * (height + 1));
  for (let j = 0; j <= height; j += 1) {
    for (let i = 0; i <= width; i += 1) {
      let top = Number.NEGATIVE_INFINITY;
      let bottom = Number.POSITIVE_INFINITY;
      const corners: Array<[number, number, number]> = [
        [i - 1, j - 1, 3],
        [i, j - 1, 2],
        [i - 1, j, 1],
        [i, j, 0],
      ];
      for (const [cx, cz, slot] of corners) {
        if (cx < 0 || cz < 0 || cx >= width || cz >= height) continue;
        const value = cellCornerHeights[(cz * width + cx) * 4 + slot];
        top = Math.max(top, value);
        bottom = Math.min(bottom, value);
      }
      const index = j * (width + 1) + i;
      cornerTop[index] = top;
      cornerBottom[index] = bottom;
    }
  }

  const walls: GridSurfaceWall[] = [];
  const pushWall = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    cornerA: number,
    cornerB: number,
    nx: number,
    nz: number,
  ): void => {
    const top0 = cornerTop[cornerA];
    const bottom0 = cornerBottom[cornerA];
    const top1 = cornerTop[cornerB];
    const bottom1 = cornerBottom[cornerB];
    if (Math.max(top0 - bottom0, top1 - bottom1) < WALL_EPSILON_M) return;
    walls.push({ ax, az, bx, bz, top0, bottom0, top1, bottom1, nx, nz });
  };

  for (let cz = 0; cz < height; cz += 1) {
    for (let cx = 0; cx < width; cx += 1) {
      const cell = cz * width + cx;
      if (cx + 1 < width) {
        const neighbour = cell + 1;
        const sign = heights[cell] >= heights[neighbour] ? 1 : -1;
        pushWall(
          originX + (cx + 1) * cellSizeM,
          originZ + cz * cellSizeM,
          originX + (cx + 1) * cellSizeM,
          originZ + (cz + 1) * cellSizeM,
          cz * (width + 1) + (cx + 1),
          (cz + 1) * (width + 1) + (cx + 1),
          sign,
          0,
        );
      }
      if (cz + 1 < height) {
        const neighbour = cell + width;
        const sign = heights[cell] >= heights[neighbour] ? 1 : -1;
        pushWall(
          originX + cx * cellSizeM,
          originZ + (cz + 1) * cellSizeM,
          originX + (cx + 1) * cellSizeM,
          originZ + (cz + 1) * cellSizeM,
          (cz + 1) * (width + 1) + cx,
          (cz + 1) * (width + 1) + (cx + 1),
          0,
          sign,
        );
      }
    }
  }

  const heightAt = (x: number, z: number): number => {
    const localX = (x - originX) / cellSizeM;
    const localZ = (z - originZ) / cellSizeM;
    const cx = Math.min(width - 1, Math.max(0, Math.floor(localX)));
    const cz = Math.min(height - 1, Math.max(0, Math.floor(localZ)));
    const tx = Math.min(1, Math.max(0, localX - cx));
    const tz = Math.min(1, Math.max(0, localZ - cz));
    const base = (cz * width + cx) * 4;
    const near = cellCornerHeights[base] * (1 - tx) + cellCornerHeights[base + 1] * tx;
    const far = cellCornerHeights[base + 2] * (1 - tx) + cellCornerHeights[base + 3] * tx;
    return near * (1 - tz) + far * tz;
  };

  return {
    width,
    height,
    cellSizeM,
    cellCornerHeights,
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    walls,
    cliffEdges: walls.length,
    heightAt,
  };
}