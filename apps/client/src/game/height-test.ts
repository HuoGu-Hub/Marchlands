import * as THREE from "three";

const PITCH = (55 * Math.PI) / 180;
const DISTANCE = 64;
const VIEW_HEIGHT = 33;
const TARGET = new THREE.Vector3(0, 1.4, -2.5);

const ROUTE: THREE.Vector3[] = [
  new THREE.Vector3(0, 0.06, 10),
  new THREE.Vector3(0, 0.06, 5.2),
  new THREE.Vector3(0, 1.55, 2),
  new THREE.Vector3(0, 3.06, -1.2),
  new THREE.Vector3(0, 3.06, -4.8),
];

export function runHeightTest(host: HTMLElement): void {
  host.innerHTML = `
    <canvas id="height-canvas"></canvas>
    <div class="hud">
      <div class="hud-left">
        <div class="chip">HeightTest <b>0 → 3 m</b></div>
        <div class="chip">坡道 <b>26.6°</b></div>
      </div>
      <div class="hint">Q / E 旋转 · 滚轮缩放 · 单位往返坡道</div>
    </div>
  `;
  const canvas = host.querySelector<HTMLCanvasElement>("#height-canvas");
  if (!canvas) throw new Error("missing height canvas");
  new HeightTestScene(canvas);
}

function layeredBox(width: number, height: number, depth: number, top: number, side: number): THREE.Mesh {
  const topMaterial = new THREE.MeshStandardMaterial({ color: top, roughness: 1, flatShading: true });
  const sideMaterial = new THREE.MeshStandardMaterial({ color: side, roughness: 1, flatShading: true });
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [
    sideMaterial,
    sideMaterial,
    topMaterial,
    sideMaterial,
    sideMaterial,
    sideMaterial,
  ]);
}

class HeightTestScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly units: THREE.Group[] = [];
  private readonly resizeObserver: ResizeObserver;
  private yawIndex = 0;
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private zoom = 1;
  private elapsed = 0;
  private last = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene.background = new THREE.Color(0x0d1410);
    this.scene.fog = new THREE.Fog(0x0d1410, 90, 150);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 220);

    this.buildLights();
    this.buildTerrain();
    this.buildCity();
    this.buildUnits();
    this.buildLabels();
    this.buildScenery();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xd8e6c8, 0x1a2418, 1.35));
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.2);
    sun.position.set(26, 42, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6d9bff, 0.5);
    rim.position.set(-30, 18, -24);
    this.scene.add(rim);
  }

  private buildTerrain(): void {
    const low = layeredBox(42, 0.8, 42, 0x35472f, 0x2a3524);
    low.position.set(0, -0.4, 7);
    this.scene.add(low);

    const plateau = layeredBox(16, 3, 14, 0x3f5336, 0x5b5140);
    plateau.position.set(0, 1.5, -8);
    this.scene.add(plateau);

    const rampAngle = Math.atan2(3, 6);
    const rampLength = Math.hypot(6, 3);
    const ramp = new THREE.Mesh(
      new THREE.BoxGeometry(5.2, 0.32, rampLength),
      new THREE.MeshStandardMaterial({ color: 0x6e5c41, roughness: 1, flatShading: true }),
    );
    ramp.position.set(0, 1.48, 2);
    ramp.rotation.x = rampAngle;
    this.scene.add(ramp);

    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3a28, roughness: 1 });
    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, rampLength), railMaterial);
      rail.position.set(side * 2.7, 1.55, 2);
      rail.rotation.x = rampAngle;
      this.scene.add(rail);
    }
  }

  private buildCity(): void {
    const group = new THREE.Group();
    group.position.set(0, 3, -6.2);
    group.scale.setScalar(1.15);

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.5, 0.5, 8),
      new THREE.MeshStandardMaterial({ color: 0x6b6657, roughness: 0.95, flatShading: true }),
    );
    base.position.y = 0.25;
    group.add(base);

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 1.5, 1.8),
      new THREE.MeshStandardMaterial({ color: 0xd8cfb6, roughness: 0.9, flatShading: true }),
    );
    wall.position.y = 1.2;
    group.add(wall);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 1, 4),
      new THREE.MeshStandardMaterial({ color: 0x5cc07f, roughness: 0.8, flatShading: true }),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.4;
    group.add(roof);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b2620 }),
    );
    pole.position.y = 3.5;
    group.add(pole);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.05, 0.65),
      new THREE.MeshStandardMaterial({ color: 0x5cc07f, side: THREE.DoubleSide }),
    );
    flag.position.set(0.55, 3.85, 0);
    group.add(flag);

    const label = makeLabel("高台城 · L2");
    label.position.set(0, 5.4, 0);
    group.add(label);

    this.scene.add(group);
  }

  private buildUnits(): void {
    const colors = [0x5cc07f, 0x8fd6a4, 0x3f9e60];
    for (let index = 0; index < 3; index += 1) {
      const group = new THREE.Group();
      group.scale.setScalar(1.25);
      const body = new THREE.Mesh(
        new THREE.CylinderGeometry(0.26, 0.34, 0.7, 6),
        new THREE.MeshStandardMaterial({ color: colors[index], roughness: 0.7, flatShading: true }),
      );
      body.position.y = 0.35;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.19, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.8 }),
      );
      head.position.y = 0.85;
      group.add(head);
      this.units.push(group);
      this.scene.add(group);
    }
  }

  private buildLabels(): void {
    const lowLabel = makeLabel("L0 · 0 m");
    lowLabel.position.set(-8.5, 1.5, 9);
    this.scene.add(lowLabel);

    const rampLabel = makeLabel("坡道 26.6°");
    rampLabel.position.set(4.6, 2.4, 2.2);
    this.scene.add(rampLabel);

    const highLabel = makeLabel("L2 · 3 m");
    highLabel.position.set(8.6, 4.8, -9);
    this.scene.add(highLabel);
  }

  private buildScenery(): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3a28, roughness: 1 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6b3c, roughness: 0.95, flatShading: true });
    const positions: Array<[number, number, number]> = [
      [-15, 0, 13], [-11, 0, 6], [-17, 0, 0], [14, 0, 12], [11, 0, 5], [16, 0, -2],
      [-12, 3, -12], [12, 3, -12], [-6, 3, -14], [6, 3, -13],
    ];
    for (const [x, y, z] of positions) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1.2, 5), trunkMaterial);
      trunk.position.set(x, y + 0.6, z);
      this.scene.add(trunk);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.4, 6), leafMaterial);
      cone.position.set(x, y + 2.1, z);
      this.scene.add(cone);
    }
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(120, now - this.last);
    this.last = now;
    this.elapsed += delta;

    let deltaYaw = this.targetYaw - this.yaw;
    while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
    while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
    this.yaw += deltaYaw * Math.min(1, delta / 140);

    const horizontal = Math.cos(PITCH) * DISTANCE;
    this.camera.position.set(
      TARGET.x + Math.sin(this.yaw) * horizontal,
      TARGET.y + Math.sin(PITCH) * DISTANCE,
      TARGET.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(TARGET);

    const total = routeLength();
    const speed = 1.1;
    for (let index = 0; index < this.units.length; index += 1) {
      const offset = index * 0.85;
      const distance = ((this.elapsed / 1000) * speed + offset) % (total * 2);
      const pingPong = distance > total ? total * 2 - distance : distance;
      this.units[index].position.copy(pointAt(pingPong));
    }

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
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.06 : 0.06), 1, 1.4);
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

function routeLength(): number {
  let total = 0;
  for (let index = 0; index < ROUTE.length - 1; index += 1) {
    total += ROUTE[index].distanceTo(ROUTE[index + 1]);
  }
  return total;
}

function pointAt(distance: number): THREE.Vector3 {
  let remaining = distance;
  for (let index = 0; index < ROUTE.length - 1; index += 1) {
    const from = ROUTE[index];
    const to = ROUTE[index + 1];
    const length = from.distanceTo(to);
    if (remaining <= length) return from.clone().lerp(to, remaining / length);
    remaining -= length;
  }
  return ROUTE[ROUTE.length - 1].clone();
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 44px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.85)";
    context.lineWidth = 7;
    context.strokeText(text, canvas.width / 2, canvas.height / 2);
    context.fillStyle = "#f2ead7";
    context.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(5.4, 1.35, 1);
  return sprite;
}
