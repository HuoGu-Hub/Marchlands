import * as THREE from "three";
import type { CityId, CityState, GridReach, MapDef, Owner, SimState, SquadState } from "@marchlands/sim";
import type { MapVisual } from "@marchlands/map-authoring";
import { Surface, decodeInt16Base64, decodeUint8Base64 } from "@marchlands/nav";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";
import { buildBuilding, paletteFor } from "./buildings";
import { siteBuildingKind, siteDefaultAsset, producingUnitKind } from "./site-kind";
import { GlbUnitActor } from "./unit-glb";
import { UnitActor } from "./unit-actor";
import { ProjectileField } from "./projectiles";
import { SQUAD_BILLBOARD_SIZE, SquadInstanceField, squadInstanceBucket } from "./squad-instances";
import type { SquadInstanceEntry } from "./squad-instances";
import { buildTerrain } from "./terrain";
import type { Terrain } from "./terrain";
import { buildAtmosphere } from "./atmosphere";
import type { Atmosphere } from "./atmosphere";
import type { UnitKind } from "./unit-models";

const PITCH = (28 * Math.PI) / 180;
const FIELD_OF_VIEW = 28;
const BASE_YAW = (12 * Math.PI) / 180;
const VIEW_HEIGHT = 58;
const ZOOM_MIN = 0.32;
const ZOOM_MAX = 2.4;
const DEFAULT_ZOOM = 1.12;
const GAMEPLAY_ZOOM = 0.42;
const CITY_BASE_RADIUS = 2.3;
/** 可派兵目标的浅绿色格子：边长与离地高度，单位：米。 */
const REACH_CELL_SIZE = 12;
const REACH_CELL_LIFT = 0.1;
const CITY_LABEL_HEIGHT = 4.3;
/** 法师塔火球从塔顶水晶附近发出，而不是从地面。 */
const MAGE_TOWER_MUZZLE_HEIGHT = 2.9;
/** 兵团路线要压在道路面之上，否则与道路重叠时会被完全遮住。 */
const SQUAD_PATH_LIFT = 0.3;
/** 单击目的地路线预览的保留路径 id。 */
const PREVIEW_PATH_ID = "__route-preview";
/** 所有小兵统一缩放到这个身高，和程序化小兵、建筑保持同一档。 */
const GLB_UNIT_HEIGHT = 0.95;
const SQUAD_LABEL_HEIGHT = 1.55;
/** 兵团按实际人数铺开，每行站位与行列间距，单位：米。 */
const SQUAD_COLUMNS = 3;
const SQUAD_SPACING_X = 0.86;
const SQUAD_SPACING_Z = 0.96;
const SQUAD_CAVALRY_SPACING = 1.1;

/**
 * 兵团编队：按人数生成每个士兵的站位，行优先、以队形中心为原点。
 * 兵种来自出发据点——城镇按 id 稳定对应一种兵营，驻兵点是弓箭塔，粮仓出步兵。
 */
/** 单兵团最多渲染的小兵数；数值本身仍以兵团实时兵力显示在头顶。 */
const MAX_SQUAD_UNITS = 20;
/** GLB 小兵每个有几十个部件，兵团里只摆前几个，避免一次出兵几百个网格。 */
const MAX_GLB_SQUAD_UNITS = 8;

/** 每个小兵的确定性随机量，保证编队有松散感但不会每帧抖动。 */
function unitJitter(id: string, index: number, salt: number): number {
  const seed = hashId(id) + index * 97 + salt * 131;
  const value = Math.sin(seed) * 43758.5453;
  return value - Math.floor(value);
}

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
  visualKey: string;
  buildToken: number;
  labelHeight: number;
  baseRadius: number;
  shadow: THREE.Mesh;
  /** 远处使用的单网格据点；近处仍显示完整 GLB。 */
  proxy: THREE.Object3D | null;
  /** 上一次重绘文字标签的时间；人口频繁变化时限频。 */
  labelPaintedAt: number;
  /** 是否挂在场景树里；镜头外会摘下。 */
  attached: boolean;
}

export interface SceneViewState {
  focus: [number, number];
  zoom: number;
  yawIndex: number;
}

type SquadUnit = UnitActor | GlbUnitActor;

interface SquadView {
  group: THREE.Group;
  units: SquadUnit[];
  label: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  labelText: string;
  disposed: boolean;
  owner: Owner;
  target: string;
  loading: boolean;
  shadow: THREE.Mesh;
  /** 抵达敌方据点后先挥击再销毁的时间点；未进入收尾阶段为 0。 */
  strikeUntil: number;
  /** 远距离兵团降频更新动画时累计的时间。 */
  animAccum: number;
  /** 当前是否使用远处静态替身；用滞回避免镜头在阈值附近反复切换。 */
  instanced: boolean;
  /** 是否挂在场景树里；镜头外会摘下以减少矩阵与渲染遍历。 */
  attached: boolean;
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
  private readonly projectiles = new ProjectileField();
  private readonly squadInstances = new SquadInstanceField();
  private readonly frustum = new THREE.Frustum();
  private readonly frustumMatrix = new THREE.Matrix4();
  private readonly squadSphere = new THREE.Sphere();
  private readonly citySphere = new THREE.Sphere();
  private readonly rings = new Map<CityId, THREE.Mesh>();
  private readonly attackRangeRings = new Map<CityId, THREE.Mesh>();
  private mageTowerRangeCm = 700;
  private readonly selectedMarkers = new Map<CityId, THREE.Mesh>();
  private readonly ringGeometry = new THREE.RingGeometry(2.55, 2.85, 48);
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: 0xe8c883,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });
  private readonly reachGroup = new THREE.Group();
  private readonly squadPathGroup = new THREE.Group();
  private readonly squadPathViews = new Map<string, { fill: THREE.Mesh; edges: THREE.LineSegments; key: string }>();
  private readonly squadFillMaterial = new THREE.MeshBasicMaterial({
    color: 0x7fe89a,
    transparent: true,
    opacity: 0.46,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  private readonly squadFillSelectedMaterial = new THREE.MeshBasicMaterial({
    color: 0x9cffb8,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  private readonly squadEdgeMaterial = new THREE.LineBasicMaterial({
    color: 0xc9ffdb,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly squadEdgeSelectedMaterial = new THREE.LineBasicMaterial({
    color: 0xeafff1,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    toneMapped: false,
  });
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
  private pitch = PITCH;
  private zoom = 1.12;
  private intro: {
    fromX: number;
    fromZ: number;
    fromZoom: number;
    toX: number;
    toZ: number;
    toZoom: number;
    elapsed: number;
    duration: number;
  } | null = null;
  private frameY = 0;
  private readonly focus = new THREE.Vector3();
  private bounds = { minX: -30, maxX: 30, minZ: -30, maxZ: 30 };
  private elapsed = 0;
  /** 渲染分辨率倍率：帧时偏高时自动降，恢复后再升回来。 */
  private renderScale = 1;
  /** 开局测帧用的采样，测完就定死倍率，不再逐帧来回调整。 */
  private benchFrames: number[] = [];
  private benchDone = false;
  private settleFrames: number[] = [];
  private settleTimer = 2000;
  private selectedIds: CityId[] = [];
  private selectedSquadId: string | null = null;
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
  private readonly pickRaycaster = new THREE.Raycaster();
  private readonly pickNdc = new THREE.Vector2();
  private readonly pickPoint = new THREE.Vector3();
  private readonly pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly projectPoint = new THREE.Vector3();
  private readonly pathHeights = new Map<number, number>();
  private viewport = { left: 0, top: 0, width: 0, height: 0 };

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
    for (const material of [
      this.squadFillMaterial,
      this.squadFillSelectedMaterial,
      this.squadEdgeMaterial,
      this.squadEdgeSelectedMaterial,
    ]) {
      material.userData.shared = true;
    }
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    // 2 倍像素密度在 1080p 缩放屏上会吃掉一半帧率，限制到 1.25 后画面几乎看不出差别。
    this.renderer.setPixelRatio(this.basePixelRatio());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 阴影投射物都是静态建筑/地形，兵团单位不投影；阴影贴图只需在
    // 建筑重建后重画，避免每帧把整张地图再渲染一遍。
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c120e);
    this.scene.fog = new THREE.Fog(0x0c120e, 125, 195);

    this.camera = new THREE.PerspectiveCamera(FIELD_OF_VIEW, 1, 0.6, 2400);
    this.squadInstances.configure(this.renderer, this.camera);

    for (const city of map.cities) {
      this.positions.set(city.id, new THREE.Vector3(city.pos[0] / 10, 0, city.pos[1] / 10));
    }
    this.computeBounds();

    this.buildLights();
    this.scene.add(this.projectiles.group);
    this.projectiles.load();
    this.scene.add(this.roadGroup);
    this.scene.add(this.propGroup);
    this.scene.add(this.sceneryGroup);
    this.scene.add(this.reachGroup);
    this.scene.add(this.squadPathGroup);
    this.scene.add(this.squadInstances.group);
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
        focus: (xDm: number, zDm: number, zoom?: number) => {
          this.focus.x = xDm / 10;
          this.focus.z = zDm / 10;
          if (zoom !== undefined) this.zoom = THREE.MathUtils.clamp(zoom, ZOOM_MIN, ZOOM_MAX);
          this.updateCamera(0);
          return { x: this.focus.x, z: this.focus.z, zoom: this.zoom };
        },
      };
    }
  }

  setSelected(cityIds: readonly CityId[] | CityId | null): void {
    this.selectedIds = cityIds === null ? [] : typeof cityIds === "string" ? [cityIds] : cityIds.slice();
    this.updateRings();
  }

  setSelectedSquad(id: string | null): void {
    this.selectedSquadId = id;
  }

  /** 当前真正挂在场景树里的兵团数，用作远景 LOD 的压力信号。 */
  private visibleSquadCount(): number {
    let count = 0;
    for (const view of this.squadViews.values()) if (view.attached) count += 1;
    return count;
  }

  /** 静态投影物变化后重画一次阴影贴图，其余帧直接复用。 */
  private markShadowDirty(): void {
    this.renderer.shadowMap.needsUpdate = true;
  }

  /** 法师塔开火：从塔顶向事件记录的目标位置打一道火红激光。 */
  playTowerLaser(cityId: CityId, owner: Owner, xCm: number, zCm: number): void {
    const base = this.positions.get(cityId);
    if (!base) return;
    const from = base.clone();
    from.y = this.terrain.heightAt(base.x, base.z) + MAGE_TOWER_MUZZLE_HEIGHT;
    const toX = xCm / 100;
    const toZ = zCm / 100;
    const to = new THREE.Vector3(toX, this.terrain.heightAt(toX, toZ) + 0.9, toZ);
    this.projectiles.launchTowerLaser(owner, from, to);
  }

  /** 场上每支己方兵团都用浅绿格子显示剩余路线；选中的那支更亮。 */
  setSquadPaths(
    paths: ReadonlyArray<{
      id: string;
      cells: ReadonlyArray<readonly [number, number]>;
      selected: boolean;
    }>,
    cellSizeCm = 100,
  ): void {
    const active = new Set(paths.map((path) => path.id));
    for (const [id, view] of this.squadPathViews) {
      // 路线预览占一个保留 id，不能被每 200ms 的兵团路线刷新清掉。
      if (id === PREVIEW_PATH_ID) continue;
      if (active.has(id)) continue;
      this.disposePathView(view);
      this.squadPathViews.delete(id);
    }
    for (const path of paths) {
      this.syncPathView(path.id, path.cells, cellSizeCm, path.selected);
    }
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlPath = {
        paths: this.squadPathViews.size,
        cells: paths.reduce((sum, path) => sum + path.cells.length, 0),
      };
    }
  }

  /** 单击目的地时的行军预览：和兵团实际行军一样，在地面铺同一套绿格。 */
  setPreviewPath(cells: ReadonlyArray<readonly [number, number]> | null, cellSizeCm = 100): void {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlPreview = { cells: cells?.length ?? 0 };
    }
    const existing = this.squadPathViews.get(PREVIEW_PATH_ID);
    if (!cells || cells.length === 0) {
      if (existing) {
        this.disposePathView(existing);
        this.squadPathViews.delete(PREVIEW_PATH_ID);
      }
      return;
    }
    this.syncPathView(PREVIEW_PATH_ID, cells, cellSizeCm, true);
  }

  private disposePathView(view: { fill: THREE.Mesh; edges: THREE.LineSegments }): void {
    this.squadPathGroup.remove(view.fill);
    this.squadPathGroup.remove(view.edges);
    view.fill.geometry.dispose();
    view.edges.geometry.dispose();
  }

  /** 按格心铺一层贴地四边形；兵团路线与单击预览共用同一份几何。 */
  private syncPathView(
    id: string,
    cells: ReadonlyArray<readonly [number, number]>,
    cellSizeCm: number,
    selected: boolean,
  ): void {
    if (cells.length === 0) return;
    const key = `${cellSizeCm}:${selected ? 1 : 0}:${cells
      .map(([x, z]) => `${x},${z}`)
      .join(";")}`;
    const existing = this.squadPathViews.get(id);
    if (existing?.key === key) return;
    if (existing) this.disposePathView(existing);
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
        this.pathHeight(px, pz) + SQUAD_PATH_LIFT,
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
    const material = selected ? this.squadFillSelectedMaterial : this.squadFillMaterial;
    const fill = new THREE.Mesh(geometry, material);
    fill.renderOrder = 3;
    this.squadPathGroup.add(fill);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
    const edgeMaterial = selected ? this.squadEdgeSelectedMaterial : this.squadEdgeMaterial;
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.renderOrder = 4;
    this.squadPathGroup.add(edges);
    this.squadPathViews.set(id, { fill, edges, key });
  }

  /**
   * 网格地图：把可达范围直接写进地形顶点属性，由地形材质染色。
   *
   * 不单独铺一层贴片：贴片在崖壁上会被格角高度拉成竖三角，而且陡面没有可靠法线可剔除。
   * 顶点属性跟着真实曲面走，材质按法线在陡处淡出，崖壁不会出现绿色。
   * 0 不可达，1 普通可走，2 可到建筑占地。
   */
  setReachableCells(reach: GridReach | null, buildings: readonly CityId[]): void {
    if (!reach) {
      this.terrain.setReachCells(null);
      return;
    }
    const nav = reach.nav;
    const cellM = nav.cellSizeCm / 100;
    const halfX = this.map.size[0] / 20;
    const halfZ = this.map.size[1] / 20;
    const values = new Uint8Array(nav.cellCount);
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
          values[nav.index(x, z)] = 2;
        }
      }
    }
    for (let index = 0; index < nav.cellCount; index += 1) {
      if (values[index] === 0 && reach.cells[index] === 1) values[index] = 1;
    }
    this.terrain.setReachCells(values);
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
    const rect = this.canvasRect();
    const projected = this.projectPoint
      .copy(position)
      .setY(position.y + (this.cityViews.get(cityId)?.labelHeight ?? CITY_LABEL_HEIGHT))
      .project(this.camera);
    return {
      x: rect.left + ((projected.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - projected.y) / 2) * rect.height,
    };
  }

  projectCityBase(cityId: CityId): { x: number; y: number } | null {
    const position = this.positions.get(cityId);
    if (!position) return null;
    const rect = this.canvasRect();
    const projected = this.projectPoint.copy(position).setY(position.y + 1.8).project(this.camera);
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
    const rect = this.canvasRect();
    const worldX = x / 10;
    const worldZ = z / 10;
    const point = this.projectPoint
      .set(worldX, this.terrain.heightAt(worldX, worldZ) + height, worldZ)
      .project(this.camera);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
    return {
      x: rect.left + ((point.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - point.y) / 2) * rect.height,
    };
  }

  /**
   * 屏幕坐标落到哪块地面。
   *
   * 不逐三角面射线：整张地形有四五万面，一次拾取要 3~4ms，
   * 拖动箭头时每个 pointermove 都做一次会直接把帧率拖垮。
   * 地形是高度场，沿射线按 0.4 米步进取第一次穿面，再二分收敛，
   * 精度到毫米级，单次约 5~10 微秒。
   */
  screenToGround(clientX: number, clientY: number): [number, number] | null {
    const rect = this.canvasRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
      -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1,
    );
    this.pickRaycaster.setFromCamera(this.pickNdc, this.camera);
    const hit = this.pickHeightfield(this.pickRaycaster.ray);
    if (hit) return hit;
    // 岛外没有地形网格：退回 y=0 平面，编辑器的浮动地基需要落在岛外。
    const point = this.pickPoint;
    this.pickPlane.constant = 0;
    if (!this.pickRaycaster.ray.intersectPlane(this.pickPlane, point)) return null;
    return [point.x * 10, point.z * 10];
  }

  /** 沿射线在高度场里步进，找到射线第一次穿入地形表面的位置。 */
  private pickHeightfield(ray: THREE.Ray): [number, number] | null {
    const terrain = this.terrain;
    const bounds = terrain.bounds;
    const top = Math.max(terrain.island.topY, 0) + 40;
    const bottom = -Math.max(24, terrain.island.depth + 24);
    const range = this.rayBoxRange(ray, bounds.minX, bounds.maxX, bottom, top, bounds.minZ, bounds.maxZ);
    if (!range) return null;
    let start = Math.max(0, range[0]);
    const end = range[1];
    if (end <= start) return null;

    const point = this.pickPoint;
    const step = 0.4;
    const span = end - start;
    const steps = Math.min(2048, Math.max(1, Math.ceil(span / step)));
    let previous = start;
    ray.at(start, point);
    let gap = point.y - terrain.heightAt(point.x, point.z);
    if (gap <= 0) {
      // 相机已经在地表以下，拾取没有意义。
      return null;
    }
    for (let index = 1; index <= steps; index += 1) {
      const t = Math.min(end, start + (span * index) / steps);
      ray.at(t, point);
      const height = terrain.heightAt(point.x, point.z);
      const nextGap = point.y - height;
      if (nextGap <= 0) {
        // 找到穿面区间后用二分收敛，0.4 米步长不会影响落点精度。
        let low = previous;
        let high = t;
        for (let round = 0; round < 12; round += 1) {
          const middle = (low + high) / 2;
          ray.at(middle, point);
          if (point.y - terrain.heightAt(point.x, point.z) > 0) low = middle;
          else high = middle;
        }
        ray.at(high, point);
        return [point.x * 10, point.z * 10];
      }
      previous = t;
      gap = nextGap;
    }
    return null;
  }

  /** 射线与轴对齐包围盒的相交区间，用于把步进限制在地形范围内。 */
  private rayBoxRange(
    ray: THREE.Ray,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
  ): [number, number] | null {
    let near = 0;
    let far = Number.POSITIVE_INFINITY;
    const origin = ray.origin;
    const direction = ray.direction;
    const axes: ReadonlyArray<readonly [number, number, number, number]> = [
      [origin.x, direction.x, minX, maxX],
      [origin.y, direction.y, minY, maxY],
      [origin.z, direction.z, minZ, maxZ],
    ];
    for (const [value, delta, min, max] of axes) {
      if (Math.abs(delta) < 1e-9) {
        if (value < min || value > max) return null;
        continue;
      }
      const inverse = 1 / delta;
      let t1 = (min - value) * inverse;
      let t2 = (max - value) * inverse;
      if (t1 > t2) {
        const swap = t1;
        t1 = t2;
        t2 = swap;
      }
      if (t1 > near) near = t1;
      if (t2 < far) far = t2;
      if (near > far) return null;
    }
    if (far <= 0) return null;
    return [Math.max(0, near), far];
  }

  /** 离屏幕坐标最近的据点及像素距离，供点击与任务箭头判定优先级。 */
  nearestCity(clientX: number, clientY: number, state: SimState): { id: CityId; distance: number } | null {
    const rect = this.canvasRect();
    let bestId: CityId | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const city of state.cities) {
      const position = this.positions.get(city.id);
      if (!position) continue;
      const projected = this.projectPoint.copy(position).setY(position.y + 1.8).project(this.camera);
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
    this.adaptResolution(deltaMs);
    this.elapsed += deltaMs;
    this.updateIntro(deltaMs);
    this.updateCamera(deltaMs);
    this.camera.updateMatrixWorld();
    this.frustumMatrix.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.frustumMatrix);
    this.updateCities(state);
    this.updateSquads(state);
    this.mageTowerRangeCm = state.rules.mageTower?.rangeCm ?? 700;
    this.projectiles.update(state, deltaMs, (id) => this.squadAnchorPosition(id));
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
    this.squadInstances.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry && mesh.geometry.userData.shared !== true) mesh.geometry.dispose();
      const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach((entry) => disposeMaterial(entry));
      else disposeMaterial(material);
    });
    for (const view of this.cityViews.values()) view.texture.dispose();
    for (const view of this.squadViews.values()) view.texture.dispose();
    this.atmosphere?.dispose();
    this.squadFillMaterial.dispose();
    this.squadFillSelectedMaterial.dispose();
    this.squadEdgeMaterial.dispose();
    this.squadEdgeSelectedMaterial.dispose();
    this.projectiles.dispose();
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

  /** 关卡预览取景：对准地图中心，把整座岛收进画面。 */
  frameWholeMap(pitchDegrees = 34, fill = 0.97): void {
    this.pitch = THREE.MathUtils.degToRad(pitchDegrees);
    this.focus.set(
      (this.bounds.minX + this.bounds.maxX) / 2,
      0,
      (this.bounds.minZ + this.bounds.maxZ) / 2,
    );
    this.yaw = BASE_YAW;
    this.targetYaw = BASE_YAW;
    this.zoom = THREE.MathUtils.clamp(this.fitZoom() * fill, ZOOM_MIN, ZOOM_MAX);
    this.resize();
  }

  /** 开局镜头：从整张地图推近到己方起始据点。 */
  startIntro(x: number, z: number, durationMs = 3600): void {
    const fit = this.fitZoom();
    const center = {
      x: (this.bounds.minX + this.bounds.maxX) / 2,
      z: (this.bounds.minZ + this.bounds.maxZ) / 2,
    };
    this.intro = {
      fromX: center.x,
      fromZ: center.z,
      fromZoom: fit,
      toX: x,
      toZ: z,
      toZoom: Math.max(fit, 1.2),
      elapsed: 0,
      duration: Math.max(1, durationMs),
    };
    this.focus.set(center.x, 0, center.z);
    this.zoom = fit;
    this.updateCamera(0);
  }

  /** 跳过开局镜头，直接落到终点取景。 */
  skipIntro(): void {
    if (!this.intro) return;
    this.applyIntro(1);
    this.intro = null;
    this.updateCamera(0);
    this.camera.updateMatrixWorld();
  }

  private applyIntro(t: number): void {
    if (!this.intro) return;
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    this.focus.x = THREE.MathUtils.lerp(this.intro.fromX, this.intro.toX, eased);
    this.focus.z = THREE.MathUtils.lerp(this.intro.fromZ, this.intro.toZ, eased);
    this.zoom = THREE.MathUtils.lerp(this.intro.fromZoom, this.intro.toZoom, eased);
  }

  private updateIntro(deltaMs: number): void {
    if (!this.intro) return;
    this.intro.elapsed = Math.min(this.intro.duration, this.intro.elapsed + deltaMs);
    this.applyIntro(this.intro.elapsed / this.intro.duration);
    if (this.intro.elapsed >= this.intro.duration) this.intro = null;
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
    const horizontal = Math.cos(this.pitch) * distance;
    this.camera.position.set(
      this.focus.x + Math.sin(this.yaw) * horizontal,
      this.frameY + Math.sin(this.pitch) * distance,
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
    const now = performance.now();
    for (const city of state.cities) {
      seen.add(city.id);
      let view = this.cityViews.get(city.id);
      if (!view) {
        view = this.createCityView(city);
        this.cityViews.set(city.id, view);
      }
      const position = this.positions.get(city.id);
      if (position) view.group.position.set(position.x, position.y, position.z);

      if (!position) continue;
      this.citySphere.center.set(
        position.x,
        position.y + view.labelHeight * 0.5,
        position.z,
      );
      this.citySphere.radius = Math.max(view.baseRadius, view.labelHeight) + 2;
      if (!this.frustum.intersectsSphere(this.citySphere)) {
        // 镜头外的建筑连组一起摘掉；模型和标签都不参与每帧矩阵更新。
        if (view.attached) {
          this.scene.remove(view.group);
          view.attached = false;
        }
        continue;
      }
      const justAttached = !view.attached;
      if (justAttached) {
        this.scene.add(view.group);
        view.attached = true;
        // 首次挂回场景时才需要把这座城补进静态阴影贴图。
        this.markShadowDirty();
      }

      const siteVisual = this.visual?.sites[city.id];
      const visualKey = siteVisual
        ? [
            siteVisual.assetId ?? "",
            siteVisual.rotation ?? 0,
            siteVisual.rotationX ?? 0,
            siteVisual.rotationZ ?? 0,
            siteVisual.scale ?? 1,
          ].join("|")
        : "";
      if (
        view.owner !== city.owner ||
        view.level !== city.level ||
        view.kind !== city.kind ||
        view.visualKey !== visualKey
      ) {
        view.visualKey = visualKey;
        this.rebuildCityModel(view, city);
      }

      // 只有拉远到全图视角才切单网格据点；正常对局视角保留完整建筑。
      const selectedCity = this.selectedIds.includes(city.id);
      const farCity = this.zoom < 0.4;
      if (view.proxy) {
        const proxyVisible = farCity && !selectedCity;
        view.proxy.visible = proxyVisible;
        const detailVisible = !proxyVisible;
        if (view.model.visible !== detailVisible) {
          view.model.visible = detailVisible;
          // 换 LOD 会改变谁参与静态阴影贴图，重画一次。
          this.markShadowDirty();
        }
      } else if (!view.model.visible) {
        view.model.visible = true;
        this.markShadowDirty();
      }

      view.label.position.y = view.labelHeight;
      const label = `${city.id} · L${city.level}\n${city.pop}/${city.maxPop}`;
      // 人口每 tick 都可能变，标签纹理按 4 Hz 限频，避免后期反复上传画布。
      if (label !== view.labelText && (justAttached || now - view.labelPaintedAt >= 250)) {
        view.labelText = label;
        view.labelPaintedAt = now;
        this.paintLabel(view.canvas, view.texture, label.split("\n"), "#f2ead7", [78, 54]);
        view.label.material.map = view.texture;
        view.label.material.needsUpdate = true;
      }
    }
    for (const [id, view] of this.cityViews) {
      if (seen.has(id)) continue;
      this.scene.remove(view.group);
      for (const unit of view.model.children) disposeObject(unit);
      if (view.proxy) disposeObject(view.proxy);
      view.label.material.dispose();
      view.texture.dispose();
      this.cityViews.delete(id);
      this.markShadowDirty();
    }
  }

  private updateSquads(state: SimState): void {
    const now = performance.now();
    const delta = Math.min(50, now - this.lastSquadUpdate || 16);
    this.lastSquadUpdate = now;
    const seen = new Set<string>();
    const instanceEntries = new Map<string, SquadInstanceEntry[]>();
    // 同屏兵团越多，越早切换到静态替身，避免放大看全图时几十支兵团
    // 同时跑骨骼和逐单位绘制。
    const enterFarDistance2 = this.squadLodDistance2();
    const stayFarDistance2 = enterFarDistance2 * 0.81;
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
      this.squadSphere.center.set(point.x, view.group.position.y + 1, point.z);
      this.squadSphere.radius = 4.5;
      const visible = this.frustum.intersectsSphere(this.squadSphere);
      if (!visible) {
        // 镜头外的兵团直接从场景树摘掉：不仅省 draw，
        // 也避免每帧为它的骨骼和子节点更新矩阵、同步模型。
        if (view.attached) {
          this.scene.remove(view.group);
          view.attached = false;
        }
        view.animAccum = 0;
        view.instanced = false;
        continue;
      }
      if (!view.attached) {
        this.scene.add(view.group);
        view.attached = true;
        view.animAccum = 0;
      }
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
      const pathing = squad.gridPath
        ? (squad.gridIndex ?? 0) < squad.gridPath.length
        : squad.pathIndex < squad.path.length - 1;
      const marching = pathing && (!squad.engagedWith || squad.stance === "forced");
      this.syncSquadUnits(view, squad);
      const distance2 = this.camera.position.distanceToSquared(view.group.position);
      const selected = this.selectedSquadId === squad.id;
      const kind = this.squadUnitKind(squad);
      const skin = this.skinFor(kind, squad.owner);
      const enterFar = !view.instanced && distance2 > enterFarDistance2;
      const stayFar = view.instanced && distance2 > stayFarDistance2;
      const far = visible && !selected && (enterFar || stayFar) && !!skin && assetRegistry.has(skin);
      if (far) {
        const bucket = squadInstanceBucket(squad.count);
        if (!this.squadInstances.has(skin as string, squad.owner, bucket)) {
          void this.squadInstances.prepare(skin as string, squad.owner, bucket);
        }
        if (this.squadInstances.has(skin as string, squad.owner, bucket)) {
          view.instanced = true;
          // 整队烘成一张贴图：每个兵团只保留一个实例，不再逐小兵铺 billboard。
          for (const unit of view.units) unit.visible = false;
          const key = `${skin}:${squad.owner}:${bucket}`;
          const list = instanceEntries.get(key) ?? [];
          list.push({
            x: view.group.position.x,
            y: view.group.position.y + 0.06,
            z: view.group.position.z,
            scale: SQUAD_BILLBOARD_SIZE * (0.96 + unitJitter(squad.id, 0, 5) * 0.08),
          });
          instanceEntries.set(key, list);
          view.animAccum = 0;
          continue;
        }
      }
      view.instanced = false;
      for (const unit of view.units) unit.visible = true;
      // 近景兵团全速更新；20 到 100 米的兵团 15 Hz 更新。
      const near = visible && distance2 < 400;
      const interval = near ? 0 : 66;
      view.animAccum += delta;
      if (!visible) {
        view.animAccum = 0;
        continue;
      }
      if (view.animAccum >= interval) {
        const step = Math.min(120, view.animAccum);
        view.animAccum = 0;
        for (const unit of view.units) {
          unit.setMoving(marching);
          unit.update(step);
        }
      }
    }
    this.squadInstances.update(instanceEntries);
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__mlSquadModels = [...this.squadViews.entries()].map(
        ([id, view]) => ({ id, units: view.units.length, loading: view.loading }),
      );
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
      view.shadow.geometry.dispose();
      (view.shadow.material as THREE.Material).dispose();
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

    // 不再铺圆盘地基：建筑直接坐在地形上，随地面起伏。
    const model = new THREE.Group();
    model.position.y = -0.04;
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
      visualKey: "",
      buildToken: 0,
      labelHeight: CITY_LABEL_HEIGHT,
      baseRadius: CITY_BASE_RADIUS,
      shadow,
      proxy: null,
      labelPaintedAt: 0,
      attached: true,
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
    const siteVisual = this.visual?.sites[city.id];
    view.model.rotation.set(
      ((siteVisual?.rotationX ?? 0) * Math.PI) / 180,
      ((siteVisual?.rotation ?? 0) * Math.PI) / 180,
      ((siteVisual?.rotationZ ?? 0) * Math.PI) / 180,
      "YXZ",
    );
    view.model.scale.setScalar(siteVisual?.scale ?? 1);
    const seed = hashId(city.id) + city.level * 17;
    const palette = paletteFor(city.owner);
    const fallback = buildBuilding(siteBuildingKind(city.kind), palette, city.level, seed);
    fallback.scale.multiplyScalar(1.7);
    view.model.add(fallback);
    this.enableShadows(view.model);
    this.fitCityLabel(view);
    this.markShadowDirty();
    view.owner = city.owner;
    view.level = city.level;
    view.kind = city.kind;

    // 远处只画一个低模据点；完整 GLB 留到镜头靠近时再显示。
    if (view.proxy) {
      view.group.remove(view.proxy);
      disposeObject(view.proxy);
    }
    const proxy = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(2.3, 1.7, 2.3),
      new THREE.MeshStandardMaterial({ color: palette.roofEdge, roughness: 0.9, metalness: 0 }),
    );
    body.position.y = 0.85;
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(1.85, 1.25, 4),
      new THREE.MeshStandardMaterial({ color: palette.roof, roughness: 0.86, metalness: 0 }),
    );
    roof.position.y = 2.3;
    roof.rotation.y = Math.PI / 4;
    body.castShadow = false;
    roof.castShadow = false;
    proxy.add(body, roof);
    const proxyScale = 1 + Math.max(0, city.level - 1) * 0.08;
    proxy.scale.setScalar(proxyScale);
    proxy.position.y = Math.max(0, city.level - 1) * 0.12;
    proxy.visible = false;
    view.proxy = proxy;
    view.group.add(proxy);

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
        view.model.add(object);
        this.enableShadows(view.model);
        this.fitCityLabel(view);
        this.markShadowDirty();
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
    view.shadow.scale.set(halfX + 0.08, halfZ + 0.08, 1);
  }

  /** 兵团在场景里的世界坐标，飞行物从这里出发、飞向对方。 */
  private squadAnchorPosition(id: string): THREE.Vector3 | null {
    const view = this.squadViews.get(id);
    if (!view) return null;
    return view.group.position.clone().setY(view.group.position.y + 0.9);
  }

  private createSquadView(squad: SquadState): SquadView {
    const group = new THREE.Group();
    const kind = this.squadUnitKind(squad);
    const spacing = kind === "ranger" ? SQUAD_CAVALRY_SPACING : SQUAD_SPACING_X;
    const unitAssetId = this.skinFor(kind, squad.owner);
    const baseMax = unitAssetId && assetRegistry.has(unitAssetId) ? MAX_GLB_SQUAD_UNITS : MAX_SQUAD_UNITS;
    const start = this.positions.get(squad.from);
    const maxUnits = start ? this.squadLodCap(baseMax, start.x, start.z) : baseMax;
    const renderCount = Math.min(squad.count, maxUnits);
    const offsets = squadFormation(renderCount, spacing, kind === "ranger" ? 0.82 : SQUAD_SPACING_Z);

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

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    shadow.scale.set(1.5, 1.1, 1);
    shadow.renderOrder = 2;
    group.add(shadow);

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
      loading: false,
      shadow,
      strikeUntil: 0,
      animAccum: 0,
      instanced: false,
      attached: true,
    };

    if (unitAssetId && assetRegistry.has(unitAssetId)) {
      void this.populateGlbUnits(view, unitAssetId, squad, offsets, kind);
    } else {
      this.populateProceduralUnits(view, squad, offsets, kind);
    }
    return view;
  }

  /** 兵团外观由皮肤设置全局决定，敌我共用同一套模型，只靠队伍色区分阵营。 */
  private skinFor(kind: UnitKind, _owner: Owner): string | null {
    return this.unitSkins[kind] ?? null;
  }

  /** 兵团自带兵种；没有时退回出发建筑对应的默认兵种。 */
  private squadUnitKind(squad: SquadState): UnitKind {
    return squad.unitKind ?? this.unitKindFor(squad.from);
  }

  /** 兵团外观由出发建筑类型固定决定；弓箭塔与粮仓不产兵。 */
  private unitKindFor(siteId: CityId): UnitKind {
    const site = this.map.cities.find((city) => city.id === siteId);
    if (!site) return "barbarian";
    return producingUnitKind(site.kind) ?? "barbarian";
  }

  private populateProceduralUnits(
    view: SquadView,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kind: UnitKind,
  ): void {
    for (let index = 0; index < offsets.length; index += 1) {
      const unit = new UnitActor({
        kind,
        palette: paletteFor(squad.owner),
        variant: index % 3,
        phase: unitJitter(squad.id, index, 4) * Math.PI * 2,
      });
      this.placeSquadUnit(unit, index, offsets, squad.id, kind);
      this.prepareSquadUnit(unit);
      view.group.add(unit);
      view.units.push(unit);
    }
  }

  /** 站位带一点随机抖动和朝向偏差，避免整队像克隆人。 */
  private placeSquadUnit(
    unit: SquadUnit,
    index: number,
    offsets: ReadonlyArray<readonly [number, number]>,
    squadId: string,
    _kind: UnitKind,
  ): void {
    const [x, z] = offsets[index] ?? [0, 0];
    // 与队形中心的距离也随机，避免所有小兵均匀铺成一个方块。
    const spread = 0.72 + unitJitter(squadId, index, 8) * 0.56;
    unit.position.set(
      x * spread + (unitJitter(squadId, index, 1) - 0.5) * 0.9,
      0,
      z * spread + (unitJitter(squadId, index, 2) - 0.5) * 0.8,
    );
    unit.rotation.y = (unitJitter(squadId, index, 3) - 0.5) * 0.8;
    // GLB 的缩放已经在 populateGlbUnits 里按包围盒算好，这里只归一化程序化小兵。
    // 否则补员、收队形时会把它重新放大回模型原始尺寸。
    if (unit instanceof UnitActor) {
      const height = unit.height > 0.01 ? unit.height : 1.7;
      unit.scale.setScalar((GLB_UNIT_HEIGHT / height) * (0.92 + unitJitter(squadId, index, 5) * 0.16));
    }
  }

  /** 小兵不参与阴影投射，节省阴影贴图开销；整队用一张软圆影。 */
  private prepareSquadUnit(unit: THREE.Object3D): void {
    unit.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
  }

  /** 路径格角高度只采样一次，路线每 200ms 重画时不再重复跑地形噪声。 */
  private pathHeight(x: number, z: number): number {
    const key = Math.round(x * 100) * 100000 + Math.round(z * 100);
    const cached = this.pathHeights.get(key);
    if (cached !== undefined) return cached;
    const height = this.terrain.heightAt(x, z);
    this.pathHeights.set(key, height);
    return height;
  }

  /** 100 米内保留完整真实模型，更远交给静态替身；替身数量不减少。 */
  private squadLodDistance2(): number {
    const load = this.visibleSquadCount();
    return load >= 30 ? 2500 : load >= 15 ? 4900 : 10000;
  }

  private squadLodCap(base: number, x: number, z: number): number {
    const dx = this.camera.position.x - x;
    const dz = this.camera.position.z - z;
    return dx * dx + dz * dz < this.squadLodDistance2() ? base : 2;
  }

  /** 兵团人数减少时同步撤掉模型，编队按当前人数重新收拢。 */
  private syncSquadUnits(view: SquadView, squad: SquadState): void {
    if (view.loading) return;
    const kind = this.squadUnitKind(squad);
    const spacing = kind === "ranger" ? SQUAD_CAVALRY_SPACING : SQUAD_SPACING_X;
    const spacingZ = kind === "ranger" ? 0.82 : SQUAD_SPACING_Z;
    const skin = this.skinFor(kind, squad.owner);
    const baseMax = skin && assetRegistry.has(skin) ? MAX_GLB_SQUAD_UNITS : MAX_SQUAD_UNITS;
    const maxUnits =
      this.selectedSquadId === squad.id ? baseMax : view.instanced ? 2 : baseMax;
    const target = Math.min(squad.count, maxUnits);
    const offsets = squadFormation(target, spacing, spacingZ);
    let changed = false;
    while (view.units.length > target) {
      const unit = view.units.pop();
      if (!unit) break;
      view.group.remove(unit);
      unit.dispose();
      changed = true;
    }
    const growsWithGlb = !!skin && assetRegistry.has(skin);
    if (growsWithGlb && view.units.length < target) {
      // GLB 兵团补员也要补 GLB，否则会和程序化小兵混编。
      void this.populateGlbUnits(view, skin as string, squad, offsets, kind, view.units.length);
      changed = true;
    } else {
      while (view.units.length < target) {
        const index = view.units.length;
        const unit = new UnitActor({
          kind,
          palette: paletteFor(squad.owner),
          variant: index % 3,
          phase: unitJitter(squad.id, index, 4) * Math.PI * 2,
        });
        this.prepareSquadUnit(unit);
        view.group.add(unit);
        view.units.push(unit);
        changed = true;
      }
    }
    if (changed) {
      view.units.forEach((unit, index) => this.placeSquadUnit(unit, index, offsets, squad.id, kind));
    }
    if (view.labelText !== String(squad.count)) {
      view.labelText = String(squad.count);
      this.paintLabel(view.canvas, view.texture, [String(squad.count)], "#f2ead7");
    }
    const radius = Math.min(2.7, 0.9 + target * 0.08);
    view.shadow.scale.set(radius, radius * 0.75, 1);
  }

  private async populateGlbUnits(
    view: SquadView,
    assetId: string,
    squad: SquadState,
    offsets: Array<[number, number]>,
    kind: UnitKind,
    startIndex = 0,
  ): Promise<void> {
    view.loading = true;
    try {
      for (let index = startIndex; index < offsets.length; index += 1) {
        // 每两三个小兵让出一帧，避免一个兵团在同一帧里克隆完造成卡顿。
        if (index > 0 && index % 3 === 0) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        const built = await assetRegistry.buildAnimated(assetId, {
          owner: squad.owner,
          seed: index + 1,
        });
        if (this.disposed || view.disposed) {
          disposeObject(built.object);
          return;
        }
        const unit = new GlbUnitActor(built.object, built.animations);
        this.placeSquadUnit(unit, index, offsets, squad.id, kind);
        // 外部兵团资产尺寸不可控，统一按包围盒缩放到身高 0.95 m
        const box = new THREE.Box3().setFromObject(built.object);
        const height = box.max.y - box.min.y;
        const baseScale = height > 0.01 ? GLB_UNIT_HEIGHT / height : 1;
        unit.scale.setScalar(baseScale * (0.92 + unitJitter(squad.id, index, 5) * 0.16));
        // 每名士兵错开相位与速度：只共用一条时钟，靠相位与时间缩放漂开。
        unit.setMoving(true);
        unit.setVariation(unitJitter(squad.id, index, 6) * 1600, 0.86 + unitJitter(squad.id, index, 7) * 0.28);
        this.prepareSquadUnit(unit);
        view.group.add(unit);
        view.units.push(unit);
      }
    } catch {
      if (this.disposed || view.disposed || view.units.length > 0) return;
      this.populateProceduralUnits(view, squad, offsets, kind);
    } finally {
      view.loading = false;
      // 补员期间体型可能已经变化，收一次队形。
      view.units.forEach((unit, index) => this.placeSquadUnit(unit, index, offsets, squad.id, kind));
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
    sun.shadow.mapSize.set(1024, 1024);
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
    this.markShadowDirty();
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
    this.markShadowDirty();
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
          this.markShadowDirty();
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

  siteModelRotation(cityId: CityId): number {
    return this.cityViews.get(cityId)?.model.rotation.y ?? 0;
  }

  siteModelEuler(cityId: CityId): { x: number; y: number; z: number } {
    const view = this.cityViews.get(cityId);
    if (!view) return { x: 0, y: 0, z: 0 };
    return { x: view.model.rotation.x, y: view.model.rotation.y, z: view.model.rotation.z };
  }

  previewSiteRotation(cityId: CityId, xDegrees: number, yDegrees: number, zDegrees: number): void {
    const view = this.cityViews.get(cityId);
    if (view) {
      view.model.rotation.set(
        (xDegrees * Math.PI) / 180,
        (yDegrees * Math.PI) / 180,
        (zDegrees * Math.PI) / 180,
        "YXZ",
      );
    }
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

  /**
   * 地形笔刷拖动时的快速路径：只刷新网格地形的高度。
   *
   * 不重建烘焙贴图、岛屿、道路和装饰，这些在松开笔刷后由 updateTerrain 一次补齐。
   * 返回 false 时调用方应退回完整重建。
   */
  updateTerrainHeights(
    map: MapDef,
    region?: { x0: number; z0: number; x1: number; z1: number },
  ): boolean {
    this.map = map;
    if (!this.terrain.refreshHeights(map, region)) return false;
    for (const [id, position] of this.positions) {
      position.y = this.terrain.heightAt(position.x, position.z);
      const view = this.cityViews.get(id);
      if (view) view.group.position.set(position.x, position.y, position.z);
    }
    return true;
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
    const cityRadius = () => 1.95;
    const dirt = this.visual?.roads.style === "dirt";
    const roadMaterial = dirt
      ? new THREE.MeshStandardMaterial({ map: dirtTexture(1, 6), roughness: 1 })
      : new THREE.MeshStandardMaterial({ map: cobbleTexture(1, 1), roughness: 1 });

    // 网格地图的路面直接画进地表贴图，不再单独铺网格。
    if (this.roadGrid) return;

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
    this.markShadowDirty();
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
        this.markShadowDirty();
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
    this.markShadowDirty();
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
    this.updateAttackRangeRings();
  }

  /** 法师塔等可攻击建筑的射程圈：沿地形起伏贴在地表。 */
  private updateAttackRangeRings(): void {
    const shown = new Set<CityId>();
    const radius = this.mageTowerRangeCm / 100;
    for (const id of this.selectedIds) {
      const view = this.cityViews.get(id);
      const position = this.positions.get(id);
      if (!view || !position || view.kind !== "mage") continue;
      shown.add(id);
      let ring = this.attackRangeRings.get(id);
      if (ring && (ring.userData.radius !== radius || ring.userData.owner !== view.owner)) {
        this.scene.remove(ring);
        ring.geometry.dispose();
        (ring.material as THREE.Material).dispose();
        this.attackRangeRings.delete(id);
        ring = undefined;
      }
      if (!ring) {
        ring = this.buildAttackRangeRing(position, radius, view.owner);
        ring.userData.radius = radius;
        ring.userData.owner = view.owner;
        this.attackRangeRings.set(id, ring);
        this.scene.add(ring);
      }
      ring.visible = true;
      ring.position.set(position.x, 0, position.z);
    }
    for (const [id, ring] of this.attackRangeRings) {
      if (!shown.has(id)) ring.visible = false;
    }
  }

  private buildAttackRangeRing(position: THREE.Vector3, radius: number, owner: Owner): THREE.Mesh {
    const segments = 96;
    const inner = Math.max(0.2, radius - 0.22);
    const positions: number[] = [];
    const indices: number[] = [];
    for (let index = 0; index <= segments; index += 1) {
      const angle = (index / segments) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dz = Math.sin(angle);
      for (const r of [inner, radius]) {
        const x = dx * r;
        const z = dz * r;
        positions.push(x, this.terrain.heightAt(position.x + x, position.z + z) + 0.06, z);
      }
    }
    for (let index = 0; index < segments; index += 1) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    const color = owner === 1 ? 0xffc83a : owner === 2 ? 0xe06a4a : 0xffd98a;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 4;
    mesh.visible = false;
    return mesh;
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
    const vertical = depth * Math.sin(this.pitch) + island.depth * Math.cos(this.pitch) + 16;
    const horizontal = width + 16;
    const aspect = Math.max(0.6, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const fit = Math.min(VIEW_HEIGHT / vertical, (VIEW_HEIGHT * aspect) / horizontal);
    return THREE.MathUtils.clamp(Math.min(DEFAULT_ZOOM, fit), ZOOM_MIN, ZOOM_MAX);
  }

  private cameraDistance(): number {
    return VIEW_HEIGHT / this.zoom / (2 * Math.tan((FIELD_OF_VIEW * Math.PI) / 360));
  }

  /**
   * 渲染分辨率上限：先按设备像素密度限到 1.25，再按总像素数封顶。
   * 窗口越大、缩放越高，倍率自动往下走，填充成本保持稳定。
   */
  private basePixelRatio(): number {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.25);
    const width = Math.max(1, this.canvas.parentElement?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, this.canvas.parentElement?.clientHeight ?? window.innerHeight);
    const pixels = width * height * dpr * dpr;
    const budget = 2_400_000;
    return pixels > budget ? dpr * Math.sqrt(budget / pixels) : dpr;
  }

  /**
   * 开局采样约 90 帧定基准倍率，之后每 2 秒按中位帧时继续微调。
   * 垂直同步下中位帧时接近刷新间隔，不会误降分辨率。
   */
  private adaptResolution(deltaMs: number): void {
    if (deltaMs <= 0 || deltaMs > 250) return;
    const target = 11.1;

    if (!this.benchDone) {
      this.benchFrames.push(deltaMs);
      if (this.benchFrames.length < 90) return;
      this.benchDone = true;
      const median = medianOf(this.benchFrames);
      if (median > target * 1.05) {
        const scale = Math.min(1, Math.max(0.5, Math.sqrt(target / median)));
        this.applyRenderScale(scale);
      }
      this.settleFrames = [];
      return;
    }

    // 后期兵团和建筑增多时 GPU 负载会继续上升；开局校准之后仍按
    // 2 秒窗口监测，慢了降分辨率，恢复了再慢慢升回来。
    this.settleFrames.push(deltaMs);
    this.settleTimer -= deltaMs;
    if (this.settleTimer > 0) return;

    const median = medianOf(this.settleFrames);
    const fastest = Math.min(...this.settleFrames);
    const atRefresh = median <= fastest * 1.08;
    this.settleFrames = [];
    this.settleTimer = 2000;
    if (!atRefresh && median > target * 1.6 && this.renderScale > 0.6) {
      this.applyRenderScale(this.renderScale - 0.1);
    } else if (median < target * 0.9 && this.renderScale < 1) {
      this.applyRenderScale(this.renderScale + 0.05);
    }
  }

  private applyRenderScale(scale: number): void {
    const next = Math.min(1, Math.max(0.6, scale));
    if (Math.abs(next - this.renderScale) < 0.001) return;
    this.renderScale = next;
    this.renderer.setPixelRatio(this.basePixelRatio() * next);
    this.resize();
  }

  private canvasRect(): { left: number; top: number; width: number; height: number } {
    if (this.viewport.width <= 0) {
      const rect = this.canvas.getBoundingClientRect();
      this.viewport = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return this.viewport;
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    const rect = this.canvas.getBoundingClientRect();
    this.viewport = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = this.editorMode ? 45 : FIELD_OF_VIEW;
    this.camera.updateProjectionMatrix();
  }
}

function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
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


function disposeMaterial(material: THREE.Material | undefined): void {
  if (!material) return;
  // 地表材质每次重建都带一张新的烘焙贴图，贴图跟着材质一起释放。
  const owned = material.userData.ownedTextures as THREE.Texture[] | undefined;
  if (owned) {
    for (const texture of owned) texture.dispose();
    material.userData.ownedTextures = undefined;
  }
  if (material.userData.shared !== true) material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && mesh.geometry.userData.shared !== true) mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) disposeMaterial(material);
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
