import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CASTLE_SOURCES = import.meta.glob("../assets/kenney/castle/*.obj", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const TOWN_URLS = import.meta.glob("../assets/kenney/town/*.glb", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

const NATURE_URLS = import.meta.glob("../assets/kenney/nature/*.glb", {
  query: "?inline",
  import: "default",
  eager: true,
}) as Record<string, string>;

const ROLE_COLORS: Record<string, number> = {
  wall: 0xc6bda7,
  wallDark: 0x948a75,
  roof: 0xc25b3f,
  roofLight: 0xd06a4b,
  roofRed: 0xb94f36,
  roofRedLight: 0xc65c41,
  wood: 0x6b4a2f,
  woodDark: 0x4a3220,
  woodBark: 0x6b4a2f,
  woodBarkDark: 0x4a3220,
  cotton: 0xf2ead7,
  stone: 0x9c9482,
  stoneDark: 0x7a7365,
  dark: 0x2e2a24,
  _defaultMat: 0x9b9484,
  foliage: 0x4f7a3f,
  leafsGreen: 0x557f3f,
  leafsDark: 0x3d6332,
  grass: 0x5d8a45,
  dirt: 0x8a7451,
  water: 0x4b7f8c,
  hay: 0xc9a14a,
};

function baseName(path: string): string {
  const file = path.split("/").pop() ?? path;
  return file.replace(/\.(obj|glb)$/i, "");
}

function parseObjByMaterial(source: string): Map<string, THREE.BufferGeometry> {
  const vertices: number[] = [];
  const faces = new Map<string, number[]>();
  let material = "default";

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith("v ")) {
      const parts = line.split(/\s+/);
      vertices.push(Number(parts[1]), Number(parts[2]), Number(parts[3]));
      continue;
    }
    if (line.startsWith("usemtl ")) {
      material = line.slice(7).trim() || "default";
      continue;
    }
    if (!line.startsWith("f ")) continue;

    const tokens = line.split(/\s+/).slice(1);
    const indices = tokens.map((token) => {
      const value = Number(token.split("/")[0]);
      return value < 0 ? vertices.length / 3 + value : value - 1;
    });
    if (indices.length < 3) continue;

    const bucket = faces.get(material) ?? [];
    for (let index = 1; index < indices.length - 1; index += 1) {
      for (const vertexIndex of [indices[0], indices[index], indices[index + 1]]) {
        bucket.push(
          vertices[vertexIndex * 3] ?? 0,
          vertices[vertexIndex * 3 + 1] ?? 0,
          vertices[vertexIndex * 3 + 2] ?? 0,
        );
      }
    }
    faces.set(material, bucket);
  }

  const geometries = new Map<string, THREE.BufferGeometry>();
  for (const [role, positions] of faces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometries.set(role, geometry);
  }
  return geometries;
}

export class ArtLibrary {
  private readonly castlePrototypes = new Map<string, THREE.Group>();
  private readonly modelPrototypes = new Map<string, THREE.Object3D>();
  private readonly modelUrls = new Map<string, string>();
  private readonly materials = new Map<string, THREE.MeshStandardMaterial>();
  private failed = 0;
  ready = false;

  get failures(): number {
    return this.failed;
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const total =
      Object.keys(CASTLE_SOURCES).length + Object.keys(TOWN_URLS).length + Object.keys(NATURE_URLS).length;
    let done = 0;
    const tick = () => {
      done += 1;
      onProgress?.(done, total);
    };

    for (const [path, source] of Object.entries(CASTLE_SOURCES)) {
      try {
        const geometryByRole = parseObjByMaterial(source);
        const group = new THREE.Group();
        for (const [role, geometry] of geometryByRole) {
          geometry.userData.shared = true;
          const mesh = new THREE.Mesh(geometry);
          mesh.userData.role = role;
          group.add(mesh);
        }
        this.castlePrototypes.set(baseName(path), group);
      } catch {
        this.failed += 1;
      }
      tick();
    }

    const gltfLoader = new GLTFLoader();
    const jobs: Array<Promise<void>> = [];
    for (const [path, url] of Object.entries({ ...TOWN_URLS, ...NATURE_URLS })) {
      jobs.push(
        gltfLoader
          .loadAsync(url)
          .then((gltf) => {
            this.modelUrls.set(baseName(path), url);
            gltf.scene.traverse((object) => {
              const mesh = object as THREE.Mesh;
              if (mesh.isMesh && mesh.geometry) mesh.geometry.userData.shared = true;
            });
            this.modelPrototypes.set(baseName(path), gltf.scene);
          })
          .catch(() => {
            this.failed += 1;
          })
          .finally(tick),
      );
    }
    await Promise.all(jobs);
    this.ready = this.castlePrototypes.size > 0 || this.modelPrototypes.size > 0;
  }

  get modelNames(): string[] {
    return [...this.modelPrototypes.keys()].sort();
  }

  modelSource(name: string): string | null {
    return this.modelUrls.get(name) ?? null;
  }

  get castleNames(): string[] {
    return [...this.castlePrototypes.keys()].sort();
  }

  hasCastle(name: string): boolean {
    return this.castlePrototypes.has(name);
  }

  hasModel(name: string): boolean {
    return this.modelPrototypes.has(name);
  }

  castle(name: string, tint?: number): THREE.Object3D | null {
    const prototype = this.castlePrototypes.get(name);
    if (!prototype) return null;
    const clone = prototype.clone(true);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.material = this.material(mesh.userData.role as string, tint);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    return clone;
  }

  model(name: string): THREE.Object3D | null {
    const prototype = this.modelPrototypes.get(name);
    if (!prototype) return null;
    const clone = prototype.clone(true);
    clone.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const original = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      mesh.material = this.material(original?.name ?? "_defaultMat");
    });
    return clone;
  }

  material(role: string, tint?: number): THREE.MeshStandardMaterial {
    const key = `${role}:${tint ?? 0}`;
    const cached = this.materials.get(key);
    if (cached) return cached;
    const tinted = role === "roof" || role === "roofLight" || role === "roofRed" || role === "roofRedLight" || role === "cotton";
    const color = tint !== undefined && tinted ? tint : ROLE_COLORS[role] ?? 0x9c9482;
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.88,
      metalness: 0,
      flatShading: true,
    });
    material.name = role;
    material.userData.shared = true;
    this.materials.set(key, material);
    return material;
  }
}

export const art = new ArtLibrary();