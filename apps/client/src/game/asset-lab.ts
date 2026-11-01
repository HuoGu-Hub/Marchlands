import * as THREE from "three";
import { art } from "./assets";

const PITCH = (55 * Math.PI) / 180;

export function runAssetLab(host: HTMLElement): void {
  host.innerHTML = `
    <canvas id="lab-canvas"></canvas>
    <div class="hud">
      <div class="hud-left"><div class="chip">Asset Lab <b id="lab-status">loading</b></div></div>
      <div class="hint">Q / E 旋转 · 滚轮缩放</div>
    </div>
  `;
  const canvas = host.querySelector<HTMLCanvasElement>("#lab-canvas");
  if (!canvas) throw new Error("missing lab canvas");
  const status = host.querySelector<HTMLElement>("#lab-status");
  void art.load((done, total) => {
    if (status) status.textContent = `${done}/${total}`;
  }).then(() => {
    if (status) status.textContent = `ready · fail ${art.failures}`;
    (window as unknown as { __art?: unknown }).__art = art;
    console.log(
      "CASTLE",
      art.hasCastle("towerSquareTopRoofHigh"),
      art.hasCastle("towerSquareBase"),
      art.hasModel("treeHigh"),
    );
    new LabScene(canvas).start();
  });
}

class LabScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private yawIndex = 0;
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private zoom = 1;
  private last = 0;
  private elapsed = 0;
  private raf = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(0x0d1410);
    this.scene.fog = new THREE.Fog(0x0d1410, 90, 160);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 250);
    this.build();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    window.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
  }

  start(): void {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): void {
    this.scene.add(new THREE.HemisphereLight(0xd8e6c8, 0x1a2418, 1.4));
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.2);
    sun.position.set(26, 42, 18);
    this.scene.add(sun);

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(60, 1, 40),
      new THREE.MeshStandardMaterial({ color: 0x35472f, roughness: 1 }),
    );
    ground.position.y = -0.5;
    this.scene.add(ground);

    this.tower(-12, 0.3, "base+mid+roof");
    this.tower(-5, 0.22, "base+roof");
    this.castleParts(3);
    this.townProps(12);
    this.nature(20);
  }

  private tower(x: number, scale: number, variant: string): void {
    const group = new THREE.Group();
    group.position.set(x, 0, 0);
    group.scale.setScalar(scale);
    const pieces = variant === "base+roof"
      ? [
          ["towerSquareBase", 0],
          ["towerSquareTopRoofHigh", 10],
        ]
      : [
          ["towerSquareBase", 0],
          ["towerSquareMidWindows", 10],
          ["towerSquareTopRoofHigh", 20],
        ];
    for (const [name, y] of pieces as Array<[string, number]>) {
      const piece = art.castle(name, 0x5cc07f);
      if (piece) {
        piece.position.y = y;
        group.add(piece);
      }
    }
    const flag = art.castle("flagBlue", 0x5cc07f);
    if (flag) {
      flag.position.y = variant === "base+roof" ? 10 : 22;
      flag.position.z = 0;
      group.add(flag);
    }
    this.scene.add(group);
    this.label(`tower ×${scale}`, x, 16 * scale + 3, 0);
  }

  private castleParts(x: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, -6);
    group.scale.setScalar(0.3);
    const wall = art.castle("wall", 0x5cc07f);
    if (wall) group.add(wall);
    const wall2 = art.castle("wall", 0x5cc07f);
    if (wall2) {
      wall2.position.x = 10;
      group.add(wall2);
    }
    const gate = art.castle("gate", 0x5cc07f);
    if (gate) {
      gate.position.x = 5;
      group.add(gate);
    }
    this.scene.add(group);
    this.label("wall + gate", x, 6, -6);
  }

  private townProps(x: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, 0);
    group.scale.setScalar(2.2);
    for (const [name, px, pz] of [
      ["treeHigh", 0, 0],
      ["windmill", 2.2, 0.5],
      ["fountainRound", 0.3, 2.3],
      ["cart", 2.2, 2.4],
    ] as Array<[string, number, number]>) {
      const model = art.model(name);
      if (model) {
        model.position.set(px, 0, pz);
        group.add(model);
      }
    }
    this.scene.add(group);
    this.label("town ×2.2", x, 7, 0);
  }

  private nature(x: number): void {
    for (const [name, px, pz, scale] of [
      ["tree_pineTallA", -2, 0, 1.8],
      ["tree_oak", 1, 0, 1.6],
      ["tree_detailed", 3.5, 0, 1.5],
      ["rock_largeB", -2, 3, 1.8],
      ["plant_bush", 2, 3, 2],
    ] as Array<[string, number, number, number]>) {
      const model = art.model(name);
      if (!model) continue;
      model.position.set(x + px, 0, pz);
      model.scale.setScalar(scale);
      this.scene.add(model);
    }
    this.label("nature", x, 5, 2);
  }

  private label(text: string, x: number, y: number, z: number): void {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    if (context) {
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.font = '600 40px "Segoe UI", "Microsoft YaHei", sans-serif';
      context.strokeStyle = "rgba(8,11,9,0.85)";
      context.lineWidth = 7;
      context.strokeText(text, 192, 48);
      context.fillStyle = "#f2ead7";
      context.fillText(text, 192, 48);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    sprite.scale.set(6, 1.5, 1);
    sprite.position.set(x, y, z);
    this.scene.add(sprite);
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(120, now - this.last);
    this.last = now;
    this.elapsed += delta;
    let dy = this.targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, delta / 140);
    const horizontal = Math.cos(PITCH) * 80;
    this.camera.position.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(PITCH) * 80,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(2, 3, 0);
    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") {
      this.yawIndex = (this.yawIndex + 1) % 4;
      this.targetYaw = Math.PI / 4 + (this.yawIndex * Math.PI) / 2;
    }
    if (event.key === "e" || event.key === "E") {
      this.yawIndex = (this.yawIndex + 3) % 4;
      this.targetYaw = Math.PI / 4 + (this.yawIndex * Math.PI) / 2;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.06 : 0.06), 1, 1.5);
    this.resize();
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const viewHeight = 40 / this.zoom;
    this.camera.left = (-viewHeight * aspect) / 2;
    this.camera.right = (viewHeight * aspect) / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
  }
}
