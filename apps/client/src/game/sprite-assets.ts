import * as THREE from "three";
import { loadSpriteAtlas } from "./sprite-unit";
import type { SpriteAtlasData } from "./sprite-unit";

/** 可直接用于兵团皮肤的序列帧资产。key 与 unit-skins 的资产 id 一致。 */
export interface SpriteSkinAsset {
  atlas: SpriteAtlasData;
  texture: THREE.Texture;
  /** 世界体高，米。 */
  height: number;
}

const DEFINITIONS: Record<string, { file: string; height: number }> = {
  "builtin:unit.sprite-ranger": { file: "./sprites/frontier-ranger-boy-walk-atlas", height: 0.92 },
  "builtin:unit.sprite-knight": { file: "./sprites/heavy-shield-knight-atlas", height: 1.55 },
};

const loaded = new Map<string, SpriteSkinAsset>();
const loads = new Map<string, Promise<SpriteSkinAsset | null>>();

/** 只加载当前对局真正使用的序列帧皮肤，避免把没用到的图集也读进来。 */
export function loadSpriteAsset(id: string): Promise<SpriteSkinAsset | null> {
  const existing = loaded.get(id);
  if (existing) return Promise.resolve(existing);
  const pending = loads.get(id);
  if (pending) return pending;
  const def = DEFINITIONS[id];
  if (!def) return Promise.resolve(null);
  const load = loadSpriteAtlas(def.file)
    .then(({ atlas, texture }) => {
      const asset: SpriteSkinAsset = { atlas, texture, height: def.height };
      loaded.set(id, asset);
      return asset;
    })
    .catch(() => null)
    .finally(() => {
      loads.delete(id);
    });
  loads.set(id, load);
  return load;
}

export function isSpriteAsset(id: string | null | undefined): boolean {
  return !!id && id in DEFINITIONS;
}

export function spriteAsset(id: string | null | undefined): SpriteSkinAsset | null {
  if (!id) return null;
  return loaded.get(id) ?? null;
}
