import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export interface TeamPalette {
  roof: number;
  roofEdge: number;
  cloth: number;
}

export const TEAM_PALETTES: Record<number, TeamPalette> = {
  0: { roof: 0x6a6d75, roofEdge: 0x50535b, cloth: 0xd0caba },
  1: { roof: 0x5a8663, roofEdge: 0x446a4d, cloth: 0x8ed9a0 },
  2: { roof: 0xa25443, roofEdge: 0x84402f, cloth: 0xef9278 },
};

export const STONE = 0x8d8676;
export const STONE_DARK = 0x6b6557;
export const STONE_LIGHT = 0xa39b88;
export const TIMBER = 0x4a3626;
export const TIMBER_DARK = 0x33261a;
export const PLASTERS = [0xd9caab, 0xd0bd9a, 0xc9b697];
export const BARN = 0x8a6a45;
export const HAY = 0xc6a55e;
export const IRON = 0x545a60;
export const GLOW = 0xffb266;

interface MaterialOptions {
  rough?: number;
  metal?: number;
  side?: THREE.Side;
  emissive?: number;
  emissiveIntensity?: number;
}

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function material(color: number, options: MaterialOptions = {}): THREE.MeshStandardMaterial {
  const key = [
    color,
    options.rough ?? 0.9,
    options.metal ?? 0,
    options.side ?? THREE.FrontSide,
    options.emissive ?? -1,
    options.emissiveIntensity ?? 0,
  ].join(":");
  const cached = materialCache.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: options.rough ?? 0.9,
    metalness: options.metal ?? 0,
    side: options.side ?? THREE.FrontSide,
    flatShading: true,
  });
  if (options.emissive !== undefined) {
    mat.emissive = new THREE.Color(options.emissive);
    mat.emissiveIntensity = options.emissiveIntensity ?? 0.7;
  }
  mat.userData.shared = true;
  materialCache.set(key, mat);
  return mat;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

const ZERO = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);

export class ModelBuilder {
  private readonly parts: Part[] = [];

  addMatrix(geometry: THREE.BufferGeometry, mat: THREE.Material, matrix: THREE.Matrix4): this {
    this.parts.push({ geometry, material: mat, matrix });
    return this;
  }

  add(
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    position: THREE.Vector3 = ZERO,
    quaternion: THREE.Quaternion = new THREE.Quaternion(),
  ): this {
    return this.addMatrix(
      geometry,
      mat,
      new THREE.Matrix4().compose(position, quaternion, ONE),
    );
  }

  box(
    size: [number, number, number],
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return this.add(new THREE.BoxGeometry(...size), mat, new THREE.Vector3(x, y, z), quaternion);
  }

  cylinder(
    radiusTop: number,
    radiusBottom: number,
    height: number,
    segments: number,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
  ): this {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
    return this.add(
      new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
      mat,
      new THREE.Vector3(x, y, z),
      quaternion,
    );
  }

  cone(radius: number, height: number, segments: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0): this {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    return this.add(new THREE.ConeGeometry(radius, height, segments), mat, new THREE.Vector3(x, y, z), quaternion);
  }

  shape(shape: THREE.Shape, mat: THREE.Material, x: number, y: number, z: number, ry = 0): this {
    const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    return this.add(new THREE.ShapeGeometry(shape), mat, new THREE.Vector3(x, y, z), quaternion);
  }

  finish(): THREE.Group {
    const group = new THREE.Group();
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const part of this.parts) {
      let geometry = part.geometry;
      if (geometry.index) {
        const nonIndexed = geometry.toNonIndexed();
        geometry.dispose();
        geometry = nonIndexed;
      }
      geometry.applyMatrix4(part.matrix);
      if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
      if (!geometry.getAttribute("uv")) {
        const count = geometry.getAttribute("position").count;
        geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
      }
      const bucket = buckets.get(part.material);
      if (bucket) bucket.push(geometry);
      else buckets.set(part.material, [geometry]);
    }

    for (const [mat, geometries] of buckets) {
      const merged = mergeGeometries(geometries, false);
      if (!merged) throw new Error("building geometry merge failed");
      group.add(new THREE.Mesh(merged, mat));
      geometries.forEach((geometry) => geometry.dispose());
    }
    this.parts.length = 0;
    return group;
  }
}

export function roofSlab(
  builder: ModelBuilder,
  mat: THREE.Material,
  length: number,
  span: number,
  rise: number,
  overhang: number,
  eaveY: number,
  rotY: number,
  thickness = 0.075,
): void {
  const halfSpan = span / 2 + overhang;
  const slope = Math.hypot(halfSpan, rise);
  const angle = Math.atan2(rise, halfSpan);
  const qY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  for (const side of [1, -1]) {
    const q = qY.clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(side * angle, 0, 0)),
    );
    const position = new THREE.Vector3(0, eaveY + rise / 2, (side * halfSpan) / 2).applyQuaternion(qY);
    builder.addMatrix(
      new THREE.BoxGeometry(length + overhang * 2, thickness, slope + 0.02),
      mat,
      new THREE.Matrix4().compose(position, q, ONE),
    );
  }
  const ridge = new THREE.BoxGeometry(length + overhang * 2 + 0.03, 0.06, 0.15);
  builder.addMatrix(
    ridge,
    mat,
    new THREE.Matrix4().compose(new THREE.Vector3(0, eaveY + rise, 0), qY, ONE),
  );
}

export function gableEnd(
  builder: ModelBuilder,
  mat: THREE.Material,
  span: number,
  length: number,
  rise: number,
  eaveY: number,
  rotY: number,
  profile: "triangle" | "barn" = "triangle",
): void {
  const shape = new THREE.Shape();
  if (profile === "barn") {
    const shoulder = span * 0.29;
    const shoulderRise = rise * 0.55;
    shape.moveTo(-span / 2, 0);
    shape.lineTo(span / 2, 0);
    shape.lineTo(shoulder, shoulderRise);
    shape.lineTo(span * 0.14, rise);
    shape.lineTo(-span * 0.14, rise);
    shape.lineTo(-shoulder, shoulderRise);
    shape.closePath();
  } else {
    shape.moveTo(-span / 2, 0);
    shape.lineTo(span / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
  }
  const qY = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0));
  for (const side of [1, -1]) {
    const position = new THREE.Vector3((side * length) / 2, eaveY, 0).applyQuaternion(qY);
    const q = qY.clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (side * Math.PI) / 2, 0)),
    );
    builder.addMatrix(new THREE.ShapeGeometry(shape), mat, new THREE.Matrix4().compose(position, q, ONE));
  }
}

export function archShape(width: number, height: number): THREE.Shape {
  const radius = width / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-radius, 0);
  shape.lineTo(-radius, height - radius);
  shape.absarc(0, height - radius, radius, Math.PI, 0, true);
  shape.lineTo(radius, 0);
  shape.closePath();
  return shape;
}

export function flagShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(width, 0.02);
  shape.lineTo(width * 0.72, -height * 0.45);
  shape.lineTo(width, -height);
  shape.lineTo(0, -height * 0.94);
  shape.closePath();
  return shape;
}

export function bannerShape(width: number, height: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, -height * 0.82);
  shape.lineTo(0, -height);
  shape.lineTo(-width / 2, -height * 0.82);
  shape.closePath();
  return shape;
}

export function timberFrame(
  builder: ModelBuilder,
  width: number,
  depth: number,
  height: number,
  baseY: number,
  beam: THREE.Material,
): void {
  const halfW = width / 2;
  const halfD = depth / 2;
  for (const x of [-halfW + 0.03, halfW - 0.03]) {
    for (const z of [-halfD + 0.03, halfD - 0.03]) {
      builder.box([0.075, height, 0.075], beam, x, baseY + height / 2, z);
    }
  }
  for (const z of [-halfD - 0.012, halfD + 0.012]) {
    builder.box([width, 0.07, 0.05], beam, 0, baseY + height - 0.055, z);
    builder.box([width, 0.06, 0.05], beam, 0, baseY + 0.05, z);
  }
  for (const x of [-halfW - 0.012, halfW + 0.012]) {
    builder.box([0.05, 0.07, depth], beam, x, baseY + height - 0.055, 0);
  }
}

export function windowPanel(
  builder: ModelBuilder,
  x: number,
  y: number,
  z: number,
  frame: THREE.Material,
  lit: THREE.Material,
  size = 1,
): void {
  builder.box([0.26 * size, 0.3 * size, 0.03], frame, x, y, z);
  builder.box([0.18 * size, 0.22 * size, 0.04], lit, x, y, z + 0.012);
}


let roofTileCache: THREE.CanvasTexture | null = null;

export function roofTileTexture(): THREE.CanvasTexture {
  if (roofTileCache) return roofTileCache;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#c8c8c8";
    context.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 8; row += 1) {
      const y = row * 16;
      for (let col = -1; col < 9; col += 1) {
        const x = col * 16 + (row % 2) * 8;
        context.fillStyle = row % 2 === 0 ? "#d8d8d8" : "#c0c0c0";
        context.beginPath();
        context.roundRect(x + 1, y + 1, 15, 14, 3);
        context.fill();
        context.strokeStyle = "rgba(40, 40, 40, 0.35)";
        context.lineWidth = 1.5;
        context.stroke();
        context.fillStyle = "rgba(255, 255, 255, 0.22)";
        context.fillRect(x + 3, y + 2, 11, 2);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.2, 1.8);
  texture.anisotropy = 4;
  roofTileCache = texture;
  return texture;
}

