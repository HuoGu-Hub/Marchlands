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
  /** 据点位置与院落半径，米；用来在地表上画一圈泥地，代替原来的圆盘。 */
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

function mixChannel(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function rgb(color: number): [number, number, number] {
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255];
}

/**
 * 把地表画成一张贴图：草地、土路、陡坡岩石和石路都在同一张图上，
 * 路面和地面本来就是一块，不会出现接缝，也不用额外铺路面网格。
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

  const offsetX = size[0] * 5;
  const offsetZ = size[1] * 5;
  const grass = rgb(palette.grass);
  const grassLight = rgb(palette.grassLight);
  const dirt = rgb(palette.dirt);
  const rock = rgb(palette.rock);
  const rockDark = rgb(palette.rockDark);

  const heightAt = (xm: number, zm: number): number =>
    navGrid.heightCmAtXZ(Math.round(xm * 100 + offsetX), Math.round(zm * 100 + offsetZ)) / 100;

  // 像素级道路距离场：先把道路格铺到像素上，再做两遍倒角距离变换，
  // 这样路面边缘是按像素过渡的，不会跟着一米一格走成台阶。
  const roadPixels = new Uint8Array(width * height);
  for (let py = 0; py < height; py += 1) {
    const z = (py + 0.5) / perMeter - depthMeters / 2;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / perMeter - widthMeters / 2;
      const surface = navGrid.surfaceAtXZ(Math.round(x * 100 + offsetX), Math.round(z * 100 + offsetZ));
      roadPixels[py * width + px] = surface === Surface.Road || surface === Surface.Bridge ? 1 : 0;
    }
  }
  // 道路遮罩做几遍模糊来软化边缘：距离场在斜边上会有条带，
  // 模糊过的二值遮罩不会有这种深浅斑块。
  const maskRadius = Math.max(2, Math.round(perMeter * 0.35));
  let mask = Float32Array.from(roadPixels);
  for (let pass = 0; pass < 2; pass += 1) {
    const next = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        let count = 0;
        for (let dy = -maskRadius; dy <= maskRadius; dy += 1) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -maskRadius; dx <= maskRadius; dx += 1) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            sum += mask[ny * width + nx];
            count += 1;
          }
        }
        next[y * width + x] = sum / count;
      }
    }
    mask = next;
  }

  const yards = options.yards ?? [];
  for (let py = 0; py < height; py += 1) {
    const z = (py + 0.5) / perMeter - depthMeters / 2;
    for (let px = 0; px < width; px += 1) {
      const x = (px + 0.5) / perMeter - widthMeters / 2;
      // 据点院落：把建筑周围压成一片泥土地，边缘柔和过渡到草地。
      let yard = 0;
      for (const entry of yards) {
        const distance = Math.hypot(x - entry.x, z - entry.z);
        if (distance > entry.radius) continue;
        yard = Math.max(yard, Math.min(1, (entry.radius - distance) / 0.6));
      }
      const slope = Math.abs(heightAt(x + 0.5, z) - heightAt(x - 0.5, z));
      const grade = slope / 1;

      // 草地底色：两层噪声拉开明暗，避免大片纯色。
      const broad = valueNoise(x / 7.5, z / 7.5);
      const fine = valueNoise(x / 1.6, z / 1.6);
      let r = mixChannel(grass[0], grassLight[0], broad * 0.55 + fine * 0.25);
      let g = mixChannel(grass[1], grassLight[1], broad * 0.55 + fine * 0.25);
      let b = mixChannel(grass[2], grassLight[2], broad * 0.55 + fine * 0.25);
      const darken = 1 - (1 - broad) * 0.35;
      r *= darken;
      g *= darken;
      b *= darken;

      // 土斑：低频噪声的少数区域。
      const patch = valueNoise(x / 11 + 3.7, z / 11 - 1.3);
      if (patch > 0.62) {
        const t = Math.min(1, (patch - 0.62) / 0.16);
        r = mixChannel(r, dirt[0], t * 0.8);
        g = mixChannel(g, dirt[1], t * 0.8);
        b = mixChannel(b, dirt[2], t * 0.8);
      }

      // 陡坡露岩。
      if (grade > 0.3) {
        const t = Math.min(1, (grade - 0.3) / 0.45);
        const tone = valueNoise(x / 2.2, z / 2.2);
        const rockColor = tone > 0.5 ? rock : rockDark;
        r = mixChannel(r, rockColor[0], t);
        g = mixChannel(g, rockColor[1], t);
        b = mixChannel(b, rockColor[2], t);
      }

      // 石路：石块铺在格子坐标上，边缘按像素距离淡出。
      const weight = Math.max(0, Math.min(1, mask[py * width + px] * 2.2));
      if (weight > 0.01) {
        const stone = 0.62;
        const sx = Math.floor(x / stone);
        const sz = Math.floor(z / stone);
        const fx = x / stone - sx;
        const fz = z / stone - sz;
        const jitter = hash2(sx, sz);
        const wobble = (valueNoise(x / 0.35, z / 0.35) - 0.5) * 0.08;
        const edge = Math.min(fx, fz, 1 - fx, 1 - fz) + wobble;
        const mortar = edge < 0.05 ? 0.42 : edge < 0.11 ? 0.74 : 1;
        const shade = 0.78 + jitter * 0.38;
        const grit = valueNoise(x / 1.1, z / 1.1) * 0.22;
        const roadR = 188 * shade * mortar * (0.84 + grit);
        const roadG = 176 * shade * mortar * (0.84 + grit);
        const roadB = 154 * shade * mortar * (0.84 + grit);
        r = mixChannel(r, roadR, weight);
        g = mixChannel(g, roadG, weight);
        b = mixChannel(b, roadB, weight);
      }

      if (yard > 0) {
        const grit = valueNoise(x / 0.8, z / 0.8) * 0.16;
        r = mixChannel(r, 122 * (0.88 + grit), yard);
        g = mixChannel(g, 108 * (0.88 + grit), yard);
        b = mixChannel(b, 84 * (0.88 + grit), yard);
      }

      const index = (py * width + px) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
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
