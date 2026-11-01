import * as THREE from "three";
import { BUILDING_DESCRIPTIONS, BUILDING_NAMES, buildBuilding, paletteFor } from "./buildings";
import type { BuildingKind } from "./buildings";

const PITCH = (36 * Math.PI) / 180;
const DISTANCE = 100;
const VIEW_HEIGHT = 24;
const TARGET = new THREE.Vector3(0, 1.2, 0);
const COLUMNS = [-3.7, 0, 3.7];
const ROWS = [-7.5, -2.5, 2.5, 7.5];
const TEAM_NAMES = ["中立", "绿方", "红方"];
const TEAM_COLORS = ["#c2bcaa", "#8ed9a0", "#ef9278"];

const GROUPS: Array<{ kinds: BuildingKind[]; title: string }> = [
  { kinds: ["infantry", "shield", "cavalry", "archer"], title: "兵营一组" },
  { kinds: ["elite", "tower", "granary", "mine"], title: "兵营二组" },
];

export function runBuildingGallery(host: HTMLElement): void {
  const params = new URLSearchParams(window.location.search);
  const group = params.get("group") === "2" ? GROUPS[1] : GROUPS[0];
  const parsedTeam = Number(params.get("team") ?? 1);
  const team = parsedTeam === 0 || parsedTeam === 2 ? parsedTeam : 1;
  host.innerHTML = [
    '<canvas id="building-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">建筑库 <b>' + group.title + "</b></div>",
    '    <div class="chip">颜色 <b>' + TEAM_NAMES[team] + '</b></div>',
    '    <div class="chip">外形 <b>兵种</b></div>',
    '    <div class="chip">档位 <b>L1 / L2 / L3</b></div>',
    '  </div>',
    '  <div class="hud-right">',
    '    <div class="team-legend">',
    '      <span><i style="background:#c2bcaa"></i>中立</span>',
    '      <span><i style="background:#8ed9a0"></i>绿方</span>',
    '      <span><i style="background:#ef9278"></i>红方</span>',
    '    </div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转 · 滚轮缩放 · ?group=2 查看第二组</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#building-canvas");
  if (!canvas) throw new Error("missing building canvas");
  new BuildingGallery(canvas, group.kinds, team);
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
  sprite.scale.set(3.3 * scale, 0.83 * scale, 1);
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

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly kinds: BuildingKind[],
    private readonly team: number,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
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
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(32, 0.6, 30),
      new THREE.MeshStandardMaterial({ color: 0x2a2e28, roughness: 1 }),
    );
    ground.position.set(0, -0.3, -0.5);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(32, 16, 0x6d8a5c, 0x4b6440);
    grid.position.set(0, 0.01, -0.5);
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.1;
    this.scene.add(grid);

    COLUMNS.forEach((x, index) => {
      const heading = label("L" + (index + 1), "#f0dfb8", 1.0);
      heading.position.set(x, 2.6, -10.6);
      this.scene.add(heading);
    });

    this.kinds.forEach((kind, row) => {
      const rowLabel = label(BUILDING_NAMES[kind], "#f0dfb8", 1.0);
      rowLabel.position.set(-6.9, 1.55, ROWS[row]);
      this.scene.add(rowLabel);
      const desc = label(BUILDING_DESCRIPTIONS[kind], "#b9c6a6", 0.72);
      desc.position.set(-6.9, 0.95, ROWS[row]);
      this.scene.add(desc);

      for (let level = 1; level <= 3; level += 1) {
        const group = buildBuilding(kind, paletteFor(this.team), level, row + level);
        group.position.set(COLUMNS[level - 1], 0.02, ROWS[row]);
        this.scene.add(group);
        const base = new THREE.Mesh(
          new THREE.CircleGeometry(1.35, 28),
          new THREE.MeshStandardMaterial({ color: 0x46493f, roughness: 1 }),
        );
        base.rotation.x = -Math.PI / 2;
        base.position.set(COLUMNS[level - 1], 0.015, ROWS[row]);
        this.scene.add(base);
      }
    });

    const soldier = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.2, 0.42, 6),
      new THREE.MeshStandardMaterial({ color: 0x5cc07f, roughness: 0.75 }),
    );
    body.position.y = 0.21;
    soldier.add(body);
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.85 }),
    );
    head.position.y = 0.52;
    soldier.add(head);
    const spear = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.78, 4),
      new THREE.MeshStandardMaterial({ color: 0x6b4a2f }),
    );
    spear.position.set(0.11, 0.42, 0);
    soldier.add(spear);
    soldier.position.set(7.0, 0, 7.5);
    this.scene.add(soldier);
    const soldierLabel = label("士兵 · 1.5 m", "#b9c6a6", 0.68);
    soldierLabel.position.set(7.0, 1.7, 7.5);
    this.scene.add(soldierLabel);
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
