import * as THREE from "three";
import type { GridSurface, GridVertexRect } from "@marchlands/map-authoring";

/**
 * 把网格地形显示面转成 three 网格。
 *
 * 显示面本身已经是细分过的连续曲面，不再需要单独补崖壁：
 * 陡坡就是面的陡坡，法线连续，贴图靠材质里的三平面投影贴合。
 */

export interface GridTerrainOptions {
  readonly material: THREE.Material;
  /** 宏观贴图在整张地图上的 UV 范围，米。 */
  readonly uvOriginX: number;
  readonly uvOriginZ: number;
  readonly uvSizeX: number;
  readonly uvSizeZ: number;
}

export function buildGridTerrainMesh(surface: GridSurface, options: GridTerrainOptions): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  const positions = surface.positions;
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aRockDither", new THREE.BufferAttribute(surface.rockDithers, 1));
  const count = positions.length / 3;
  // 可达高亮直接画在地形顶点色里：单独铺一层贴片会在崖壁上被拉成竖三角，
  // 而且多一层透明三角形。0 不可达，1 普通可走，2 可到建筑占地。
  geometry.setAttribute("aReach", new THREE.BufferAttribute(new Float32Array(count), 1));
  const uvs = new Float32Array(count * 2);
  const sizeX = Math.max(1e-6, options.uvSizeX);
  const sizeZ = Math.max(1e-6, options.uvSizeZ);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    uvs[index * 2] = (positions[offset] - options.uvOriginX) / sizeX;
    uvs[index * 2 + 1] = 1 - (positions[offset + 2] - options.uvOriginZ) / sizeZ;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, options.material);
  mesh.name = "grid-surface";
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * 只重算法线矩形内的顶点法线。
 *
 * 整个几何体 computeVertexNormals 要扫十几万三角形，刷地形时每次拖拽都做会卡；
 * 这里只累加矩形周围的四边形，再把受影响顶点归一化。
 */
function updateGridNormals(
  geometry: THREE.BufferGeometry,
  surface: GridSurface,
  rect: GridVertexRect,
): void {
  const attribute = geometry.getAttribute("normal") as THREE.BufferAttribute | undefined;
  if (!attribute) return;
  const normals = attribute.array as Float32Array;
  const positions = surface.positions;
  const cols = surface.cols;
  const rows = surface.rows;

  // 顶点法线取相邻四边形的面积加权和。矩形外扩一圈，边界顶点的法线也要重算。
  const i0 = Math.max(0, rect.i0 - 1);
  const j0 = Math.max(0, rect.j0 - 1);
  const i1 = Math.min(cols - 1, rect.i1 + 1);
  const j1 = Math.min(rows - 1, rect.j1 + 1);
  for (let row = j0; row <= j1; row += 1) {
    const base = row * cols * 3;
    for (let col = i0; col <= i1; col += 1) {
      const offset = base + col * 3;
      normals[offset] = 0;
      normals[offset + 1] = 0;
      normals[offset + 2] = 0;
    }
  }

  const quadX0 = Math.max(0, i0 - 1);
  const quadZ0 = Math.max(0, j0 - 1);
  const quadX1 = Math.min(cols - 2, i1);
  const quadZ1 = Math.min(rows - 2, j1);
  for (let row = quadZ0; row <= quadZ1; row += 1) {
    for (let col = quadX0; col <= quadX1; col += 1) {
      const a = (row * cols + col) * 3;
      const b = a + cols * 3;
      const c = a + 3;
      const d = c + cols * 3;
      // 三角形 (a, b, c)：b 在南、c 在东，叉乘朝上。
      const abx = positions[b] - positions[a];
      const aby = positions[b + 1] - positions[a + 1];
      const abz = positions[b + 2] - positions[a + 2];
      const acx = positions[c] - positions[a];
      const acy = positions[c + 1] - positions[a + 1];
      const acz = positions[c + 2] - positions[a + 2];
      const n1x = aby * acz - abz * acy;
      const n1y = abz * acx - abx * acz;
      const n1z = abx * acy - aby * acx;
      // 三角形 (c, b, d)。
      const cbx = positions[b] - positions[c];
      const cby = positions[b + 1] - positions[c + 1];
      const cbz = positions[b + 2] - positions[c + 2];
      const cdx = positions[d] - positions[c];
      const cdy = positions[d + 1] - positions[c + 1];
      const cdz = positions[d + 2] - positions[c + 2];
      const n2x = cby * cdz - cbz * cdy;
      const n2y = cbz * cdx - cbx * cdz;
      const n2z = cbx * cdy - cby * cdx;

      // 只往重算矩形里的顶点累加：矩形外的法线没有清零，写进去会把好法线弄脏。
      if (col >= i0 && col <= i1 && row >= j0 && row <= j1) {
        normals[a] += n1x;
        normals[a + 1] += n1y;
        normals[a + 2] += n1z;
      }
      if (col >= i0 && col <= i1 && row + 1 >= j0 && row + 1 <= j1) {
        normals[b] += n1x + n2x;
        normals[b + 1] += n1y + n2y;
        normals[b + 2] += n1z + n2z;
      }
      if (col + 1 >= i0 && col + 1 <= i1 && row >= j0 && row <= j1) {
        normals[c] += n1x + n2x;
        normals[c + 1] += n1y + n2y;
        normals[c + 2] += n1z + n2z;
      }
      if (col + 1 >= i0 && col + 1 <= i1 && row + 1 >= j0 && row + 1 <= j1) {
        normals[d] += n2x;
        normals[d + 1] += n2y;
        normals[d + 2] += n2z;
      }
    }
  }

  for (let row = j0; row <= j1; row += 1) {
    const base = row * cols * 3;
    for (let col = i0; col <= i1; col += 1) {
      const offset = base + col * 3;
      const x = normals[offset];
      const y = normals[offset + 1];
      const z = normals[offset + 2];
      const length = Math.hypot(x, y, z) || 1;
      normals[offset] = x / length;
      normals[offset + 1] = y / length;
      normals[offset + 2] = z / length;
    }
  }
  attribute.needsUpdate = true;
}

/** 地形高度局部变化后刷新网格：只动高度、法线和草岩扰动。 */
export function updateGridTerrainRegion(
  mesh: THREE.Mesh,
  surface: GridSurface,
  rect: GridVertexRect,
): void {
  const geometry = mesh.geometry;
  (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  (geometry.getAttribute("aRockDither") as THREE.BufferAttribute).needsUpdate = true;
  updateGridNormals(geometry, surface, rect);
  geometry.computeBoundingSphere();
}
