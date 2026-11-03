import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { buildAssetPack } from "@marchlands/asset-pack";
import type { AssetKind, AssetManifest } from "@marchlands/asset-pack";

export interface ObjImportResult {
  bytes: Uint8Array;
  manifest: AssetManifest;
  assetId: string;
  fileName: string;
  label: string;
  footprint: number;
  height: number;
}

function baseName(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function slug(value: string): string {
  const result = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return result || "model";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForTextures(manager: THREE.LoadingManager): Promise<void> {
  return new Promise((resolve) => {
    const done = () => resolve();
    manager.onLoad = done;
    manager.onError = done;
    const total = (manager as unknown as { itemsTotal?: number }).itemsTotal ?? 0;
    const loaded = (manager as unknown as { itemsLoaded?: number }).itemsLoaded ?? 0;
    if (total <= loaded) resolve();
  });
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function mapTextures(material: THREE.Material): THREE.Texture[] {
  const source = material as unknown as Record<string, unknown>;
  const textures: THREE.Texture[] = [];
  for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "alphaMap"]) {
    const value = source[key];
    if (value instanceof THREE.Texture) textures.push(value);
  }
  return textures;
}

function prepareModel(object: THREE.Object3D): void {
  const fallback = new THREE.MeshStandardMaterial({ color: 0xc9c1b0, roughness: 0.9 });
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.material || (Array.isArray(mesh.material) && mesh.material.length === 0)) {
      mesh.material = fallback;
      return;
    }
    for (const material of materialList(mesh.material)) {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhongMaterial) {
        const standard = material as THREE.MeshStandardMaterial;
        for (const texture of mapTextures(material)) texture.colorSpace = THREE.SRGBColorSpace;
        if (standard.side === THREE.FrontSide) standard.side = THREE.DoubleSide;
        standard.needsUpdate = true;
      }
    }
  });
}

function normalizeModel(object: THREE.Object3D, kind: AssetKind): { footprint: number; height: number } {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (!Number.isFinite(size.x) || !Number.isFinite(size.y) || !Number.isFinite(size.z)) {
    throw new Error("模型没有有效尺寸");
  }
  if (size.x + size.y + size.z <= 0.0001) throw new Error("模型是空的");
  const anchorY = kind === "foundation" ? box.max.y : box.min.y;
  object.position.set(object.position.x - center.x, object.position.y - anchorY, object.position.z - center.z);
  object.updateMatrixWorld(true);
  return {
    footprint: Math.max(0.1, Math.round(Math.max(size.x, size.z) * 100) / 100),
    height: Math.max(0.1, Math.round(size.y * 100) / 100),
  };
}

async function exportGlb(object: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      object,
      (output) => {
        if (output instanceof ArrayBuffer) resolve(output);
        else reject(new Error("GLTF 导出没有返回二进制数据"));
      },
      (error) => reject(error instanceof Error ? error : new Error(String(error))),
      { binary: true, embedImages: true, animations: [] },
    );
  });
}

export async function convertObjToPack(files: File[], kind: AssetKind): Promise<ObjImportResult> {
  const objFile = files.find((file) => /\.obj$/i.test(file.name));
  const mtlFile = files.find((file) => /\.mtl$/i.test(file.name));
  if (!objFile) throw new Error("请选择 .obj 文件");

  const textureUrls = new Map<string, string>();
  const objectUrls: string[] = [];
  for (const file of files) {
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) continue;
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    textureUrls.set(baseName(file.name).toLowerCase(), url);
  }

  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    const clean = decodeURIComponent(url.split("?")[0]).replace(/\\/g, "/").split("/").pop();
    if (!clean) return url;
    return textureUrls.get(clean.toLowerCase()) ?? url;
  });

  try {
    let materials: ReturnType<MTLLoader["parse"]> | null = null;
    if (mtlFile) {
      const mtlLoader = new MTLLoader(manager);
      materials = mtlLoader.parse(await mtlFile.text(), "");
      materials.preload();
    }
    const objLoader = new OBJLoader(manager);
    if (materials) objLoader.setMaterials(materials);
    const object = objLoader.parse(await objFile.text());
    await waitForTextures(manager);
    prepareModel(object);
    const metrics = normalizeModel(object, kind);
    const glb = new Uint8Array(await exportGlb(object));

    const label = baseName(objFile.name).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "OBJ 模型";
    const slugName = slug(label);
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const packId = "local.obj." + stamp;
    const assetId = packId + ":" + slugName;
    const file = "models/" + slugName + ".glb";
    const manifest: AssetManifest = {
      format: "mlpack",
      version: 1,
      id: packId,
      name: "OBJ 导入 · " + label,
      description: "由 " + objFile.name + " 转换",
      assets: [
        {
          id: assetId,
          kind,
          label,
          file,
          scale: 1,
          rotation: 0,
          footprint: metrics.footprint,
          height: metrics.height,
          tags: ["OBJ导入"],
        },
      ],
    };
    const bytes = buildAssetPack(manifest, [{ name: file, data: glb }]);
    return {
      bytes,
      manifest,
      assetId,
      fileName: "OBJ-" + slugName + ".mlpack",
      label,
      footprint: metrics.footprint,
      height: metrics.height,
    };
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url);
  }
}
