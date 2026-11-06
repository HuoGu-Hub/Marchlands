import * as THREE from "three";
import { Surface } from "@marchlands/nav";
import type { NavGrid } from "@marchlands/nav";

export interface GroundPaintOptions {
  readonly navGrid: NavGrid;
  readonly size: [number, number];
  readonly palette: {
    grass: number;
    grassDark: number;
    grassLight: number;
    dirt: number;
    dirtLight: number;
    rock: number;
    rockDark: number;
  };
  /** 每米像素数，默认 32。 */
  readonly pixelsPerMeter?: number;
  /** 据点位置与院落半径，米；用来在地表上画一圈泥地，代替圆盘。 */
  readonly yards?: ReadonlyArray<{ x: number; z: number; radius: number }>;
}

function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgb(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

/**
 * 把地表画成一张贴图：草地、土斑、陡坡岩石、石路和据点院落都在同一张图上。
 *
 * 颜色按格计算再双线性采样，只有路面细节按像素画。
 * 全分辨率逐像素跑噪声要八秒多，按格算只要几百毫秒。
 */
export function paintGroundTexture(options: GroundPaintOptions): THREE.CanvasTexture {
  const { navGrid, size, palette } = options;
  const widthMeters = size[0] / 10;
  const depthMeters = size[1] / 10;
  const perMeter = Math.min(options.pixelsPerMeter ?? 32, Math.floor(4096 / Math.max(widthMeters, depthMeters)));
  const width = Math.max(64, Math.round(widthMeters * perMeter));
  const height = Math.max(64, Math.round(depthMeters * perMeter));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建地表贴图画布");
  const image = context.createImageData(width, height);
  const data = image.data;

  const cellSize = navGrid.cellSizeCm;
  const cellMeters = cellSize / 100;
  const cellW = Math.max(1, Math.ceil((size[0] * 10) / cellSize));
  const cellH = Math.max(1, Math.ceil((size[1] * 10) / cellSize));

  const grass = rgb(palette.grass);
  const grassLight = rgb(palette.grassLight);
  const dirt = rgb(palette.dirt);
  const rock = rgb(palette.rock);
  const rockDark = rgb(palette.rockDark);
  const yards = options.yards ?? [];

  // 按格算底色：草地明暗、土斑、陡坡岩石、院落泥地。
  const cellColor = new Float32Array(cellW * cellH * 3);
  const cellYard = new Float32Array(cellW * cellH);
  for (let cz = 0; cz < cellH; cz += 1) {
    const z = (cz + 0.5) * cellMeters - depthMeters / 2;
    for (let cx = 0; cx < cellW; cx += 1) {
      const x = (cx + 0.5) * cellMeters - widthMeters / 2;
      const index = cz * cellW + cx;
      const here = navGrid.heightCm(Math.min(navGrid.height - 1, cz) * navGrid.width + Math.min(navGrid.width - 1, cx));
      const right = navGrid.heightCm(Math.min(navGrid.height - 1, cz) * navGrid.width + Math.min(navGrid.width - 1, cx + 1));
      const down = navGrid.heightCm(Math.min(navGrid.height - 1, cz + 1) * navGrid.width + Math.min(navGrid.width - 1, cx));
      const grade = Math.max(Math.abs(right - here), Math.abs(down - here)) / cellSize;

      const broad = valueNoise(x / 7.5, z / 7.5);
      const fine = valueNoise(x / 1.6, z / 1.6);
      const shade = broad * 0.55 + fine * 0.25;
      let r = mix(grass[0], grassLight[0], shade);
      let g = mix(grass[1], grassLight[1], shade);
      let b = mix(grass[2], grassLight[2], shade);
      const darken = 1 - (1 - broad) * 0.35;
      r *= darken;
      g *= darken;
      b *= darken;

      const patch = valueNoise(x / 11 + 3.7, z / 11 - 1.3);
      if (patch > 0.62) {
        const t = Math.min(1, (patch - 0.62) / 0.16) * 0.8;
        r = mix(r, dirt[0], t);
        g = mix(g, dirt[1], t);
        b = mix(b, dirt[2], t);
      }

      if (grade > 0.3) {
        const t = Math.min(1, (grade - 0.3) / 0.45);
        const tone = valueNoise(x / 2.2, z / 2.2);
        const rockColor = tone > 0.5 ? rock : rockDark;
        r = mix(r, rockColor[0], t);
        g = mix(g, rockColor[1], t);
        b = mix(b, rockColor[2], t);
      }

      for (const entry of yards) {
        const dx = x - entry.x;
        const dz = z - entry.z;
        const distance = Math.hypot(dx, dz);
        if (distance > entry.radius * 1.5) continue;
        const wobble =
          valueNoise(entry.x * 0.6 + dx * 0.8, entry.z * 0.6 + dz * 0.8) * 0.6 +
          valueNoise(entry.x * 1.7 + dx * 2.1, entry.z * 1.7 + dz * 2.1) * 0.3;
        const radius = entry.radius * (0.74 + wobble * 0.62);
        if (distance > radius) continue;
        cellYard[index] = Math.max(cellYard[index], Math.min(1, (radius - distance) / 0.55));
      }

      cellColor[index * 3] = r;
      cellColor[index * 3 + 1] = g;
      cellColor[index * 3 + 2] = b;
    }
  }

  // 道路遮罩在格子分辨率上模糊，按像素双线性采样。
  let cellMask = new Float32Array(cellW * cellH);
  for (let cz = 0; cz < cellH; cz += 1) {
    for (let cx = 0; cx < cellW; cx += 1) {
      const surface = navGrid.surfaceAtXZ(Math.round((cx + 0.5) * cellSize), Math.round((cz + 0.5) * cellSize));
      cellMask[cz * cellW + cx] = surface === Surface.Road || surface === Surface.Bridge ? 1 : 0;
    }
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(cellMask.length);
    for (let cz = 0; cz < cellH; cz += 1) {
      for (let cx = 0; cx < cellW; cx += 1) {
        let sum = 0;
        let count = 0;
        for (let dz = -1; dz <= 1; dz += 1) {
          const nz = cz + dz;
          if (nz < 0 || nz >= cellH) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = cx + dx;
            if (nx < 0 || nx >= cellW) continue;
            sum += cellMask[nz * cellW + nx];
            count += 1;
          }
        }
        next[cz * cellW + cx] = sum / count;
      }
    }
    cellMask = next;
  }

  const sampleBilinear = (source: Float32Array, stride: number, xm: number, zm: number, channel = 0): number => {
    const fx = (xm + widthMeters / 2) / cellMeters - 0.5;
    const fz = (zm + depthMeters / 2) / cellMeters - 0.5;
    const x0 = Math.max(0, Math.min(cellW - 1, Math.floor(fx)));
    const z0 = Math.max(0, Math.min(cellH - 1, Math.floor(fz)));
    const x1 = Math.min(cellW - 1, x0 + 1);
    const z1 = Math.min(cellH - 1, z0 + 1);
    const tx = Math.max(0, Math.min(1, fx - x0));
    const tz = Math.max(0, Math.min(1, fz - z0));
    const a = source[(z0 * cellW + x0) * stride + channel];
    const b = source[(z0 * cellW + x1) * stride + channel];
    const c = source[(z1 * cellW + x0) * stride + channel];
    const d = source[(z1 * cellW + x1) * stride + channel];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };

  for (let py = 0; py < height; py += 1) {
    const z = (py + 0.5) / perMeter - depthMeters / 2;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / perMeter - widthMeters / 2;
      let r = sampleBilinear(cellColor, 3, x, z, 0);
      let g = sampleBilinear(cellColor, 3, x, z, 1);
      let b = sampleBilinear(cellColor, 3, x, z, 2);

      const weight = Math.max(0, Math.min(1, (sampleBilinear(cellMask, 1, x, z) - 0.22) / 0.5));
      if (weight > 0.01) {
        const stone = 0.62;
        const sx = Math.floor(x / stone);
        const sz = Math.floor(z / stone);
        const fx = x / stone - sx;
        const fz = z / stone - sz;
        const jitter = hash2(sx, sz);
        const edge = Math.min(fx, fz, 1 - fx, 1 - fz);
        const mortar = edge < 0.05 ? 0.42 : edge < 0.11 ? 0.74 : 1;
        const shade = 0.78 + jitter * 0.38;
        const grit = hash2(px, py) * 0.18;
        r = mix(r, 188 * shade * mortar * (0.84 + grit), weight);
        g = mix(g, 176 * shade * mortar * (0.84 + grit), weight);
        b = mix(b, 154 * shade * mortar * (0.84 + grit), weight);
      }

      // 院落压在路面之上：据点那一圈泥地不会被石路盖住。
      const yard = Math.max(0, Math.min(1, sampleBilinear(cellYard, 1, x, z)));
      if (yard > 0.01) {
        const grit = hash2(px * 7 + 11, py * 13 + 5) * 0.14;
        r = mix(r, 122 * (0.88 + grit), yard);
        g = mix(g, 108 * (0.88 + grit), yard);
        b = mix(b, 84 * (0.88 + grit), yard);
      }

      // 一格一米的底色插值后很平滑，加一点逐像素噪点找回颗粒感。
      const grain = (hash2(px * 3 + 7, py * 5 + 13) - 0.5) * 9;
      const index = (py * width + px) * 4;
      data[index] = r + grain;
      data[index + 1] = g + grain;
      data[index + 2] = b + grain;
      data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}
