import * as THREE from "three";
import type { CityId, CityState, MapDef, Owner, SimState, SquadState } from "@marchlands/sim";
import { art } from "./assets";

const PLAYER_COLORS: Record<Owner, number> = {
  0: 0x97917f,
  1: 0x5cc07f,
  2: 0xe06a4a,
};

const PITCH = (55 * Math.PI) / 180;
const CAMERA_DISTANCE = 90;
const VIEW_HEIGHT = 56;
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.4;

const TREE_SPECIES = ["tree_pineTallA", "tree_oak", "tree_detailed", "tree_default", "tree_pineRoundC"];
const ROCK_SPECIES = ["rock_largeB", "rock_smallA", "rock_smallB"];
const PLANT_SPECIES = ["plant_bush", "grass", "flower_redA", "flower_yellowA"];

interface CityView {
  group: THREE.Group;
  model: THREE.Group;
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  labelText: string;
  owner: Owner;
  level: number;
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
    this.renderer.toneMappingExposure = 1.2;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c120e);
    this.scene.fog = new THREE.Fog(0x0c120e, 125, 195);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 260);

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
    const projected = position.clone().setY(8.5).project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  pickCity(clientX: number, clientY: number, state: SimState): CityId | null {
    const rect = this.canvas.getBoundingClientRect();
    let bestId: CityId | null = null;
    let bestDistance = 46;
    for (const city of state.cities) {
      const position = this.positions.get(city.id);
      if (!position) continue;
      const projected = position.clone().setY(2).project(this.camera);
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
      if (position) this.ring.position.set(position.x, 0.09, position.z);
      const material = this.ring.material as THREE.MeshBasicMaterial;
      material.opacity = 0.5 + Math.sin(this.elapsed / 260) * 0.18;
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
    this.camera.lookAt(0, 2.2, 0);
  }

  private updateCities(state: SimState): void {
    for (const city of state.cities) {
      let view = this.cityViews.get(city.id);
      if (!view) {
        view = this.createCityView(city);
        this.cityViews.set(city.id, view);
      }
      if (view.owner !== city.owner || view.level !== city.level) {
        this.rebuildCityModel(view, city);
      }

      view.label.position.y = city.level === 1 ? 10 : city.level === 2 ? 14 : 16;
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

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(5.9, 30),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    group.add(shadow);

    const apron = new THREE.Mesh(
      new THREE.CylinderGeometry(5.25, 5.55, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3d4f34, roughness: 1, flatShading: true }),
    );
    apron.position.y = 0.08;
    group.add(apron);

    const platformSide = new THREE.MeshStandardMaterial({ color: 0x6a6150, roughness: 1, flatShading: true });
    const platformTop = new THREE.MeshStandardMaterial({ map: flagstoneTexture(), roughness: 0.95 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(4.55, 4.8, 0.22, 10), [
      platformSide,
      platformTop,
      platformSide,
    ]);
    platform.position.y = 0.11;
    group.add(platform);

    const model = new THREE.Group();
    model.position.y = 0.28;
    group.add(model);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 192;
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(6.4, 2.4, 1);
    label.position.y = 13.5;
    group.add(label);

    this.scene.add(group);
    const view: CityView = {
      group,
      model,
      label,
      canvas: labelCanvas,
      texture,
      labelText: "",
      owner: 255 as Owner,
      level: 0,
    };
    this.rebuildCityModel(view, city);
    return view;
  }

  private rebuildCityModel(view: CityView, city: CityState): void {
    view.model.clear();
    const tint = PLAYER_COLORS[city.owner];
    const built = art.ready ? this.buildArtCity(city, tint) : this.buildFallbackCity(city, tint);
    view.model.add(built);
    view.owner = city.owner;
    view.level = city.level;
  }

  private buildHouse(scale: number, roofStyle: number): THREE.Group {
    const group = new THREE.Group();
    const width = 4.2;
    const depth = 3.4;
    const wallHeight = 3.4;
    const roofHeight = 1.3;
    const overhang = 0.22;

    const plaster = new THREE.MeshStandardMaterial({
      map: housePlasterTexture(),
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({
      map: houseRoofTexture(roofStyle),
      roughness: 0.85,
      side: THREE.DoubleSide,
    });
    const trim = new THREE.MeshStandardMaterial({ color: 0x4a3220, roughness: 0.95 });

    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.24, 0.32, depth + 0.24),
      new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1 }),
    );
    plinth.position.y = 0.16;
    group.add(plinth);

    const body = new THREE.Mesh(new THREE.BoxGeometry(width, wallHeight, depth), plaster);
    body.position.y = 0.3 + wallHeight / 2;
    group.add(body);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(width * 0.72, 18),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    group.add(shadow);

    const geometry = new THREE.BufferGeometry();
    const x0 = -width / 2 - overhang;
    const x1 = width / 2 + overhang;
    const z0 = -depth / 2 - overhang;
    const z1 = depth / 2 + overhang;
    const eave = 0.3 + wallHeight;
    const ridge = 0.3 + wallHeight + roofHeight;
    const positions = [
      x0, eave, z1, x1, eave, z1, x1, ridge, 0, x0, ridge, 0,
      x1, eave, z0, x0, eave, z0, x0, ridge, 0, x1, ridge, 0,
    ];
    const uvs = [0, 0, 2, 0, 2, 1, 0, 1, 0, 0, 2, 0, 2, 1, 0, 1];
    const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const roof = new THREE.Mesh(geometry, roofMaterial);
    group.add(roof);

    for (const side of [-1, 1]) {
      const gable = new THREE.Mesh(new THREE.BufferGeometry(), plaster);
      const gx = side * (width / 2);
      const gpos = [gx, eave, z0, gx, eave, z1, gx, ridge, 0];
      gable.geometry.setAttribute("position", new THREE.Float32BufferAttribute(gpos, 3));
      gable.geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      gable.geometry.setIndex(side > 0 ? [0, 1, 2] : [2, 1, 0]);
      gable.geometry.computeVertexNormals();
      group.add(gable);
    }

    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.55, 0.1), trim);
    door.position.set(0.3, 1.08, depth / 2 + 0.02);
    group.add(door);

    const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x2a241c, roughness: 0.6 });
    const addWindow = (x: number, y: number, z: number, rotation: number): void => {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.58, 0.08), windowMaterial);
      pane.position.set(x, y, z);
      pane.rotation.y = rotation;
      group.add(pane);
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.74, 0.04), trim);
      frame.position.set(x, y, z);
      frame.rotation.y = rotation;
      group.add(frame);
    };
    for (const x of [-1.2, 1.25]) {
      addWindow(x, 2.55, depth / 2 + 0.03, 0);
      addWindow(x, 2.55, -depth / 2 - 0.03, 0);
    }
    for (const z of [-0.8, 0.85]) {
      addWindow(width / 2 + 0.03, 2.55, z, Math.PI / 2);
      addWindow(-width / 2 - 0.03, 2.55, z, Math.PI / 2);
    }

    const ridgeCap = new THREE.Mesh(new THREE.BoxGeometry(width + 0.46, 0.14, 0.24), trim);
    ridgeCap.position.set(0, ridge + 0.02, 0);
    group.add(ridgeCap);

    for (const cx of [-width / 2 + 0.06, width / 2 - 0.06]) {
      for (const cz of [-depth / 2 + 0.06, depth / 2 - 0.06]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, wallHeight, 0.12), trim);
        post.position.set(cx, wallHeight / 2, cz);
        group.add(post);
      }
    }
    for (const z of [-depth / 2 - 0.01, depth / 2 + 0.01]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(width, 0.12, 0.08), trim);
      beam.position.set(0, wallHeight - 0.12, z);
      group.add(beam);
    }

    const chimney = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.1, 0.4), new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1 }));
    chimney.position.set(-width / 4, ridge - 0.1, -0.5);
    group.add(chimney);

    group.scale.setScalar(scale);
    return group;
  }

  private buildArtCity(city: CityState, tint: number): THREE.Group {
    const group = new THREE.Group();
    const castle = (name: string, x: number, y: number, z: number, scale: number, rotation = 0) => {
      const piece = art.castle(name, tint);
      if (!piece) return;
      piece.position.set(x, y, z);
      piece.scale.setScalar(scale);
      piece.rotation.y = rotation;
      group.add(piece);
    };
    const town = (name: string, x: number, y: number, z: number, scale: number, rotation = 0) => {
      const piece = art.model(name);
      if (!piece) return;
      piece.position.set(x, y, z);
      piece.scale.setScalar(scale);
      piece.rotation.y = rotation;
      group.add(piece);
    };

    const village = city.level === 1;
    const wallRole = village ? "fence" : "wall";
    const wallScale = village ? 2.6 : 2.5;
    const radius = 4.2;
    this.addWallRing(
      group,
      wallRole,
      radius,
      wallScale,
      village ? "fenceGate" : "wallDoor",
      1,
    );

    if (city.level === 1) {
      const scale = 0.28;
      castle("towerSquareBase", 0, 0, -1.3, scale);
      castle("towerSquareTopRoofHigh", 0, 10 * scale, -1.3, scale);
      castle("flagBlue", 0, 21 * scale, -1.3, scale * 1.1);
      this.addKeepDoor(group, 0.05, 1.1, 1.6);
      const houseLeft = this.buildHouse(0.72, 0);
      houseLeft.position.set(-2.6, 0, 1.7);
      houseLeft.rotation.y = 0.35;
      group.add(houseLeft);
      const houseRight = this.buildHouse(0.66, 1);
      houseRight.position.set(2.55, 0, 1.35);
      houseRight.rotation.y = -0.4;
      group.add(houseRight);
      town("lantern", -3.1, 0, -1.6, 1.6);
      town("cart", 0.2, 0, 2.6, 1.4, 0.5);
    } else if (city.level === 2) {
      const scale = 0.34;
      castle("towerSquareBase", 0, 0, -1.4, scale);
      castle("towerSquareMidWindows", 0, 10 * scale, -1.4, scale);
      castle("towerSquareTopRoofHigh", 0, 20 * scale, -1.4, scale);
      castle("flagBlue", 0, 32 * scale, -1.4, scale * 1.05);
      this.addKeepDoor(group, 0.35, 1.3, 1.9);
      castle("flagBlueWide", -2.4, 0, 1.9, scale * 0.9);
      castle("flagBlueWide", 2.4, 0, 1.9, scale * 0.9);
      const houseLeft = this.buildHouse(0.68, 2);
      houseLeft.position.set(-2.7, 0, 1.6);
      houseLeft.rotation.y = 0.3;
      group.add(houseLeft);
      const houseRight = this.buildHouse(0.62, 1);
      houseRight.position.set(2.6, 0, 1.3);
      houseRight.rotation.y = -0.45;
      group.add(houseRight);
      town("lantern", -3.2, 0, -1.5, 1.6);
    } else {
      const scale = 0.4;
      for (const side of [-1, 1]) {
        castle("towerSquareBase", side * 2.55, 0, -2.1, 0.24);
        castle("towerSquareTopRoofHigh", side * 2.55, 10 * 0.24, -2.1, 0.24);
        castle("flagBlue", side * 2.55, 21 * 0.24, -2.1, 0.24);
      }
      castle("towerSquareBase", 0, 0, -0.8, scale);
      castle("towerSquareMidWindows", 0, 10 * scale, -0.8, scale);
      castle("towerSquareTopRoofHigh", 0, 20 * scale, -0.8, scale);
      castle("flagBlue", 0, 32 * scale, -0.8, scale);
      this.addKeepDoor(group, 1.35, 1.5, 2.2);
      castle("flagBlueWide", -2.8, 0, 1.9, 0.27);
      castle("flagBlueWide", 2.8, 0, 1.9, 0.27);
      const houseLeft = this.buildHouse(0.66, 0);
      houseLeft.position.set(-2.9, 0, 1.7);
      houseLeft.rotation.y = 0.6;
      group.add(houseLeft);
      const houseRight = this.buildHouse(0.62, 2);
      houseRight.position.set(2.85, 0, 1.4);
      houseRight.rotation.y = -0.65;
      group.add(houseRight);
      town("lantern", -3.4, 0, -1.4, 1.7);
    }

    return group;
  }

  private addKeepDoor(group: THREE.Group, z: number, width: number, height: number): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 0.9 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.14), material);
    door.position.set(0, height / 2, z);
    group.add(door);
    const arch = new THREE.Mesh(
      new THREE.BoxGeometry(width + 0.3, 0.22, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1 }),
    );
    arch.position.set(0, height + 0.11, z);
    group.add(arch);

    const slitMaterial = new THREE.MeshStandardMaterial({ color: 0x241d15, roughness: 0.8 });
    for (const [x, y] of [[-0.5, height + 0.9], [0.5, height + 0.9], [0, height + 1.9]] as Array<[number, number]>) {
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.5, 0.1), slitMaterial);
      slit.position.set(x, y, z - 0.05);
      group.add(slit);
    }
  }

  private addWallRing(
    group: THREE.Group,
    role: string,
    radius: number,
    scale: number,
    doorRole: string,
    rows: number,
  ): void {
    const count = Math.max(6, Math.round((Math.PI * 2 * radius) / scale));
    const doorIndex = Math.round(count * 0.25);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2;
      for (let row = 0; row < rows; row += 1) {
        const piece = art.model(index === doorIndex && row === 0 ? doorRole : role);
        if (!piece) return;
        piece.position.set(Math.cos(angle) * radius, row * scale, Math.sin(angle) * radius);
        piece.scale.setScalar(scale);
        piece.rotation.y = -angle;
        group.add(piece);
      }
    }
  }

  private buildFallbackCity(city: CityState, tint: number): THREE.Group {
    const group = new THREE.Group();
    const scale = 0.9 + city.level * 0.12;
    const keep = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 1.65, 1.85),
      new THREE.MeshStandardMaterial({ color: 0xd8cfb6, roughness: 0.9, flatShading: true }),
    );
    body.position.y = 0.82;
    keep.add(body);
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 1, 4),
      new THREE.MeshStandardMaterial({ color: tint, roughness: 0.8, flatShading: true }),
    );
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 2.5;
    keep.add(roof);
    keep.scale.set(scale, scale, scale);
    group.add(keep);
    return group;
  }

  private createSquadView(squad: SquadState): SquadView {
    const group = new THREE.Group();
    const color = PLAYER_COLORS[squad.owner];
    const bodyMaterial = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc2, roughness: 0.8 });
    const units: THREE.Mesh[] = [];

    const offsets: Array<[number, number]> = [
      [-0.3, -0.16],
      [0.3, -0.12],
      [0, 0.34],
    ];
    for (const [x, z] of offsets) {
      const unit = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.6, 6), bodyMaterial);
      unit.position.set(x, 0.3, z);
      group.add(unit);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), headMaterial);
      head.position.set(x, 0.68, z);
      group.add(head);
      const spear = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.1, 4),
        new THREE.MeshStandardMaterial({ color: 0x6b4a2f }),
      );
      spear.position.set(x + 0.16, 0.55, z);
      group.add(spear);
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
    label.position.y = 1.5;
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
    const hemisphere = new THREE.HemisphereLight(0xe4edcf, 0x1b2618, 1.35);
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffd39c, 2.7);
    sun.position.set(26, 42, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6d9bff, 0.65);
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
    gridMaterial.opacity = 0.1;
    this.scene.add(grid);
  }

  private buildRoads(): void {
    const material = new THREE.MeshStandardMaterial({ color: 0x7a674b, roughness: 1 });
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: 0x8c7959, roughness: 1 });
    for (const edge of this.map.edges) {
      const from = this.positions.get(edge.from);
      const to = this.positions.get(edge.to);
      if (!from || !to) continue;
      const length = from.distanceTo(to);
      const road = new THREE.Mesh(new THREE.BoxGeometry(length, 0.06, 0.68), material);
      road.position.set((from.x + to.x) / 2, 0.03, (from.z + to.z) / 2);
      road.rotation.y = -Math.atan2(to.z - from.z, to.x - from.x);
      this.scene.add(road);
      const center = new THREE.Mesh(new THREE.BoxGeometry(length, 0.03, 0.14), edgeMaterial);
      center.position.set(road.position.x, 0.07, road.position.z);
      center.rotation.y = road.rotation.y;
      this.scene.add(center);
    }
  }

  private buildScenery(): void {
    const random = seededRandom(20261101);
    const treePlacements: Array<{ x: number; z: number; rotation: number; scale: number }> = [];
    const rockPlacements: Array<{ x: number; z: number; rotation: number; scale: number }> = [];
    const plantPlacements: Array<{ x: number; z: number; rotation: number; scale: number }> = [];

    let guard = 0;
    while (treePlacements.length < 64 && guard < 3000) {
      guard += 1;
      const angle = random() * Math.PI * 2;
      const radius = 17 + random() * 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (nearCity(this.positions, x, z, 6.4)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 2.1)) continue;
      treePlacements.push({ x, z, rotation: random() * Math.PI * 2, scale: 2.6 + random() * 1.1 });
    }

    guard = 0;
    while (rockPlacements.length < 22 && guard < 2000) {
      guard += 1;
      const angle = random() * Math.PI * 2;
      const radius = 16 + random() * 13;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (nearCity(this.positions, x, z, 5.6)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.4)) continue;
      rockPlacements.push({ x, z, rotation: random() * Math.PI * 2, scale: 1.6 + random() * 1.2 });
    }

    guard = 0;
    while (plantPlacements.length < 46 && guard < 2000) {
      guard += 1;
      const angle = random() * Math.PI * 2;
      const radius = 15 + random() * 14;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      if (nearCity(this.positions, x, z, 4.6)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.2)) continue;
      plantPlacements.push({ x, z, rotation: random() * Math.PI * 2, scale: 1.8 + random() * 1.2 });
    }

    this.instanceSpecies(TREE_SPECIES, treePlacements, 0);
    this.instanceSpecies(ROCK_SPECIES, rockPlacements, 1);
    this.instanceSpecies(PLANT_SPECIES, plantPlacements, 2);
  }

  private instanceSpecies(
    names: string[],
    placements: Array<{ x: number; z: number; rotation: number; scale: number }>,
    variantOffset: number,
  ): void {
    if (placements.length === 0) return;
    const buckets = names.map(() => [] as typeof placements);
    placements.forEach((placement, index) => {
      buckets[(index + variantOffset) % names.length].push(placement);
    });

    names.forEach((name, nameIndex) => {
      const bucket = buckets[nameIndex];
      if (bucket.length === 0) return;
      const prototype = art.model(name);
      if (!prototype) return;
      prototype.updateMatrixWorld(true);
      const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material; matrix: THREE.Matrix4 }> = [];
      prototype.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        parts.push({
          geometry: mesh.geometry,
          material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
          matrix: mesh.matrixWorld.clone(),
        });
      });

      const dummy = new THREE.Object3D();
      for (const part of parts) {
        const instanced = new THREE.InstancedMesh(part.geometry, part.material, bucket.length);
        instanced.frustumCulled = false;
        bucket.forEach((placement, index) => {
          dummy.position.set(placement.x, 0, placement.z);
          dummy.rotation.set(0, placement.rotation, 0);
          dummy.scale.setScalar(placement.scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(dummy.matrix, part.matrix));
        });
        instanced.instanceMatrix.needsUpdate = true;
        this.scene.add(instanced);
      }
    });
  }

  private buildRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.5, 5.85, 64),
      new THREE.MeshBasicMaterial({ color: 0xe8c883, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
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

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function nearCity(positions: Map<string, THREE.Vector3>, x: number, z: number, distance: number): boolean {
  for (const position of positions.values()) {
    if (Math.hypot(position.x - x, position.z - z) < distance) return true;
  }
  return false;
}

function nearRoad(
  edges: MapDef["edges"],
  positions: Map<string, THREE.Vector3>,
  x: number,
  z: number,
  distance: number,
): boolean {
  for (const edge of edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    if (distanceToSegment(x, z, from.x, from.z, to.x, to.z) < distance) return true;
  }
  return false;
}

function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared === 0) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
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

let plasterTexture: THREE.CanvasTexture | null = null;
function housePlasterTexture(): THREE.CanvasTexture {
  if (plasterTexture) return plasterTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#d9ccb2";
    context.fillRect(0, 0, 256, 256);
    let seed = 4242;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 260; index += 1) {
      context.fillStyle = `rgba(120, 104, 78, ${0.03 + random() * 0.05})`;
      context.fillRect(random() * 256, random() * 256, 1 + random() * 4, 1 + random() * 4);
    }
    context.fillStyle = "#5a3f2a";
    context.fillRect(0, 0, 256, 14);
    context.fillRect(0, 242, 256, 14);
    context.fillRect(0, 0, 14, 256);
    context.fillRect(242, 0, 14, 256);
    context.fillRect(18, 120, 220, 12);
    for (const x of [36, 128, 220]) context.fillRect(x, 0, 10, 256);
    context.save();
    context.translate(70, 120);
    context.rotate(0.6);
    context.fillRect(0, 0, 120, 9);
    context.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  plasterTexture = texture;
  return texture;
}

const roofPalettes: Array<[string, string, string, string]> = [
  ["#a14b35", "#b25840", "#97432f", "rgba(70, 30, 20, 0.35)"],
  ["#576b46", "#637a50", "#4b5d3c", "rgba(32, 44, 26, 0.35)"],
  ["#4f5f6b", "#5c6e7c", "#43525d", "rgba(24, 32, 38, 0.35)"],
];
const roofTextures = new Map<number, THREE.CanvasTexture>();

function houseRoofTexture(style: number): THREE.CanvasTexture {
  const cached = roofTextures.get(style);
  if (cached) return cached;
  const palette = roofPalettes[style % roofPalettes.length];
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = palette[0];
    context.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row += 1) {
      const y = row * 32;
      for (let col = 0; col < 8; col += 1) {
        const x = col * 32 + (row % 2) * 16;
        context.fillStyle = row % 2 === 0 ? palette[1] : palette[2];
        context.beginPath();
        context.roundRect(x + 1, y + 1, 30, 30, 6);
        context.fill();
        context.strokeStyle = palette[3];
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(x + 4, y + 24);
        context.quadraticCurveTo(x + 16, y + 32, x + 28, y + 24);
        context.stroke();
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1.2);
  roofTextures.set(style, texture);
  return texture;
}

let flagstoneTextureCache: THREE.CanvasTexture | null = null;

function flagstoneTexture(): THREE.CanvasTexture {
  if (flagstoneTextureCache) return flagstoneTextureCache;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#8a8270";
    context.fillRect(0, 0, 256, 256);
    let seed = 991;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 70; index += 1) {
      const x = random() * 256;
      const y = random() * 256;
      const radius = 8 + random() * 14;
      context.fillStyle = `rgba(${120 + random() * 30}, ${112 + random() * 26}, ${96 + random() * 22}, 0.55)`;
      context.beginPath();
      context.ellipse(x, y, radius, radius * 0.65, random() * Math.PI, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "rgba(60, 54, 44, 0.35)";
      context.lineWidth = 2;
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  flagstoneTextureCache = texture;
  return texture;
}
