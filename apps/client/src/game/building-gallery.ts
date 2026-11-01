import * as THREE from "three";
import { BUILDING_KINDS, BUILDING_NAMES, buildBuilding, buildKeep, paletteFor } from "./buildings";

const PITCH = (55 * Math.PI) / 180;
const DISTANCE = 100;
const VIEW_HEIGHT = 26;
const TARGET = new THREE.Vector3(0, 1.25, -3.9);
const COLUMNS = [-3.8, 0, 3.8];
const ROWS = [6.4, 1.2, -4.0, -9.2];

const TEAMS = [
  { owner: 0, name: "中立", color: "#c2bcaa" },
  { owner: 1, name: "绿方", color: "#7ccb8d" },
  { owner: 2, name: "红方", color: "#e2836a" },
];

export function runBuildingGallery(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="building-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">建筑库 <b>4 型 × 3 阵营</b></div>',
    '    <div class="chip">颜色 <b>阵营</b></div>',
    '    <div class="chip">外形 <b>兵种</b></div>',
    '  </div>',
    '  <div class="hud-right">',
    '    <div class="team-legend">',
    '      <span><i style="background:#c2bcaa"></i>中立</span>',
    '      <span><i style="background:#7ccb8d"></i>绿方</span>',
    '      <span><i style="background:#e2836a"></i>红方</span>',
    '    </div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转 · 滚轮缩放</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#building-canvas");
  if (!canvas) throw new Error("missing building canvas");
  new BuildingGallery(canvas);
}

function label(text: string, color = "#f2ead7", scale = 1): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 56px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.9)";
    context.lineWidth = 9;
    context.strokeText(text, 256, 64);
    context.fillStyle = color;
    context.fillText(text, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(3.4 * scale, 0.85 * scale, 1);
  return sprite;
}

class BuildingGallery {
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
    this.renderer.toneMappingExposure = 1.15;
    this.scene.background = new THREE.Color(0x0b110d);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
    this.scene.add(new THREE.HemisphereLight(0xe6efd2, 0x172116, 1.5));
    const sun = new THREE.DirectionalLight(0xffd9a6, 2.6);
    sun.position.set(24, 44, 20);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x7ea2ff, 0.6);
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
      new THREE.BoxGeometry(52, 0.6, 46),
      new THREE.MeshStandardMaterial({ color: 0x35472f, roughness: 1 }),
    );
    ground.position.set(0, -0.3, -6.2);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(48, 24, 0x6d8a5c, 0x4b6440);
    grid.position.set(0, 0.01, -6.2);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.12;
    this.scene.add(grid);

    BUILDING_KINDS.forEach((kind, row) => {
      const rowLabel = label(BUILDING_NAMES[kind], "#f0dfb8", 1.1);
      rowLabel.position.set(-8.2, 1.5, ROWS[row]);
      this.scene.add(rowLabel);
      for (let column = 0; column < TEAMS.length; column += 1) {
        const team = TEAMS[column];
        const group = buildBuilding(kind, paletteFor(team.owner), team.owner + row);
        group.position.set(COLUMNS[column], 0.02, ROWS[row]);
        this.scene.add(group);
        this.addBase(COLUMNS[column], ROWS[row]);
      }
    });

    const keepLabel = label("城镇中心", "#f0dfb8", 1.1);
    keepLabel.position.set(-8.2, 1.5, -14.4);
    this.scene.add(keepLabel);
    for (let level = 1; level <= 3; level += 1) {
      const x = COLUMNS[level - 1];
      const keep = buildKeep(paletteFor(1), level);
      keep.position.set(x, 0.02, -14.4);
      this.scene.add(keep);
      this.addBase(x, -14.4);
      const levelLabel = label("L" + level, "#c9d7b8", 0.68);
      levelLabel.position.set(x, 3.1, -14.4);
      this.scene.add(levelLabel);
    }

    this.buildSoldier(7.6, 6.4);
    const soldierLabel = label("士兵 · 1.5 m", "#b9c6a6", 0.7);
    soldierLabel.position.set(7.6, 1.6, 6.4);
    this.scene.add(soldierLabel);
  }

  private addBase(x: number, z: number): void {
    const base = new THREE.Mesh(
      new THREE.CircleGeometry(1.32, 28),
      new THREE.MeshStandardMaterial({ color: 0x3c4b33, roughness: 1 }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.set(x, 0.015, z);
    this.scene.add(base);
  }

  private buildSoldier(x: number, z: number): void {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.2, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x5cc07f, roughness: 0.75 }),
    );
    body.position.y = 0.21;
    group.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.85 }),
    );
    head.position.y = 0.52;
    group.add(head);
    const spear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.78, 4),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f }),
    );
    spear.position.set(0.11, 0.42, 0);
    group.add(spear);
    group.position.set(x, 0, z);
    this.scene.add(group);
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
    this.zoom = THREE.MathUtils.clamp(this.zoom + (event.deltaY > 0 ? -0.08 : 0.08), 0.9, 2.4);
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
