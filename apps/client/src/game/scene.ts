import * as THREE from "three";
import type { CityId, CityState, MapDef, Owner, SimState, SquadState } from "@marchlands/sim";

const PLAYER_COLORS: Record<Owner, number> = {
  0: 0xa7ab9e,
  1: 0x5cc07f,
  2: 0xe06a4a,
};

const PITCH = (55 * Math.PI) / 180;
const CAMERA_DISTANCE = 90;
const VIEW_HEIGHT = 64;
const ZOOM_MIN = 1;
const ZOOM_MAX = 1.3;

interface CityView {
  group: THREE.Group;
  keep: THREE.Group;
  flag: THREE.Mesh;
  roof: THREE.Mesh;
  disc: THREE.Mesh;
  palisade: THREE.Group;
  banner: THREE.Group;
  bannerFlags: THREE.Mesh[];
  crown: THREE.Mesh;
  shadow: THREE.Mesh;
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  labelText: string;
}

interface SquadView {
  group: THREE.Group;
  units: THREE.Mesh[];
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  labelText: string;
}

export class BattleScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: MapDef;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly cityViews = new Map<CityId, CityView>();
  private readonly squadViews = new Map<string, SquadView>();
  private readonly ring: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly positions = new Map<CityId, THREE.Vector3>();

  private yawIndex = 0;
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private zoom = 1;
  private elapsed = 0;
  private selected: CityId | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, map: MapDef) {
    this.canvas = canvas;
    this.map = map;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d1410);
    this.scene.fog = new THREE.Fog(0x0d1410, 120, 190);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 260);
    this.camera.zoom = 1;

    for (const city of map.cities) {
      this.positions.set(city.id, new THREE.Vector3(city.pos[0] / 10, 0, city.pos[1] / 10));
    }

    this.buildLights();
    this.buildGround();
    this.buildRoads();
    this.buildScenery();
    this.ring = this.buildRing();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
  }

  setSelected(cityId: CityId | null): void {
    this.selected = cityId;
  }

  rotate(direction: 1 | -1): void {
    this.yawIndex = (this.yawIndex + direction + 4) % 4;
    this.targetYaw = Math.PI / 4 + (this.yawIndex * Math.PI) / 2;
  }

  zoomBy(delta: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom + delta, ZOOM_MIN, ZOOM_MAX);
    this.resize();
  }

  projectCity(cityId: CityId): { x: number; y: number } | null {
    const position = this.positions.get(cityId);
    if (!position) return null;
    const rect = this.canvas.getBoundingClientRect();
    const projected = position.clone().setY(3.2).project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  pickCity(clientX: number, clientY: number, state: SimState): CityId | null {
    const rect = this.canvas.getBoundingClientRect();
    let bestId: CityId | null = null;
    let bestDistance = 44;
    for (const city of state.cities) {
      const position = this.positions.get(city.id);
      if (!position) continue;
      const projected = position.clone().setY(1.2).project(this.camera);
      const x = rect.left + ((projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = city.id;
      }
    }
    return bestId;
  }

  update(state: SimState, deltaMs: number): void {
    this.elapsed += deltaMs;
    this.updateCamera(deltaMs);
    this.updateCities(state);
    this.updateSquads(state);
    this.ring.visible = this.selected !== null;
    if (this.selected) {
      const position = this.positions.get(this.selected);
      if (position) this.ring.position.set(position.x, 0.07, position.z);
      const material = this.ring.material as THREE.MeshBasicMaterial;
      material.opacity = 0.55 + Math.sin(this.elapsed / 260) * 0.2;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
      else material?.dispose();
    });
    for (const view of this.cityViews.values()) view.texture.dispose();
    for (const view of this.squadViews.values()) view.texture.dispose();
    this.renderer.dispose();
  }

  private updateCamera(deltaMs: number): void {
    let delta = this.targetYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = Math.min(1, deltaMs / 140);
    this.yaw += delta * step;
    if (Math.abs(delta) < 0.002) this.yaw = this.targetYaw;

    const horizontal = Math.cos(PITCH) * CAMERA_DISTANCE;
    this.camera.position.set(
      Math.sin(this.yaw) * horizontal,
      Math.sin(PITCH) * CAMERA_DISTANCE,
      Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(0, 1.2, 0);
  }

  private updateCities(state: SimState): void {
    for (const city of state.cities) {
      let view = this.cityViews.get(city.id);
      if (!view) {
        view = this.createCityView(city);
        this.cityViews.set(city.id, view);
      }
      const color = PLAYER_COLORS[city.owner];
      (view.flag.material as THREE.MeshStandardMaterial).color.setHex(color);
      (view.roof.material as THREE.MeshStandardMaterial).color.setHex(color);
      (view.disc.material as THREE.MeshBasicMaterial).color.setHex(color);
      for (const bannerFlag of view.bannerFlags) {
        (bannerFlag.material as THREE.MeshStandardMaterial).color.setHex(color);
      }
      view.palisade.visible = city.level === 1;
      view.banner.visible = city.level >= 2;
      view.crown.visible = city.level >= 3;
      const scale = 0.9 + city.level * 0.12;
      view.keep.scale.set(scale, scale, scale);

      const label = `${city.id} · L${city.level}\n${city.pop}/${city.maxPop}`;
      if (label !== view.labelText) {
        view.labelText = label;
        this.paintLabel(view.canvas, view.texture, label.split("\n"), "#f2ead7");
        view.label.material.map = view.texture;
        view.label.material.needsUpdate = true;
      }
    }
  }

  private updateSquads(state: SimState): void {
    const seen = new Set<string>();
    for (const squad of state.squads) {
      seen.add(squad.id);
      let view = this.squadViews.get(squad.id);
      if (!view) {
        view = this.createSquadView(squad);
        this.squadViews.set(squad.id, view);
      }
      const point = this.squadPoint(squad, state.tick);
      view.group.position.set(point.x, 0.42, point.z);
      view.units.forEach((unit, index) => {
        unit.position.y = Math.sin(this.elapsed / 170 + index * 1.7) * 0.05;
      });
    }
    for (const [id, view] of this.squadViews) {
      if (seen.has(id)) continue;
      this.scene.remove(view.group);
      view.texture.dispose();
      view.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | undefined;
        material?.dispose();
      });
      this.squadViews.delete(id);
    }
  }

  private squadPoint(squad: SquadState, tick: number): THREE.Vector3 {
    const start = this.positions.get(squad.path[0] ?? squad.from) ?? new THREE.Vector3();
    const end = this.positions.get(squad.path[squad.path.length - 1] ?? squad.to) ?? new THREE.Vector3();
    const segments: Array<{ from: THREE.Vector3; to: THREE.Vector3; length: number }> = [];
    let total = 0;
    for (let index = 0; index < squad.path.length - 1; index += 1) {
      const from = this.positions.get(squad.path[index]);
      const to = this.positions.get(squad.path[index + 1]);
      if (!from || !to) continue;
      const length = from.distanceTo(to);
      segments.push({ from, to, length });
      total += length;
    }
    if (segments.length === 0) return start.clone();
    const duration = Math.max(1, squad.arrivalTick - squad.departTick);
    const t = THREE.MathUtils.clamp((tick - squad.departTick) / duration, 0, 0.999);
    let remaining = t * total;
    for (const segment of segments) {
      if (remaining <= segment.length) {
        return segment.from.clone().lerp(segment.to, remaining / segment.length);
      }
      remaining -= segment.length;
    }
    return end.clone();
  }

  private createCityView(city: CityState): CityView {
    const group = new THREE.Group();
    const position = this.positions.get(city.id) ?? new THREE.Vector3();
    group.position.copy(position);

    const stone = new THREE.MeshStandardMaterial({ color: 0x6b6657, roughness: 0.95, flatShading: true });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 3.0, 0.5, 8), stone);
    base.position.y = 0.25;
    group.add(base);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(2.5, 32),
      new THREE.MeshBasicMaterial({
        color: PLAYER_COLORS[city.owner],
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.52;
    group.add(disc);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(3.1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    group.add(shadow);

    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd8cfb6, roughness: 0.9, flatShading: true });
    const ownerMaterial = new THREE.MeshStandardMaterial({
      color: PLAYER_COLORS[city.owner],
      roughness: 0.8,
      flatShading: true,
    });

    const keep = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.65, 1.85), wallMaterial);
    body.position.y = 0.82;
    keep.add(body);

    for (const dx of [-0.72, 0.72]) {
      for (const dz of [-0.72, 0.72]) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.36), wallMaterial);
        merlon.position.set(dx, 1.82, dz);
        keep.add(merlon);
      }
    }

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.0, 4), ownerMaterial);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.5;
    keep.add(roof);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 1.7, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b2620 }),
    );
    pole.position.y = 3.65;
    keep.add(pole);

    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({ color: PLAYER_COLORS[city.owner], roughness: 0.7, side: THREE.DoubleSide }),
    );
    flag.position.set(0.58, 4.05, 0);
    keep.add(flag);

    for (const dx of [-2.05, 2.05]) {
      for (const dz of [-1.35, 1.35]) {
        const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 1.0, 6), wallMaterial);
        turret.position.set(dx, 0.98, dz);
        group.add(turret);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.55, 6), ownerMaterial);
        cap.position.set(dx, 1.75, dz);
        group.add(cap);
      }
    }

    keep.position.y = 0.55;
    group.add(keep);

    const palisade = new THREE.Group();
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4f30, roughness: 1, flatShading: true });
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.62, 5), postMaterial);
      post.position.set(Math.cos(angle) * 2.55, 0.78, Math.sin(angle) * 2.55);
      palisade.add(post);
    }
    group.add(palisade);

    const banner = new THREE.Group();
    const bannerFlags: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const bannerPole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 2.1, 5),
        new THREE.MeshStandardMaterial({ color: 0x2b2620 }),
      );
      bannerPole.position.set(side * 2.1, 1.55, 1.45);
      banner.add(bannerPole);
      const bannerFlag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.85, 0.55),
        new THREE.MeshStandardMaterial({
          color: PLAYER_COLORS[city.owner],
          roughness: 0.75,
          side: THREE.DoubleSide,
        }),
      );
      bannerFlag.position.set(side * 2.1 + 0.42, 2.25, 1.45);
      banner.add(bannerFlag);
      bannerFlags.push(bannerFlag);
    }
    group.add(banner);

    const crown = new THREE.Mesh(
      new THREE.TorusGeometry(1.58, 0.075, 6, 20),
      new THREE.MeshStandardMaterial({ color: 0xe8c883, metalness: 0.25, roughness: 0.5 }),
    );
    crown.rotation.x = Math.PI / 2;
    crown.position.y = 2.02;
    keep.add(crown);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 192;
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const labelMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const label = new THREE.Sprite(labelMaterial);
    label.scale.set(6.4, 2.4, 1);
    label.position.y = 6.9;
    group.add(label);

    this.scene.add(group);
    return {
      group,
      keep,
      flag,
      roof,
      disc,
      palisade,
      banner,
      bannerFlags,
      crown,
      shadow,
      label,
      canvas: labelCanvas,
      texture,
      labelText: "",
    };
  }

  private createSquadView(squad: SquadState): SquadView {
    const group = new THREE.Group();
    const color = PLAYER_COLORS[squad.owner];
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.8 });
    const units: THREE.Mesh[] = [];

    const offsets: Array<[number, number]> = [
      [-0.26, -0.14],
      [0.26, -0.1],
      [0, 0.3],
    ];
    for (const [x, z] of offsets) {
      const unit = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.55, 6), bodyMaterial);
      unit.position.set(x, 0.28, z);
      group.add(unit);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), headMaterial);
      head.position.set(x, 0.63, z);
      group.add(head);
      units.push(unit);
    }

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.paintLabel(canvas, texture, [String(squad.count)], "#f2ead7");
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(2.2, 1.1, 1);
    label.position.y = 1.45;
    group.add(label);

    this.scene.add(group);
    return { group, units, label, canvas, texture, labelText: String(squad.count) };
  }

  private paintLabel(canvas: HTMLCanvasElement, texture: THREE.CanvasTexture, lines: string[], color: string): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    const sizes = lines.length > 1 ? [58, 42] : [60];
    let y = canvas.height / 2 - (lines.length - 1) * 24;
    lines.forEach((line, index) => {
      context.font = `600 ${sizes[index] ?? 32}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      context.strokeStyle = "rgba(8, 11, 9, 0.85)";
      context.lineWidth = 7;
      context.strokeText(line, canvas.width / 2, y);
      context.fillStyle = color;
      context.fillText(line, canvas.width / 2, y);
      y += 66;
    });
    texture.needsUpdate = true;
  }

  private buildLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xd8e6c8, 0x1a2418, 1.35);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.1);
    sun.position.set(26, 42, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6d9bff, 0.55);
    rim.position.set(-30, 18, -24);
    this.scene.add(rim);
  }

  private buildGround(): void {
    const side = new THREE.MeshStandardMaterial({ color: 0x2a3524, roughness: 1, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ map: makeGroundTexture(), roughness: 1 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(60, 1.2, 60), [
      side,
      side,
      top,
      side,
      side,
      side,
    ]);
    ground.position.y = -0.6;
    this.scene.add(ground);

    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(62.4, 0.7, 62.4),
      new THREE.MeshStandardMaterial({ color: 0x1b261a, roughness: 1 }),
    );
    rim.position.y = -0.75;
    this.scene.add(rim);

    const grid = new THREE.GridHelper(60, 30, 0x6d8a5c, 0x4b6440);
    grid.position.y = 0.015;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.16;
    this.scene.add(grid);
  }

  private buildRoads(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x6e5c41, roughness: 1 });
    for (const edge of this.map.edges) {
      const from = this.positions.get(edge.from);
      const to = this.positions.get(edge.to);
      if (!from || !to) continue;
      const length = from.distanceTo(to);
      const road = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.52), material);
      road.position.set((from.x + to.x) / 2, 0.03, (from.z + to.z) / 2);
      road.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
      this.scene.add(road);
    }
  }

  private buildScenery(): void {
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4b3a28, roughness: 1 });
    const leafMaterials = [0x3f6b3c, 0x4d7a44, 0x335c33].map(
      (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true }),
    );
    const trunkGeometry = new THREE.CylinderGeometry(0.16, 0.24, 1.4, 5);
    const leafGeometry = new THREE.ConeGeometry(1.05, 2.6, 6);
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, 150);
    const leafMeshes = leafMaterials.map((material) => new THREE.InstancedMesh(leafGeometry, material, 50));
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    let seed = 20261101;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    let placed = 0;
    let guard = 0;
    while (placed < 150 && guard < 4000) {
      guard += 1;
      const angle = random() * Math.PI * 2;
      const radius = 20 + random() * 8.8;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      let blocked = false;
      for (const cityPosition of this.positions.values()) {
        if (Math.hypot(cityPosition.x - x, cityPosition.z - z) < 5.2) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      const height = 0.75 + random() * 0.6;
      position.set(x, 0.7 * height, z);
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI);
      scale.set(height, height, height);
      matrix.compose(position, quaternion, scale);
      trunkMesh.setMatrixAt(placed, matrix);
      const leaf = leafMeshes[placed % leafMeshes.length];
      position.set(x, 1.5 * height + 1.0, z);
      scale.set(height, height * (0.9 + random() * 0.25), height);
      matrix.compose(position, quaternion, scale);
      leaf.setMatrixAt(Math.floor(placed / leafMeshes.length), matrix);
      placed += 1;
    }
    trunkMesh.count = placed;
    leafMeshes.forEach((mesh) => {
      mesh.count = Math.ceil(placed / leafMeshes.length);
      this.scene.add(mesh);
    });
    this.scene.add(trunkMesh);
  }

  private buildRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.95, 3.35, 48),
      new THREE.MeshBasicMaterial({ color: 0xd6b26a, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.07;
    this.scene.add(ring);
    return ring;
  }

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

function makeGroundTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#37492f";
    context.fillRect(0, 0, 512, 512);
    let seed = 77123;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 420; index += 1) {
      const x = random() * 512;
      const y = random() * 512;
      const radius = 6 + random() * 26;
      context.fillStyle = `rgba(${52 + Math.floor(random() * 26)}, ${72 + Math.floor(random() * 24)}, ${44 + Math.floor(random() * 16)}, 0.35)`;
      context.beginPath();
      context.ellipse(x, y, radius, radius * 0.6, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = 0; index < 520; index += 1) {
      const x = random() * 512;
      const y = random() * 512;
      context.fillStyle = `rgba(96, 78, 50, ${0.12 + random() * 0.18})`;
      context.fillRect(x, y, 1 + random() * 2, 1 + random() * 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}
