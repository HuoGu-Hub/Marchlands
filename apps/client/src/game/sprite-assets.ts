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
  "builtin:unit.sprite-ranger": { file: "./sprites/frontier-ranger-boy-atlas", height: 0.92 },
  "builtin:unit.sprite-knight": { file: "./sprites/heavy-shield-knight-atlas", height: 1.55 },
};

const loaded = new Map<string, SpriteSkinAsset>();
let pending: Promise<void> | null = null;

/** 预加载全部序列帧资产。失败时对应皮肤回退程序化模型。 */
export function loadSpriteAssets(): Promise<void> {
  if (pending) return pending;
  pending = Promise.all(
    Object.entries(DEFINITIONS).map(async ([id, def]) => {
      try {
        const { atlas, texture } = await loadSpriteAtlas(def.file);
        loaded.set(id, { atlas, texture, height: def.height });
      } catch {
        // 资产缺失时保持未加载，场景会退回程序化小兵
      }
    }),
  ).then(() => undefined);
  return pending;
}

export function spriteAsset(id: string | null | undefined): SpriteSkinAsset | null {
  if (!id) return null;
  return loaded.get(id) ?? null;
}
