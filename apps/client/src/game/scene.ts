import * as THREE from "three";
import type { CityId, CityState, MapDef, Owner, SimState, SquadState } from "@marchlands/sim";
import type { MapVisual } from "@marchlands/map-authoring";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";
import { buildBuilding, buildTown, buildWall, paletteFor, townBuildingKind } from "./buildings";
import { GlbUnitActor } from "./unit-glb";
import type { UnitActorView } from "./unit-glb";
import { UnitActor } from "./unit-actor";
import { buildTerrain, terrainAtmosphere } from "./terrain";
import type { Terrain } from "./terrain";
import type { UnitKind } from "./unit-models";

const PLAYER_COLORS: Record<Owner, number> = {
  0: 0x97917f,
  1: 0x5cc07f,
  2: 0xe06a4a,
};

const PITCH = (55 * Math.PI) / 180;
const CAMERA_DISTANCE = 90;
const VIEW_HEIGHT = 57;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.4;
const DEFAULT_ZOOM = 1.12;

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
  kind: string;
  buildToken: number;
}

export interface SceneViewState {
  focus: [number, number];
  zoom: number;
  yawIndex: number;
}

interface SquadView {
  group: THREE.Group;
  units: UnitActorView[];
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  labelText: string;
  disposed: boolean;
}

export class BattleScene {
  private readonly canvas: HTMLCanvasElement;
  private map: MapDef;
  private visual: MapVisual | null;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly cityViews = new Map<CityId, CityView>();
  private readonly squadViews = new Map<string, SquadView>();
  private readonly ring: THREE.Mesh;
  private readonly resizeObserver: ResizeObserver;
  private readonly positions = new Map<CityId, THREE.Vector3>();
  private terrain!: Terrain;
  private lastSquadUpdate = 0;

  private yawIndex = 0;
  private yaw = Math.PI / 4;
  private targetYaw = Math.PI / 4;
  private zoom = 1.12;
  private readonly focus = new THREE.Vector3();
  private bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  private elapsed = 0;
  private selected: CityId | null = null;
  private disposed = false;
  private propBuildToken = 0;
  private propPoints: Array<{ x: number; z: number; radius: number }> = [];
  private readonly missingAssets = new Set<string>();
  private readonly roadGroup = new THREE.Group();
  private readonly propGroup = new THREE.Group();
  private readonly sceneryGroup = new THREE.Group();

  constructor(canvas: HTMLCanvasElement, map: MapDef, visual: MapVisual | null = null) {
    this.canvas = canvas;
    this.map = map;
    this.visual = visual;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c120e);
    this.scene.fog = new THREE.Fog(0x0c120e, 125, 195);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 260);
    this.zoom = this.fitZoom();

    for (const city of map.cities) {
      this.positions.set(city.id, new THREE.Vector3(city.pos[0] / 10, 0, city.pos[1] / 10));
    }
    this.computeBounds();

    this.buildLights();
    this.scene.add(this.roadGroup);
    this.scene.add(this.propGroup);
    this.scene.add(this.sceneryGroup);
    this.buildGround();
    for (const position of this.positions.values()) {
      position.y = this.terrain.heightAt(position.x, position.z);
    }
    this.buildRoads();
    this.buildScenery();
    this.buildExplicitProps();
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

  panBy(dx: number, dy: number): void {
    const viewHeight = VIEW_HEIGHT / this.zoom;
    const scale = viewHeight / Math.max(1, this.canvas.clientHeight);
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.focus.addScaledVector(right, -dx * scale);
    this.focus.addScaledVector(forward, dy * scale);
    this.clampFocus();
  }

  private computeBounds(): void {
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    for (const position of this.positions.values()) {
      minX = Math.min(minX, position.x);
      maxX = Math.max(maxX, position.x);
      minZ = Math.min(minZ, position.z);
      maxZ = Math.max(maxZ, position.z);
    }
    this.bounds = { minX: minX - 8, maxX: maxX + 8, minZ: minZ - 8, maxZ: maxZ + 8 };
    this.focus.set((this.bounds.minX + this.bounds.maxX) / 2, 0, (this.bounds.minZ + this.bounds.maxZ) / 2);
  }

  private clampFocus(): void {
    const viewHeight = VIEW_HEIGHT / this.zoom;
    const viewWidth = viewHeight * (this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const padX = Math.max(0, (viewWidth - (this.bounds.maxX - this.bounds.minX)) / 2);
    const padZ = Math.max(0, (viewHeight - (this.bounds.maxZ - this.bounds.minZ)) / 2);
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, this.bounds.minX - padX, this.bounds.maxX + padX);
    this.focus.z = THREE.MathUtils.clamp(this.focus.z, this.bounds.minZ - padZ, this.bounds.maxZ + padZ);
  }

  projectCity(cityId: CityId): { x: number; y: number } | null {
    const position = this.positions.get(cityId);
    if (!position) return null;
    const rect = this.canvas.getBoundingClientRect();
    const projected = position.clone().setY(position.y + 4.8).project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  getViewState(): SceneViewState {
    return { focus: [this.focus.x, this.focus.z], zoom: this.zoom, yawIndex: this.yawIndex };
  }

  setViewState(state: SceneViewState): void {
    this.focus.set(state.focus[0], 0, state.focus[1]);
    this.zoom = THREE.MathUtils.clamp(state.zoom, ZOOM_MIN, ZOOM_MAX);
    this.yawIndex = state.yawIndex;
    this.targetYaw = Math.PI / 4 + (state.yawIndex * Math.PI) / 2;
    this.yaw = this.targetYaw;
    this.clampFocus();
    this.resize();
  }

  setNavPreview(visible: boolean): void {
    this.terrain.setNavPreview(visible);
  }

  projectGround(x: number, z: number, height = 0): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    const worldX = x / 10;
    const worldZ = z / 10;
    const point = new THREE.Vector3(worldX, this.terrain.heightAt(worldX, worldZ) + height, worldZ).project(this.camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  }

  screenToGround(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    this.terrain.mesh.updateMatrixWorld(true);
    const hits = raycaster.intersectObject(this.terrain.mesh, false);
    if (hits.length > 0) {
      point.copy(hits[0].point);
      return [point.x * 10, point.z * 10];
    }
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) return null;
    return [point.x * 10, point.z * 10];
  }

  pickCity(clientX: number, clientY: number, state: SimState): CityId | null {
    const rect = this.canvas.getBoundingClientRect();
    let bestId: CityId | null = null;
    let bestDistance = 72;
    for (const city of state.cities) {
      const position = this.positions.get(city.id);
      if (!position) continue;
      const projected = position.clone().setY(position.y + 2).project(this.camera);
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
      if (position) this.ring.position.set(position.x, this.terrain.heightAt(position.x, position.z) + 0.09, position.z);
      const material = this.ring.material as THREE.MeshBasicMaterial;
      material.opacity = 0.5 + Math.sin(this.elapsed / 260) * 0.18;
    }
    this.renderer.render(this.scene, this.camera);
  }

  getMissingAssets(): string[] {
    return [...this.missingAssets];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.propBuildToken += 1;
    this.resizeObserver.disconnect();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.userData.shared !== true) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => {
        if (entry.userData.shared !== true) entry.dispose();
      });
      else if (material && material.userData.shared !== true) material.dispose();
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
      this.focus.x + Math.sin(this.yaw) * horizontal,
      Math.sin(PITCH) * CAMERA_DISTANCE,
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus.x, 2.2, this.focus.z);
  }

  private updateCities(state: SimState): void {
    const seen = new Set<CityId>();
    for (const city of state.cities) {
      seen.add(city.id);
      let view = this.cityViews.get(city.id);
      if (!view) {
        view = this.createCityView(city);
        this.cityViews.set(city.id, view);
      }
      const position = this.positions.get(city.id);
      if (position) view.group.position.set(position.x, this.terrain.heightAt(position.x, position.z), position.z);
      if (view.owner !== city.owner || view.level !== city.level || view.kind !== city.kind) {
        this.rebuildCityModel(view, city);
      }

      view.label.position.y = 3.9;
      const label = `${city.id} · L${city.level}\n${city.pop}/${city.maxPop}`;
      if (label !== view.labelText) {
        view.labelText = label;
        this.paintLabel(view.canvas, view.texture, label.split("\n"), "#f2ead7", [78, 54]);
        view.label.material.map = view.texture;
        view.label.material.needsUpdate = true;
      }
    }
    for (const [id, view] of this.cityViews) {
      if (seen.has(id)) continue;
      this.scene.remove(view.group);
      for (const unit of view.model.children) disposeObject(unit);
      view.label.material.dispose();
      view.texture.dispose();
      this.cityViews.delete(id);
    }
  }

  private updateSquads(state: SimState): void {
    const now = performance.now();
    const delta = Math.min(50, now - this.lastSquadUpdate || 16);
    this.lastSquadUpdate = now;
    const seen = new Set<string>();
    for (const squad of state.squads) {
      seen.add(squad.id);
      let view = this.squadViews.get(squad.id);
      if (!view) {
        view = this.createSquadView(squad);
        this.squadViews.set(squad.id, view);
      }
      const point = this.squadPoint(squad, state.tick);
      point.y = this.terrain.heightAt(point.x, point.z);
      view.group.position.set(point.x, point.y + 0.06, point.z);
      if (squad.gridPath && squad.xCm !== undefined && squad.zCm !== undefined && squad.gridIndex !== undefined) {
        const target = squad.gridPath[squad.gridIndex];
        if (target) {
          const dx = target[0] / 10 - squad.xCm / 10;
          const dz = target[1] / 10 - squad.zCm / 10;
          if (dx * dx + dz * dz > 0.0001) view.group.rotation.y = Math.atan2(dx, dz);
        }
      } else {
        const from = this.positions.get(squad.path[squad.pathIndex] ?? squad.from);
        const to = this.positions.get(squad.path[squad.pathIndex + 1] ?? squad.to);
        if (from && to) {
          const direction = new THREE.Vector3().subVectors(to, from);
          if (direction.lengthSq() > 0.0001) {
            view.group.rotation.y = Math.atan2(direction.x, direction.z);
          }
        }
      }
      const moving = squad.gridPath
        ? (squad.gridIndex ?? 0) < squad.gridPath.length
        : squad.pathIndex < squad.path.length - 1;
      for (const unit of view.units) {
        unit.setMoving(moving);
        unit.update(delta);
      }
    }
    for (const [id, view] of this.squadViews) {
      if (seen.has(id)) continue;
      view.disposed = true;
      for (const unit of view.units) unit.dispose();
      view.label.material.dispose();
      view.texture.dispose();
      this.scene.remove(view.group);
      this.squadViews.delete(id);
    }
  }

  private squadPoint(squad: SquadState, tick: number): THREE.Vector3 {
    if (squad.xCm !== undefined && squad.zCm !== undefined) {
      return new THREE.Vector3(squad.xCm / 10, 0, squad.zCm / 10);
    }
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
    group.userData.cityId = city.id;
    const position = this.positions.get(city.id) ?? new THREE.Vector3();
    group.position.copy(position);
    group.position.y = this.terrain.heightAt(position.x, position.z);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 30),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.14, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    group.add(shadow);

    const apron = new THREE.Mesh(
      new THREE.CylinderGeometry(3.7, 3.9, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: 0x3d4f34, roughness: 1, flatShading: true }),
    );
    apron.position.y = 0.08;
    group.add(apron);

    const platformSide = new THREE.MeshStandardMaterial({ color: 0x6a6150, roughness: 1, flatShading: true });
    const platformTop = new THREE.MeshStandardMaterial({ map: flagstoneTexture(), roughness: 0.95 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(3.45, 3.7, 0.22, 10), [
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
    labelCanvas.height = 160;
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(4.5, 1.45, 1);
    label.position.y = 3.9;
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
      kind: "",
      buildToken: 0,
    };
    this.rebuildCityModel(view, city);
    return view;
  }

  private rebuildCityModel(view: CityView, city: CityState): void {
    view.buildToken += 1;
    const token = view.buildToken;
    view.model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    view.model.clear();
    const seed = hashId(city.id) + city.level * 17;
    const palette = paletteFor(city.owner);
    if (city.kind === "town") {
      const built = buildTown(city.level, palette, seed, townBuildingKind(hashId(city.id)));
      built.add(buildWall(city.level, palette, 3.3));
      view.model.add(built);
    } else {
      const kind = city.kind === "granary" ? "granary" : "tower";
      view.model.add(buildBuilding(kind, palette, city.level, seed));
    }
    view.owner = city.owner;
    view.level = city.level;
    view.kind = city.kind;

    const siteVisual = this.visual?.sites[city.id];
    const defaultAssetId = city.kind === "town"
      ? "builtin:building.town"
      : city.kind === "granary"
        ? "builtin:building.granary"
        : "builtin:building.tower";
    const assetId = siteVisual?.assetId ?? defaultAssetId;
    if (!assetRegistry.has(assetId)) {
      this.missingAssets.add(assetId);
      return;
    }
    void assetRegistry
      .build(assetId, { owner: city.owner, level: city.level, seed })
      .then((object) => {
        if (this.disposed || view.buildToken !== token) {
          disposeObject(object);
          return;
        }
        for (const child of [...view.model.children]) {
          disposeObject(child);
          view.model.remove(child);
        }
        object.rotation.y = ((siteVisual?.rotation ?? 0) * Math.PI) / 180;
        object.scale.multiplyScalar(siteVisual?.scale ?? 1);
        view.model.add(object);
      })
      .catch(() => {
        this.missingAssets.add(assetId);
      });
  }

  private createSquadView(squad: SquadState): SquadView {
    const group = new THREE.Group();
    const explicit = (squad as SquadState & { unitKind?: UnitKind }).unitKind;
    const fallback: UnitKind[] = ["shield", "infantry", "archer"];
    const kinds: UnitKind[] = explicit ? [explicit, explicit, explicit] : fallback;

    const offsets: Array<[number, number]> = explicit === "cavalry"
      ? [[-0.65, -0.25], [0.65, -0.25], [0, 0.7]]
      : [[-0.75, -0.12], [0.75, -0.08], [0, 0.72]];

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.paintLabel(canvas, texture, [String(squad.count)], "#f2ead7");
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(2.4, 1.2, 1);
    label.position.y = 2.05;
    group.add(label);

    this.scene.add(group);
    const view: SquadView = {
      group,
      units: [],
      label,
      canvas,
      texture,
      labelText: String(squad.count),
      disposed: false,
    };

    const unitAssetId = this.visual?.units?.[squad.owner === 1 ? "player1" : "player2"];
    if (unitAssetId && assetRegistry.has(unitAssetId)) {
      void this.populateGlbUnits(view, unitAssetId, squad, offsets, kinds);
    } else {
      this.populateProceduralUnits(view, squad, offsets, kinds);
    }
    return view;
  }

  private populateProceduralUnits(
    view: SquadView,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kinds: UnitKind[],
  ): void {
    kinds.forEach((kind, index) => {
      const [x, z] = offsets[index];
      const unit = new UnitActor({
        kind,
        palette: paletteFor(squad.owner),
        variant: index,
        phase: index * 2.1 + 0.4,
      });
      unit.position.set(x, 0, z);
      unit.scale.setScalar(kind === "cavalry" ? 1.28 : 1.55);
      view.group.add(unit);
      view.units.push(unit);
    });
  }

  private async populateGlbUnits(
    view: SquadView,
    assetId: string,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kinds: UnitKind[],
  ): Promise<void> {
    try {
      for (let index = 0; index < offsets.length; index += 1) {
        const built = await assetRegistry.buildAnimated(assetId, {
          owner: squad.owner,
          seed: index + 1,
        });
        if (this.disposed || view.disposed) {
          disposeObject(built.object);
          return;
        }
        const [x, z] = offsets[index];
        const unit = new GlbUnitActor(built.object, built.animations);
        unit.position.set(x, 0, z);
        unit.scale.setScalar(1.4);
        view.group.add(unit);
        view.units.push(unit);
      }
    } catch {
      if (this.disposed || view.disposed || view.units.length > 0) return;
      this.populateProceduralUnits(view, squad, offsets, kinds);
    }
  }

  private paintLabel(
    canvas: HTMLCanvasElement,
    texture: THREE.CanvasTexture,
    lines: string[],
    color: string,
    sizes?: number[],
  ): void {
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.lineJoin = "round";
    const fontSizes = sizes ?? (lines.length > 1 ? [58, 42] : [60]);
    const step = canvas.height * 0.42;
    let y = canvas.height / 2 - ((lines.length - 1) * step) / 2;
    lines.forEach((line, index) => {
      context.font = `600 ${fontSizes[index] ?? 32}px "Segoe UI", "Microsoft YaHei", sans-serif`;
      context.strokeStyle = "rgba(8, 11, 9, 0.85)";
      context.lineWidth = 8;
      context.strokeText(line, canvas.width / 2, y);
      context.fillStyle = color;
      context.fillText(line, canvas.width / 2, y);
      y += step;
    });
    texture.needsUpdate = true;
  }

  private buildLights(): void {
    const hemisphere = new THREE.HemisphereLight(0xe4edcf, 0x1b2618, 1.5);
    this.scene.add(new THREE.AmbientLight(0xcfc6ad, 0.35));
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffd39c, 2.2);
    sun.position.set(26, 42, 18);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x6d9bff, 0.65);
    rim.position.set(-30, 18, -24);
    this.scene.add(rim);
  }

  private buildGround(): void {
    const terrain = this.visual?.terrain;
    this.terrain = buildTerrain(this.map, this.positions, terrain);
    this.scene.add(this.terrain.group);
    const atmosphere = terrainAtmosphere(terrain?.style);
    this.scene.background = new THREE.Color(atmosphere.background);
    this.scene.fog = new THREE.Fog(atmosphere.fog, 125, 195);
  }

  updateSites(map: MapDef, visual: MapVisual | null, state: SimState): void {
    this.map = map;
    this.visual = visual;
    this.positions.clear();
    for (const city of map.cities) {
      const position = new THREE.Vector3(city.pos[0] / 10, 0, city.pos[1] / 10);
      position.y = this.terrain.heightAt(position.x, position.z);
      this.positions.set(city.id, position);
    }
    this.updateCities(state);
    this.updateRoads(map, visual);
    if (this.selected) {
      const position = this.positions.get(this.selected);
      if (position) this.ring.position.set(position.x, this.terrain.heightAt(position.x, position.z) + 0.09, position.z);
    }
  }

  updateTerrain(map: MapDef, visual: MapVisual | null): void {
    this.map = map;
    this.visual = visual;
    this.scene.remove(this.terrain.group);
    disposeObject(this.terrain.group);
    this.buildGround();
    for (const position of this.positions.values()) {
      position.y = this.terrain.heightAt(position.x, position.z);
    }
    for (const view of this.cityViews.values()) {
      const position = this.positions.get(view.group.userData.cityId as CityId);
      if (!position) continue;
      view.group.position.set(position.x, position.y, position.z);
    }
    this.buildRoads();
    this.buildScenery();
    this.buildExplicitProps();
    if (this.selected) {
      const position = this.positions.get(this.selected);
      if (position) this.ring.position.set(position.x, this.terrain.heightAt(position.x, position.z) + 0.09, position.z);
    }
  }

  updateRoads(map: MapDef, visual: MapVisual | null): void {
    this.map = map;
    this.visual = visual;
    this.buildRoads();
  }

  private clearGroup(group: THREE.Group): void {
    for (const child of [...group.children]) {
      group.remove(child);
      disposeObject(child);
    }
  }

  private buildRoads(): void {
    this.clearGroup(this.roadGroup);
    const width = this.visual?.roads.width ?? 1.6;
    const centerId = "c3";
    const cityRadius = () => 3.75;
    const dirt = this.visual?.roads.style === "dirt";
    const roadMaterial = dirt
      ? new THREE.MeshStandardMaterial({ map: dirtTexture(1, 6), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: cobbleTexture(1, 1), roughness: 1 });
    const plazaMaterial = new THREE.MeshStandardMaterial({ map: cobbleTexture(2, 2), roughness: 1 });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: dirt ? 0x736348 : 0xb3aa96, roughness: 1 });

    for (const edge of this.map.edges) {
      const from = this.positions.get(edge.from);
      const to = this.positions.get(edge.to);
      if (!from || !to) continue;
      const edgeWidth = edge.widthDm !== undefined ? edge.widthDm / 10 : width;
      const path = edge.path;
      if (path && path.length >= 2) {
        const controls = path.map(([x, z]) => new THREE.Vector3(x / 10, 0, z / 10));
        controls[0].y = this.terrain.heightAt(controls[0].x, controls[0].z);
        controls[controls.length - 1].y = this.terrain.heightAt(
          controls[controls.length - 1].x,
          controls[controls.length - 1].z,
        );
        this.addRoadPath(
          controls,
          edgeWidth,
          roadMaterial,
          curbMaterial,
          edge.from !== centerId,
          edge.to !== centerId,
          plazaMaterial,
        );
        continue;
      }
      const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      const start = from.clone().addScaledVector(direction, cityRadius());
      const end = to.clone().addScaledVector(direction, -cityRadius());
      const length = start.distanceTo(end);
      if (length < 0.6) continue;
      this.addRoad(start, end, length, edgeWidth, roadMaterial, curbMaterial, edge.from !== centerId, edge.to !== centerId, plazaMaterial);
    }

    if (this.map.slug === "crossroads01") this.addRoundabout(centerId, width, plazaMaterial, curbMaterial);
  }

  private addRoad(
    start: THREE.Vector3,
    end: THREE.Vector3,
    length: number,
    width: number,
    material: THREE.Material,
    curbMaterial: THREE.Material,
    startPlaza: boolean,
    endPlaza: boolean,
    plazaMaterial: THREE.Material,
  ): void {
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const direction = new THREE.Vector3(dx, 0, dz).normalize();
    const perpendicular = new THREE.Vector3(-direction.z, 0, direction.x);
    const bend = Math.sin(start.x * 0.73 + start.z * 0.41 + end.x * 0.29 + end.z * 0.17) * Math.min(2.8, length * 0.2);
    const curve = new THREE.CatmullRomCurve3([
      start.clone(),
      start.clone().addScaledVector(direction, length / 3).addScaledVector(perpendicular, bend),
      start.clone().addScaledVector(direction, (length * 2) / 3).addScaledVector(perpendicular, bend),
      end.clone(),
    ], false, "catmullrom", 0.18);
    const points = curve.getSpacedPoints(28);
    for (const point of points) point.y = this.terrain.heightAt(point.x, point.z);
    this.addRoadRibbon(points, width, material, curbMaterial);

    if (startPlaza) this.addPlaza(start, plazaMaterial);
    if (endPlaza) this.addPlaza(end, plazaMaterial);
  }

  private addRoadPath(
    points: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    curbMaterial: THREE.Material,
    startPlaza: boolean,
    endPlaza: boolean,
    plazaMaterial: THREE.Material,
  ): void {
    const first = points[0];
    const last = points[points.length - 1];
    const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.18);
    const samples = curve
      .getSpacedPoints(Math.max(32, points.length * 14))
      .filter((point) => point.distanceTo(first) > 3.3 && point.distanceTo(last) > 3.3);
    if (samples.length < 2) return;
    for (const point of samples) point.y = this.terrain.heightAt(point.x, point.z);
    this.addRoadRibbon(samples, width, material, curbMaterial);
    if (startPlaza) this.addPlaza(first, plazaMaterial);
    if (endPlaza) this.addPlaza(last, plazaMaterial);
  }

  private addRoadRibbon(points: THREE.Vector3[], width: number, material: THREE.Material, curbMaterial: THREE.Material): void {
    const shoulder = new THREE.Mesh(
      this.ribbonGeometry(points, width + 0.55),
      new THREE.MeshStandardMaterial({ color: 0x4b4a36, roughness: 1 }),
    );
    shoulder.position.y = 0.035;
    this.roadGroup.add(shoulder);

    const road = new THREE.Mesh(this.ribbonGeometry(points, width), material);
    road.position.y = 0.05;
    this.roadGroup.add(road);

    for (const side of [-1, 1]) {
      const offset = this.offsetPoints(points, side * (width / 2 + 0.08));
      const curb = new THREE.Mesh(this.ribbonGeometry(offset, 0.16), curbMaterial);
      curb.position.y = 0.07;
      this.roadGroup.add(curb);
    }
  }

  private offsetPoints(points: THREE.Vector3[], offset: number): THREE.Vector3[] {
    return points.map((point, index) => {
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangent = new THREE.Vector3().subVectors(next, previous).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      return point.clone().addScaledVector(normal, offset);
    });
  }

  private ribbonGeometry(points: THREE.Vector3[], width: number): THREE.BufferGeometry {
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let distance = 0;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index];
      const previous = points[Math.max(0, index - 1)];
      const next = points[Math.min(points.length - 1, index + 1)];
      const tangent = new THREE.Vector3().subVectors(next, previous);
      if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
      tangent.normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
      if (index > 0) distance += point.distanceTo(points[index - 1]);
      for (const side of [-1, 1]) {
        positions.push(point.x + normal.x * side * width / 2, point.y, point.z + normal.z * side * width / 2);
        uvs.push(distance / 3.2, side < 0 ? 0 : 1);
      }
      if (index > 0) {
        const base = (index - 1) * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  private addPlaza(position: THREE.Vector3, material: THREE.Material): void {
    const plaza = new THREE.Mesh(new THREE.CircleGeometry(1.85, 22), material);
    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(position.x, this.terrain.heightAt(position.x, position.z) + 0.04, position.z);
    this.roadGroup.add(plaza);
  }

  private addRoundabout(centerId: string, width: number, plazaMaterial: THREE.Material, curbMaterial: THREE.Material): void {
    const center = this.positions.get(centerId);
    if (!center) return;
    const inner = 3.75;
    const outer = inner + width;
    const ringMaterial = new THREE.MeshStandardMaterial({ map: cobbleTexture(10, 2), roughness: 1 });
    const shoulder = new THREE.Mesh(
      new THREE.RingGeometry(inner - 0.3, outer + 0.3, 64),
      new THREE.MeshStandardMaterial({ color: 0x4b4a36, roughness: 1 }),
    );
    shoulder.rotation.x = -Math.PI / 2;
    const ground = this.terrain.heightAt(center.x, center.z);
    shoulder.position.set(center.x, ground + 0.035, center.z);
    this.roadGroup.add(shoulder);

    const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 64), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(center.x, ground + 0.05, center.z);
    this.roadGroup.add(ring);

    for (const radius of [inner, outer]) {
      const curb = new THREE.Mesh(new THREE.RingGeometry(radius - 0.09, radius + 0.09, 64), curbMaterial);
      curb.rotation.x = -Math.PI / 2;
      curb.position.set(center.x, ground + 0.11, center.z);
      this.roadGroup.add(curb);
    }

    const neighbours = this.map.cities.filter((city) => city.id !== centerId);
    neighbours.forEach((city, index) => {
      const position = this.positions.get(city.id);
      if (!position) return;
      const direction = new THREE.Vector3().subVectors(position, center).normalize();
      const pad = new THREE.Mesh(new THREE.CircleGeometry(1.55, 20), plazaMaterial);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(center.x + direction.x * outer, ground + 0.055, center.z + direction.z * outer);
      this.roadGroup.add(pad);

      if (index % 2 === 0) {
        const lamp = art.model("lantern");
        if (lamp) {
          const perp = new THREE.Vector3(-direction.z, 0, direction.x);
          lamp.position.set(
            center.x + direction.x * (outer + 1.2) + perp.x * 1.4,
            ground,
            center.z + direction.z * (outer + 1.2) + perp.z * 1.4,
          );
          lamp.scale.setScalar(2.5);
          this.roadGroup.add(lamp);
          const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.34, 0.42, 0.42, 8),
            new THREE.MeshStandardMaterial({ color: 0x8a8170, roughness: 1 }),
          );
          base.position.set(lamp.position.x, ground + 0.21, lamp.position.z);
          this.roadGroup.add(base);
        }
      }
    });
  }

  private buildScenery(): void {
    this.clearGroup(this.sceneryGroup);
    if (this.visual?.scatter === false) return;
    this.propPoints = (this.visual?.props ?? []).map((prop) => {
      const info = assetRegistry.info(prop.assetId);
      return {
        x: prop.pos[0] / 10,
        z: prop.pos[1] / 10,
        radius: Math.max(1, (info?.footprint ?? 1.5) * prop.scale * 0.5),
      };
    });
    const nearProp = (x: number, z: number, distance: number): boolean =>
      this.propPoints.some((point) => Math.hypot(point.x - x, point.z - z) < point.radius + distance);
    const random = seededRandom(20261101);
    const treePlacements: Array<{ x: number; z: number; y: number; rotation: number; scale: number }> = [];
    const rockPlacements: Array<{ x: number; z: number; y: number; rotation: number; scale: number }> = [];
    const plantPlacements: Array<{ x: number; z: number; y: number; rotation: number; scale: number }> = [];

    let guard = 0;
    while (treePlacements.length < 120 && guard < 16000) {
      guard += 1;
      const x = this.bounds.minX + 3 + random() * (this.bounds.maxX - this.bounds.minX - 6);
      const z = this.bounds.minZ + 3 + random() * (this.bounds.maxZ - this.bounds.minZ - 6);
      if (nearCity(this.positions, x, z, 6.2)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 2.1)) continue;
      if (nearProp(x, z, 1.2)) continue;
      treePlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 2.6 + random() * 1.1 });
    }

    guard = 0;
    while (rockPlacements.length < 56 && guard < 10000) {
      guard += 1;
      const x = this.bounds.minX + 3 + random() * (this.bounds.maxX - this.bounds.minX - 6);
      const z = this.bounds.minZ + 3 + random() * (this.bounds.maxZ - this.bounds.minZ - 6);
      if (nearCity(this.positions, x, z, 5.3)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.5)) continue;
      if (nearProp(x, z, 1.0)) continue;
      rockPlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 1.6 + random() * 1.2 });
    }

    guard = 0;
    while (plantPlacements.length < 110 && guard < 16000) {
      guard += 1;
      const x = this.bounds.minX + 3 + random() * (this.bounds.maxX - this.bounds.minX - 6);
      const z = this.bounds.minZ + 3 + random() * (this.bounds.maxZ - this.bounds.minZ - 6);
      if (nearCity(this.positions, x, z, 3.45)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.2)) continue;
      if (nearProp(x, z, 0.8)) continue;
      plantPlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 1.8 + random() * 1.2 });
    }

    this.instanceSpecies(TREE_SPECIES, treePlacements, 0);
    this.instanceSpecies(ROCK_SPECIES, rockPlacements, 1);
    this.instanceSpecies(PLANT_SPECIES, plantPlacements, 2);
  }

  private instanceSpecies(
    names: string[],
    placements: Array<{ x: number; z: number; y: number; rotation: number; scale: number }>,
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
          dummy.position.set(placement.x, placement.y, placement.z);
          dummy.rotation.set(0, placement.rotation, 0);
          dummy.scale.setScalar(placement.scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(dummy.matrix, part.matrix));
        });
        instanced.instanceMatrix.needsUpdate = true;
        this.sceneryGroup.add(instanced);
      }
    });
  }


  updateProps(visual: MapVisual | null): void {
    this.visual = visual;
    this.buildExplicitProps();
  }

  private buildExplicitProps(): void {
    this.clearGroup(this.propGroup);
    this.propBuildToken += 1;
    const props = this.visual?.props ?? [];
    if (props.length === 0) return;
    const group = this.propGroup;
    group.name = "map-props";
    const token = this.propBuildToken;
    for (const prop of props) {
      const info = assetRegistry.info(prop.assetId);
      if (!info) {
        this.missingAssets.add(prop.assetId);
        continue;
      }
      void assetRegistry
        .build(prop.assetId, { seed: hashId(prop.id), terrainStyle: this.visual?.terrain.style })
        .then((object) => {
          if (this.disposed || token !== this.propBuildToken) {
            disposeObject(object);
            return;
          }
          const x = prop.pos[0] / 10;
          const z = prop.pos[1] / 10;
          const y = this.terrain.heightAt(x, z) - (info.kind === "terrain" ? 0.04 : 0);
          object.position.set(x, y, z);
          object.rotation.y = (prop.rotation * Math.PI) / 180;
          object.scale.multiplyScalar(prop.scale);
          group.add(object);
        })
        .catch(() => {
          this.missingAssets.add(prop.assetId);
        });
    }
  }

  private buildRing(): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.75, 6.1, 64),
      new THREE.MeshBasicMaterial({ color: 0xe8c883, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.09;
    this.scene.add(ring);
    return ring;
  }

  private fitZoom(): number {
    let radius = 1;
    for (const city of this.map.cities) {
      radius = Math.max(radius, Math.hypot(city.pos[0] / 10, city.pos[1] / 10));
    }
    const fit = VIEW_HEIGHT / (radius * 2 * 1.12);
    return THREE.MathUtils.clamp(Math.min(DEFAULT_ZOOM, fit), ZOOM_MIN, ZOOM_MAX);
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

function hashId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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


function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && mesh.geometry.userData.shared !== true) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material && material.userData.shared !== true) material.dispose();
    }
  });
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


let dirtCache: THREE.CanvasTexture | null = null;

function dirtTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  if (!dirtCache) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#8a7451";
      context.fillRect(0, 0, 256, 256);
      let seed = 7319;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let index = 0; index < 900; index += 1) {
        const x = random() * 256;
        const y = random() * 256;
        const size = 1 + random() * 3;
        context.fillStyle = `rgba(${70 + Math.floor(random() * 40)}, ${56 + Math.floor(random() * 30)}, ${34 + Math.floor(random() * 24)}, ${0.18 + random() * 0.35})`;
        context.fillRect(x, y, size, size);
      }
      for (let index = 0; index < 45; index += 1) {
        context.strokeStyle = "rgba(58, 45, 28, 0.28)";
        context.lineWidth = 1;
        context.beginPath();
        const x = random() * 256;
        const y = random() * 256;
        context.moveTo(x, y);
        context.quadraticCurveTo(x + 8, y + 5, x + 18, y - 2);
        context.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    dirtCache = texture;
  }
  const clone = dirtCache.clone();
  clone.needsUpdate = true;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeatX, repeatY);
  return clone;
}

let cobbleCache: THREE.CanvasTexture | null = null;

function cobbleTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  if (!cobbleCache) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "#5f5848";
      context.fillRect(0, 0, 256, 256);
      let seed = 5521;
      const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let row = 0; row < 9; row += 1) {
        for (let col = 0; col < 9; col += 1) {
          const w = 22 + random() * 6;
          const h = 20 + random() * 6;
          const x = col * 29 + (row % 2) * 12 + 3;
          const y = row * 29 + 3;
          context.fillStyle = `rgb(${104 + random() * 22}, ${96 + random() * 20}, ${78 + random() * 18})`;
          context.beginPath();
          context.roundRect(x, y, w, h, 5);
          context.fill();
          context.strokeStyle = "rgba(40, 36, 28, 0.32)";
          context.lineWidth = 2;
          context.stroke();
          context.fillStyle = "rgba(255, 245, 220, 0.05)";
          context.fillRect(x + 3, y + 3, w - 6, 3);
        }
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    cobbleCache = texture;
  }
  const clone = cobbleCache.clone();
  clone.needsUpdate = true;
  clone.wrapS = THREE.RepeatWrapping;
  clone.wrapT = THREE.RepeatWrapping;
  clone.repeat.set(repeatX, repeatY);
  return clone;
}