import * as THREE from "three";
import type { GridSurface } from "@marchlands/map-authoring";

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
  const count = positions.length / 3;
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
