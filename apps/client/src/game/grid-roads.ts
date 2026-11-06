import * as THREE from "three";

export interface RoadGridData {
  readonly surface: Uint8Array;
  readonly heights: Int16Array;
  readonly width: number;
  readonly height: number;
  readonly cellCm: number;
}

export interface GridRoadOptions {
  readonly map: { size: [number, number] };
  readonly grid: RoadGridData;
  readonly roadMaterial: THREE.Material;
  readonly curbMaterial: THREE.Material;
  /** 一格一米的网格上，路面比地面抬高一点，避免 z-fighting。 */
  readonly lift?: number;
}

const ROAD_SURFACE = 3;
const BRIDGE_SURFACE = 8;

/**
 * 网格地图的路面直接按地表格铺四边形，和地形共用同一份高度：
 * 路和地面不会有缝隙，所有格子合并成两张网格（路面 + 路肩），只有两次绘制。
 */
export function buildGridRoadMesh(options: GridRoadOptions): THREE.Group {
  const { grid, roadMaterial, curbMaterial } = options;
  const lift = options.lift ?? 0.05;
  const cellMeters = grid.cellCm / 100;
  const halfX = (options.map.size[0] * 5) / 100;
  const halfZ = (options.map.size[1] * 5) / 100;

  const isRoad = (x: number, z: number): boolean => {
    if (x < 0 || z < 0 || x >= grid.width || z >= grid.height) return false;
    const surface = grid.surface[z * grid.width + x];
    return surface === ROAD_SURFACE || surface === BRIDGE_SURFACE;
  };

  const cornerHeight = (x: number, z: number): number => {
    let sum = 0;
    let count = 0;
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const cx = x + dx;
      const cz = z + dz;
      if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) continue;
      sum += grid.heights[cz * grid.width + cx];
      count += 1;
    }
    return count > 0 ? sum / count / 100 : 0;
  };

  const road: { positions: number[]; uvs: number[]; indices: number[] } = { positions: [], uvs: [], indices: [] };
  const curb: { positions: number[]; uvs: number[]; indices: number[] } = { positions: [], uvs: [], indices: [] };

  const pushQuad = (
    target: typeof road,
    cellX: number,
    cellZ: number,
    expand: number,
    y: number,
  ): void => {
    const x0 = cellX * cellMeters - halfX - expand;
    const x1 = (cellX + 1) * cellMeters - halfX + expand;
    const z0 = cellZ * cellMeters - halfZ - expand;
    const z1 = (cellZ + 1) * cellMeters - halfZ + expand;
    const base = target.positions.length / 3;
    // 四个角的高度取相邻格的平均，格子之间不会裂开。
    const corners: Array<[number, number, number, number]> = [
      [x0, z0, cornerHeight(cellX, cellZ), 0],
      [x1, z0, cornerHeight(cellX + 1, cellZ), 0],
      [x0, z1, cornerHeight(cellX, cellZ + 1), 0],
      [x1, z1, cornerHeight(cellX + 1, cellZ + 1), 0],
    ];
    for (const [x, z, h] of corners) {
      target.positions.push(x, h + y, z);
      target.uvs.push(x / 3.2, z / 3.2);
    }
    target.indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  };

  // 每格向外铺半格：斜向的路段连成一条粗带，不会有锯齿状的孤立格。
  const expand = cellMeters * 0.45;
  for (let z = 0; z < grid.height; z += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      if (!isRoad(x, z)) continue;
      pushQuad(road, x, z, expand, lift);
    }
  }

  const group = new THREE.Group();
  group.name = "grid-roads";
  const build = (data: typeof road, material: THREE.Material): void => {
    if (data.indices.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uvs, 2));
    geometry.setIndex(data.indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    group.add(mesh);
  };
  build(road, roadMaterial);
  void curbMaterial;
  void curb;
  return group;
}
