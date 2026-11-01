import * as THREE from "three";

export type RoadKind = "straight" | "curve" | "up" | "down" | "cross" | "tee";

export const ROAD_KINDS: RoadKind[] = ["straight", "curve", "up", "down", "cross", "tee"];

export const ROAD_NAMES: Record<RoadKind, string> = {
  straight: "直道",
  curve: "C 型道路",
  up: "上坡道路",
  down: "下坡道路",
  cross: "十字路口",
  tee: "T 型路口",
};

export const ROAD_WIDTH = 1.6;
const TILE = 4;

let cobble: THREE.CanvasTexture | null = null;

function cobbleTexture(): THREE.CanvasTexture {
  if (cobble) return cobble;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#5f5848";
    context.fillRect(0, 0, 256, 256);
    let seed = 5521;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let row = 0; row < 9; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const w = 22 + random() * 6;
        const h = 20 + random() * 6;
        const x = col * 29 + (row % 2) * 12 + 3;
        const y = row * 29 + 3;
        context.fillStyle =
          "rgb(" +
          Math.floor(104 + random() * 22) +
          "," +
          Math.floor(96 + random() * 20) +
          "," +
          Math.floor(78 + random() * 18) +
          ")";
        context.beginPath();
        context.roundRect(x, y, w, h, 5);
        context.fill();
        context.strokeStyle = "rgba(40, 36, 28, 0.32)";
        context.lineWidth = 2;
        context.stroke();
        context.fillStyle = "rgba(255, 245, 220, 0.05)";
        context.fillRect(x + 3, y + 3, w - 6, 3);
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  cobble = texture;
  return texture;
}

const roadMaterial = new THREE.MeshStandardMaterial({ map: cobbleTexture(), roughness: 1 });
const shoulderMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4a36, roughness: 1 });
const curbMaterial = new THREE.MeshStandardMaterial({ color: 0xb3aa96, roughness: 1 });
const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6a5b, roughness: 1 });
const earthMaterial = new THREE.MeshStandardMaterial({ color: 0x5b4b35, roughness: 1, side: THREE.DoubleSide });

function ribbon(points: THREE.Vector3[], width: number, offsetY: number, material: THREE.Material, vScale = 2.6): THREE.Mesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let distance = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const crossing = new THREE.Vector3().subVectors(next, previous).normalize();
    const normal = new THREE.Vector3(-crossing.z, 0, crossing.x).normalize();
    if (index > 0) distance += point.distanceTo(points[index - 1]);
    const half = width / 2;
    for (const side of [-1, 1]) {
      positions.push(point.x + normal.x * half * side, point.y + offsetY, point.z + normal.z * half * side);
      uvs.push(side < 0 ? 0 : 1, distance / vScale);
    }
    if (index < points.length - 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

function offsetPoints(points: THREE.Vector3[], offset: number): THREE.Vector3[] {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(points.length - 1, index + 1)];
    const crossing = new THREE.Vector3().subVectors(next, previous).normalize();
    const normal = new THREE.Vector3(-crossing.z, 0, crossing.x).normalize();
    return point.clone().addScaledVector(normal, offset);
  });
}

function addEdges(group: THREE.Group, points: THREE.Vector3[], width: number, y = 0.08): void {
  for (const side of [-1, 1]) {
    const edge = ribbon(offsetPoints(points, side * (width / 2 + 0.07)), 0.14, y, curbMaterial, 4);
    group.add(edge);
  }
}

function addShoulder(group: THREE.Group, points: THREE.Vector3[], width: number): void {
  group.add(ribbon(points, width + 0.5, -0.02, shoulderMaterial, 3));
}

function straightPoints(): THREE.Vector3[] {
  return [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, TILE / 2), new THREE.Vector3(0, 0, TILE)];
}

function curvePoints(): THREE.Vector3[] {
  const radius = 2.4;
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 28; index += 1) {
    const t = (index / 28) * (Math.PI / 2);
    points.push(new THREE.Vector3(radius - radius * Math.cos(t), 0, radius * Math.sin(t)));
  }
  return points;
}

function slopePoints(up: boolean): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= 14; index += 1) {
    const t = index / 14;
    points.push(new THREE.Vector3(0, up ? t * 1.2 : (1 - t) * 1.2, t * TILE));
  }
  return points;
}

function wedge(width: number, length: number, height: number): THREE.Mesh {
  const w = width / 2;
  const positions = [
    -w, 0, 0, w, 0, 0, w, 0, length, -w, 0, length,
    -w, height, length, w, height, length,
  ];
  const indices = [
    0, 1, 2, 0, 2, 3,
    3, 2, 5, 3, 5, 4,
    0, 3, 4,
    1, 5, 2,
    0, 4, 5, 0, 5, 1,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1], 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, earthMaterial);
}

function crossShape(half = 3, arm = 0.8, pad = 1.6): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-half, -arm);
  shape.lineTo(-pad, -arm);
  shape.lineTo(-pad, -half);
  shape.lineTo(pad, -half);
  shape.lineTo(pad, -arm);
  shape.lineTo(half, -arm);
  shape.lineTo(half, arm);
  shape.lineTo(pad, arm);
  shape.lineTo(pad, half);
  shape.lineTo(-pad, half);
  shape.lineTo(-pad, arm);
  shape.lineTo(-half, arm);
  shape.closePath();
  return shape;
}

function teeShape(half = 3, arm = 0.8, pad = 1.6): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-pad, -half);
  shape.lineTo(pad, -half);
  shape.lineTo(pad, -arm);
  shape.lineTo(half, -arm);
  shape.lineTo(half, arm);
  shape.lineTo(pad, arm);
  shape.lineTo(pad, half);
  shape.lineTo(-pad, half);
  shape.lineTo(-pad, arm);
  shape.lineTo(-pad, -arm);
  shape.closePath();
  return shape;
}

function pavedShape(shape: THREE.Shape, depth: number, material: THREE.Material, y: number): THREE.Mesh {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  return mesh;
}

function buildStraight(): THREE.Group {
  const group = new THREE.Group();
  const points = straightPoints();
  addShoulder(group, points, ROAD_WIDTH);
  group.add(ribbon(points, ROAD_WIDTH, 0.015, roadMaterial));
  addEdges(group, points, ROAD_WIDTH);
  return group;
}

function buildCurve(): THREE.Group {
  const group = new THREE.Group();
  const points = curvePoints();
  addShoulder(group, points, ROAD_WIDTH);
  group.add(ribbon(points, ROAD_WIDTH, 0.015, roadMaterial));
  addEdges(group, points, ROAD_WIDTH);
  return group;
}

function buildSlope(up: boolean): THREE.Group {
  const group = new THREE.Group();
  const points = slopePoints(up);
  const base = wedge(ROAD_WIDTH + 0.34, TILE, 1.2);
  if (!up) {
    base.scale.z = -1;
    base.position.z = TILE;
  }
  group.add(base);
  addShoulder(group, points, ROAD_WIDTH);
  group.add(ribbon(points, ROAD_WIDTH, 0.015, roadMaterial));
  addEdges(group, points, ROAD_WIDTH, 0.1);
  return group;
}

function buildCross(): THREE.Group {
  const group = new THREE.Group();
  group.add(pavedShape(crossShape(3.12, 0.92, 1.72), 0.05, edgeMaterial, 0.01));
  group.add(pavedShape(crossShape(3, 0.8, 1.6), 0.07, roadMaterial, 0.04));
  return group;
}

function buildTee(): THREE.Group {
  const group = new THREE.Group();
  group.add(pavedShape(teeShape(3.12, 0.92, 1.72), 0.05, edgeMaterial, 0.01));
  group.add(pavedShape(teeShape(3, 0.8, 1.6), 0.07, roadMaterial, 0.04));
  const wall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.38, 3.4), curbMaterial);
  wall.position.set(-1.66, 0.19, 0);
  group.add(wall);
  return group;
}

export function buildRoad(kind: RoadKind): THREE.Group {
  const group = new THREE.Group();
  if (kind === "straight") group.add(buildStraight());
  else if (kind === "curve") group.add(buildCurve());
  else if (kind === "up") group.add(buildSlope(true));
  else if (kind === "down") group.add(buildSlope(false));
  else if (kind === "cross") group.add(buildCross());
  else group.add(buildTee());
  group.name = "road-" + kind;
  return group;
}
