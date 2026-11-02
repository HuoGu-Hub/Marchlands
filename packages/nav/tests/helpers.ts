import { NavGrid, type NavGridData, type NavRules } from "../src";

export interface GridSpec {
  readonly width: number;
  readonly height: number;
  readonly cellSizeCm?: number;
  readonly heightAt?: (x: number, z: number) => number;
  readonly surface?: (x: number, z: number) => number;
  readonly blocked?: ReadonlyArray<readonly [number, number]>;
  readonly override?: ReadonlyArray<readonly [number, number]>;
  readonly rules?: Partial<NavRules>;
}

export function makeGrid(spec: GridSpec): NavGrid {
  const width = spec.width;
  const height = spec.height;
  const count = width * height;
  const heightCm = new Int16Array(count);
  const surface = new Uint8Array(count);
  const blocked = new Uint8Array(count);
  const walkableOverride = new Uint8Array(count);

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      heightCm[index] = spec.heightAt ? spec.heightAt(x, z) : 0;
      surface[index] = spec.surface ? spec.surface(x, z) : 0;
    }
  }
  for (const cell of spec.blocked ?? []) blocked[cell[1] * width + cell[0]] = 1;
  for (const cell of spec.override ?? []) walkableOverride[cell[1] * width + cell[0]] = 1;

  const data: NavGridData = {
    width,
    height,
    cellSizeCm: spec.cellSizeCm ?? 100,
    heightCm,
    surface,
    blocked,
    walkableOverride,
    rules: spec.rules,
  };
  return new NavGrid(data);
}
