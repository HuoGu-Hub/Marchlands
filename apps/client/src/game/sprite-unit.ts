import * as THREE from "three";
import type { UnitActorView } from "./unit-glb";

/** 图集里单个方向格子的描述，来自 sprite-atlas 工具导出的 JSON。 */
export interface SpriteCell {
  index: number;
  label: string;
  column: number;
  row: number;
  rect: [number, number, number, number];
  pivot: [number, number];
  pivot_in_tile: [number, number];
}

export interface SpriteAtlasData {
  name: string;
  image: string;
  tile: number;
  columns: number;
  rows: number;
  directions: number;
  /** 每个方向列出的帧数；1 表示只有静帧。 */
  frames?: number;
  cells: SpriteCell[];
}

export interface SpriteUnitOptions {
  /** 世界里的体高，米。素材按画布高度的 88% 绘制。 */
  height?: number;
  /** 素材按画布高度的比例，用于把包围盒换算成真实体高。 */
  coverage?: number;
  /** 反向映射方向索引，素材转向与镜头约定相反时打开。 */
  flip?: boolean;
}

const QUARTER = Math.PI / 4;

/**
 * 八方向序列帧单位。只跟偏航，不跟俯仰；索引用相对镜头方位量化到 45 度一档。
 */
export class SpriteUnit extends THREE.Object3D {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly atlas: SpriteAtlasData;
  private readonly planeWidth: number;
  private readonly planeHeight: number;
  private index = -1;
  private frame = 0;
  private moving = false;
  private clock = 0;
  private flip: boolean;
  private readonly frameCount: number;

  constructor(atlas: SpriteAtlasData, texture: THREE.Texture, options: SpriteUnitOptions = {}) {
    super();
    this.atlas = atlas;
    this.flip = options.flip ?? false;
    this.frameCount = Math.max(1, atlas.frames ?? 1);

    const coverage = options.coverage ?? 0.88;
    const height = options.height ?? 0.9;
    this.planeHeight = height / coverage;
    this.planeWidth = this.planeHeight;

    const map = texture.clone();
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.wrapT = THREE.ClampToEdgeWrapping;
    map.repeat.set(1 / atlas.columns, 1 / atlas.rows);
    map.anisotropy = 4;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.planeWidth, this.planeHeight),
      new THREE.MeshBasicMaterial({
        map,
        alphaTest: 0.5,
        transparent: false,
        side: THREE.FrontSide,
        toneMapped: false,
      }),
    );
    this.mesh.frustumCulled = false;
    this.add(this.mesh);

    this.setDirection(0);
  }

  /** 素材方向与镜头约定相反时翻转。 */
  setFlip(flip: boolean): void {
    this.flip = flip;
    this.index = -1;
  }

  get direction(): number {
    return Math.max(0, this.index);
  }

  /** 行走时推进帧；停下时回到第一帧。 */
  setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    this.clock = 0;
    this.frame = moving && this.frameCount > 1 ? 1 : 0;
    this.applyCell();
  }

  /** 按毫秒推进动画，静帧时无动作。 */
  advance(deltaMs: number): void {
    if (!this.moving || this.frameCount <= 1) return;
    this.clock += Math.min(100, Math.max(0, deltaMs));
    const steps = Math.floor(this.clock / 110);
    const next = 1 + (steps % (this.frameCount - 1));
    if (next === this.frame) return;
    this.frame = next;
    this.applyCell();
  }

  private applyCell(): void {
    const idx = this.index * this.frameCount + this.frame;
    const cell = this.atlas.cells[idx] ?? this.atlas.cells[0];
    if (!cell) return;
    const tile = this.atlas.tile;
    const [px, py] = cell.pivot_in_tile;
    this.mesh.position.set((0.5 - px / tile) * this.planeWidth, (py / tile - 0.5) * this.planeHeight, 0);
    this.mesh.material.map?.offset.set(
      cell.rect[0] / (this.atlas.columns * tile),
      1 - (cell.rect[1] + tile) / (this.atlas.rows * tile),
    );
  }

  /** 直接指定图集索引，用于静态陈列。 */
  setDirection(index: number): void {
    const count = this.atlas.directions;
    const next = ((index % count) + count) % count;
    if (next === this.index) return;
    this.index = next;
    this.applyCell();
  }

  /**
   * 按单位朝向与镜头方位选择方向，并让平面正对镜头。
   * parentYaw 是自身之上所有父级累计的偏航，用于把世界朝向换算成局部旋转。
   */
  setPose(facing: number, cameraYaw: number, parentYaw = 0): void {
    const steps = Math.round((facing - cameraYaw) / QUARTER);
    const raw = ((-steps % 8) + 8) % 8;
    this.setDirection(this.flip ? (8 - raw) % 8 : raw);
    this.mesh.rotation.y = cameraYaw - parentYaw;
  }
}

/** 队伍标识用的柔光贴片，中心亮、边缘全透明。 */
let haloTexture: THREE.Texture | null = null;

function sharedHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    // 中心几乎透明、靠近边缘才亮，形成一圈轮廓光而不是整体染色。
    const gradient = context.createRadialGradient(64, 64, 4, 64, 64, 62);
    gradient.addColorStop(0, "rgba(255,255,255,0.06)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
    gradient.addColorStop(0.68, "rgba(255,255,255,0.7)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);
  }
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

/** 把 SpriteUnit 包成兵团小兵，接口与 UnitActor / GlbUnitActor 一致。 */
export class SpriteUnitActor extends THREE.Group implements UnitActorView {
  private readonly sprite: SpriteUnit;
  private readonly yawOfCamera: () => number;
  private readonly halo: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;

  constructor(sprite: SpriteUnit, cameraYaw: () => number, haloColor: number | null = null) {
    super();
    this.sprite = sprite;
    this.yawOfCamera = cameraYaw;
    this.add(sprite);

    this.halo = haloColor === null ? null : makeHalo(sprite, haloColor);
    if (this.halo) this.add(this.halo);
  }

  setMoving(moving: boolean): void {
    this.sprite.setMoving(moving);
  }

  playAttack(): void {
    // 同上。
  }

  update(deltaMs = 0): void {
    this.sprite.advance(deltaMs);
    const parentYaw = this.parent ? parentYawOf(this.parent) : 0;
    const accumulated = parentYaw + this.rotation.y;
    this.sprite.setPose(accumulated, this.yawOfCamera(), accumulated);
    if (this.halo) {
      this.halo.position.copy(this.sprite.mesh.position);
      this.halo.position.z -= 0.02;
      this.halo.rotation.y = this.sprite.mesh.rotation.y;
    }
  }

  dispose(): void {
    this.remove(this.sprite);
    this.sprite.mesh.geometry.dispose();
    if (this.halo) {
      this.remove(this.halo);
      this.halo.geometry.dispose();
      this.halo.material.dispose();
    }
  }
}

function makeHalo(
  sprite: SpriteUnit,
  color: number,
): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const mesh = sprite.mesh;
  const width = mesh.geometry.parameters.width * 1.02;
  const height = mesh.geometry.parameters.height * 1.0;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({
      map: sharedHaloTexture(),
      color,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }),
  );
  halo.frustumCulled = false;
  halo.renderOrder = -1;
  return halo;
}

const yawEuler = new THREE.Euler();
const yawMatrix = new THREE.Matrix4();

function parentYawOf(object: THREE.Object3D): number {
  object.updateWorldMatrix(true, false);
  yawMatrix.extractRotation(object.matrixWorld);
  yawEuler.setFromRotationMatrix(yawMatrix, "YXZ");
  return yawEuler.y;
}

/** 读取一组图集描述与贴图，返回可直接构造 SpriteUnit 的原料。 */
export async function loadSpriteAtlas(
  base: string,
): Promise<{ atlas: SpriteAtlasData; texture: THREE.Texture }> {
  const response = await fetch(base + ".json");
  if (!response.ok) throw new Error("图集描述缺失：" + base);
  const atlas = (await response.json()) as SpriteAtlasData;
  const texture = await new THREE.TextureLoader().loadAsync(base + ".png");
  return { atlas, texture };
}
