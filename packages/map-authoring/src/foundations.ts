import type { FoundationDraft, MapDocument } from "./types";

/** 单块地基的最小边长，分米。 */
export const MIN_FOUNDATION_SIZE_DM = 100;
/** 单块地基的最大边长，分米。 */
export const MAX_FOUNDATION_SIZE_DM = 4000;
/** 新建地基的默认边长，分米。 */
export const DEFAULT_FOUNDATION_SIZE_DM = 700;
/** 拖拽地基时的吸附步长，分米。 */
export const FOUNDATION_SNAP_DM = 5;

export interface FoundationBoundsDm {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function foundationRect(foundation: FoundationDraft): FoundationBoundsDm {
  const halfW = foundation.size[0] / 2;
  const halfH = foundation.size[1] / 2;
  return {
    minX: foundation.pos[0] - halfW,
    maxX: foundation.pos[0] + halfW,
    minZ: foundation.pos[1] - halfH,
    maxZ: foundation.pos[1] + halfH,
  };
}

export function foundationBounds(foundations: ReadonlyArray<FoundationDraft>): FoundationBoundsDm | null {
  if (foundations.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const foundation of foundations) {
    const rect = foundationRect(foundation);
    minX = Math.min(minX, rect.minX);
    maxX = Math.max(maxX, rect.maxX);
    minZ = Math.min(minZ, rect.minZ);
    maxZ = Math.max(maxZ, rect.maxZ);
  }
  return { minX, maxX, minZ, maxZ };
}

/** 地图可编辑范围：有地基时取地基并集，否则回退到以原点为中心的地图尺寸。 */
export function documentBounds(document: MapDocument): FoundationBoundsDm {
  const bounds = foundationBounds(document.visual.foundations);
  if (bounds) return bounds;
  return {
    minX: -document.size[0] / 2,
    maxX: document.size[0] / 2,
    minZ: -document.size[1] / 2,
    maxZ: document.size[1] / 2,
  };
}

export function foundationContains(foundation: FoundationDraft, x: number, z: number): boolean {
  const rect = foundationRect(foundation);
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** 找到覆盖该点、且顶面最高的地基。 */
export function foundationAt(foundations: ReadonlyArray<FoundationDraft>, x: number, z: number): FoundationDraft | null {
  let best: FoundationDraft | null = null;
  for (const foundation of foundations) {
    if (!foundationContains(foundation, x, z)) continue;
    if (!best || foundation.elevation > best.elevation) best = foundation;
  }
  return best;
}

export function foundationDepth(foundation: FoundationDraft): number {
  if (foundation.depth !== undefined) return foundation.depth;
  const halfX = foundation.size[0] / 20;
  const halfZ = foundation.size[1] / 20;
  return Math.min(38, Math.max(14, Math.hypot(halfX, halfZ) * 0.24));
}

export function nextFoundationId(foundations: ReadonlyArray<FoundationDraft>): string {
  const used = new Set(foundations.map((foundation) => foundation.id));
  let next = 1;
  while (used.has("f" + String(next))) next += 1;
  return "f" + String(next);
}

export interface FoundationInput {
  pos?: [number, number];
  size?: [number, number];
  elevation?: number;
  depth?: number;
  assetId?: string;
  scale?: number;
  rotation?: number;
  id?: string;
}

export function createFoundation(
  foundations: ReadonlyArray<FoundationDraft>,
  input: FoundationInput = {},
): FoundationDraft {
  const size: [number, number] = [
    clampSize(input.size?.[0] ?? DEFAULT_FOUNDATION_SIZE_DM),
    clampSize(input.size?.[1] ?? DEFAULT_FOUNDATION_SIZE_DM),
  ];
  const used = new Set(foundations.map((foundation) => foundation.id));
  const id = input.id && !used.has(input.id) ? input.id : nextFoundationId(foundations);
  const halfX = size[0] / 20;
  const halfZ = size[1] / 20;
  return {
    id,
    pos: [Math.round(input.pos?.[0] ?? 0), Math.round(input.pos?.[1] ?? 0)],
    size,
    elevation: clampElevation(input.elevation ?? 0),
    depth: clampDepth(input.depth ?? Math.min(38, Math.max(14, Math.hypot(halfX, halfZ) * 0.24))),
    ...(input.assetId ? { assetId: input.assetId } : {}),
    scale: clampScale(input.scale ?? 1),
    rotation: clampRotation(input.rotation ?? 0),
  };
}

export function clampSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_FOUNDATION_SIZE_DM;
  return Math.max(MIN_FOUNDATION_SIZE_DM, Math.min(MAX_FOUNDATION_SIZE_DM, Math.round(value)));
}

export function clampElevation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-200, Math.min(400, Math.round(value * 100) / 100));
}

export function clampDepth(value: number): number {
  if (!Number.isFinite(value)) return 20;
  return Math.max(2, Math.min(200, Math.round(value * 100) / 100));
}

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0.01, Math.min(50, Math.round(value * 1000) / 1000));
}

export function clampRotation(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-3600, Math.min(3600, Math.round(value * 10) / 10));
}

/** 两块同高度地基如果并集仍是矩形，就合并成一块，避免接缝处出现双层地基。 */
export function mergeFoundationRects(foundations: ReadonlyArray<FoundationDraft>): FoundationDraft[] {
  let list = foundations.map((foundation) => ({ ...foundation, pos: [foundation.pos[0], foundation.pos[1]] as [number, number] }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let a = 0; a < list.length; a += 1) {
      for (let b = a + 1; b < list.length; b += 1) {
        const first = list[a];
        const second = list[b];
        if (Math.abs(first.elevation - second.elevation) > 0.001) continue;
        if ((first.assetId ?? "") !== (second.assetId ?? "")) continue;
        const merged = mergePair(first, second);
        if (!merged) continue;
        list = list.filter((_, index) => index !== a && index !== b);
        list.push(merged);
        changed = true;
        break outer;
      }
    }
  }
  return list;
}

function mergePair(first: FoundationDraft, second: FoundationDraft): FoundationDraft | null {
  const a = foundationRect(first);
  const b = foundationRect(second);
  const sameZ = Math.abs(a.minZ - b.minZ) < 0.5 && Math.abs(a.maxZ - b.maxZ) < 0.5;
  const sameX = Math.abs(a.minX - b.minX) < 0.5 && Math.abs(a.maxX - b.maxX) < 0.5;
  const touchX = Math.abs(a.maxX - b.minX) < 0.5 || Math.abs(b.maxX - a.minX) < 0.5;
  const touchZ = Math.abs(a.maxZ - b.minZ) < 0.5 || Math.abs(b.maxZ - a.minZ) < 0.5;
  let rect: FoundationBoundsDm | null = null;
  if (sameZ && touchX) {
    rect = {
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
      minZ: a.minZ,
      maxZ: a.maxZ,
    };
  } else if (sameX && touchZ) {
    rect = {
      minX: a.minX,
      maxX: a.maxX,
      minZ: Math.min(a.minZ, b.minZ),
      maxZ: Math.max(a.maxZ, b.maxZ),
    };
  } else if (contains(a, b) || contains(b, a)) {
    rect = {
      minX: Math.min(a.minX, b.minX),
      maxX: Math.max(a.maxX, b.maxX),
      minZ: Math.min(a.minZ, b.minZ),
      maxZ: Math.max(a.maxZ, b.maxZ),
    };
  }
  if (!rect) return null;
  const keep = first.assetId ? first : second;
  return {
    id: keep.id,
    pos: [(rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2],
    size: [rect.maxX - rect.minX, rect.maxZ - rect.minZ],
    elevation: keep.elevation,
    depth: keep.depth,
    ...(keep.assetId ? { assetId: keep.assetId } : {}),
    scale: keep.scale,
    rotation: keep.rotation,
  };
}

function contains(outer: FoundationBoundsDm, inner: FoundationBoundsDm): boolean {
  return (
    inner.minX >= outer.minX - 0.5 &&
    inner.maxX <= outer.maxX + 0.5 &&
    inner.minZ >= outer.minZ - 0.5 &&
    inner.maxZ <= outer.maxZ + 0.5
  );
}

export function overlapArea(first: FoundationDraft, second: FoundationDraft): number {
  const a = foundationRect(first);
  const b = foundationRect(second);
  const width = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const height = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return width > 0 && height > 0 ? width * height : 0;
}

/** 把地基并集同步成文档尺寸；网格地图的尺寸由网格决定，不改。 */
export function syncFoundationSize(document: MapDocument): MapDocument {
  if (document.navigation === "grid") return document;
  const bounds = foundationBounds(document.visual.foundations);
  if (!bounds) return document;
  const width = Math.max(MIN_FOUNDATION_SIZE_DM, Math.round(bounds.maxX - bounds.minX));
  const height = Math.max(MIN_FOUNDATION_SIZE_DM, Math.round(bounds.maxZ - bounds.minZ));
  if (width === document.size[0] && height === document.size[1]) return document;
  return { ...document, size: [width, height] };
}
