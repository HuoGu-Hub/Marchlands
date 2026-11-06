import * as THREE from "three";
import type { GridSurface, GridSurfaceWall } from "@marchlands/map-authoring";

/**
 * 把网格地形显示面转成 three 网格：顶面一张，陡壁墙面一张。
 * 顶面的顶点由 terrain-surface 按"同侧共点"生成，陡壁处天然断开。
 */

export interface GridTerrainOptions {
  readonly topMaterial: THREE.Material;
  readonly cliffMaterial: THREE.Material;
  /** 宏观贴图在整张地图上的 UV 范围，米。 */
  readonly uvOriginX: number;
  readonly uvOriginZ: number;
  readonly uvSizeX: number;
  readonly uvSizeZ: number;
}

export interface GridTerrainMeshes {
  readonly top: THREE.Mesh;
  readonly cliffs: THREE.Mesh | null;
}

function wallTone(wall: GridSurfaceWall): number {
  let hash =
    Math.imul(Math.round(wall.ax * 100) | 0, 374761393) ^
    Math.imul(Math.round(wall.az * 100) | 0, 668265263);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function buildTopGeometry(surface: GridSurface, options: GridTerrainOptions): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = surface.positions;
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const count = positions.length / 3;
  const uvs = new Float32Array(count * 2);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    uvs[index * 2] = (positions[offset] - options.uvOriginX) / Math.max(1e-6, options.uvSizeX);
    uvs[index * 2 + 1] = 1 - (positions[offset + 2] - options.uvOriginZ) / Math.max(1e-6, options.uvSizeZ);
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function buildCliffGeometry(walls: readonly GridSurfaceWall[]): THREE.BufferGeometry | null {
  if (walls.length === 0) return null;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // 同一格角上相邻墙段的法线取平均，圆形台地的崖面才不会一格一格地明暗跳。
  const endpointNormal = new Map<string, { x: number; z: number }>();
  const endpointKey = (x: number, z: number): string => Math.round(x * 100) + ":" + Math.round(z * 100);
  for (const wall of walls) {
    for (const [x, z] of [
      [wall.ax, wall.az],
      [wall.bx, wall.bz],
    ]) {
      const key = endpointKey(x, z);
      const entry = endpointNormal.get(key) ?? { x: 0, z: 0 };
      entry.x += wall.nx;
      entry.z += wall.nz;
      endpointNormal.set(key, entry);
    }
  }
  const smoothNormal = (x: number, z: number): { x: number; z: number } => {
    const entry = endpointNormal.get(endpointKey(x, z)) ?? { x: 0, z: 1 };
    const length = Math.hypot(entry.x, entry.z) || 1;
    return { x: entry.x / length, z: entry.z / length };
  };

  for (const wall of walls) {
    // 墙段两端共用格角的顶/底高度，相邻墙段完全对齐。
    const normalA = smoothNormal(wall.ax, wall.az);
    const normalB = smoothNormal(wall.bx, wall.bz);
    const normal = new THREE.Vector3(
      (normalA.x + normalB.x) / 2,
      0.45,
      (normalA.z + normalB.z) / 2,
    ).normalize();
    const tone = 0.97 + wallTone(wall) * 0.05;
    const shadeAt = (y: number, bottom: number, top: number): number => {
      const t = top - bottom < 1e-4 ? 1 : (y - bottom) / (top - bottom);
      return tone * (0.68 + 0.32 * t);
    };

    const quad = [
      { x: wall.ax, y: wall.top0, z: wall.az, shade: shadeAt(wall.top0, wall.bottom0, wall.top0) },
      { x: wall.ax, y: wall.bottom0, z: wall.az, shade: shadeAt(wall.bottom0, wall.bottom0, wall.top0) },
      { x: wall.bx, y: wall.bottom1, z: wall.bz, shade: shadeAt(wall.bottom1, wall.bottom1, wall.top1) },
      { x: wall.bx, y: wall.top1, z: wall.bz, shade: shadeAt(wall.top1, wall.bottom1, wall.top1) },
    ];
    const e1x = quad[1].x - quad[0].x;
    const e1y = quad[1].y - quad[0].y;
    const e1z = quad[1].z - quad[0].z;
    const e2x = quad[2].x - quad[0].x;
    const e2y = quad[2].y - quad[0].y;
    const e2z = quad[2].z - quad[0].z;
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const facing = cx * normal.x + cy * normal.y + cz * normal.z;
    const ring = facing >= 0 ? quad : [quad[0], quad[3], quad[2], quad[1]];

    const normalFor = (point: { x: number; y: number; z: number }): THREE.Vector3 => {
      const side = point.x === wall.ax && point.z === wall.az ? normalA : normalB;
      return new THREE.Vector3(side.x, 0.45, side.z).normalize();
    };
    const base = positions.length / 3;
    for (const point of ring) {
      positions.push(point.x, point.y, point.z);
      const pointNormal = normalFor(point);
      normals.push(pointNormal.x, pointNormal.y, pointNormal.z);
      colors.push(point.shade, point.shade, point.shade);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

export function buildGridTerrainMeshes(
  surface: GridSurface,
  options: GridTerrainOptions,
): GridTerrainMeshes {
  const top = new THREE.Mesh(buildTopGeometry(surface, options), options.topMaterial);
  top.name = "grid-surface";
  top.receiveShadow = true;
  top.castShadow = false;

  const cliffGeometry = buildCliffGeometry(surface.walls);
  const cliffs = cliffGeometry ? new THREE.Mesh(cliffGeometry, options.cliffMaterial) : null;
  if (cliffs) {
    cliffs.name = "grid-cliffs";
    cliffs.receiveShadow = false;
    cliffs.castShadow = false;
  }
  return { top, cliffs };
}