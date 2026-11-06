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
  // 二三十像素一米已经够用：近景由细节层的三平面贴图负责。
  // 上限从 4096 收到 2560，地表烘焙的像素数减少四成，画质几乎看不出差别。
  const perMeter = Math.min(options.pixelsPerMeter ?? 32, Math.floor(2560 / Math.max(widthMeters, depthMeters)));
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

  // 每个像素只算一次双线性权重，颜色、道路遮罩和院落遮罩共用。
  // 旧实现每个像素要调四次闭包函数、每个通道各算一遍坐标，是烘焙慢的主因。
  const invPixelCell = 1 / (perMeter * cellMeters);
  const x0Of = new Int32Array(width);
  const x1Of = new Int32Array(width);
  const txOf = new Float32Array(width);
  for (let px = 0; px < width; px += 1) {
    const fx = (px + 0.5) * invPixelCell - 0.5;
    const x0 = Math.max(0, Math.min(cellW - 1, Math.floor(fx)));
    x0Of[px] = x0;
    x1Of[px] = Math.min(cellW - 1, x0 + 1);
    txOf[px] = Math.max(0, Math.min(1, fx - x0));
  }
  const z0Of = new Int32Array(height);
  const z1Of = new Int32Array(height);
  const tzOf = new Float32Array(height);
  for (let py = 0; py < height; py += 1) {
    const fz = (py + 0.5) * invPixelCell - 0.5;
    const z0 = Math.max(0, Math.min(cellH - 1, Math.floor(fz)));
    z0Of[py] = z0;
    z1Of[py] = Math.min(cellH - 1, z0 + 1);
    tzOf[py] = Math.max(0, Math.min(1, fz - z0));
  }
  const hasMask = cellMask.some((value) => value > 0.02);
  const hasYard = cellYard.some((value) => value > 0.001);

  for (let py = 0; py < height; py += 1) {
    const z = (py + 0.5) / perMeter - depthMeters / 2;
    const z0 = z0Of[py];
    const z1 = z1Of[py];
    const tz = tzOf[py];
    const row0 = z0 * cellW;
    const row1 = z1 * cellW;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / perMeter - widthMeters / 2;
      const x0 = x0Of[px];
      const x1 = x1Of[px];
      const tx = txOf[px];
      const i00 = row0 + x0;
      const i10 = row0 + x1;
      const i01 = row1 + x0;
      const i11 = row1 + x1;
      const w00 = (1 - tx) * (1 - tz);
      const w10 = tx * (1 - tz);
      const w01 = (1 - tx) * tz;
      const w11 = tx * tz;

      const c00 = i00 * 3;
      const c10 = i10 * 3;
      const c01 = i01 * 3;
      const c11 = i11 * 3;
      let r = cellColor[c00] * w00 + cellColor[c10] * w10 + cellColor[c01] * w01 + cellColor[c11] * w11;
      let g = cellColor[c00 + 1] * w00 + cellColor[c10 + 1] * w10 + cellColor[c01 + 1] * w01 + cellColor[c11 + 1] * w11;
      let b = cellColor[c00 + 2] * w00 + cellColor[c10 + 2] * w10 + cellColor[c01 + 2] * w01 + cellColor[c11 + 2] * w11;

      let weight = 0;
      if (hasMask) {
        const mask = cellMask[i00] * w00 + cellMask[i10] * w10 + cellMask[i01] * w01 + cellMask[i11] * w11;
        weight = Math.max(0, Math.min(1, (mask - 0.22) / 0.5));
      }
      if (weight > 0.01) {
        const stone = 0.62;
        const sx = Math.floor(x / stone);
        const sz = Math.floor(z / stone);
        const fx = x / stone - sx;
        const fz = z / stone - sz;
        const edge = Math.min(fx, fz, 1 - fx, 1 - fz);
        const mortar = edge < 0.05 ? 0.42 : edge < 0.11 ? 0.74 : 1;
        const shade = 0.78 + hash2(sx, sz) * 0.38;
        const grit = hash2(px, py) * 0.18;
        const tone = shade * mortar * (0.84 + grit);
        r = r + (188 * tone - r) * weight;
        g = g + (176 * tone - g) * weight;
        b = b + (154 * tone - b) * weight;
      }

      // 院落压在路面之上：据点那一圈泥地不会被石路盖住。
      if (hasYard && cellYard[i00] + cellYard[i10] + cellYard[i01] + cellYard[i11] > 0.001) {
        const yard = Math.max(
          0,
          Math.min(1, cellYard[i00] * w00 + cellYard[i10] * w10 + cellYard[i01] * w01 + cellYard[i11] * w11),
        );
        if (yard > 0.01) {
          const grit = hash2(px * 7 + 11, py * 13 + 5) * 0.14;
          const target = 122 * (0.88 + grit);
          r = r + (target - r) * yard;
          g = g + (108 * (0.88 + grit) - g) * yard;
          b = b + (84 * (0.88 + grit) - b) * yard;
        }
      }

      // 一格一米的底色插值后很平滑，加一点逐像素噪点找回颗粒感。
      let hash = Math.imul((px * 3 + 7) | 0, 374761393) ^ Math.imul((py * 5 + 13) | 0, 668265263);
      hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
      const grain = (((hash ^ (hash >>> 16)) >>> 0) / 4294967296 - 0.5) * 9;
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
