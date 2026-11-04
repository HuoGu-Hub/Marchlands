import * as THREE from "three";
import { customGroundMaterial } from "./custom-materials";

const URLS = import.meta.glob("../assets/materials/*/*.jpg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const cache = new Map<string, THREE.MeshStandardMaterial>();
const loader = new THREE.TextureLoader();

function load(path: string | undefined, colorSpace: boolean): THREE.Texture | null {
  if (!path) return null;
  const texture = loader.load(path);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  if (colorSpace) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * 预载地面贴图并写入缓存，供关卡封面截图等一次性渲染使用。
 * 正常对局不需要调用，地形会自己异步加载。
 */
export async function preloadGroundMaterial(name: string | undefined): Promise<void> {
  if (!name || name.startsWith("custom.")) return;
  const key = name.toLowerCase();
  if (cache.has(key)) return;
  const url = URLS[`../assets/materials/${key}/color.jpg`];
  if (!url) return;
  try {
    const texture = await loader.loadAsync(url);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    cache.set(key, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }));
  } catch {
    // 贴图缺失时地形退回顶点色
  }
}

export function groundMaterial(name: string | undefined): THREE.MeshStandardMaterial | null {
  if (!name) return null;
  if (name.startsWith("custom.")) return customGroundMaterial(name);
  const key = name.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  const base = `../assets/materials/${key}`;
  const map = load(URLS[`${base}/color.jpg`], true);
  if (!map) return null;
  const material = new THREE.MeshStandardMaterial({
    map,
    roughness: 0.95,
    metalness: 0,
  });
  cache.set(key, material);
  return material;
}

export const GROUND_MATERIALS = ["rocks007", "ground068", "snow014"] as const;
