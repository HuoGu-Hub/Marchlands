import * as THREE from "three";
import { art } from "./assets";
import { TERRAIN_PALETTES } from "./terrain";

type TerrainPalette = (typeof TERRAIN_PALETTES)[string];

export type TerrainAssetKind = "hill" | "ridge" | "mesa" | "pond" | "field" | "grove" | "ruin" | "camp";

export interface TerrainAsset {
  kind: TerrainAssetKind;
  label: string;
  footprint: number;
  height: number;
}

export const TERRAIN_ASSETS: TerrainAsset[] = [
  { kind: "hill", label: "草丘", footprint: 10.5, height: 3.4 },
  { kind: "ridge", label: "岩脊", footprint: 9.5, height: 4.2 },
  { kind: "mesa", label: "台地", footprint: 9, height: 4.6 },
  { kind: "pond", label: "池塘", footprint: 10.5, height: 0.8 },
  { kind: "field", label: "农田", footprint: 8.5, height: 1.2 },
  { kind: "grove", label: "树林", footprint: 10, height: 5.2 },
  { kind: "ruin", label: "废墟", footprint: 7.5, height: 3.2 },
  { kind: "camp", label: "营地", footprint: 7.5, height: 3.2 },
];

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function material(color: number, roughness = 1): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, flatShading: true });
}

function mesh(
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
  rotationY = 0,
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, mat);
  result.position.set(x, y, z);
  result.rotation.y = rotationY;
  return result;
}

function box(
  group: THREE.Object3D,
  size: [number, number, number],
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotationY = 0,
): THREE.Mesh {
  const result = mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat, x, y, z, rotationY);
  group.add(result);
  return result;
}

function jitterGeometry(geometry: THREE.BufferGeometry, random: () => number, amount: number): void {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  for (let index = 0; index < position.count; index += 1) {
    position.setX(index, position.getX(index) + (random() - 0.5) * amount);
    position.setZ(index, position.getZ(index) + (random() - 0.5) * amount);
  }
  geometry.computeVertexNormals();
}

function proceduralTree(mat: THREE.Material, trunk: THREE.Material, height: number): THREE.Group {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, height * 0.34, 5), trunk, 0, height * 0.17, 0));
  const levels = 3;
  for (let index = 0; index < levels; index += 1) {
    const radius = 0.9 - index * 0.22;
    const cone = mesh(
      new THREE.ConeGeometry(radius, height * 0.38, 6),
      mat,
      0,
      height * (0.38 + index * 0.2),
      0,
    );
    group.add(cone);
  }
  return group;
}

function addTree(group: THREE.Object3D, name: string, x: number, z: number, scale: number, rotation: number): void {
  const model = art.model(name);
  if (model) {
    model.position.set(x, 0, z);
    model.rotation.y = rotation;
    model.scale.setScalar(scale);
    group.add(model);
    return;
  }
  const fallback = proceduralTree(material(0x4f7138), material(0x5b422c), 3.2);
  fallback.position.set(x, 0, z);
  fallback.rotation.y = rotation;
  fallback.scale.setScalar(scale / 3);
  group.add(fallback);
}

function buildHill(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const grass = material(palette.grass);
  const grassDark = material(palette.grassDark);
  const rock = material(palette.ridge);
  const rockDark = material(palette.ridgeDark);

  group.add(mesh(new THREE.CylinderGeometry(5.5, 6.1, 0.45, 10), grassDark, 0, 0.12, 0));
  const bodyGeometry = new THREE.CylinderGeometry(4.15, 5.55, 2.2, 10, 3);
  jitterGeometry(bodyGeometry, random, 0.7);
  const body = mesh(bodyGeometry, grassDark, 0, 1.3, 0);
  group.add(body);
  const capGeometry = new THREE.CylinderGeometry(4.2, 3.95, 0.24, 10);
  jitterGeometry(capGeometry, random, 0.3);
  group.add(mesh(capGeometry, grass, 0, 2.5, 0));
  for (let index = 0; index < 6; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 4.6 + random() * 0.6;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(0.35 + random() * 0.45, 0),
        index % 2 === 0 ? rock : rockDark,
        Math.cos(angle) * radius,
        0.45 + random() * 0.7,
        Math.sin(angle) * radius,
        random() * Math.PI,
      ),
    );
  }

  for (let index = 0; index < 7; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 3.5 + random() * 1.7;
    const size = 0.35 + random() * 0.55;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(size, 0),
        index % 2 === 0 ? rock : rockDark,
        Math.cos(angle) * radius,
        0.35 + random() * 1.1,
        Math.sin(angle) * radius,
        random() * Math.PI,
      ),
    );
  }
  addTree(group, "tree_oak", -0.9, 0.3, 2.8, 0.6);
  addTree(group, "tree_detailed", 1.4, -1.1, 2.2, 2.2);
  addTree(group, "tree_pineTallA", -2.2, -1.4, 1.9, 1.4);
  for (let index = 0; index < 8; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 4.5 + random() * 1.4;
    group.add(
      mesh(
        new THREE.ConeGeometry(0.18, 0.5 + random() * 0.4, 4),
        grassDark,
        Math.cos(angle) * radius,
        0.35,
        Math.sin(angle) * radius,
      ),
    );
  }
  return group;
}

function buildRidge(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const rock = material(palette.ridge);
  const dark = material(palette.ridgeDark);
  group.add(mesh(new THREE.CylinderGeometry(4.4, 5.0, 0.35, 9), material(palette.rockDark), 0, 0.1, 0));
  for (let index = 0; index < 6; index += 1) {
    const radius = 0.8 + random() * 1.1;
    const height = 1.6 + random() * 3.1;
    const geometry = new THREE.CylinderGeometry(radius * 0.5, radius, height, 6, 2);
    jitterGeometry(geometry, random, 0.45);
    const column = mesh(
      geometry,
      index % 2 === 0 ? rock : dark,
      (index - 2.5) * 1.25,
      height / 2 + 0.2,
      (random() - 0.5) * 2.0,
      random() * Math.PI,
    );
    group.add(column);
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 2.5 + random() * 2.2;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(0.25 + random() * 0.45, 0),
        random() > 0.5 ? rock : dark,
        Math.cos(angle) * radius,
        0.15,
        Math.sin(angle) * radius,
        random() * Math.PI,
      ),
    );
  }
  return group;
}

function buildMesa(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const stone = material(palette.mesa);
  const dark = material(palette.rockDark);
  const grass = material(palette.mesaCap);
  group.add(mesh(new THREE.CylinderGeometry(4.3, 5.1, 0.4, 8), dark, 0, 0.12, 0));
  group.add(mesh(new THREE.CylinderGeometry(3.2, 4.4, 2.1, 8), stone, 0, 1.15, 0));
  group.add(mesh(new THREE.CylinderGeometry(3.35, 3.2, 0.22, 8), grass, 0, 2.3, 0));
  group.add(mesh(new THREE.CylinderGeometry(0.9, 1.6, 1.4, 7), dark, -2.8, 0.75, 1.7));
  for (let index = 0; index < 5; index += 1) {
    const angle = random() * Math.PI * 2;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(0.3 + random() * 0.4, 0),
        index % 2 === 0 ? stone : dark,
        Math.cos(angle) * 3.8,
        0.25,
        Math.sin(angle) * 3.8,
        random() * Math.PI,
      ),
    );
  }
  addTree(group, "tree_pineRoundC", 0.7, -0.5, 2.1, 1.1);
  return group;
}

function buildPond(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const grass = material(palette.grass);
  const shore = material(palette.dirtLight);
  const mud = material(palette.dirt);
  const water = new THREE.MeshStandardMaterial({
    color: 0x3e7376,
    roughness: 0.18,
    metalness: 0.08,
    transparent: true,
    opacity: 0.9,
    flatShading: true,
  });
  const waterDark = new THREE.MeshStandardMaterial({ color: 0x274c53, roughness: 0.4 });

  group.add(mesh(new THREE.CylinderGeometry(6.3, 6.5, 0.12, 12), grass, 0, 0.04, 0));
  const mudRing = mesh(new THREE.RingGeometry(4.35, 5.55, 28), mud, 0, 0.1, 0);
  mudRing.rotation.x = -Math.PI / 2;
  group.add(mudRing);
  const shoreRing = mesh(new THREE.RingGeometry(4.15, 4.75, 28), shore, 0, 0.115, 0);
  shoreRing.rotation.x = -Math.PI / 2;
  group.add(shoreRing);
  const waterMesh = mesh(new THREE.CircleGeometry(4.3, 30), water, 0, 0.125, 0);
  waterMesh.rotation.x = -Math.PI / 2;
  group.add(waterMesh);
  const deep = mesh(new THREE.CircleGeometry(3.1, 24), waterDark, 0, 0.118, 0);
  deep.rotation.x = -Math.PI / 2;
  group.add(deep);

  for (let index = 0; index < 9; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 4.75 + random() * 0.55;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    group.add(mesh(new THREE.DodecahedronGeometry(0.3 + random() * 0.35, 0), shore, x, 0.2, z, random() * Math.PI));
    for (let reed = 0; reed < 2; reed += 1) {
      const height = 0.7 + random() * 0.8;
      group.add(
        mesh(
          new THREE.CylinderGeometry(0.025, 0.04, height, 4),
          material(palette.grassLight),
          x + (random() - 0.5) * 0.4,
          height / 2 + 0.1,
          z + (random() - 0.5) * 0.4,
        ),
      );
    }
  }
  for (let index = 0; index < 6; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = random() * 3.4;
    const pad = mesh(
      new THREE.CircleGeometry(0.32 + random() * 0.2, 7),
      material(palette.grassDark),
      Math.cos(angle) * radius,
      0.135,
      Math.sin(angle) * radius,
    );
    pad.rotation.x = -Math.PI / 2;
    group.add(pad);
  }
  addTree(group, "tree_thin", -5.9, 3.4, 2.2, 0.4);
  addTree(group, "tree_simple", 5.5, -3.4, 1.9, 1.7);
  return group;
}

function buildField(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const soil = material(palette.dirt);
  const soilLight = material(palette.dirtLight);
  const crop = material(0xb99a4f);
  const cropGreen = material(0x6d853e);
  const wood = material(0x6b4a2f);
  group.add(box(group, [7.6, 0.16, 5.4], soil, 0, 0.08, 0));
  for (let row = 0; row < 7; row += 1) {
    box(group, [7.0, 0.06, 0.34], soilLight, 0, 0.17, -2.25 + row * 0.75);
    for (let index = 0; index < 18; index += 1) {
      const x = -3.4 + index * 0.4;
      const stem = mesh(new THREE.ConeGeometry(0.1, 0.42, 4), row % 2 === 0 ? crop : cropGreen, x, 0.4, -2.25 + row * 0.75);
      stem.rotation.z = (random() - 0.5) * 0.2;
      group.add(stem);
    }
  }
  for (const [x, z, w, d] of [[0, -2.9, 8, 0.12], [0, 2.9, 8, 0.12], [-4, 0, 0.12, 5.8], [4, 0, 0.12, 5.8]] as Array<[number, number, number, number]>) {
    box(group, [w, 0.5, d], wood, x, 0.32, z);
    box(group, [w, 0.08, d], wood, x, 0.58, z);
  }
  for (const [x, z] of [[-4, -2.9], [4, -2.9], [-4, 2.9], [4, 2.9]] as Array<[number, number]>) {
    box(group, [0.18, 0.85, 0.18], wood, x, 0.42, z);
  }
  box(group, [0.9, 0.4, 0.55], material(0x8d6d45), 5.1, 0.2, 1.9);
  return group;
}

function buildGrove(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const grass = material(palette.grassDark);
  group.add(mesh(new THREE.CylinderGeometry(5.4, 6.0, 0.26, 9), grass, 0, 0.1, 0));
  const names = ["tree_oak", "tree_detailed", "tree_pineTallA", "tree_default", "tree_pineRoundC", "tree_simple"];
  for (let index = 0; index < 7; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 1.2 + random() * 3.6;
    addTree(group, names[index % names.length], Math.cos(angle) * radius, Math.sin(angle) * radius, 2.1 + random() * 1.3, random() * Math.PI * 2);
  }
  for (let index = 0; index < 10; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 2.2 + random() * 3.2;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(0.18 + random() * 0.3, 0),
        material(palette.rock),
        Math.cos(angle) * radius,
        0.22,
        Math.sin(angle) * radius,
        random() * Math.PI,
      ),
    );
  }
  for (let index = 0; index < 9; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 2.6 + random() * 2.7;
    group.add(
      mesh(
        new THREE.ConeGeometry(0.16, 0.4, 4),
        material(index % 2 === 0 ? palette.grass : palette.grassLight),
        Math.cos(angle) * radius,
        0.28,
        Math.sin(angle) * radius,
      ),
    );
  }
  return group;
}

function buildRuin(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const stone = material(palette.rock);
  const dark = material(palette.rockDark);
  const moss = material(palette.grassDark);
  group.add(mesh(new THREE.CylinderGeometry(4.6, 5.1, 0.28, 9), material(palette.rockDark), 0, 0.1, 0));
  const walls: Array<[number, number, number]> = [[-2.2, 0.4, 0.5], [0.2, 0.8, 0.5], [2.4, 0.35, 0.5]];
  for (const [x, height, z] of walls) {
    box(group, [0.65, height, 2.6], stone, x, height / 2 + 0.2, z, 0.08);
    for (let index = 0; index < 3; index += 1) {
      if (height < 0.6) continue;
      box(group, [0.7, 0.32, 0.55], dark, x - 0.75 + index * 0.75, height + 0.35, z, 0.08);
    }
  }
  box(group, [2.6, 0.5, 0.7], stone, 0.4, 0.45, -2.5, Math.PI / 2);
  for (const x of [-1.5, 1.1]) {
    group.add(mesh(new THREE.CylinderGeometry(0.32, 0.4, 1.5, 7), stone, x, 0.95, -1.7));
    group.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.12, 7), dark, x, 1.75, -1.7));
  }
  for (let index = 0; index < 12; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 1.2 + random() * 3.1;
    group.add(
      mesh(
        new THREE.DodecahedronGeometry(0.2 + random() * 0.35, 0),
        index % 3 === 0 ? moss : index % 2 === 0 ? stone : dark,
        Math.cos(angle) * radius,
        0.22,
        Math.sin(angle) * radius,
        random() * Math.PI,
      ),
    );
  }
  return group;
}

function buildCamp(seed: number, palette: TerrainPalette): THREE.Group {
  const random = seeded(seed);
  const group = new THREE.Group();
  const cloth = material(0x9a6a4a);
  const clothLight = material(0xb9855e);
  const wood = material(0x6b4a2f);
  const stone = material(0x7c7668);
  group.add(mesh(new THREE.CylinderGeometry(4.4, 4.8, 0.24, 8), material(palette.dirt), 0, 0.1, 0));
  for (const [x, z, rotation] of [[-1.8, 0.9, 0.2], [1.7, 1.3, -0.3], [0.8, -1.9, 0.5]] as Array<[number, number, number]>) {
    const tent = new THREE.Group();
    tent.position.set(x, 0, z);
    tent.rotation.y = rotation;
    tent.add(mesh(new THREE.ConeGeometry(1.1, 1.7, 4), cloth, 0, 0.95, 0, Math.PI / 4));
    tent.add(mesh(new THREE.ConeGeometry(0.72, 1.2, 4), clothLight, 0, 0.75, 0.12, Math.PI / 4));
    tent.add(box(tent, [0.08, 0.65, 0.08], wood, -0.68, 0.33, 0));
    tent.add(box(tent, [0.08, 0.65, 0.08], wood, 0.68, 0.33, 0));
    group.add(tent);
  }
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    group.add(mesh(new THREE.DodecahedronGeometry(0.22, 0), stone, Math.cos(angle) * 0.75, 0.24, Math.sin(angle) * 0.75));
  }
  for (const rotation of [0.4, 1.5, 2.7]) {
    group.add(mesh(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 5), wood, Math.cos(rotation) * 0.15, 0.65, Math.sin(rotation) * 0.15, rotation));
  }
  const ember = new THREE.Mesh(
    new THREE.ConeGeometry(0.26, 0.5, 5),
    new THREE.MeshBasicMaterial({ color: 0xffa24a }),
  );
  ember.position.set(0, 0.55, 0);
  group.add(ember);
  box(group, [0.7, 0.45, 0.5], wood, 2.4, 0.25, -0.6);
  box(group, [0.5, 0.35, 0.4], wood, 2.0, 0.18, -0.2);
  box(group, [0.12, 2.0, 0.12], wood, -2.9, 1.0, -0.9);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), material(0x5cc07f, 0.9));
  flag.position.set(-2.42, 1.7, -0.9);
  flag.rotation.y = Math.PI / 2;
  group.add(flag);
  return group;
}

export function buildTerrainAsset(kind: TerrainAssetKind, seed = 1, style = "frontier"): THREE.Group {
  const palette = TERRAIN_PALETTES[style] ?? TERRAIN_PALETTES.frontier;
  switch (kind) {
    case "hill":
      return buildHill(seed, palette);
    case "ridge":
      return buildRidge(seed, palette);
    case "mesa":
      return buildMesa(seed, palette);
    case "pond":
      return buildPond(seed, palette);
    case "field":
      return buildField(seed, palette);
    case "grove":
      return buildGrove(seed, palette);
    case "ruin":
      return buildRuin(seed, palette);
    case "camp":
      return buildCamp(seed, palette);
  }
}