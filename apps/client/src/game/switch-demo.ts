import * as THREE from "three";
import { BUILDING_KINDS, BUILDING_NAMES, LEVEL_NAMES, paletteFor } from "./buildings";
import type { BuildingLevel } from "./buildings";
import { BuildingActor } from "./building-actor";

const PITCH = (38 * Math.PI) / 180;
const DISTANCE = 26;
const VIEW_HEIGHT = 9.5;
const TARGET = new THREE.Vector3(0, 1.2, 0);
const STEP_MS = 1700;

export function runSwitchDemo(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="switch-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">切换演示 <b id="switch-name">步兵营</b></div>',
    '    <div class="chip">等级 <b id="switch-level">L1</b></div>',
    '  </div>',
    '  <div class="hint">1–8 选类型 · L 换等级 · 空格暂停 · Q / E 旋转</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#switch-canvas");
  if (!canvas) throw new Error("missing switch canvas");
  new SwitchDemo(canvas, host);
}

class SwitchDemo {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly actor: BuildingActor;
  private label: THREE.Sprite;
  private labelTexture: THREE.CanvasTexture | null = null;
  private yaw = 0.5;
  private targetYaw = 0.5;
  private timer = 0;
  private index = 0;
  private paused = false;
  private last = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.scene.background = new THREE.Color(0x0b110d);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 120);
    this.scene.add(new THREE.HemisphereLight(0xe6efd2, 0x172116, 1.55));
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.7);
    sun.position.set(14, 30, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ea2ff, 0.6);
    rim.position.set(-18, 12, -16);
    this.scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.7, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a4231, roughness: 1, flatShading: true }),
    );
    ground.position.y = -0.25;
    this.scene.add(ground);
    const plate = new THREE.Mesh(
      new THREE.CylinderGeometry(3.1, 3.1, 0.06, 10),
      new THREE.MeshStandardMaterial({ color: 0x6f6b5b, roughness: 1 }),
    );
    plate.position.y = 0.02;
    this.scene.add(plate);

    this.actor = new BuildingActor({
      kind: BUILDING_KINDS[0],
      level: 1,
      palette: paletteFor(1),
      variant: 0,
    });
    this.scene.add(this.actor);
    this.label = this.makeLabel(BUILDING_NAMES[BUILDING_KINDS[0]], LEVEL_NAMES[1]);
    this.label.position.set(0, 4.2, 0);
    this.scene.add(this.label);

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private makeLabel(name: string, level: string): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    if (context) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";
      context.strokeStyle = "rgba(8, 11, 9, 0.9)";
      context.lineWidth = 9;
      context.font = '600 60px "Segoe UI", "Microsoft YaHei", sans-serif';
      context.strokeText(name, 256, 56);
      context.fillStyle = "#f2ead7";
      context.fillText(name, 256, 56);
      context.font = '600 38px "Segoe UI", "Microsoft YaHei", sans-serif';
      context.strokeText(level, 256, 116);
      context.fillStyle = "#8ed9a0";
      context.fillText(level, 256, 116);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.labelTexture?.dispose();
    this.labelTexture = texture;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(3.4, 1.06, 1);
    return sprite;
  }

  private select(kindIndex: number, level: BuildingLevel): void {
    const kind = BUILDING_KINDS[kindIndex];
    this.index = kindIndex * 3 + (level - 1);
    this.timer = 0;
    this.actor.set({ kind, level, palette: paletteFor(1), variant: kindIndex + level });
    const name = BUILDING_NAMES[kind];
    const label = this.makeLabel(name, LEVEL_NAMES[level]);
    this.label.material.map = label.material.map;
    this.label.material.needsUpdate = true;
    this.label.material.dispose();
    this.label.material = label.material;
    this.host.querySelector("#switch-name")!.textContent = name;
    this.host.querySelector("#switch-level")!.textContent = "L" + level;
  }

  private advance(): void {
    this.index = (this.index + 1) % (BUILDING_KINDS.length * 3);
    const kindIndex = Math.floor(this.index / 3);
    const level = ((this.index % 3) + 1) as BuildingLevel;
    this.select(kindIndex, level);
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

    this.actor.update(delta);
    if (!this.paused && !this.actor.isSwitching) {
      this.timer += delta;
      if (this.timer >= STEP_MS) this.advance();
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.targetYaw += Math.PI / 3;
    if (event.key === "e" || event.key === "E") this.targetYaw -= Math.PI / 3;
    if (event.key === " ") {
      event.preventDefault();
      this.paused = !this.paused;
      return;
    }
    if (event.key === "l" || event.key === "L") {
      this.select(Math.floor(this.index / 3), (((this.index % 3) + 1) % 3 + 1) as BuildingLevel);
      return;
    }
    const number = Number(event.key);
    if (number >= 1 && number <= BUILDING_KINDS.length) {
      this.select(number - 1, 1);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.8, 2);
    this.resize();
  };

  private zoom = 1;

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
