import * as THREE from "three";
import type { CityId, CityState, GridReach, MapDef, Owner, SimState, SquadState } from "@marchlands/sim";
import type { MapVisual } from "@marchlands/map-authoring";
import { Surface, decodeInt16Base64, decodeUint8Base64 } from "@marchlands/nav";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";
import { buildBuilding, paletteFor } from "./buildings";
import { siteBuildingKind, siteDefaultAsset, producingUnitKind } from "./site-kind";
import { GlbUnitActor } from "./unit-glb";
import type { UnitActorView } from "./unit-glb";
import { UnitActor } from "./unit-actor";
import { buildTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { buildAtmosphere } from "./atmosphere";
import type { Atmosphere } from "./atmosphere";
import type { UnitKind } from "./unit-models";

const PLAYER_COLORS: Record<Owner, number> = {
  0: 0x97917f,
  1: 0x5cc07f,
  2: 0xe06a4a,
};

const PITCH = (28 * Math.PI) / 180;
const FIELD_OF_VIEW = 28;
const BASE_YAW = (12 * Math.PI) / 180;
const VIEW_HEIGHT = 58;
const ZOOM_MIN = 0.32;
const ZOOM_MAX = 2.4;
const DEFAULT_ZOOM = 1.12;
const GAMEPLAY_ZOOM = 0.42;
const CITY_BASE_RADIUS = 2.3;
const CITY_BASE_HEIGHT = 0.26;
/** 可派兵目标的浅绿色格子：边长与离地高度，单位：米。 */
const REACH_CELL_SIZE = 12;
const REACH_CELL_LIFT = 0.1;
const CITY_LABEL_HEIGHT = 4.3;
const UNIT_SCALE = 1.15;
const CAVALRY_SCALE = 0.95;
const SQUAD_LABEL_HEIGHT = 1.55;
/** 兵团按实际人数铺开，每行站位与行列间距，单位：米。 */
const SQUAD_COLUMNS = 5;
const SQUAD_SPACING_X = 0.44;
const SQUAD_SPACING_Z = 0.5;
const SQUAD_CAVALRY_SPACING = 0.78;

/**
 * 兵团编队：按人数生成每个士兵的站位，行优先、以队形中心为原点。
 * 兵种来自出发据点——城镇按 id 稳定对应一种兵营，驻兵点是弓箭塔，粮仓出步兵。
 */
function squadFormation(count: number, spacingX: number, spacingZ: number): Array<[number, number]> {
  const total = Math.max(1, Math.floor(count));
  const rows = Math.ceil(total / SQUAD_COLUMNS);
  const offsets: Array<[number, number]> = [];
  for (let index = 0; index < total; index += 1) {
    const row = Math.floor(index / SQUAD_COLUMNS);
    const column = index % SQUAD_COLUMNS;
    const rowCount = Math.min(SQUAD_COLUMNS, total - row * SQUAD_COLUMNS);
    offsets.push([(column - (rowCount - 1) / 2) * spacingX, (row - (rows - 1) / 2) * spacingZ]);
  }
  return offsets;
}

const TREE_SPECIES = [
  "tree_pineTallA",
  "tree_pineTallB",
  "tree_pineTallC",
  "tree_pineTallD",
  "tree_pineRoundA",
  "tree_pineRoundC",
  "tree_pineRoundE",
  "tree_oak",
  "tree_detailed",
  "tree_default",
  "tree_fat",
  "tree_tall",
  "tree_cone",
];
const TREE_SPECIES_AUTUMN = [
  "tree_oak_fall",
  "tree_detailed_fall",
  "tree_default_fall",
  "tree_cone_fall",
  "tree_pineTallA",
  "tree_fat",
];
const TREE_SPECIES_ASH = [
  "tree_default_dark",
  "tree_detailed_dark",
  "tree_oak_dark",
  "tree_thin_dark",
  "tree_blocks",
  "tree_pineRoundB",
];
const TREE_SPECIES_COAST = ["tree_palmTall", "tree_palmShort", "tree_oak", "tree_pineRoundD", "tree_small"];
const RIM_ROCK_SPECIES = [
  "rock_largeA",
  "rock_largeC",
  "rock_largeD",
  "rock_largeE",
  "rock_largeF",
  "stone_largeA",
  "stone_largeC",
  "stone_largeE",
];
const CLIFF_ROCK_SPECIES = [
  "rock_largeA",
  "rock_largeC",
  "rock_largeD",
  "rock_largeE",
  "rock_largeF",
  "stone_largeA",
  "stone_largeC",
];
const ROCK_SPECIES = [
  "rock_largeB",
  "rock_largeA",
  "rock_largeD",
  "rock_largeE",
  "rock_tallC",
  "rock_tallE",
  "rock_tallG",
  "rock_smallA",
  "rock_smallB",
  "rock_smallD",
  "rock_smallF",
  "stone_largeC",
  "stone_smallG",
];
const PLANT_SPECIES = [
  "plant_bush",
  "plant_bushDetailed",
  "plant_bushLarge",
  "plant_bushSmall",
  "grass",
  "grass_large",
  "grass_leafs",
  "flower_redA",
  "flower_redB",
  "flower_purpleA",
  "flower_yellowC",
  "mushroom_tan",
];

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
  labelHeight: number;
  baseRadius: number;
  base: THREE.Mesh;
  shadow: THREE.Mesh;
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
  owner: Owner;
  target: string;
  /** 抵达敌方据点后先挥击再销毁的时间点；未进入收尾阶段为 0。 */
  strikeUntil: number;
}

export class BattleScene {
  private readonly canvas: HTMLCanvasElement;
  private map: MapDef;
  private visual: MapVisual | null;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cityViews = new Map<CityId, CityView>();
  private readonly squadViews = new Map<string, SquadView>();
  private readonly rings = new Map<CityId, THREE.Mesh>();
  private readonly selectedMarkers = new Map<CityId, THREE.Mesh>();
  private readonly ringGeometry = new THREE.RingGeometry(2.55, 2.85, 48);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xe8c883,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  private readonly reachGroup = new THREE.Group();
  private readonly reachCellGroup = new THREE.Group();
  private readonly squadPathGroup = new THREE.Group();
  private squadPathMesh: THREE.Mesh | null = null;
  private squadPathEdges: THREE.LineSegments | null = null;
  private squadPathKey = "";
  private reachCellMesh: THREE.Mesh | null = null;
  private reachCorners: Float32Array | null = null;
  private reachCornersKey = "";
  private readonly reachFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x2f7d3e,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    side: THREE.FrontSide,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly reachEdgeMaterial = new THREE.LineBasicMaterial({
    color: 0xc8ffd4,
    transparent: true,
    opacity: 0.9,
    toneMapped: false,
  });
  private reachTiles: THREE.Object3D[] = [];
  private reachKey = "";
  private readonly resizeObserver: ResizeObserver;
  private readonly positions = new Map<CityId, THREE.Vector3>();
  private terrain!: Terrain;
  private lastSquadUpdate = 0;

  private yawIndex = 0;
  private yaw = BASE_YAW;
  private targetYaw = BASE_YAW;
  private zoom = 1.12;
  private frameY = 0;
  private readonly focus = new THREE.Vector3();
  private bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  private elapsed = 0;
  private selectedIds: CityId[] = [];
  private disposed = false;
  private propBuildToken = 0;
  private propPoints: Array<{ x: number; z: number; radius: number }> = [];
  private readonly missingAssets = new Set<string>();
  private readonly roadGroup = new THREE.Group();
  private readonly propGroup = new THREE.Group();
  private readonly propObjects = new Map<string, THREE.Object3D>();
  private readonly sceneryGroup = new THREE.Group();
  private readonly sceneryInstances: Array<{
    mesh: THREE.InstancedMesh;
    placements: Array<{ x: number; z: number; y: number; rotation: number; scale: number; fixedY?: number }>;
    partMatrix: THREE.Matrix4;
  }> = [];
  private roadGrid: {
    surface: Uint8Array;
    heights: Int16Array;
    width: number;
    height: number;
    cellCm: number;
  } | null = null;
  private readonly foundationGroups: THREE.Group[] = [];
  private foundationToken = 0;
  private foundationSignature = "";
  private editorMode = false;
  private atmosphere: Atmosphere | null = null;
  private sun: THREE.DirectionalLight | null = null;
  /** 开场前选定的兵团皮肤：兵种 → 资产 id。 */
  private readonly unitSkins: Record<string, string>;

  constructor(
    canvas: HTMLCanvasElement,
    map: MapDef,
    visual: MapVisual | null = null,
    unitSkins: Record<string, string> = {},
  ) {
    this.canvas = canvas;
    this.map = map;
    this.visual = visual;
    this.unitSkins = unitSkins;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c120e);
    this.scene.fog = new THREE.Fog(0x0c120e, 125, 195);

    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.6, 2400);

    for (const city of map.cities) {
      this.positions.set(city.id, new THREE.Vector3(city.pos[0] / 10, 0, city.pos[1] / 10));
    }
    this.computeBounds();

    this.buildLights();
    this.scene.add(this.roadGroup);
    this.scene.add(this.propGroup);
    this.scene.add(this.sceneryGroup);
    this.scene.add(this.reachGroup);
    this.scene.add(this.reachCellGroup);
    this.scene.add(this.squadPathGroup);
    this.buildGround();
    this.applyFoundations();
    this.zoom = Math.max(this.fitZoom(), GAMEPLAY_ZOOM);
    for (const position of this.positions.values()) {
      position.y = this.terrain.heightAt(position.x, position.z);
    }
    this.buildRoads();
    this.buildScenery();
    this.buildExplicitProps();
    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlDebug = {
        projectCity: (id: string) => this.projectCity(id as CityId),
        projectCityBase: (id: string) => this.projectCityBase(id as CityId),
        projectGround: (x: number, z: number) => this.projectGround(x, z, 0.1),
      };
    }
  }

  setSelected(cityIds: readonly CityId[] | CityId | null): void {
    this.selectedIds = cityIds === null ? [] : typeof cityIds === "string" ? [cityIds] : cityIds.slice();
    this.updateRings();
  }

  /** 选中兵团时用浅绿格子显示剩余行走路线；cells 为地图坐标厘米的格心，传 null 清除。 */
  setSquadPath(cells: ReadonlyArray<readonly [number, number]> | null, cellSizeCm = 100): void {
    const key =
      cells && cells.length > 0
        ? `${cellSizeCm}:${cells.map(([x, z]) => `${x},${z}`).join(";")}`
        : "";
    if (key === this.squadPathKey) return;
    this.squadPathKey = key;
    if (this.squadPathMesh) {
      this.squadPathGroup.remove(this.squadPathMesh);
      this.squadPathMesh.geometry.dispose();
      (this.squadPathMesh.material as THREE.Material).dispose();
      this.squadPathMesh = null;
    }
    if (this.squadPathEdges) {
      this.squadPathGroup.remove(this.squadPathEdges);
      this.squadPathEdges.geometry.dispose();
      (this.squadPathEdges.material as THREE.Material).dispose();
      this.squadPathEdges = null;
    }
    if (!cells || cells.length === 0) return;
    const half = cellSizeCm / 200;
    const positions: number[] = [];
    const indices: number[] = [];
    const edgePositions: number[] = [];
    for (const [xCm, zCm] of cells) {
      const x = xCm / 100;
      const z = zCm / 100;
      const corners: Array<[number, number]> = [
        [x - half, z - half],
        [x + half, z - half],
        [x + half, z + half],
        [x - half, z + half],
      ];
      const base = positions.length / 3;
      const lifted = corners.map(([px, pz]): [number, number, number] => [
        px,
        this.terrain.heightAt(px, pz) + 0.09,
        pz,
      ]);
      for (const point of lifted) positions.push(...point);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      for (let index = 0; index < 4; index += 1) {
        const a = lifted[index];
        const b = lifted[(index + 1) % 4];
        edgePositions.push(...a, ...b);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      color: 0x9cffb8,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.squadPathMesh = new THREE.Mesh(geometry, material);
    this.squadPathMesh.renderOrder = 3;
    this.squadPathGroup.add(this.squadPathMesh);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlPath = {
        count: cells.length,
        first: cells[0],
        last: cells[cells.length - 1],
        inScene: this.squadPathGroup.children.length,
      };
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xeafff1,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    });
    this.squadPathEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    this.squadPathEdges.renderOrder = 4;
    this.squadPathGroup.add(this.squadPathEdges);
  }

  /** 开局预采样地形格角高度，避免第一次点建筑时才算两万多个点。 */
  prepareReachableCells(map: MapDef): void {
    const grid = map.grid;
    if (!grid) return;
    const key = `${grid.width}x${grid.height}x${grid.cellSizeCm}`;
    if (this.reachCorners && this.reachCornersKey === key) return;
    const cellM = grid.cellSizeCm / 100;
    const halfX = map.size[0] / 20;
    const halfZ = map.size[1] / 20;
    const stride = grid.width + 1;
    const corners = new Float32Array(stride * (grid.height + 1));
    for (let z = 0; z <= grid.height; z += 1) {
      const wz = z * cellM - halfZ;
      for (let x = 0; x <= grid.width; x += 1) {
        corners[z * stride + x] = this.terrain.heightAt(x * cellM - halfX, wz);
      }
    }
    this.reachCorners = corners;
    this.reachCornersKey = key;
  }

  /**
   * 网格地图：浅绿色标出可抵达的地面格，深绿色标出可抵达建筑占地内的格子。
   * 非网格地图传 null，清空网格高亮。
   */
  setReachableCells(reach: GridReach | null, buildings: readonly CityId[]): void {
    this.clearReachCells();
    if (!reach) return;
    const nav = reach.nav;
    const cellM = nav.cellSizeCm / 100;
    const halfX = this.map.size[0] / 20;
    const halfZ = this.map.size[1] / 20;
    const dark = new Set<number>();
    for (const id of buildings) {
      const city = this.map.cities.find((entry) => entry.id === id);
      if (!city) continue;
      const radius = (city.footprintCm ?? 800) / 200;
      const cx = city.pos[0] / 10;
      const cz = city.pos[1] / 10;
      const minX = Math.max(0, Math.floor((cx - radius + halfX) / cellM));
      const maxX = Math.min(nav.width - 1, Math.floor((cx + radius + halfX) / cellM));
      const minZ = Math.max(0, Math.floor((cz - radius + halfZ) / cellM));
      const maxZ = Math.min(nav.height - 1, Math.floor((cz + radius + halfZ) / cellM));
      for (let z = minZ; z <= maxZ; z += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const px = (x + 0.5) * cellM - halfX;
          const pz = (z + 0.5) * cellM - halfZ;
          if (Math.hypot(px - cx, pz - cz) > radius) continue;
          dark.add(nav.index(x, z));
        }
      }
    }

    // 取每个格角的实际地形高度，避免起伏地面把贴地高亮切碎。
    // 地形在一局内不变，缓存下来，切换建筑时不再重复采样两万多个点。
    const stride = nav.width + 1;
    const cornersKey = `${nav.width}x${nav.height}x${nav.cellSizeCm}`;
    if (!this.reachCorners || this.reachCornersKey !== cornersKey) {
      const corners = new Float32Array(stride * (nav.height + 1));
      for (let z = 0; z <= nav.height; z += 1) {
        const wz = z * cellM - halfZ;
        for (let x = 0; x <= nav.width; x += 1) {
          corners[z * stride + x] = this.terrain.heightAt(x * cellM - halfX, wz);
        }
      }
      this.reachCorners = corners;
      this.reachCornersKey = cornersKey;
    }
    const corners = this.reachCorners;

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const light = new THREE.Color(0x4fd985);
    const heavy = new THREE.Color(0x1f7a35);
    const lift = 0.1;
    const addCell = (index: number, color: THREE.Color): void => {
      const x = nav.cellX(index);
      const z = nav.cellZ(index);
      const cx = (x + 0.5) * cellM - halfX;
      const cz = (z + 0.5) * cellM - halfZ;
      const half = cellM * 0.42;
      const y00 = corners[z * stride + x] + lift;
      const y10 = corners[z * stride + x + 1] + lift;
      const y11 = corners[(z + 1) * stride + x + 1] + lift;
      const y01 = corners[(z + 1) * stride + x] + lift;
      const base = positions.length / 3;
      positions.push(cx - half, y00, cz - half);
      positions.push(cx + half, y10, cz - half);
      positions.push(cx + half, y11, cz + half);
      positions.push(cx - half, y01, cz + half);
      for (let vertex = 0; vertex < 4; vertex += 1) colors.push(color.r, color.g, color.b);
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    };

    for (let index = 0; index < nav.cellCount; index += 1) {
      if (dark.has(index)) {
        addCell(index, heavy);
        continue;
      }
      if (reach.cells[index] === 1) addCell(index, light);
    }
    if (positions.length === 0) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 2;
    this.reachCellMesh = mesh;
    this.reachCellGroup.add(mesh);
  }

  private clearReachCells(): void {
    if (!this.reachCellMesh) return;
    this.reachCellGroup.remove(this.reachCellMesh);
    this.reachCellMesh.geometry.dispose();
    const material = this.reachCellMesh.material as THREE.Material;
    material.dispose();
    this.reachCellMesh = null;
  }

  /** 用浅绿色格子标出当前可派兵抵达的据点。 */
  setReachable(cityIds: readonly CityId[]): void {
    const key = cityIds.join(",");
    if (key === this.reachKey) return;
    this.reachKey = key;
    for (const tile of this.reachTiles) {
      this.reachGroup.remove(tile);
      tile.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
    }
    this.reachTiles = [];
    for (const id of cityIds) {
      const tile = this.buildReachTile(id);
      if (!tile) continue;
      this.reachGroup.add(tile);
      this.reachTiles.push(tile);
    }
    this.reachGroup.visible = this.reachTiles.length > 0;
  }

  rotate(direction: 1 | -1): void {
    this.yawIndex = (this.yawIndex + direction + 4) % 4;
    this.targetYaw = BASE_YAW + (this.yawIndex * Math.PI) / 2;
  }

  focusOn(x: number, z: number): void {
    this.focus.set(x, 0, z);
    this.clampFocus();
    this.resize();
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
    this.refreshBounds();
    this.focus.set((this.bounds.minX + this.bounds.maxX) / 2, 0, (this.bounds.minZ + this.bounds.maxZ) / 2);
  }

  /** 镜头活动范围取据点与所有地基的并集，浮空岛不会被裁掉。 */
  private refreshBounds(): void {
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
    const terrainBounds = this.terrain?.bounds;
    if (terrainBounds) {
      minX = Math.min(minX, terrainBounds.minX);
      maxX = Math.max(maxX, terrainBounds.maxX);
      minZ = Math.min(minZ, terrainBounds.minZ);
      maxZ = Math.max(maxZ, terrainBounds.maxZ);
    }
    if (!Number.isFinite(minX)) {
      minX = -30;
      maxX = 30;
      minZ = -30;
      maxZ = 30;
    }
    this.bounds = { minX: minX - 8, maxX: maxX + 8, minZ: minZ - 8, maxZ: maxZ + 8 };
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
    const projected = position.clone().setY(position.y + (this.cityViews.get(cityId)?.labelHeight ?? CITY_LABEL_HEIGHT)).project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  projectCityBase(cityId: CityId): { x: number; y: number } | null {
    const position = this.positions.get(cityId);
    if (!position) return null;
    const rect = this.canvas.getBoundingClientRect();
    const projected = position.clone().setY(position.y + 1.8).project(this.camera);
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
    this.targetYaw = BASE_YAW + (state.yawIndex * Math.PI) / 2;
    this.yaw = this.targetYaw;
    this.clampFocus();
    this.resize();
  }

  setNavPreview(visible: boolean): void {
    this.terrain.setNavPreview(visible);
  }

  /** 分米坐标是否落在某块地基上。 */
  hasGround(xDm: number, zDm: number): boolean {
    return this.terrain.hasGround(xDm / 10, zDm / 10);
  }

  /** 点击兵团模型选中兵团：优先命中模型本体，退化到模型屏幕位置附近。 */
  pickSquad(clientX: number, clientY: number): string | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    let best: { id: string; distance: number } | null = null;
    for (const [id, view] of this.squadViews) {
      view.group.updateMatrixWorld(true);
      const hit = raycaster.intersectObject(view.group, true)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { id, distance: hit.distance };
    }
    if (best) return best.id;
    let fallback: { id: string; distance: number } | null = null;
    for (const [id, view] of this.squadViews) {
      const point = view.group.position.clone();
      point.y += SQUAD_LABEL_HEIGHT * 0.5;
      const projected = point.project(this.camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
      const x = rect.left + ((projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance <= 26 && (!fallback || distance < fallback.distance)) fallback = { id, distance };
    }
    return fallback?.id ?? null;
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
    for (const mesh of this.terrain.meshes) mesh.updateMatrixWorld(true);
    const hits = raycaster.intersectObjects(this.terrain.meshes, false);
    if (hits.length > 0) {
      point.copy(hits[0].point);
      return [point.x * 10, point.z * 10];
    }
    if (!raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), point)) return null;
    return [point.x * 10, point.z * 10];
  }

  /** 离屏幕坐标最近的据点及像素距离，供点击与任务箭头判定优先级。 */
  nearestCity(clientX: number, clientY: number, state: SimState): { id: CityId; distance: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    let bestId: CityId | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const city of state.cities) {
      const position = this.positions.get(city.id);
      if (!position) continue;
      const projected = position.clone().setY(position.y + 1.8).project(this.camera);
      const x = rect.left + ((projected.x + 1) / 2) * rect.width;
      const y = rect.top + ((1 - projected.y) / 2) * rect.height;
      const distance = Math.hypot(clientX - x, clientY - y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestId = city.id;
      }
    }
    return bestId ? { id: bestId, distance: bestDistance } : null;
  }

  update(state: SimState, deltaMs: number): void {
    this.elapsed += deltaMs;
    this.updateCamera(deltaMs);
    this.updateCities(state);
    this.updateSquads(state);
    this.updateRings();
    if (this.reachTiles.length > 0) {
      this.reachFillMaterial.opacity = 0.3 + (Math.sin(this.elapsed / 620) + 1) * 0.05;
    }
    this.atmosphere?.update(this.elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  getMissingAssets(): string[] {
    return [...this.missingAssets];
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.propBuildToken += 1;
    this.foundationToken += 1;
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
    this.atmosphere?.dispose();
    this.renderer.dispose();
  }

  /** 编辑器模式：相机交给外部 OrbitControls，游戏镜头更新暂停。 */
  setEditorMode(enabled: boolean): void {
    if (this.editorMode === enabled) return;
    this.editorMode = enabled;
    this.camera.fov = enabled ? 45 : FIELD_OF_VIEW;
    this.camera.near = enabled ? 0.1 : 0.6;
    this.camera.far = enabled ? 4000 : 2400;
    this.camera.updateProjectionMatrix();
  }

  getEditorCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  getEditorScene(): THREE.Scene {
    return this.scene;
  }

  getCanvasElement(): HTMLCanvasElement {
    return this.canvas;
  }

  /** 编辑器模式下只渲染，不推进模拟。 */
  renderEditor(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** 编辑器容器尺寸变化。 */
  resizeEditor(): void {
    this.resize();
  }

  /** 分米坐标处的地形高度，米。 */
  groundHeight(xDm: number, zDm: number): number {
    return this.terrain.heightAt(xDm / 10, zDm / 10);
  }

  private updateCamera(deltaMs: number): void {
    if (this.editorMode) return;
    let delta = this.targetYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = Math.min(1, deltaMs / 140);
    this.yaw += delta * step;
    if (Math.abs(delta) < 0.002) this.yaw = this.targetYaw;

    const distance = this.cameraDistance();
    const horizontal = Math.cos(PITCH) * distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.frameY + Math.sin(PITCH) * distance,
      this.focus.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.focus.x, this.frameY, this.focus.z);
    const radius = Math.max(this.terrain.island.radiusX, this.terrain.island.radiusZ);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = distance + radius * 0.25;
      fog.far = distance + radius * 2.3;
    }
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

      view.label.position.y = view.labelHeight;
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
      if (view.strikeUntil === 0) {
        const target = state.cities.find((city) => city.id === view.target);
        if (target !== undefined && target.owner !== view.owner) {
          view.strikeUntil = now + 700;
          for (const unit of view.units) {
            unit.playAttack();
            unit.update(delta);
          }
          continue;
        }
      } else if (now < view.strikeUntil) {
        for (const unit of view.units) unit.update(delta);
        continue;
      }
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
      return new THREE.Vector3(squad.xCm / 100, 0, squad.zCm / 100);
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
      new THREE.CircleGeometry(1, 30),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    shadow.scale.set(CITY_BASE_RADIUS + 0.18, CITY_BASE_RADIUS + 0.18, 1);
    group.add(shadow);

    const base = createCityBase();
    base.position.y = CITY_BASE_HEIGHT / 2;
    base.scale.set(CITY_BASE_RADIUS, 1, CITY_BASE_RADIUS);
    group.add(base);

    const model = new THREE.Group();
    model.position.y = CITY_BASE_HEIGHT;
    group.add(model);

    const labelCanvas = document.createElement("canvas");
    labelCanvas.width = 512;
    labelCanvas.height = 160;
    const texture = new THREE.CanvasTexture(labelCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(4.6, 1.48, 1);
    label.position.y = CITY_LABEL_HEIGHT;
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
      labelHeight: CITY_LABEL_HEIGHT,
      baseRadius: CITY_BASE_RADIUS,
      base,
      shadow,
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
    const fallback = buildBuilding(siteBuildingKind(city.kind), palette, city.level, seed);
    fallback.scale.multiplyScalar(1.7);
    view.model.add(fallback);
    this.enableShadows(view.model);
    this.fitCityLabel(view);
    view.owner = city.owner;
    view.level = city.level;
    view.kind = city.kind;

    const siteVisual = this.visual?.sites[city.id];
    const defaultAssetId = siteDefaultAsset(city.kind);
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
        this.enableShadows(view.model);
        this.fitCityLabel(view);
      })
      .catch(() => {
        this.missingAssets.add(assetId);
      });
  }

  private enableShadows(root: THREE.Object3D): void {
    root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
  }

  private fitCityLabel(view: CityView): void {
    view.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(view.model);
    const height = Number.isFinite(box.max.y) ? box.max.y : 3.4;
    view.labelHeight = THREE.MathUtils.clamp(height + 1.1, 3.2, 9);
    view.label.position.y = view.labelHeight;
    const halfX = THREE.MathUtils.clamp(Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) + 0.14, 1.1, 2.4);
    const halfZ = THREE.MathUtils.clamp(Math.max(Math.abs(box.min.z), Math.abs(box.max.z)) + 0.14, 1.1, 2.4);
    view.baseRadius = Math.max(halfX, halfZ);
    view.base.scale.set(halfX, 1, halfZ);
    view.shadow.scale.set(halfX + 0.08, halfZ + 0.08, 1);
  }

  private createSquadView(squad: SquadState): SquadView {
    const group = new THREE.Group();
    const kind = this.unitKindFor(squad.from);
    const spacing = kind === "cavalry" ? SQUAD_CAVALRY_SPACING : SQUAD_SPACING_X;
    const offsets = squadFormation(squad.count, spacing, kind === "cavalry" ? 0.82 : SQUAD_SPACING_Z);

    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.paintLabel(canvas, texture, [String(squad.count)], "#f2ead7");
    const label = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    label.scale.set(2.1, 1.05, 1);
    label.position.y = SQUAD_LABEL_HEIGHT;
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
      owner: squad.owner,
      target: squad.to,
      strikeUntil: 0,
    };

    const unitAssetId = this.skinFor(kind, squad.owner);
    if (unitAssetId && assetRegistry.has(unitAssetId)) {
      void this.populateGlbUnits(view, unitAssetId, squad, offsets, kind);
    } else {
      this.populateProceduralUnits(view, squad, offsets, kind);
    }
    return view;
  }

  /** 兵团外观只由玩家开场前的兵种皮肤设置决定；地图不再覆盖，敌方保留默认模型。 */
  private skinFor(kind: UnitKind, owner: Owner): string | null {
    if (owner !== 1) return null;
    return this.unitSkins[kind] ?? null;
  }

  /** 兵团外观由出发建筑类型固定决定；弓箭塔与粮仓不产兵。 */
  private unitKindFor(siteId: CityId): UnitKind {
    const site = this.map.cities.find((city) => city.id === siteId);
    if (!site) return "infantry";
    return producingUnitKind(site.kind) ?? "infantry";
  }

  private populateProceduralUnits(
    view: SquadView,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kind: UnitKind,
  ): void {
    for (let index = 0; index < offsets.length; index += 1) {
      const [x, z] = offsets[index];
      const unit = new UnitActor({
        kind,
        palette: paletteFor(squad.owner),
        variant: index % 3,
        phase: (index % SQUAD_COLUMNS) * 0.9 + Math.floor(index / SQUAD_COLUMNS) * 1.7,
      });
      unit.position.set(x, 0, z);
      unit.scale.setScalar(kind === "cavalry" ? CAVALRY_SCALE : UNIT_SCALE);
      this.enableShadows(unit);
      view.group.add(unit);
      view.units.push(unit);
    }
  }

  private async populateGlbUnits(
    view: SquadView,
    assetId: string,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kind: UnitKind,
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
        // 外部兵团资产尺寸不可控，统一按包围盒缩放到身高 1.55 m
        const box = new THREE.Box3().setFromObject(built.object);
        const height = box.max.y - box.min.y;
        unit.scale.setScalar(height > 0.01 ? 1.55 / height : 1);
        this.enableShadows(unit);
        view.group.add(unit);
        view.units.push(unit);
      }
    } catch {
      if (this.disposed || view.disposed || view.units.length > 0) return;
      this.populateProceduralUnits(view, squad, offsets, kind);
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
    const hemisphere = new THREE.HemisphereLight(0xe4edcf, 0x5c6254, 0.5);
    this.scene.add(new THREE.AmbientLight(0xcfc6ad, 0.1));
    this.scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe0b4, 3.3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.06;
    this.sun = sun;
    this.scene.add(sun);
    this.scene.add(sun.target);
    const rim = new THREE.DirectionalLight(0x6d9bff, 0.5);
    rim.position.set(-30, 18, -24);
    this.scene.add(rim);
    const bounce = new THREE.DirectionalLight(0xd6d8d0, 1.05);
    bounce.position.set(-16, -52, 48);
    this.scene.add(bounce);
  }

  private configureSunShadow(): void {
    const sun = this.sun;
    if (!sun) return;
    const island = this.terrain.island;
    const radius = Math.max(island.radiusX, island.radiusZ) * 1.45 + 12;
    sun.position.set(island.centerX + radius * 0.85, radius * 1.35, island.centerZ + radius * 0.55);
    sun.target.position.set(island.centerX, 0, island.centerZ);
    sun.target.updateMatrixWorld();
    const camera = sun.shadow.camera;
    camera.left = -radius;
    camera.right = radius;
    camera.top = radius;
    camera.bottom = -radius;
    camera.near = 1;
    camera.far = radius * 5;
    camera.updateProjectionMatrix();
  }

  private buildGround(previous?: Terrain, reuseIsland = false, atmosphereChanged = true): void {
    const terrain = this.visual?.terrain;
    this.terrain = buildTerrain(this.map, this.positions, {
      ...terrain,
      visual: this.visual,
      ...(reuseIsland && previous ? { previous } : {}),
    });
    if (previous) {
      this.scene.remove(previous.group);
      disposeObject(previous.group);
    }
    this.scene.add(this.terrain.group);
    this.refreshBounds();
    // 只在整体地貌参数变化时重建大气；增删地基或更换地表材质不应让云层/雾突然覆盖平台。
    if (atmosphereChanged) this.rebuildAtmosphere(terrain?.style);
  }

  /** 按地基逐块套用外壳模型；没有外壳的地基保留程序化浮岛。 */
  private applyFoundations(): void {
    const signature = this.terrain.platforms
      .map((entry) =>
        [
          entry.platform.id,
          entry.platform.assetId ?? "",
          entry.platform.elevation,
          entry.platform.scale,
          entry.platform.rotation,
          entry.platform.minX,
          entry.platform.maxX,
          entry.platform.minZ,
          entry.platform.maxZ,
        ].join(":"),
      )
      .join("|");
    if (signature === this.foundationSignature) return;
    this.foundationSignature = signature;
    this.foundationToken += 1;
    const token = this.foundationToken;
    for (const group of this.foundationGroups) {
      this.scene.remove(group);
      disposeObject(group);
    }
    this.foundationGroups.length = 0;
    for (const entry of this.terrain.platforms) {
      const platform = entry.platform;
      entry.shell.visible = true;
      if (!platform.assetId) continue;
      if (!assetRegistry.has(platform.assetId)) {
        this.missingAssets.add(platform.assetId);
        continue;
      }
      const assetId = platform.assetId;
      void assetRegistry
        .build(assetId, { seed: hashId(assetId), terrainStyle: this.visual?.terrain.style })
        .then((model) => {
          if (this.disposed || token !== this.foundationToken) {
            disposeObject(model);
            return;
          }
          const group = new THREE.Group();
          group.name = `foundation-${platform.id}`;
          group.add(model);
          group.position.set(
            (platform.minX + platform.maxX) / 2,
            platform.elevation,
            (platform.minZ + platform.maxZ) / 2,
          );
          group.rotation.y = (platform.rotation * Math.PI) / 180;
          group.scale.setScalar(platform.scale);
          this.foundationGroups.push(group);
          this.scene.add(group);
          entry.shell.visible = false;
        })
        .catch(() => {
          this.missingAssets.add(assetId);
          entry.shell.visible = true;
        });
    }
  }

  private rebuildAtmosphere(style: string | undefined): void {
    if (this.atmosphere) {
      this.scene.remove(this.atmosphere.group);
      this.atmosphere.dispose();
      this.atmosphere = null;
    }
    const island = this.terrain.island;
    this.frameY = -island.depth * 0.06;
    const atmosphere = buildAtmosphere({
      centerX: island.centerX,
      centerZ: island.centerZ,
      radius: Math.max(island.radiusX, island.radiusZ),
      topY: island.topY,
      depth: island.depth,
      style,
      seed: this.visual?.terrain.seed ?? 20261123,
    });
    this.atmosphere = atmosphere;
    this.scene.add(atmosphere.group);
    this.scene.background = atmosphere.background;
    this.scene.fog = new THREE.Fog(atmosphere.fogColor, atmosphere.fogNear, atmosphere.fogFar);
    this.configureSunShadow();
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
    this.updateRings();
  }

  updateTerrain(map: MapDef, visual: MapVisual | null): void {
    const previous = this.terrain;
    const previousVisual = this.visual;
    const reuseIsland = Boolean(
      previousVisual &&
        previousVisual.terrain.style === visual?.terrain.style &&
        previousVisual.terrain.seed === visual?.terrain.seed &&
        previousVisual.terrain.amplitude === visual?.terrain.amplitude &&
        previousVisual.terrain.material === visual?.terrain.material,
    );
    const atmosphereChanged =
      !previousVisual ||
      previousVisual.terrain.style !== visual?.terrain.style ||
      previousVisual.terrain.seed !== visual?.terrain.seed ||
      previousVisual.terrain.amplitude !== visual?.terrain.amplitude;
    this.map = map;
    this.visual = visual;
    this.buildGround(previous, reuseIsland, atmosphereChanged);
    this.applyFoundations();
    for (const position of this.positions.values()) {
      position.y = this.terrain.heightAt(position.x, position.z);
    }
    for (const view of this.cityViews.values()) {
      const position = this.positions.get(view.group.userData.cityId as CityId);
      if (!position) continue;
      view.group.position.set(position.x, position.y, position.z);
    }
    this.buildRoads();
    this.updateSceneryHeights();
    this.regroundProps();
    this.updateRings();
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
    this.prepareRoadGrid();
    const width = this.visual?.roads.width ?? 1.6;
    const centerId = "c3";
    const cityRadius = () => 1.95;
    const dirt = this.visual?.roads.style === "dirt";
    const roadMaterial = dirt
      ? new THREE.MeshStandardMaterial({ map: dirtTexture(1, 6), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: cobbleTexture(1, 1), roughness: 1 });
    const plazaMaterial = new THREE.MeshStandardMaterial({ map: cobbleTexture(2, 2), roughness: 1 });
    const curbMaterial = new THREE.MeshStandardMaterial({ color: dirt ? 0x736348 : 0xb3aa96, roughness: 1 });

    const covered = new Set<string>();
    for (const road of this.map.roads ?? []) {
      if (road.points.length < 2) continue;
      const controls = road.points.map(([x, z]) => new THREE.Vector3(x / 10, 0, z / 10));
      controls[0].y = this.terrain.heightAt(controls[0].x, controls[0].z);
      controls[controls.length - 1].y = this.terrain.heightAt(
        controls[controls.length - 1].x,
        controls[controls.length - 1].z,
      );
      this.addRoadPath(
        controls,
        road.widthDm / 10,
        roadMaterial,
        road.from ? cityRadius() : 0,
        road.to ? cityRadius() : 0,
      );
      if (road.from && road.to) {
        covered.add(road.from < road.to ? `${road.from}|${road.to}` : `${road.to}|${road.from}`);
      }
    }

    for (const edge of this.map.edges) {
      const edgeKey = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
      if (covered.has(edgeKey)) continue;
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
        this.addRoadPath(controls, edgeWidth, roadMaterial, cityRadius(), cityRadius());
        continue;
      }
      const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize();
      const start = from.clone().addScaledVector(direction, cityRadius());
      const end = to.clone().addScaledVector(direction, -cityRadius());
      const length = start.distanceTo(end);
      if (length < 0.6) continue;
      this.addRoad(start, end, length, edgeWidth, roadMaterial);
    }

    // 环岛、路灯这类程序化场景件不属于可编辑对象，已移除；交叉路口由普通道路组成。
  }

  private prepareRoadGrid(): void {
    this.roadGrid = null;
    if (!this.map.grid) return;
    const grid = this.map.grid;
    const cells = grid.width * grid.height;
    try {
      this.roadGrid = {
        surface: decodeUint8Base64(grid.surface, cells),
        heights: decodeInt16Base64(grid.heightCm, cells),
        width: grid.width,
        height: grid.height,
        cellCm: grid.cellSizeCm,
      };
    } catch {
      this.roadGrid = null;
    }
  }

  /** 道路经过桥面格时抬到编译后的桥面高度，其余情况贴地形。 */
  private roadGroundAt(x: number, z: number): number {
    const grid = this.roadGrid;
    if (grid) {
      const cx = Math.floor((x * 100 + this.map.size[0] * 5) / grid.cellCm);
      const cz = Math.floor((z * 100 + this.map.size[1] * 5) / grid.cellCm);
      if (cx >= 0 && cz >= 0 && cx < grid.width && cz < grid.height) {
        const index = cz * grid.width + cx;
        if (grid.surface[index] === Surface.Bridge) return grid.heights[index] / 100;
      }
    }
    return this.terrain.heightAt(x, z);
  }

  /** 按折线采样，和模拟里的道路折线保持完全一致。 */
  private samplePolyline(
    points: THREE.Vector3[],
    trimStart = 0,
    trimEnd = 0,
    step = 0.35,
  ): THREE.Vector3[] {
    if (points.length < 2) return [];
    const lengths = new Map<number, number>();
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += points[index].distanceTo(points[index - 1]);
      lengths.set(index, total);
    }
    if (total <= trimStart + trimEnd) return [];
    const startDistance = Math.max(0, trimStart);
    const endDistance = total - Math.max(0, trimEnd);
    const result: THREE.Vector3[] = [];
    for (let index = 1; index < points.length; index += 1) {
      const segmentStart = lengths.get(index - 1) ?? 0;
      const segmentEnd = lengths.get(index) ?? total;
      const from = Math.max(segmentStart, startDistance);
      const to = Math.min(segmentEnd, endDistance);
      if (to <= from) continue;
      const segmentLength = segmentEnd - segmentStart;
      if (segmentLength <= 0.0001) continue;
      const count = Math.max(1, Math.ceil((to - from) / step));
      for (let stepIndex = 0; stepIndex <= count; stepIndex += 1) {
        const distance = from + ((to - from) * stepIndex) / count;
        const t = (distance - segmentStart) / segmentLength;
        const point = points[index - 1].clone().lerp(points[index], t);
        const previous = result[result.length - 1];
        if (!previous || previous.distanceToSquared(point) > 0.000001) result.push(point);
      }
    }
    return result;
  }

  private addRoad(start: THREE.Vector3, end: THREE.Vector3, _length: number, width: number, material: THREE.Material): void {
    const samples = this.samplePolyline([start, end]);
    if (samples.length < 2) return;
    for (const point of samples) point.y = this.roadGroundAt(point.x, point.z);
    this.addRoadRibbon(samples, width, material);
  }

  private addRoadPath(
    points: THREE.Vector3[],
    width: number,
    material: THREE.Material,
    trimStart = 0,
    trimEnd = 0,
  ): void {
    const samples = this.samplePolyline(points, trimStart, trimEnd);
    if (samples.length < 2) return;
    for (const point of samples) point.y = this.roadGroundAt(point.x, point.z);
    this.addBridgeDetails(samples, width);
    this.addRoadRibbon(samples, width, material);
  }

  private isBridgeAt(x: number, z: number): boolean {
    const grid = this.roadGrid;
    if (!grid) return false;
    const cx = Math.floor((x * 100 + this.map.size[0] * 5) / grid.cellCm);
    const cz = Math.floor((z * 100 + this.map.size[1] * 5) / grid.cellCm);
    if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return false;
    return grid.surface[cz * grid.width + cx] === Surface.Bridge;
  }

  private addBridgeDetails(points: THREE.Vector3[], width: number): void {
    const spans: Array<[number, number]> = [];
    let start = -1;
    for (let index = 0; index < points.length; index += 1) {
      const bridge = this.isBridgeAt(points[index].x, points[index].z);
      if (bridge && start < 0) start = index;
      if (!bridge && start >= 0) {
        if (index - start >= 2) spans.push([start, index - 1]);
        start = -1;
      }
    }
    if (start >= 0 && points.length - 1 - start >= 2) spans.push([start, points.length - 1]);
    if (spans.length === 0) return;

    const postGeometry = new THREE.BoxGeometry(0.09, 0.72, 0.09);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5b4a35, roughness: 1 });
    const railMaterial = new THREE.LineBasicMaterial({ color: 0x6d5a40 });
    const pierGeometry = new THREE.CylinderGeometry(0.2, 0.28, 1, 7);
    const pierMaterial = new THREE.MeshStandardMaterial({ color: 0x7d7665, roughness: 1, flatShading: true });

    for (const [from, to] of spans) {
      const sides: THREE.Vector3[][] = [[], []];
      for (let index = from; index <= to; index += 1) {
        const point = points[index];
        const previous = points[Math.max(from, index - 1)];
        const next = points[Math.min(to, index + 1)];
        const tangent = new THREE.Vector3().subVectors(next, previous);
        if (tangent.lengthSq() === 0) tangent.set(1, 0, 0);
        tangent.normalize();
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
        sides.forEach((side, sideIndex) => {
          const sign = sideIndex === 0 ? -1 : 1;
          side.push(new THREE.Vector3(
            point.x + normal.x * sign * (width / 2 - 0.02),
            point.y,
            point.z + normal.z * sign * (width / 2 - 0.02),
          ));
        });
      }
      sides.forEach((side) => {
        const railPositions: number[] = [];
        for (let index = 0; index < side.length - 1; index += 1) {
          railPositions.push(
            side[index].x, side[index].y + 0.72, side[index].z,
            side[index + 1].x, side[index + 1].y + 0.72, side[index + 1].z,
          );
        }
        const railGeometry = new THREE.BufferGeometry();
        railGeometry.setAttribute("position", new THREE.Float32BufferAttribute(railPositions, 3));
        this.roadGroup.add(new THREE.LineSegments(railGeometry, railMaterial));
        for (let index = 0; index < side.length; index += 2) {
          const post = new THREE.Mesh(postGeometry, postMaterial);
          post.position.set(side[index].x, side[index].y + 0.36, side[index].z);
          this.roadGroup.add(post);
        }
      });

      const middle = points[Math.floor((from + to) / 2)];
      const ground = this.terrain.heightAt(middle.x, middle.z);
      const height = Math.max(0.4, middle.y - ground + 0.2);
      const pier = new THREE.Mesh(pierGeometry, pierMaterial);
      pier.scale.y = height;
      pier.position.set(middle.x, middle.y - height / 2 - 0.15, middle.z);
      this.roadGroup.add(pier);
    }
  }

  private addRoadRibbon(points: THREE.Vector3[], width: number, material: THREE.Material): void {
    const lift = 0.18 + (this.roadGroup.children.length % 9) * 0.0018;
    const shoulder = new THREE.Mesh(
      this.ribbonGeometry(points, width + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x4b4a36, roughness: 1 }),
    );
    shoulder.position.y = lift;
    this.roadGroup.add(shoulder);

    const road = new THREE.Mesh(this.ribbonGeometry(points, width), material);
    road.position.y = lift + 0.012;
    this.roadGroup.add(road);
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

    });
  }

  private buildScenery(): void {
    this.clearGroup(this.sceneryGroup);
    this.sceneryInstances.length = 0;
    // 自动补景已迁移为编辑器里的显式 props，保证每一株都能选中、移动和删除。
    return;
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
    type Scatter = { x: number; z: number; y: number; rotation: number; scale: number; fixedY?: number };
    const treePlacements: Scatter[] = [];
    const rockPlacements: Scatter[] = [];
    const plantPlacements: Scatter[] = [];
    const scatter = this.terrain.bounds;

    let guard = 0;
    while (treePlacements.length < 240 && guard < 30000) {
      guard += 1;
      const x = scatter.minX + 3 + random() * (scatter.maxX - scatter.minX - 6);
      const z = scatter.minZ + 3 + random() * (scatter.maxZ - scatter.minZ - 6);
      if (!this.terrain.hasScatterGround(x, z)) continue;
      if (nearCity(this.positions, x, z, 3.9)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 2.1)) continue;
      if (nearProp(x, z, 1.2)) continue;
      treePlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 2.6 + random() * 1.1 });
    }

    guard = 0;
    while (rockPlacements.length < 80 && guard < 14000) {
      guard += 1;
      const x = scatter.minX + 3 + random() * (scatter.maxX - scatter.minX - 6);
      const z = scatter.minZ + 3 + random() * (scatter.maxZ - scatter.minZ - 6);
      if (!this.terrain.hasScatterGround(x, z)) continue;
      if (nearCity(this.positions, x, z, 3.4)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.5)) continue;
      if (nearProp(x, z, 1.0)) continue;
      rockPlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 1.6 + random() * 1.2 });
    }

    guard = 0;
    while (plantPlacements.length < 180 && guard < 24000) {
      guard += 1;
      const x = scatter.minX + 3 + random() * (scatter.maxX - scatter.minX - 6);
      const z = scatter.minZ + 3 + random() * (scatter.maxZ - scatter.minZ - 6);
      if (!this.terrain.hasScatterGround(x, z)) continue;
      if (nearCity(this.positions, x, z, 2.7)) continue;
      if (nearRoad(this.map.edges, this.positions, x, z, 1.2)) continue;
      if (nearProp(x, z, 0.8)) continue;
      plantPlacements.push({ x, z, y: this.terrain.heightAt(x, z), rotation: random() * Math.PI * 2, scale: 1.8 + random() * 1.2 });
    }

    const rimRocks: Scatter[] = [];
    const cliffRocks: Scatter[] = [];
    const rimTrees: Scatter[] = [];

    const style = this.visual?.terrain?.style ?? "frontier";
    const trees =
      style === "autumn"
        ? TREE_SPECIES_AUTUMN
        : style === "ash"
          ? TREE_SPECIES_ASH
          : style === "coast"
            ? TREE_SPECIES_COAST
            : TREE_SPECIES;
    this.instanceSpecies(trees, treePlacements, 0);
    this.instanceSpecies(ROCK_SPECIES, rockPlacements, 1);
    this.instanceSpecies(PLANT_SPECIES, plantPlacements, 2);
    this.instanceSpecies(RIM_ROCK_SPECIES, rimRocks, 3);
    this.instanceSpecies(CLIFF_ROCK_SPECIES, cliffRocks, 5);
    this.instanceSpecies(trees, rimTrees, 4);
  }

  private updateSceneryHeights(): void {
    return;
    if (this.visual?.scatter === false) return;
    if (this.sceneryInstances.length === 0) {
      this.buildScenery();
      return;
    }
    const dummy = new THREE.Object3D();
    const combined = new THREE.Matrix4();
    for (const record of this.sceneryInstances) {
      record.placements.forEach((placement, index) => {
        if (placement.fixedY === undefined) placement.y = this.terrain.heightAt(placement.x, placement.z);
        dummy.position.set(placement.x, placement.y, placement.z);
        dummy.rotation.set(0, placement.rotation, 0);
        dummy.scale.setScalar(placement.scale);
        dummy.updateMatrix();
        combined.multiplyMatrices(dummy.matrix, record.partMatrix);
        record.mesh.setMatrixAt(index, combined);
      });
      record.mesh.instanceMatrix.needsUpdate = true;
    }
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
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        bucket.forEach((placement, index) => {
          dummy.position.set(placement.x, placement.y, placement.z);
          dummy.rotation.set(0, placement.rotation, 0);
          dummy.scale.setScalar(placement.scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(index, new THREE.Matrix4().multiplyMatrices(dummy.matrix, part.matrix));
        });
        instanced.instanceMatrix.needsUpdate = true;
        this.sceneryGroup.add(instanced);
        this.sceneryInstances.push({ mesh: instanced, placements: bucket, partMatrix: part.matrix.clone() });
      }
    });
  }


  refreshScenery(): void {
    this.buildScenery();
  }

  updateProps(visual: MapVisual | null): void {
    this.syncProps(visual);
  }

  private applyPropTransform(prop: MapVisual["props"][number], object: THREE.Object3D): void {
    const x = prop.pos[0] / 10;
    const z = prop.pos[1] / 10;
    const offset = (object.userData.groundOffset as number | undefined) ?? 0;
    const baseScale = object.userData.baseScale as THREE.Vector3 | undefined;
    object.position.set(x, this.terrain.heightAt(x, z) - offset, z);
    object.rotation.y = (prop.rotation * Math.PI) / 180;
    if (baseScale) object.scale.copy(baseScale).multiplyScalar(prop.scale);
  }

  private syncProps(visual: MapVisual | null): void {
    this.visual = visual;
    const props = visual?.props ?? [];
    const ids = new Set(props.map((prop) => prop.id));
    for (const [id, object] of this.propObjects) {
      if (ids.has(id)) continue;
      this.propObjects.delete(id);
      this.propGroup.remove(object);
      disposeObject(object);
    }
    for (const prop of props) {
      const existing = this.propObjects.get(prop.id);
      if (existing) {
        this.applyPropTransform(prop, existing);
        continue;
      }
      this.buildProp(prop);
    }
  }

  private buildProp(prop: MapVisual["props"][number]): void {
    const info = assetRegistry.info(prop.assetId);
    if (!info) {
      this.missingAssets.add(prop.assetId);
      return;
    }
    const token = this.propBuildToken;
    void assetRegistry
      .build(prop.assetId, { seed: hashId(prop.id), terrainStyle: this.visual?.terrain.style })
      .then((object) => {
        if (this.disposed || token !== this.propBuildToken) {
          disposeObject(object);
          return;
        }
        if (!this.visual?.props.some((entry) => entry.id === prop.id) || this.propObjects.has(prop.id)) {
          disposeObject(object);
          return;
        }
        object.userData.baseScale = object.scale.clone();
        object.userData.groundOffset = info.kind === "terrain" ? 0.04 : 0;
        this.propObjects.set(prop.id, object);
        this.propGroup.add(object);
        this.enableShadows(object);
        this.applyPropTransform(prop, object);
      })
      .catch(() => {
        this.missingAssets.add(prop.assetId);
      });
  }

  private regroundProps(): void {
    for (const prop of this.visual?.props ?? []) {
      const object = this.propObjects.get(prop.id);
      if (!object) continue;
      const x = prop.pos[0] / 10;
      const z = prop.pos[1] / 10;
      const offset = (object.userData.groundOffset as number | undefined) ?? 0;
      object.position.set(x, this.terrain.heightAt(x, z) - offset, z);
    }
  }

  private buildExplicitProps(): void {
    this.clearGroup(this.propGroup);
    this.propObjects.clear();
    this.propBuildToken += 1;
    this.propGroup.name = "map-props";
    for (const prop of this.visual?.props ?? []) this.buildProp(prop);
  }

  /** 同步所有被选中据点的地面环，多选时逐座显示。 */
  private updateRings(): void {
    const active = new Set(this.selectedIds);
    for (const [id, ring] of this.rings) {
      if (!active.has(id)) ring.visible = false;
    }
    for (const [id, marker] of this.selectedMarkers) {
      if (active.has(id)) continue;
      this.scene.remove(marker);
      marker.geometry.dispose();
      (marker.material as THREE.Material).dispose();
      this.selectedMarkers.delete(id);
    }
    for (const id of this.selectedIds) {
      const position = this.positions.get(id);
      if (!position) continue;
      let ring = this.rings.get(id);
      if (!ring) {
        ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
        ring.rotation.x = -Math.PI / 2;
        this.scene.add(ring);
        this.rings.set(id, ring);
      }
      const radius = this.cityViews.get(id)?.baseRadius ?? CITY_BASE_RADIUS;
      ring.visible = true;
      ring.scale.setScalar(radius / 2.7);
      ring.position.set(position.x, this.terrain.heightAt(position.x, position.z) + 0.09, position.z);
      let marker = this.selectedMarkers.get(id);
      if (!marker) {
        const geometry = new THREE.ConeGeometry(2.55, 3.9, 4);
        geometry.rotateX(Math.PI);
        const material = new THREE.MeshBasicMaterial({
          color: 0xffc83a,
          transparent: true,
          opacity: 0.98,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });
        marker = new THREE.Mesh(geometry, material);
        marker.renderOrder = 20;
        this.scene.add(marker);
        this.selectedMarkers.set(id, marker);
      }
      const labelHeight = this.cityViews.get(id)?.labelHeight ?? CITY_LABEL_HEIGHT;
      const baseY = this.terrain.heightAt(position.x, position.z) + labelHeight + 3;
      marker.position.set(position.x, baseY + Math.sin(this.elapsed / 300) * 0.16, position.z);
      marker.rotation.y = this.elapsed / 1400;
    }
    this.ringMaterial.opacity = 0.5 + Math.sin(this.elapsed / 260) * 0.18;
  }

  /** 贴地绘制浅绿色格子，格子随地形起伏，不会插进山坡。 */
  private buildReachTile(id: CityId): THREE.Object3D | null {
    const position = this.positions.get(id);
    if (!position) return null;
    const half = REACH_CELL_SIZE / 2;
    const segments = 8;
    const geometry = new THREE.PlaneGeometry(REACH_CELL_SIZE, REACH_CELL_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < attribute.count; index += 1) {
      const x = position.x + attribute.getX(index);
      const z = position.z + attribute.getZ(index);
      attribute.setXYZ(index, x, this.terrain.heightAt(x, z) + REACH_CELL_LIFT, z);
    }
    attribute.needsUpdate = true;

    const mesh = new THREE.Mesh(geometry, this.reachFillMaterial);
    mesh.renderOrder = 2;

    const border: number[] = [];
    const corners: Array<[number, number]> = [
      [-half, -half],
      [half, -half],
      [half, half],
      [-half, half],
    ];
    const steps = 6;
    for (let side = 0; side < corners.length; side += 1) {
      const start = corners[side];
      const end = corners[(side + 1) % corners.length];
      for (let step = 0; step < steps; step += 1) {
        const t = step / steps;
        const x = position.x + start[0] + (end[0] - start[0]) * t;
        const z = position.z + start[1] + (end[1] - start[1]) * t;
        border.push(x, this.terrain.heightAt(x, z) + REACH_CELL_LIFT + 0.03, z);
      }
    }
    const borderGeometry = new THREE.BufferGeometry();
    borderGeometry.setAttribute("position", new THREE.Float32BufferAttribute(border, 3));
    const outline = new THREE.LineLoop(borderGeometry, this.reachEdgeMaterial);
    outline.renderOrder = 3;

    const group = new THREE.Group();
    group.add(mesh);
    group.add(outline);
    return group;
  }

  private fitZoom(): number {
    const island = this.terrain.island;
    const cos = Math.abs(Math.cos(this.yaw));
    const sin = Math.abs(Math.sin(this.yaw));
    const depth = 2 * (island.radiusZ * cos + island.radiusX * sin);
    const width = 2 * (island.radiusX * cos + island.radiusZ * sin);
    const vertical = depth * Math.sin(PITCH) + island.depth * Math.cos(PITCH) + 16;
    const horizontal = width + 16;
    const aspect = Math.max(0.6, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const fit = Math.min(VIEW_HEIGHT / vertical, (VIEW_HEIGHT * aspect) / horizontal);
    return THREE.MathUtils.clamp(Math.min(DEFAULT_ZOOM, fit), ZOOM_MIN, ZOOM_MAX);
  }

  private cameraDistance(): number {
    return VIEW_HEIGHT / this.zoom / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360));
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.editorMode ? 45 : FIELD_OF_VIEW;
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

let cityBaseGeometry: THREE.CylinderGeometry | null = null;
let cityBaseMaterials: THREE.Material[] | null = null;

function createCityBase(): THREE.Mesh {
  if (!cityBaseGeometry) {
    cityBaseGeometry = new THREE.CylinderGeometry(1, 1.06, CITY_BASE_HEIGHT, 20);
    cityBaseGeometry.userData.shared = true;
  }
  if (!cityBaseMaterials) {
    const side = new THREE.MeshStandardMaterial({ color: 0x5f5848, roughness: 1, flatShading: true });
    const top = new THREE.MeshStandardMaterial({ map: cobbleTexture(2, 2), roughness: 1 });
    side.userData.shared = true;
    top.userData.shared = true;
    cityBaseMaterials = [side, top, side];
  }
  return new THREE.Mesh(cityBaseGeometry, cityBaseMaterials);
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