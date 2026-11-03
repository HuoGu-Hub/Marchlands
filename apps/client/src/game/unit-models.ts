import * as THREE from "three";
import { ModelBuilder } from "./building-kit";
import type { TeamPalette } from "./building-kit";

export type UnitKind = "infantry" | "shield" | "cavalry" | "archer" | "elite";

export const UNIT_KINDS: UnitKind[] = ["infantry", "shield", "cavalry", "archer", "elite"];

export const UNIT_NAMES: Record<UnitKind, string> = {
  infantry: "步兵",
  shield: "盾兵",
  cavalry: "骑兵",
  archer: "弓兵",
  elite: "精兵",
};

export const UNIT_DESCRIPTIONS: Record<UnitKind, string> = {
  infantry: "单刀 · 札甲",
  shield: "重甲 · 大盾",
  cavalry: "长枪 · 战马",
  archer: "弓箭 · 轻甲",
  elite: "精甲 · 羽饰",
};

const CACHE = new Map<string, THREE.MeshStandardMaterial>();

function paint(color: number, roughness = 0.94, metalness = 0): THREE.MeshStandardMaterial {
  const key = color + ":" + roughness + ":" + metalness;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const created = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  CACHE.set(key, created);
  return created;
}

function metal(color: number): THREE.MeshStandardMaterial {
  return paint(color, 0.78, 0.28);
}

const SKIN = paint(0xd9a67c, 0.96);
const HAIR = paint(0x4b3626, 0.98);
const STEEL = metal(0x8b9195);
const DARK_STEEL = metal(0x4d5358);
const GOLD = paint(0x9c7d4c, 0.78);
const LEATHER = paint(0x7f5a3c, 0.98);
const DARK_LEATHER = paint(0x45301f, 0.99);
const WOOD = paint(0x7a5738, 0.96);
const HORSE = paint(0x8a5c3e, 0.96);
const HORSE_LIGHT = paint(0xc79c75, 0.95);
const HORSE_DARK = paint(0x463021, 0.98);
const WHITE = paint(0xd9cfbc, 0.95);
const INK = paint(0x231b16, 0.98);
const RUST = paint(0x7d4e30, 0.95);
const SCAR = paint(0xb9806c, 0.92);
const ARMOR = metal(0x5b6167);
const ARMOR_EDGE = metal(0x3a3e43);
const ARMOR_LIGHT = metal(0x686f74);

function scratch(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  angle: number,
  color: string,
  width = 1,
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
  context.stroke();
  context.restore();
}

let METAL_MAP: THREE.CanvasTexture | null = null;

function metalMap(): THREE.CanvasTexture {
  if (METAL_MAP) return METAL_MAP;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#4b4f53";
    context.fillRect(0, 0, 256, 256);
    let seed = 9137;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 90; index += 1) {
      const shade = 55 + Math.floor(random() * 35);
      context.fillStyle = "rgba(" + shade + "," + shade + "," + (shade + 5) + ",0.32)";
      context.beginPath();
      context.arc(random() * 256, random() * 256, 2 + random() * 10, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = 0; index < 26; index += 1) {
      scratch(context, random() * 256, random() * 256, 7 + random() * 24, random() * Math.PI, "rgba(28,30,32,0.55)", 1);
      scratch(context, random() * 256, random() * 256, 4 + random() * 16, random() * Math.PI, "rgba(150,156,160,0.35)", 1);
    }
    for (let index = 0; index < 12; index += 1) {
      context.fillStyle = "rgba(125,78,48,0.5)";
      context.beginPath();
      context.arc(random() * 256, random() * 256, 2 + random() * 5, 0, Math.PI * 2);
      context.fill();
    }
    context.strokeStyle = "rgba(24,26,28,0.7)";
    context.lineWidth = 3;
    context.strokeRect(6, 6, 244, 244);
    context.fillStyle = "rgba(190,194,198,0.35)";
    for (const [x, y] of [[18, 18], [238, 18], [18, 238], [238, 238], [128, 16], [128, 240]]) {
      context.beginPath();
      context.arc(x, y, 3, 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  METAL_MAP = texture;
  return texture;
}

let LEATHER_MAP: THREE.CanvasTexture | null = null;

function leatherMap(): THREE.CanvasTexture {
  if (LEATHER_MAP) return LEATHER_MAP;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#6b4b33";
    context.fillRect(0, 0, 256, 256);
    let seed = 4421;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 120; index += 1) {
      const shade = 60 + Math.floor(random() * 40);
      context.fillStyle = "rgba(" + (shade + 28) + "," + (shade + 10) + "," + (shade - 8) + ",0.22)";
      context.beginPath();
      context.arc(random() * 256, random() * 256, 2 + random() * 7, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = "#5b3e2b";
    context.fillRect(26, 152, 78, 62);
    context.strokeStyle = "#c9b18e";
    context.setLineDash([4, 5]);
    context.lineWidth = 2;
    context.strokeRect(32, 158, 66, 50);
    context.setLineDash([]);
    context.fillStyle = "#7d5a3d";
    context.fillRect(148, 46, 72, 58);
    context.strokeStyle = "#2f2118";
    context.strokeRect(152, 50, 64, 50);
    for (const [x, y] of [[156, 56], [210, 56], [156, 96], [210, 96]]) {
      context.fillStyle = "#c9b18e";
      context.beginPath();
      context.arc(x, y, 2, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = 0; index < 20; index += 1) {
      scratch(context, random() * 256, random() * 256, 4 + random() * 18, random() * Math.PI, "rgba(42,28,18,0.45)", 1);
    }
    context.strokeStyle = "rgba(44,30,20,0.75)";
    context.lineWidth = 4;
    context.strokeRect(4, 4, 248, 248);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  LEATHER_MAP = texture;
  return texture;
}

let WOOD_MAP: THREE.CanvasTexture | null = null;

function woodMap(): THREE.CanvasTexture {
  if (WOOD_MAP) return WOOD_MAP;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#745333";
    context.fillRect(0, 0, 256, 256);
    for (let index = 0; index < 5; index += 1) {
      context.fillStyle = index % 2 === 0 ? "#7d5a39" : "#6a4b2f";
      context.fillRect(index * 52, 0, 50, 256);
      context.strokeStyle = "rgba(38,26,18,0.55)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(index * 52, 0);
      context.lineTo(index * 52, 256);
      context.stroke();
    }
    let seed = 7717;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 40; index += 1) {
      scratch(context, random() * 256, random() * 256, 8 + random() * 30, Math.PI / 2 + (random() - 0.5) * 0.3, "rgba(48,32,20,0.35)", 1);
    }
    context.strokeStyle = "rgba(34,23,15,0.7)";
    context.lineWidth = 4;
    context.strokeRect(4, 4, 248, 248);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  WOOD_MAP = texture;
  return texture;
}

const CLOTH_MAPS = new Map<number, THREE.CanvasTexture>();

function clothMap(color: number): THREE.CanvasTexture {
  const cached = CLOTH_MAPS.get(color);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const base = new THREE.Color(color);
    context.fillStyle = "#" + base.getHexString();
    context.fillRect(0, 0, 256, 256);
    let seed = 3313;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 140; index += 1) {
      context.fillStyle = "rgba(20,18,15," + (0.04 + random() * 0.06) + ")";
      context.fillRect(random() * 256, random() * 256, 1 + random() * 5, 1 + random() * 5);
    }
    context.fillStyle = "rgba(30,26,20,0.2)";
    context.fillRect(18, 170, 62, 46);
    context.strokeStyle = "rgba(210,196,170,0.55)";
    context.setLineDash([3, 4]);
    context.strokeRect(22, 174, 54, 38);
    context.setLineDash([]);
    context.fillStyle = "rgba(20,18,15,0.3)";
    context.beginPath();
    context.arc(190, 190, 18, 0, Math.PI * 2);
    context.fill();
    for (let index = 0; index < 6; index += 1) {
      scratch(context, random() * 256, random() * 256, 4 + random() * 14, random() * Math.PI, "rgba(30,26,20,0.28)", 1);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  CLOTH_MAPS.set(color, texture);
  return texture;
}

const ARMOR_PLATE = new THREE.MeshStandardMaterial({ map: metalMap(), roughness: 0.8, metalness: 0.24 });
const LEATHER_PLATE = new THREE.MeshStandardMaterial({ map: leatherMap(), roughness: 0.98 });
const WOOD_PLATE = new THREE.MeshStandardMaterial({ map: woodMap(), roughness: 0.96 });

const HIP_Y = 0.19;
const SHOULDER_Y = 0.25;
const NECK_Y = 0.45;

export interface UnitRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  mount?: THREE.Group;
  mountLegs: THREE.Group[];
  height: number;
  kind: UnitKind;
}

function part(build: (builder: ModelBuilder) => void): THREE.Group {
  const builder = new ModelBuilder();
  build(builder);
  return builder.finish();
}

const CLOTH_MATERIALS = new Map<number, THREE.MeshStandardMaterial>();

function paintTeam(palette: TeamPalette): THREE.MeshStandardMaterial {
  const color = new THREE.Color(palette.cloth);
  color.offsetHSL(0, -0.08, -0.03);
  const key = color.getHex();
  const cached = CLOTH_MATERIALS.get(key);
  if (cached) return cached;
  const material = new THREE.MeshStandardMaterial({ map: clothMap(key), roughness: 1 });
  CLOTH_MATERIALS.set(key, material);
  return material;
}

function paintTrim(palette: TeamPalette): THREE.MeshStandardMaterial {
  return paint(new THREE.Color(palette.roofEdge).offsetHSL(0, -0.04, -0.02).getHex(), 0.98);
}

function ball(
  builder: ModelBuilder,
  radius: number,
  sx: number,
  sy: number,
  sz: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const geometry = new THREE.SphereGeometry(radius, 16, 12);
  geometry.scale(sx, sy, sz);
  builder.add(geometry, material, new THREE.Vector3(x, y, z));
}

function capsule(
  builder: ModelBuilder,
  radius: number,
  length: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): void {
  const geometry = new THREE.CapsuleGeometry(radius, length, 6, 14);
  geometry.scale(sx, sy, sz);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  builder.add(geometry, material, new THREE.Vector3(x, y, z), quaternion);
}

function torus(
  builder: ModelBuilder,
  radius: number,
  tube: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = Math.PI / 2,
  ry = 0,
  rz = 0,
): void {
  const geometry = new THREE.TorusGeometry(radius, tube, 10, 28);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  builder.add(geometry, material, new THREE.Vector3(x, y, z), quaternion);
}

function roundedPanel(
  builder: ModelBuilder,
  width: number,
  height: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + 0.02, -h);
  shape.quadraticCurveTo(-w, -h, -w, -h + 0.02);
  shape.lineTo(-w, h - 0.02);
  shape.quadraticCurveTo(-w, h, -w + 0.02, h);
  shape.lineTo(w - 0.02, h);
  shape.quadraticCurveTo(w, h, w, h - 0.02);
  shape.lineTo(w, -h + 0.02);
  shape.quadraticCurveTo(w, -h, w - 0.02, -h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  builder.add(geometry, material, new THREE.Vector3(x, y, z));
}

function texturedPanel(
  builder: ModelBuilder,
  width: number,
  height: number,
  radius: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + radius, -h);
  shape.lineTo(w - radius, -h);
  shape.quadraticCurveTo(w, -h, w, -h + radius);
  shape.lineTo(w, h - radius);
  shape.quadraticCurveTo(w, h, w - radius, h);
  shape.lineTo(-w + radius, h);
  shape.quadraticCurveTo(-w, h, -w, h - radius);
  shape.lineTo(-w, -h + radius);
  shape.quadraticCurveTo(-w, -h, -w + radius, -h);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 16);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const uv = geometry.attributes.uv;
  const position = geometry.attributes.position;
  if (box && uv) {
    for (let index = 0; index < uv.count; index += 1) {
      uv.setXY(
        index,
        (position.getX(index) - box.min.x) / (box.max.x - box.min.x),
        (position.getY(index) - box.min.y) / (box.max.y - box.min.y),
      );
    }
  }
  builder.add(geometry, material, new THREE.Vector3(x, y, z));
}

function makeTorso(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = paintTeam(palette);
  const trim = paintTrim(palette);
  const heavy = kind === "shield" || kind === "elite";
  return part((b) => {
    ball(b, 0.22, 1.08, 1.12, 0.92, team, 0, 0.17, 0);
    ball(b, 0.21, 1.0, 0.95, 0.86, kind === "archer" ? LEATHER : heavy ? ARMOR : LEATHER, 0, 0.14, 0.03);

    const plateW = heavy ? 0.25 : 0.22;
    const plateH = heavy ? 0.19 : 0.16;
    texturedPanel(b, plateW + 0.014, plateH + 0.008, 0.04, heavy ? ARMOR_EDGE : DARK_LEATHER, 0, 0.17, 0.228);
    texturedPanel(b, plateW, plateH, 0.035, heavy ? ARMOR_PLATE : LEATHER_PLATE, 0, 0.17, 0.238);

    if (!heavy) {
      texturedPanel(b, 0.09, 0.07, 0.012, kind === "archer" ? team : LEATHER, -0.1, 0.11, 0.245);
      for (const [x, y] of [[-0.135, 0.14], [-0.065, 0.08], [-0.135, 0.08], [-0.065, 0.14]]) {
        ball(b, 0.006, 1, 1, 1, WHITE, x, y, 0.252);
      }
    } else {
      for (const [x, y] of [[-0.1, 0.25], [0.1, 0.25], [-0.1, 0.09], [0.1, 0.09]]) {
        ball(b, 0.009, 1, 1, 1, STEEL, x, y, 0.245);
      }
    }

    torus(b, 0.2, 0.022, DARK_LEATHER, 0, 0.055, 0);
    ball(b, 0.04, 1, 1, 1, GOLD, 0, 0.055, 0.19);

    ball(b, 0.215, 1.1, 0.3, 0.95, heavy ? ARMOR : LEATHER, 0, 0.0, 0);
    torus(b, 0.205, 0.014, heavy ? ARMOR_EDGE : DARK_LEATHER, 0, -0.02, 0);
    ball(b, 0.22, 1.05, 0.2, 0.95, team, 0, -0.07, 0);
    for (const x of [-0.13, 0, 0.13]) capsule(b, 0.022, 0.08, team, x, -0.12, 0.13);

    for (const side of [-1, 1]) {
      if (heavy) {
        ball(b, 0.105, 0.95, 0.5, 0.9, ARMOR, side * 0.21, 0.29, 0);
        ball(b, 0.085, 0.92, 0.32, 0.9, ARMOR_LIGHT, side * 0.235, 0.255, 0.01);
        torus(b, 0.095, 0.01, ARMOR_EDGE, side * 0.21, 0.3, 0, Math.PI / 2, 0, 0);
      } else {
        ball(b, 0.1, 0.95, 0.45, 0.9, LEATHER, side * 0.21, 0.29, 0);
        torus(b, 0.09, 0.008, DARK_LEATHER, side * 0.21, 0.3, 0, Math.PI / 2, 0, 0);
      }
      for (const offset of [-0.03, 0, 0.03]) {
        capsule(b, 0.016, 0.07, team, side * 0.25 + offset, 0.17, 0.02);
      }
    }

    if (kind === "shield") {
      texturedPanel(b, 0.3, 0.07, 0.02, ARMOR_PLATE, 0, 0.29, 0.235);
      for (const x of [-0.12, 0.12]) ball(b, 0.026, 1, 1, 1, STEEL, x, 0.29, 0.245);
    } else if (kind === "elite") {
      ball(b, 0.19, 0.95, 1.05, 0.22, team, 0, 0.13, -0.19);
      for (const x of [-0.16, -0.08, 0, 0.08, 0.16]) {
        capsule(b, 0.022, 0.2, x === 0 ? trim : team, x, -0.08, -0.22, 0.1, 0, 0);
      }
    } else if (kind === "archer") {
      ball(b, 0.19, 0.9, 1.05, 0.2, team, 0, 0.1, -0.16);
      for (const x of [-0.09, 0, 0.09]) {
        capsule(b, 0.02, 0.12, team, x, -0.04, -0.2, 0.08, 0, 0);
      }
    } else if (kind === "cavalry") {
      for (let index = 0; index < 10; index += 1) {
        const angle = (index / 10) * Math.PI * 2;
        ball(b, 0.045, 1, 0.8, 1, index % 2 === 0 ? WHITE : HORSE_LIGHT, Math.cos(angle) * 0.14, 0.31, Math.sin(angle) * 0.1 + 0.02);
      }
    } else {
      capsule(b, 0.025, 0.22, DARK_LEATHER, 0, 0.2, 0.245, 0, 0, 0.55);
      for (const x of [-0.13, 0.13]) ball(b, 0.022, 1, 1, 1, STEEL, x, 0.11, 0.245);
    }
    if (variant % 2 === 0) ball(b, 0.022, 1, 1, 1, GOLD, 0, 0.31, 0.2);
  });
}

function makeHead(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = paintTeam(palette);
  const trim = paintTrim(palette);
  return part((b) => {
    ball(b, 0.21, 1, 1, 0.96, SKIN, 0, 0.12, 0);
    ball(b, 0.07, 1, 1, 1, HAIR, 0, 0.26, -0.12);
    for (const x of [-0.075, 0.075]) {
      ball(b, 0.034, 1, 0.5, 0.35, INK, x, 0.14, 0.195);
      ball(b, 0.008, 1, 1, 1, WHITE, x + 0.008, 0.148, 0.215);
      capsule(b, 0.014, 0.075, HAIR, x, 0.178, 0.195, 0, 0, x < 0 ? -0.42 : 0.42);
    }
    ball(b, 0.018, 1, 0.8, 0.5, INK, 0, 0.075, 0.205);
    ball(b, 0.014, 1, 0.5, 0.4, RUST, 0, 0.065, 0.205);

    if (kind === "infantry") {
      ball(b, 0.215, 1.0, 0.55, 0.95, DARK_LEATHER, 0, 0.27, -0.05);
      torus(b, 0.208, 0.022, LEATHER, 0, 0.2, 0, Math.PI / 2, 0, 0);
      for (const x of [-0.15, 0.15]) capsule(b, 0.025, 0.1, HAIR, x, 0.02, 0.06, 0, 0, x < 0 ? 0.4 : -0.4);
      if (variant % 2 === 0) {
        capsule(b, 0.008, 0.13, SCAR, 0.08, 0.12, 0.2, 0, 0, 0.55);
      } else {
        ball(b, 0.062, 1, 0.95, 0.3, INK, 0.075, 0.14, 0.21);
        capsule(b, 0.009, 0.23, DARK_LEATHER, 0.01, 0.17, 0.2, 0, 0, 1.2);
      }
    } else if (kind === "shield") {
      ball(b, 0.225, 1, 1, 1, ARMOR, 0, 0.12, 0.005);
      ball(b, 0.13, 1.0, 0.18, 0.1, INK, 0, 0.15, 0.205);
      for (const x of [-0.12, 0.12]) ball(b, 0.03, 1, 1, 1, STEEL, x, 0.18, 0.18);
      torus(b, 0.2, 0.018, ARMOR_EDGE, 0, 0.13, 0, Math.PI / 2, 0, 0);
      ball(b, 0.035, 1, 1, 1, RUST, 0, 0.27, 0.16);
      for (let index = 0; index < 8; index += 1) {
        const x = -0.12 + index * 0.034;
        ball(b, 0.034, 0.9, 1.45, 0.7, index % 2 === 0 ? HAIR : HORSE_DARK, x, -0.08, 0.17);
      }
      ball(b, 0.1, 1.2, 0.4, 0.5, HAIR, 0, -0.04, 0.17);
    } else if (kind === "archer") {
      ball(b, 0.22, 1, 1, 1, team, 0, 0.15, -0.05);
      torus(b, 0.185, 0.03, trim, 0, 0.12, 0.14, 0.2, 0, 0);
      ball(b, 0.18, 0.9, 0.9, 0.2, INK, 0, 0.13, 0.09);
      ball(b, 0.06, 1.1, 0.55, 0.8, team, 0, 0.32, -0.12);
      for (const x of [-0.14, 0.14]) capsule(b, 0.02, 0.1, team, x, 0.04, 0.05);
    } else if (kind === "elite") {
      b.add(
        new THREE.SphereGeometry(0.225, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        ARMOR,
        new THREE.Vector3(0, 0.19, 0),
      );
      torus(b, 0.21, 0.018, ARMOR_EDGE, 0, 0.18, 0, Math.PI / 2, 0, 0);
      for (const x of [-0.18, 0.18]) ball(b, 0.05, 1, 1, 1, ARMOR, x, 0.1, 0.02);
      capsule(b, 0.014, 0.06, STEEL, 0, 0.12, 0.21);
      const featherColors = [paint(0xcbb58c), paint(0x9a6b45), team];
      for (let index = 0; index < 3; index += 1) {
        const x = -0.07 + index * 0.07;
        const cone = new THREE.ConeGeometry(0.055, 0.18, 7);
        cone.scale(1, 1, 0.28);
        const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.15, 0, -0.55 + index * 0.5));
        b.add(cone, featherColors[index], new THREE.Vector3(x, 0.35 + index * 0.015, -0.11), quaternion);
        capsule(b, 0.007, 0.12, DARK_LEATHER, x, 0.29, -0.1, 0, 0, -0.55 + index * 0.5);
      }
      capsule(b, 0.006, 0.1, SCAR, -0.075, 0.14, 0.195, 0, 0, -0.5);
    } else {
      ball(b, 0.225, 1, 0.62, 1, DARK_LEATHER, 0, 0.27, -0.05);
      for (const x of [-0.16, 0.16]) ball(b, 0.06, 1, 0.8, 1, HORSE_LIGHT, x, 0.13, 0.02);
      torus(b, 0.215, 0.03, HORSE_LIGHT, 0, 0.21, 0, Math.PI / 2, 0, 0);
      capsule(b, 0.02, 0.09, STEEL, 0, 0.12, 0.2);
      for (const x of [-0.14, 0.14]) capsule(b, 0.02, 0.08, HAIR, x, 0.02, 0.05);
      capsule(b, 0.02, 0.18, team, 0.18, 0.0, -0.08, 0, 0, 0.3);
    }

    if (kind !== "archer") {
      ball(b, 0.17, 1.05, 0.4, 0.8, ARMOR, 0, 0.02, -0.1);
      for (const x of [-0.19, 0.19]) ball(b, 0.07, 0.7, 0.9, 0.7, ARMOR, x, 0.07, 0.015);
    }
  });
}

function makeArm(kind: UnitKind, palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  const armor = kind === "shield" || kind === "cavalry" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    capsule(b, 0.065, 0.08, kind === "archer" ? team : armor, 0, -0.08, 0);
    if (kind !== "archer") {
      capsule(b, 0.072, 0.06, ARMOR, 0, -0.12, 0);
      torus(b, 0.065, 0.012, STEEL, 0, -0.14, 0, Math.PI / 2, 0, 0);
    }
    ball(b, 0.07, 1, 1, 1, kind === "shield" || kind === "elite" ? ARMOR_EDGE : SKIN, 0, -0.17, 0.01);
    if (kind === "shield" || kind === "cavalry") torus(b, 0.055, 0.012, DARK_LEATHER, 0, -0.02, 0, 0, 0, 0);
  });
}

/**
 * 把近战武器放进右手：握把落在手掌位置，刃口朝前。
 * 武器挂在手臂组下，手臂旋转时武器跟随，攻击剪辑因此能带出挥砍弧线。
 */
function holdWeapon(weapon: THREE.Group, lean = 0): void {
  weapon.name = "weapon";
  weapon.position.set(0, -0.2, 0.04);
  weapon.rotation.set(-Math.PI / 3.2, 0, lean);
}

function makeLeg(kind: UnitKind): THREE.Group {
  return part((b) => {
    capsule(b, 0.078, 0.05, kind === "shield" || kind === "elite" ? ARMOR : DARK_LEATHER, 0, -0.075, 0);
    ball(b, 0.075, 1.05, 0.7, 1.25, DARK_LEATHER, 0, -0.175, 0.025);
    ball(b, 0.07, 0.95, 0.35, 1.0, paint(0x8a7558, 0.98), 0, -0.19, 0.09);
    if (kind === "shield" || kind === "elite" || kind === "cavalry") {
      ball(b, 0.07, 0.95, 0.55, 1.1, ARMOR, 0, -0.19, 0.07);
      torus(b, 0.066, 0.011, STEEL, 0, -0.15, 0.02);
    } else {
      torus(b, 0.066, 0.01, DARK_LEATHER, 0, -0.11, 0, 0, 0, 0);
    }
  });
}

function sword(gleam = false): THREE.Group {
  const bladeMaterial = gleam ? paint(0xc6ccd0, 0.34, 0.55) : paint(0x777b7d, 0.8, 0.25);
  return part((b) => {
    const blade = new THREE.CapsuleGeometry(0.042, 0.18, 6, 10);
    blade.scale(1, 1, 0.3);
    b.add(blade, bladeMaterial, new THREE.Vector3(0, 0.2, 0));
    ball(b, 0.045, 1, 0.45, 0.3, bladeMaterial, 0, 0.32, 0);
    capsule(b, 0.024, 0.1, ARMOR_EDGE, 0, 0.075, 0, 0, 0, Math.PI / 2);
    capsule(b, 0.022, 0.05, DARK_LEATHER, 0, 0.0, 0);
    ball(b, 0.033, 1, 1, 1, RUST, 0, -0.035, 0);
  });
}

function machete(): THREE.Group {
  return part((b) => {
    const blade = new THREE.CapsuleGeometry(0.065, 0.17, 6, 10);
    blade.scale(1, 1, 0.22);
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.28));
    b.add(blade, paint(0x77706a, 0.84, 0.18), new THREE.Vector3(0.02, 0.2, 0), quaternion);
    ball(b, 0.05, 1, 0.55, 0.25, RUST, 0.07, 0.27, 0);
    for (const [x, y] of [[0.06, 0.16], [0.09, 0.22], [0.03, 0.28]]) {
      ball(b, 0.012, 1, 1, 1, RUST, x, y, 0.02);
    }
    capsule(b, 0.026, 0.1, DARK_LEATHER, 0, 0.02, 0, 0, 0, 0.28);
  });
}

function roundShield(palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  return part((b) => {
    const disc = new THREE.CylinderGeometry(0.265, 0.265, 0.05, 36);
    b.add(disc, WOOD, new THREE.Vector3(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    b.add(new THREE.CircleGeometry(0.245, 36), WOOD_PLATE, new THREE.Vector3(0, 0, 0.032));
    torus(b, 0.265, 0.03, ARMOR_EDGE, 0, 0, 0.012, 0, 0, 0);
    torus(b, 0.19, 0.012, ARMOR, 0, 0, 0.036, 0, 0, 0);
    ball(b, 0.075, 1, 1, 0.5, ARMOR_EDGE, 0, 0, 0.045);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      ball(b, 0.02, 1, 1, 1, STEEL, Math.cos(angle) * 0.225, Math.sin(angle) * 0.225, 0.04);
    }
    capsule(b, 0.03, 0.12, team, 0, -0.23, 0.03, 0, 0, 0);
    for (const x of [-0.1, 0.1]) ball(b, 0.012, 1, 1, 1, RUST, x, 0.12, 0.045);
  });
}

function bow(): THREE.Group {
  return part((b) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, -0.4, 0),
      new THREE.Vector3(0.17, -0.22, 0),
      new THREE.Vector3(0.21, 0, 0),
      new THREE.Vector3(0.17, 0.22, 0),
      new THREE.Vector3(0.02, 0.4, 0),
    ]);
    b.add(new THREE.TubeGeometry(curve, 16, 0.019, 6, false), WOOD, new THREE.Vector3(0, 0, 0));
    capsule(b, 0.004, 0.62, WHITE, 0.03, 0, 0);
    capsule(b, 0.022, 0.09, DARK_LEATHER, 0.19, 0, 0);
    ball(b, 0.024, 1, 1, 1, ARMOR, 0.02, 0.41, 0);
    ball(b, 0.024, 1, 1, 1, ARMOR, 0.02, -0.41, 0);
  });
}

function lance(palette: TeamPalette): THREE.Group {
  return part((b) => {
    capsule(b, 0.022, 0.66, WOOD, 0, 0.22, 0);
    b.add(new THREE.ConeGeometry(0.05, 0.16, 10), paint(0x8b8e90, 0.55, 0.35), new THREE.Vector3(0, 0.7, 0));
    const team = paintTeam(palette);
    ball(b, 0.09, 1.2, 0.7, 0.2, team, 0.1, 0.53, 0);
    ball(b, 0.03, 1, 1, 1, DARK_LEATHER, 0, 0.06, 0);
  });
}

function quiver(palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  return part((b) => {
    capsule(b, 0.06, 0.16, DARK_LEATHER, 0, 0.02, 0, 0, 0, -0.22);
    torus(b, 0.06, 0.015, team, 0, 0.1, 0, 0, 0, 0);
    for (const x of [-0.035, 0, 0.035]) {
      capsule(b, 0.007, 0.16, WOOD, x, 0.17, 0, 0, 0, -0.22);
      ball(b, 0.02, 1, 1.4, 0.6, WHITE, x, 0.26, 0);
    }
  });
}

function makeHumanoid(kind: UnitKind, palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const torso = makeTorso(kind, palette, variant);
  torso.position.y = HIP_Y;
  root.add(torso);

  const head = makeHead(kind, palette, variant);
  head.position.y = NECK_Y;
  torso.add(head);

  const leftArm = makeArm(kind, palette);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(kind === "archer" ? -1.0 : -0.4, 0, kind === "archer" ? -0.25 : -0.3);
  torso.add(leftArm);

  const rightArm = makeArm(kind, palette);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(kind === "archer" ? -0.45 : -1.05, 0, kind === "archer" ? 0.25 : 0.72);
  torso.add(rightArm);

  const leftLeg = makeLeg(kind);
  leftLeg.position.set(-0.095, HIP_Y, 0);
  root.add(leftLeg);
  const rightLeg = makeLeg(kind);
  rightLeg.position.set(0.095, HIP_Y, 0);
  root.add(rightLeg);

  if (kind === "archer") {
    const bag = quiver(palette);
    bag.position.set(0.11, 0.12, -0.15);
    torso.add(bag);
    const weapon = bow();
    weapon.position.set(-0.3, 0.22, 0.12);
    weapon.rotation.set(0.08, 0.15, 0.05);
    root.add(weapon);
  } else if (kind === "shield") {
    const weapon = sword();
    holdWeapon(weapon);
    rightArm.add(weapon);
    const shield = roundShield(palette);
    shield.position.set(-0.12, 0.08, 0.12);
    shield.rotation.set(0.05, -0.12, 0.05);
    leftArm.add(shield);
  } else if (kind === "elite") {
    const weapon = sword(true);
    holdWeapon(weapon);
    rightArm.add(weapon);
  } else if (kind === "cavalry") {
    const weapon = lance(palette);
    weapon.position.set(0.3, 0.38, 0.06);
    root.add(weapon);
    const shield = roundShield(palette);
    shield.position.set(-0.12, 0.08, 0.12);
    shield.rotation.set(0.05, -0.12, 0.05);
    leftArm.add(shield);
  } else {
    const weapon = machete();
    holdWeapon(weapon, 0.05);
    rightArm.add(weapon);
  }

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    mountLegs: [],
    height: 0.9,
    kind,
  };
}

function makeHorseLeg(x: number, z: number): THREE.Group {
  return part((b) => {
    capsule(b, 0.065, 0.16, HORSE, 0, -0.11, 0);
    ball(b, 0.075, 1.05, 0.7, 1.25, HORSE_DARK, 0, -0.235, 0.02);
  }).translateX(x).translateZ(z);
}

function makeCavalry(palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const mount = new THREE.Group();
  root.add(mount);
  const horse = part((b) => {
    ball(b, 0.26, 1.0, 1.0, 1.45, HORSE, 0, 0.42, 0);
    ball(b, 0.2, 0.9, 0.9, 0.9, HORSE, 0, 0.48, 0.3);
    capsule(b, 0.11, 0.16, HORSE, 0, 0.62, 0.3, 0.55, 0, 0);
    ball(b, 0.2, 1.0, 1.0, 0.95, HORSE, 0, 0.74, 0.44);
    ball(b, 0.12, 1.0, 0.85, 1.1, HORSE_LIGHT, 0, 0.68, 0.6);
    ball(b, 0.05, 1, 0.8, 0.7, HORSE_DARK, 0, 0.7, 0.69);
    torus(b, 0.09, 0.012, DARK_LEATHER, 0, 0.84, 0.56, 0.4, 0, 0);
    ball(b, 0.025, 1, 1, 1, STEEL, 0, 0.93, 0.5);
    capsule(b, 0.016, 0.1, DARK_LEATHER, 0, 0.8, 0.63, 0.3, 0, 0);
    for (const x of [-0.16, 0.16]) capsule(b, 0.02, 0.08, paintTeam(palette), x, 0.48, -0.02);
    for (const x of [-0.085, 0.085]) {
      b.add(new THREE.ConeGeometry(0.045, 0.12, 10), HORSE_DARK, new THREE.Vector3(x, 0.94, 0.38));
      ball(b, 0.03, 1, 1, 0.6, INK, x, 0.76, 0.59);
      ball(b, 0.01, 1, 1, 1, WHITE, x + 0.01, 0.77, 0.61);
    }
    const mane = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.92, 0.32),
      new THREE.Vector3(0, 0.82, 0.24),
      new THREE.Vector3(0, 0.72, 0.18),
    ]);
    b.add(new THREE.TubeGeometry(mane, 6, 0.045, 8, false), HORSE_DARK, new THREE.Vector3(0, 0, 0));
    const tail = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.5, -0.4),
      new THREE.Vector3(0, 0.38, -0.52),
      new THREE.Vector3(0, 0.24, -0.55),
    ]);
    b.add(new THREE.TubeGeometry(tail, 6, 0.04, 8, false), HORSE_DARK, new THREE.Vector3(0, 0, 0));
    const team = paintTeam(palette);
    ball(b, 0.18, 0.35, 0.65, 1.3, team, -0.24, 0.44, 0);
    ball(b, 0.18, 0.35, 0.65, 1.3, team, 0.24, 0.44, 0);
    ball(b, 0.16, 0.95, 0.28, 1.15, team, 0, 0.56, 0);
    ball(b, 0.1, 0.9, 0.3, 0.9, DARK_LEATHER, 0, 0.57, 0);
    torus(b, 0.15, 0.014, DARK_LEATHER, 0, 0.58, 0, Math.PI / 2, 0, 0);
    torus(b, 0.19, 0.012, paintTeam(palette), 0, 0.55, 0, Math.PI / 2, 0, 0);
  });
  mount.add(horse);

  const mountLegs: THREE.Group[] = [];
  for (const x of [-0.14, 0.14]) {
    for (const z of [-0.24, 0.24]) {
      const leg = makeHorseLeg(x, z);
      leg.position.y = 0.22;
      mount.add(leg);
      mountLegs.push(leg);
    }
  }

  const torso = makeTorso("cavalry", palette, variant);
  torso.position.set(0, 0.62, -0.12);
  root.add(torso);
  const head = makeHead("cavalry", palette, variant);
  head.position.y = NECK_Y;
  torso.add(head);
  const leftArm = makeArm("cavalry", palette);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(-0.5, 0, -0.35);
  torso.add(leftArm);
  const rightArm = makeArm("cavalry", palette);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(-0.9, 0, 0.55);
  torso.add(rightArm);
  const weapon = lance(palette);
  weapon.position.set(0.3, 0.38, 0.06);
  root.add(weapon);
  const shield = roundShield(palette);
  shield.position.set(-0.05, -0.12, 0.12);
  shield.rotation.set(0.05, 0.45, 0.05);
  leftArm.add(shield);

  const leftLeg = part((b) => {
    capsule(b, 0.075, 0.1, LEATHER, 0, -0.08, 0.02, -0.7, 0, 0);
    ball(b, 0.07, 1, 0.8, 1.2, DARK_LEATHER, 0, -0.18, 0.07);
  });
  leftLeg.position.set(-0.2, 0.64, -0.02);
  root.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.2;
  root.add(rightLeg);

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    mount,
    mountLegs,
    height: 1.32,
    kind: "cavalry",
  };
}

export function buildUnit(kind: UnitKind, palette: TeamPalette, variant: number = 0): UnitRig {
  const rig = kind === "cavalry" ? makeCavalry(palette, variant) : makeHumanoid(kind, palette, variant);
  rig.root.name = "unit-" + kind;
  rig.root.userData.unitKind = kind;
  rig.torso.name = "torso";
  rig.head.name = "head";
  rig.leftArm.name = "leftArm";
  rig.rightArm.name = "rightArm";
  rig.leftLeg.name = "leftLeg";
  rig.rightLeg.name = "rightLeg";
  if (rig.mount) rig.mount.name = "mount";
  rig.mountLegs.forEach((leg, index) => {
    leg.name = "mountLeg" + index;
  });
  return rig;
}
