import * as THREE from "three";
import { paletteFor } from "./buildings";
import { UNIT_DESCRIPTIONS, UNIT_KINDS, UNIT_NAMES } from "./unit-models";
import type { UnitKind } from "./unit-models";
import { UnitActor } from "./unit-actor";

const PITCH = (30 * Math.PI) / 180;
const DISTANCE = 55;
const VIEW_HEIGHT = 9.2;
const TARGET = new THREE.Vector3(0, 0.55, 0);
const COLUMNS = [-4.8, -2.4, 0, 2.4, 4.8];
const ROWS = [-3.5, 0, 3.5];

const TEAMS = [
  { owner: 0, name: "中立", color: "#c2bcaa" },
  { owner: 1, name: "绿方", color: "#8ed9a0" },
  { owner: 2, name: "红方", color: "#ef9278" },
];

export function runUnitGallery(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="unit-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">单位库 <b>5 类 × 3 阵营</b></div>',
    '    <div class="chip">阵营色 <b>披风 / 盾面 / 旗帜</b></div>',
    '    <div class="chip">动作 <b>行走循环</b></div>',
    '    <div class="chip">造型 <b>圆润 v3</b></div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转 · 滚轮缩放</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#unit-canvas");
  if (!canvas) throw new Error("missing unit canvas");
  new UnitGallery(canvas);
}

function label(text: string, color = "#f2ead7", scale = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 50px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.9)";
    context.lineWidth = 8;
    context.strokeText(text, 256, 64);
    context.fillStyle = color;
    context.fillText(text, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(2.6 * scale, 0.65 * scale, 1);
  return sprite;
}

class UnitGallery {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly actors: UnitActor[] = [];
  private yaw = 0;
  private targetYaw = 0;
  private zoom = 1;
  private raf = 0;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.scene.background = new THREE.Color(0x0b110d);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 140);
    this.scene.add(new THREE.HemisphereLight(0xe6efd2, 0x172116, 1.55));
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.8);
    sun.position.set(14, 28, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ea2ff, 0.7);
    rim.position.set(-18, 10, -16);
    this.scene.add(rim);

    this.build();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(20, 0.5, 14),
      new THREE.MeshStandardMaterial({ color: 0x3c4a34, roughness: 1 }),
    );
    ground.position.set(0, -0.25, 0);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(20, 20, 0x6d8a5c, 0x4b6440);
    grid.position.y = 0.01;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    this.scene.add(grid);

    TEAMS.forEach((team, row) => {
      const heading = label(team.name, team.color, 0.95);
      heading.position.set(-7.0, 0.95, ROWS[row]);
      this.scene.add(heading);
    });

    UNIT_KINDS.forEach((kind, column) => {
      const heading = label(UNIT_NAMES[kind], "#f0dfb8", 0.9);
      heading.position.set(COLUMNS[column], 2.0, -5.1);
      this.scene.add(heading);
      const desc = label(UNIT_DESCRIPTIONS[kind], "#b9c6a6", 0.65);
      desc.position.set(COLUMNS[column], 1.65, -5.1);
      this.scene.add(desc);

      TEAMS.forEach((team, row) => {
        const actor = new UnitActor({
          kind,
          palette: paletteFor(team.owner),
          variant: column + row,
          phase: (column * 0.7 + row * 0.4) % (Math.PI * 2),
        });
        actor.position.set(COLUMNS[column], 0.02, ROWS[row]);
        actor.rotation.y = 0.16;
        actor.setMoving(true);
        this.scene.add(actor);
        this.actors.push(actor);
        const base = new THREE.Mesh(
          new THREE.CircleGeometry(0.55, 20),
          new THREE.MeshStandardMaterial({ color: 0x4a4b40, roughness: 1 }),
        );
        base.rotation.x = -Math.PI / 2;
        base.position.set(COLUMNS[column], 0.015, ROWS[row]);
        this.scene.add(base);
      });
    });
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(100, now - this.last);
    this.last = now;
    let difference = this.targetYaw - this.yaw;
    while (difference > Math.PI) difference -= Math.PI * 2;
    while (difference < -Math.PI) difference += Math.PI * 2;
    this.yaw += difference * Math.min(1, delta / 160);
    const horizontal = Math.cos(PITCH) * DISTANCE;
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * horizontal,
      TARGET.y + Math.sin(PITCH) * DISTANCE,
      TARGET.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(TARGET);
    for (const actor of this.actors) actor.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.targetYaw += Math.PI / 4;
    if (event.key === "e" || event.key === "E") this.targetYaw -= Math.PI / 4;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.85, 2.4);
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
