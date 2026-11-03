import * as THREE from "three";

const DB_NAME = "marchlands.materials.v1";
const STORE = "materials";
const VERSION = 1;

interface StoredMaterial {
  id: string;
  label: string;
  color: Blob;
  normal?: Blob;
  rough?: Blob;
}

const records = new Map<string, StoredMaterial>();
const materials = new Map<string, THREE.MeshStandardMaterial>();
const objectUrls: string[] = [];
const loader = new THREE.TextureLoader();
let loaded = false;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开材质库"));
  });
}

async function readStored(): Promise<StoredMaterial[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly");
    const request = transaction.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as StoredMaterial[]);
    request.onerror = () => reject(request.error ?? new Error("无法读取材质库"));
    transaction.oncomplete = () => db.close();
  });
}

async function writeStored(record: StoredMaterial): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const request = transaction.objectStore(STORE).put(record);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("无法写入材质库"));
    transaction.oncomplete = () => db.close();
  });
}

async function deleteStored(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    const request = transaction.objectStore(STORE).delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("无法删除材质"));
    transaction.oncomplete = () => db.close();
  });
}

function texture(url: string, srgb: boolean): THREE.Texture {
  const loadedTexture = loader.load(url);
  loadedTexture.wrapS = THREE.RepeatWrapping;
  loadedTexture.wrapT = THREE.RepeatWrapping;
  if (srgb) loadedTexture.colorSpace = THREE.SRGBColorSpace;
  return loadedTexture;
}

function buildMaterial(record: StoredMaterial): THREE.MeshStandardMaterial {
  const colorUrl = URL.createObjectURL(record.color);
  objectUrls.push(colorUrl);
  const color = texture(colorUrl, true);
  const material = new THREE.MeshStandardMaterial({ map: color, roughness: 1, metalness: 0 });
  if (record.normal) {
    const normalUrl = URL.createObjectURL(record.normal);
    objectUrls.push(normalUrl);
    material.normalMap = texture(normalUrl, false);
  }
  if (record.rough) {
    const roughUrl = URL.createObjectURL(record.rough);
    objectUrls.push(roughUrl);
    material.roughnessMap = texture(roughUrl, false);
  }
  material.name = record.id;
  material.needsUpdate = true;
  return material;
}

function register(record: StoredMaterial): void {
  records.set(record.id, record);
  materials.set(record.id, buildMaterial(record));
}

export async function loadCustomMaterials(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    for (const record of await readStored()) register(record);
  } catch {
    // IndexedDB 不可用时保留本次会话内导入的材质。
  }
}

export function customMaterialList(): Array<{ id: string; label: string }> {
  return [...records.values()].map((record) => ({ id: record.id, label: record.label }));
}

export function customGroundMaterial(id: string): THREE.MeshStandardMaterial | null {
  return materials.get(id) ?? null;
}

function pickImage(files: File[], pattern: RegExp): File | null {
  return files.find((file) => pattern.test(file.name)) ?? null;
}

export interface ImportedMaterial {
  id: string;
  label: string;
}

export async function saveCustomMaterial(files: File[]): Promise<ImportedMaterial> {
  const images = files.filter((file) => /\.(png|jpe?g|webp)$/i.test(file.name));
  const color = pickImage(images, /(color|albedo|diffuse|base)/i) ?? images[0];
  if (!color) throw new Error("请选择一张贴图");
  const normal = pickImage(images, /(normal|nrm|nor)/i);
  const rough = pickImage(images, /(rough|rgh|rms)/i);
  const folder = (color.webkitRelativePath ?? "").split("/").filter(Boolean)[0];
  const base = color.name.replace(/\.[^.]+$/, "");
  const stripped = base.replace(/^(color|albedo|diffuse|base)[_-]?/i, "").trim();
  const fallback = stripped || base;
  const label = (folder || fallback || "自定义材质").trim();
  const id = "custom." + Date.now().toString(36) + "." + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const record: StoredMaterial = { id, label, color, ...(normal ? { normal } : {}), ...(rough ? { rough } : {}) };
  register(record);
  try {
    await writeStored(record);
  } catch {
    // 写入失败时仍保留会话内材质。
  }
  return { id, label };
}

export async function removeCustomMaterial(id: string): Promise<void> {
  records.delete(id);
  const material = materials.get(id);
  if (material) {
    material.map?.dispose();
    material.normalMap?.dispose();
    material.roughnessMap?.dispose();
    material.dispose();
  }
  materials.delete(id);
  try {
    await deleteStored(id);
  } catch {
    // 忽略本地删除失败。
  }
}
