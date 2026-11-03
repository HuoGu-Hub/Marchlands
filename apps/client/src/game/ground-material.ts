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
