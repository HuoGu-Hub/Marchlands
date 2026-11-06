import * as THREE from "three";
import { ROAD_NAMES, buildRoad } from "./road-kit";
import type { RoadKind } from "./road-kit";

const PITCH = (45 * Math.PI) / 180;
const DISTANCE = 85;
const VIEW_HEIGHT = 22;
const TARGET = new THREE.Vector3(0, 0.6, 0);

const SPOTS: Array<{ kind: RoadKind; x: number; z: number }> = [
  { kind: "straight", x: -8, z: -5 },
  { kind: "curve", x: 0, z: -5 },
  { kind: "up", x: 8, z: -5 },
  { kind: "down", x: -8, z: 2 },
  { kind: "cross", x: 0, z: 2.5 },
  { kind: "tee", x: 8, z: 2.5 },
];

export function runRoadShowcase(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="road-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">道路模块 <b>6 种</b></div>',
    '    <div class="chip">路宽 <b>1.6 m</b></div>',
    '    <div class="chip">路口 <b>十字 / T 型</b></div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转 · 滚轮缩放</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#road-canvas");
  if (!canvas) throw new Error("missing road canvas");
  new RoadShowcase(canvas);
}

function label(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 112;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 50px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.9)";
    context.lineWidth = 8;
    context.strokeText(text, 320, 56);
    context.fillStyle = "#f2ead7";
    context.fillText(text, 320, 56);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(3.6, 0.63, 1);
  return sprite;
}

class RoadShowcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private yaw = 0.35;
  private targetYaw = 0.35;
  private zoom = 1;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color(0x0b110d);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0xe6efd2, 0x172116, 1.5));
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.6);
    sun.position.set(20, 36, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ea2ff, 0.55);
    rim.position.set(-24, 14, -20);
    this.scene.add(rim);

    this.build();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private build(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(40, 0.6, 26),
      new THREE.MeshStandardMaterial({ color: 0x35472f, roughness: 1 }),
    );
    ground.position.set(0, -0.3, -1);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(40, 20, 0x6d8a5c, 0x4b6440);
    grid.position.set(0, 0.01, -1);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    this.scene.add(grid);

    for (const spot of SPOTS) {
      const road = buildRoad(spot.kind);
      road.position.set(spot.x, 0, spot.z);
      this.scene.add(road);
      const caption = label(ROAD_NAMES[spot.kind]);
      caption.position.set(spot.x, 1.5, spot.z + (spot.kind === "cross" || spot.kind === "tee" ? 3.9 : 0.6));
      this.scene.add(caption);
    }
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(100, now - this.last);
    this.last = now;
    let difference = this.targetYaw - this.yaw;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    this.yaw += difference * Math.min(1, delta / 150);
    const horizontal = Math.cos(PITCH) * DISTANCE;
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * horizontal,
      TARGET.y + Math.sin(PITCH) * DISTANCE,
      TARGET.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(TARGET);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.targetYaw += Math.PI / 4;
    if (event.key === "e" || event.key === "E") this.targetYaw -= Math.PI / 4;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.85, 2.2);
    this.resize();
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = VIEW_HEIGHT / this.zoom;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }
}
