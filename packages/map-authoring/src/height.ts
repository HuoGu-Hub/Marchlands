import type { TerrainDraft } from "./types";

export interface HeightFieldOptions {
  cities: Array<[number, number]>;
  terrain: Pick<TerrainDraft, "seed" | "amplitude"> & { style?: TerrainDraft["style"] };
}

export interface HeightField {
  heightAt(x: number, z: number): number;
}

const CITY_PAD = 4.2;
const CITY_FADE = 7.4;

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth(x - ix);
  const fz = smooth(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createHeightField(options: HeightFieldOptions): HeightField {
  const amplitude = Math.min(3.2, Math.max(0.2, options.terrain.amplitude));
  const noiseShift = (Math.round(options.terrain.seed) % 1000) * 0.017;
  const cities = options.cities;

  return {
    heightAt(x: number, z: number): number {
      let cityFade = 1;
      for (const [cx, cz] of cities) {
        const distance = Math.hypot(x - cx, z - cz);
        cityFade = Math.min(cityFade, smoothstep(CITY_PAD, CITY_FADE, distance));
      }
      const broad =
        valueNoise(x / 13 + noiseShift, z / 13 - noiseShift, 17) * 1.25 +
        valueNoise(x / 5.5 - noiseShift, z / 5.5 + noiseShift, 31) * 0.34;
      const ridge = Math.max(0, valueNoise(x / 9 + noiseShift, z / 9, 71) - 0.5) * 1.7;
      return Math.max(0, (broad - 0.32 + ridge) * cityFade * amplitude);
    },
  };
}

export function edgeGrade(
  field: HeightField,
  fromWorld: [number, number],
  toWorld: [number, number],
  lengthDm: number,
): number {
  const samples = 9;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < samples; index += 1) {
    const t = index / (samples - 1);
    const x = fromWorld[0] + (toWorld[0] - fromWorld[0]) * t;
    const z = fromWorld[1] + (toWorld[1] - fromWorld[1]) * t;
    const height = field.heightAt(x, z);
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  const run = Math.max(0.1, lengthDm / 10);
  return Math.min(1, Math.max(0, (max - min) / run));
}