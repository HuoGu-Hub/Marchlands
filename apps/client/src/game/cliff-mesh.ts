import * as THREE from "three";
import type { NavGrid } from "@marchlands/nav";

export interface CliffMeshOptions {
  readonly navGrid: NavGrid;
  readonly size: [number, number];
  /** 高差超过这个值就当作陡壁，厘米。 */
  readonly thresholdCm?: number;
}

/**
 * 给陡壁补一层竖直面：地形高度场在格与格之间是斜的，
 * 补上这层之后，高差大的地方才看得出来是一道坎，而不是一段缓坡。
 */
export function buildCliffMesh(options: CliffMeshOptions): THREE.Mesh | null {
  const { navGrid, size } = options;
  const threshold = options.thresholdCm ?? 100;
  const cellM = navGrid.cellSizeCm / 100;
  const halfX = size[0] / 20;
  const halfZ = size[1] / 20;
  const width = navGrid.width;
  const height = navGrid.height;

  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const low = new THREE.Color(0x4a4438);
  const high = new THREE.Color(0x8a8272);

  const pushWall = (
    ax: number,
    az: number,
    bx: number,
    bz: number,
    hLow: number,
    hHigh: number,
  ): void => {
    if (hHigh - hLow < threshold) return;
    const bottom = hLow / 100;
    const top = hHigh / 100;
    const base = positions.length / 3;
    positions.push(ax, bottom, az);
    positions.push(bx, bottom, bz);
    positions.push(bx, top, bz);
    positions.push(ax, top, az);
    // 上亮下暗，陡壁才有体积感。
    colors.push(low.r, low.g, low.b);
    colors.push(low.r, low.g, low.b);
    colors.push(high.r, high.g, high.b);
    colors.push(high.r, high.g, high.b);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const here = navGrid.heightCm(index);
      // 向右和向下两条边各检查一次，避免重复生成。
      if (x + 1 < width) {
        const right = navGrid.heightCm(z * width + x + 1);
        const edgeX = (x + 1) * cellM - halfX;
        const z0 = z * cellM - halfZ;
        const z1 = (z + 1) * cellM - halfZ;
        if (Math.abs(right - here) >= threshold) {
          pushWall(edgeX, z0, edgeX, z1, Math.min(here, right), Math.max(here, right));
        }
      }
      if (z + 1 < height) {
        const down = navGrid.heightCm((z + 1) * width + x);
        const edgeZ = (z + 1) * cellM - halfZ;
        const x0 = x * cellM - halfX;
        const x1 = (x + 1) * cellM - halfX;
        if (Math.abs(down - here) >= threshold) {
          pushWall(x0, edgeZ, x1, edgeZ, Math.min(here, down), Math.max(here, down));
        }
      }
    }
  }

  if (positions.length === 0) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "cliff-walls";
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
