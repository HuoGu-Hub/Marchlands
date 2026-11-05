import * as THREE from "three";
import { buildTown, buildWall, paletteFor } from "./buildings";

const PITCH = (55 * Math.PI) / 180;
const DISTANCE = 96;
const VIEW_HEIGHT = 16;
const TARGET = new THREE.Vector3(0, 1.2, 0);

const TOWNS = [
  { x: -7.4, level: 1, owner: 0, title: "L1 据点 · 中立", color: "#c2bcaa", kind: "barbarian" as const },
  { x: 0, level: 2, owner: 1, title: "L2 据点 · 绿方", color: "#8ed9a0", kind: "mage" as const },
  { x: 7.4, level: 3, owner: 2, title: "L3 据点 · 红方", color: "#ef9278", kind: "ranger" as const },
];

export function runTownShowcase(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="town-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">单建筑据点 <b>L1 / L2 / L3</b></div>',
    '    <div class="chip">屋顶与旗帜 <b>阵营色</b></div>',
    '    <div class="chip">建筑外形 <b>类型</b></div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转 · 滚轮缩放</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#town-canvas");
  if (!canvas) throw new Error("missing town canvas");
  new TownShowcase(canvas);
}

function label(text: string, color: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 44px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.9)";
    context.lineWidth = 8;
    context.strokeText(text, 320, 48);
    context.fillStyle = color;
    context.fillText(text, 320, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(5.6, 0.84, 1);
  return sprite;
}

class TownShowcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private yaw = 0;
  private targetYaw = 0;
  private zoom = 1;
  private raf = 0;
  private last = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color(0x0b110d);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
    this.scene.add(new THREE.HemisphereLight(0xe6efd2, 0x172116, 1.5));
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.6);
    sun.position.set(24, 44, 20);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ea2ff, 0.55);
    rim.position.set(-28, 18, -24);
    this.scene.add(rim);

    this.build();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(42, 0.6, 20),
      new THREE.MeshStandardMaterial({ color: 0x35472f, roughness: 1 }),
    );
    ground.position.set(0, -0.3, 0);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(42, 21, 0x6d8a5c, 0x4b6440);
    grid.position.set(0, 0.01, 0);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    this.scene.add(grid);

    for (const town of TOWNS) {
      const group = buildTown(town.level, paletteFor(town.owner), town.owner * 31 + town.level, town.kind);
      group.add(buildWall(town.level, paletteFor(town.owner), 3.3));
      group.position.set(town.x, 0, 0);
      this.scene.add(group);

      const shadow = new THREE.Mesh(
        new THREE.CircleGeometry(4.2, 30),
        new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }),
      );
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(town.x, 0.012, 0);
      this.scene.add(shadow);

      const apron = new THREE.Mesh(
        new THREE.CylinderGeometry(3.7, 3.9, 0.16, 12),
        new THREE.MeshStandardMaterial({ color: 0x3d4f34, roughness: 1, flatShading: true }),
      );
      apron.position.set(town.x, 0.08, 0);
      this.scene.add(apron);

      const side = new THREE.MeshStandardMaterial({ color: 0x6a6150, roughness: 1, flatShading: true });
      const top = new THREE.MeshStandardMaterial({ color: 0x8a8270, roughness: 0.95 });
      const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.7, 0.22, 10), [side, top, side]);
      platform.position.set(town.x, 0.11, 0);
      this.scene.add(platform);

      const caption = label(town.title, town.color);
      caption.position.set(town.x, 1.0, 4.6);
      this.scene.add(caption);
    }
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(120, now - this.last);
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
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.targetYaw += Math.PI / 2;
    if (event.key === "e" || event.key === "E") this.targetYaw -= Math.PI / 2;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.9, 2.2);
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
