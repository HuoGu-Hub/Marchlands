import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { GlbUnitActor } from "./unit-glb";
import type { UnitActorView } from "./unit-glb";
import { paletteFor } from "./buildings";

/**
 * 边军兵种图鉴：U01-U10 十个 GLB 单位 x 三阵营色同屏。
 * ?scene=frontier-units 打开，用于核对造型与队伍色换色效果。
 */

interface UnitEntry {
  id: string;
  label: string;
  url: string;
}

const KIND_LABELS: Record<string, string> = {
  infantry: "步兵",
  shield: "盾兵",
  cavalry: "骑兵",
  archer: "弓兵",
  elite: "精兵",
};

const VARIANT_LABELS: Record<string, string> = {
  A: "老兵",
  B: "新募",
};

const TEAMS = [
  { owner: 0, name: "中立", color: "#c2bcaa" },
  { owner: 1, name: "绿方", color: "#8ed9a0" },
  { owner: 2, name: "红方", color: "#ef9278" },
];

const COLUMNS = [-5.2, -2.6, 0, 2.6, 5.2];
const ROWS = [-3.4, 0, 3.4];
const PITCH = 27 * (Math.PI / 180);
const DISTANCE = 46;
const VIEW_HEIGHT = 10.5;
const TARGET = new THREE.Vector3(0, 0.7, 0);

function clipUrl(name: string): string {
  const glob = import.meta.glob("../assets/characters/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;
  for (const [path, url] of Object.entries(glob)) {
    if (path.endsWith("/" + name + ".glb")) return url;
  }
  throw new Error("missing unit glb: " + name);
}

function label(text: string, color: string, scale = 1): THREE.Sprite {
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
  sprite.scale.set(2.4 * scale, 0.6 * scale, 1);
  return sprite;
}

/** 只把 team_ 前缀材质换成阵营色，其余保持手绘固有色。 */
function tintTeam(object: THREE.Object3D, owner: number): void {
  const color = paletteFor(owner).cloth;
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = materials.map((material) => {
      if (!material.name.toLowerCase().startsWith("team")) return material;
      const clone = material.clone();
      clone.name = material.name;
      const standard = clone as THREE.MeshStandardMaterial;
      if (standard.color) standard.color.setHex(color);
      clone.userData.shared = false;
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

export function runFrontierUnitShowcase(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="fu-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">边军兵种 <b>5 类 x 老兵 / 新募</b></div>',
    '    <div class="chip">阵营色 <b>中立 / 绿方 / 红方</b></div>',
    '    <div class="chip">动作 <b>待机 / 行走 / 挥击</b></div>',
    '  </div>',
    '  <div class="hud-actions">',
    '    <button data-variant="A">老兵</button>',
    '    <button data-variant="B">新募</button>',
    '    <button data-move="1">行走</button>',
    '    <button data-move="0">待机</button>',
    '  </div>',
    '  <div class="hint">空格挥击 · Q / E 旋转 · 滚轮缩放</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#fu-canvas");
  if (!canvas) throw new Error("missing frontier unit canvas");
  new FrontierUnitShowcase(host, canvas);
}

class FrontierUnitShowcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly actors: Array<{ view: UnitActorView; node: THREE.Object3D; label: THREE.Sprite }> = [];
  private yaw = 0;
  private zoom = 1;
  private raf = 0;
  private last = 0;
  private variant: "A" | "B" = "A";

  constructor(private readonly host: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.34;
    this.scene.background = new THREE.Color(0x1d1a17);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 160);
    this.scene.add(new THREE.HemisphereLight(0xf0e4d0, 0x2a211a, 1.7));
    const key = new THREE.DirectionalLight(0xfff1d8, 3.0);
    key.position.set(-10, 18, 14);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9fb7d8, 0.85);
    fill.position.set(12, 8, 10);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffd6a0, 1.8);
    rim.position.set(2, 10, -14);
    this.scene.add(rim);

    this.buildStage();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    host.querySelectorAll<HTMLButtonElement>("[data-variant]").forEach((button) => {
      button.addEventListener("click", () => this.setVariant(button.dataset.variant === "B" ? "B" : "A"));
    });
    host.querySelectorAll<HTMLButtonElement>("[data-move]").forEach((button) => {
      button.addEventListener("click", () => this.setMoving(button.dataset.move === "1"));
    });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    void this.loadUnits();
  }

  private buildStage(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.5, 15),
      new THREE.MeshStandardMaterial({ color: 0x3a3229, roughness: 1 }),
    );
    ground.position.set(0, -0.25, 0);
    this.scene.add(ground);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(7.4, 7.6, 0.18, 72),
      new THREE.MeshStandardMaterial({ color: 0x45392b, roughness: 1 }),
    );
    platform.position.y = -0.04;
    this.scene.add(platform);
    TEAMS.forEach((team, row) => {
      const heading = label(team.name, team.color, 0.9);
      heading.position.set(-7.6, 0.9, ROWS[row]);
      this.scene.add(heading);
    });
    Object.entries(KIND_LABELS).forEach(([kind, text], column) => {
      const heading = label(text, "#f0dfb8", 0.85);
      heading.position.set(COLUMNS[column], 1.75, -5.2);
      this.scene.add(heading);
    });
  }

  private async loadUnits(): Promise<void> {
    const loader = new GLTFLoader();
    const entries: UnitEntry[] = [];
    for (const kind of ["infantry", "shield", "cavalry", "archer", "elite"]) {
      for (const variant of ["A", "B"]) {
        const id = kind + "-" + variant;
        entries.push({
          id,
          label: KIND_LABELS[kind] + "·" + VARIANT_LABELS[variant],
          url: clipUrl("frontier-" + id),
        });
      }
    }
    const loaded = new Map<string, { object: THREE.Object3D; animations: THREE.AnimationClip[] }>();
    await Promise.all(entries.map(async (entry) => {
      try {
        const gltf = await loader.loadAsync(entry.url);
        loaded.set(entry.id, { object: gltf.scene, animations: gltf.animations });
      } catch (error) {
        console.error("[frontier-units] load failed", entry.id, error);
      }
    }));

    TEAMS.forEach((team, row) => {
      Object.keys(KIND_LABELS).forEach((kind, column) => {
        const id = kind + "-" + this.variant;
        const template = loaded.get(id);
        if (!template) return;
        const instance = SkeletonUtils.clone(template.object);
        tintTeam(instance, team.owner);
        const actor = new GlbUnitActor(instance, template.animations);
        actor.position.set(COLUMNS[column], 0.02, ROWS[row]);
        actor.rotation.y = 0.2;
        actor.setMoving(false);
        this.scene.add(actor);
        const tag = label(KIND_LABELS[kind], team.color, 0.6);
        tag.position.set(COLUMNS[column], 0.0, ROWS[row] + 0.9);
        this.scene.add(tag);
        this.actors.push({ view: actor, node: actor, label: tag });
        const base = new THREE.Mesh(
          new THREE.CircleGeometry(0.5, 24),
          new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 1 }),
        );
        base.rotation.x = -Math.PI / 2;
        base.position.set(COLUMNS[column], 0.012, ROWS[row]);
        this.scene.add(base);
      });
    });
    this.applyMoving(false);
  }

  private setVariant(variant: "A" | "B"): void {
    if (variant === this.variant) return;
    this.variant = variant;
    this.clearActors();
    void this.loadUnits();
  }

  private clearActors(): void {
    for (const entry of this.actors) {
      this.scene.remove(entry.node);
      this.scene.remove(entry.label);
      entry.view.dispose();
    }
    this.actors.length = 0;
  }

  private moving = false;
  private applyMoving(moving: boolean): void {
    this.moving = moving;
    for (const entry of this.actors) entry.view.setMoving(moving);
  }
  private setMoving(moving: boolean): void {
    this.applyMoving(moving);
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(100, now - this.last);
    this.last = now;
    const horizontal = Math.cos(PITCH) * DISTANCE;
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * horizontal,
      TARGET.y + Math.sin(PITCH) * DISTANCE,
      TARGET.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(TARGET);
    for (const entry of this.actors) entry.view.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.yaw += Math.PI / 4;
    if (event.key === "e" || event.key === "E") this.yaw -= Math.PI / 4;
    if (event.code === "Space") {
      event.preventDefault();
      for (const entry of this.actors) entry.view.playAttack();
    }
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
