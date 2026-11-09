import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Owner } from "@marchlands/sim";
import { assetRegistry } from "./asset-registry";
import { GlbUnitActor } from "./unit-glb";

export interface SquadInstanceEntry {
  x: number;
  y: number;
  z: number;
  scale: number;
  /** 左右镜像，给相同兵种/阵营的兵团制造一点队形差异。 */
  flip?: boolean;
}

interface BillboardMesh {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.PlaneGeometry;
  target: THREE.WebGLRenderTarget;
}

/** 远景只保留这些人数档位，避免为每个具体人数生成一张贴图。 */
export type SquadInstanceBucket = 1 | 4 | 8;

export function squadInstanceBucket(count: number): SquadInstanceBucket {
  if (count <= 2) return 1;
  if (count <= 5) return 4;
  return 8;
}

const CAPACITY = 4096;
const TARGET_HEIGHT = 0.95;
const TEXTURE_SIZE = 256;
/** 一张远景四边形的世界高度，贴图内部仍按真实比例绘制小兵。 */
export const SQUAD_BILLBOARD_SIZE = 4.2;
const ORTHO_SIZE = 3.8;

/**
 * 远处兵团的整队替身。
 * 把 1/4/8 个小兵按队形烘成一张透明贴图，每个兵团只画一个四边形；
 * 不再为每个小兵维护骨骼、动画和单独实例。
 */
export class SquadInstanceField {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, BillboardMesh>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly dummy = new THREE.Object3D();
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private disposed = false;

  configure(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.renderer = renderer;
    this.camera = camera;
  }

  has(assetId: string, owner: Owner, bucket: SquadInstanceBucket): boolean {
    return this.meshes.has(this.key(assetId, owner, bucket));
  }

  async prepare(assetId: string, owner: Owner, bucket: SquadInstanceBucket): Promise<void> {
    const key = this.key(assetId, owner, bucket);
    if (this.meshes.has(key) || this.pending.has(key) || this.failed.has(key) || this.disposed) return;
    if (!this.renderer || !this.camera) return;
    this.pending.add(key);
    try {
      const built = await assetRegistry.buildAnimated(assetId, { owner, seed: 1 });
      if (this.disposed) return;

      // 先由原始对象量一次身高；后面的队形成员都克隆它，避免重复构建 GLB。
      const probe = new GlbUnitActor(built.object, built.animations);
      probe.setMoving(true);
      probe.update(420);
      probe.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(probe);
      const height = box.max.y - box.min.y;
      if (!Number.isFinite(height) || height <= 0.01) {
        probe.dispose();
        return;
      }
      const scale = TARGET_HEIGHT / height;
      const actors: GlbUnitActor[] = [];
      const layout = formationLayout(bucket);
      for (let index = 0; index < layout.length; index += 1) {
        const object = index === 0 ? built.object : cloneSkeleton(built.object);
        const actor = index === 0 ? probe : new GlbUnitActor(object, built.animations);
        actor.setMoving(true);
        actor.update(420 + index * 37);
        const scaleJitter = 0.9 + formationJitter(index, bucket, 1) * 0.18;
        actor.scale.setScalar(scale * scaleJitter);
        actor.position.set(
          layout[index][0] + (formationJitter(index, bucket, 2) - 0.5) * 0.28,
          0,
          layout[index][1] + (formationJitter(index, bucket, 3) - 0.5) * 0.24,
        );
        actor.rotation.y =
          (index * 0.73) % (Math.PI * 2) +
          (formationJitter(index, bucket, 4) - 0.5) * 0.7;
        actor.updateMatrixWorld(true);
        actors.push(actor);
      }

      const texture = this.renderFormation(actors);
      for (const actor of actors) actor.dispose();

      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: false,
        alphaTest: 0.02,
        depthWrite: true,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, CAPACITY);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.count = 0;
      this.group.add(mesh);
      this.meshes.set(key, {
        mesh,
        material,
        geometry,
        target: texture.userData.target as THREE.WebGLRenderTarget,
      });
    } catch {
      // 贴图生成失败就继续用真实模型；记住失败，避免每帧重复烘焙。
      this.failed.add(key);
    } finally {
      this.pending.delete(key);
    }
  }

  update(entries: ReadonlyMap<string, readonly SquadInstanceEntry[]>): void {
    if (this.disposed) return;
    for (const { mesh } of this.meshes.values()) mesh.count = 0;
    for (const [key, list] of entries) {
      const target = this.meshes.get(key);
      if (!target || list.length === 0) continue;
      const count = Math.min(list.length, CAPACITY);
      for (let index = 0; index < count; index += 1) {
        const item = list[index];
        const scale = item.scale;
        this.dummy.position.set(item.x, item.y + scale * 0.5, item.z);
        this.dummy.quaternion.copy(this.camera?.quaternion ?? IDENTITY);
        this.dummy.scale.set(item.flip ? -scale : scale, scale, 1);
        this.dummy.updateMatrix();
        target.mesh.setMatrixAt(index, this.dummy.matrix);
      }
      target.mesh.count = count;
      target.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const { mesh, material, geometry, target } of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.dispose();
      geometry.dispose();
      material.dispose();
      target.dispose();
    }
    this.meshes.clear();
    this.failed.clear();
  }

  private renderFormation(actors: readonly THREE.Object3D[]): THREE.Texture {
    const renderer = this.renderer as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    for (const actor of actors) scene.add(actor);
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(2, 4, 3);
    scene.add(light);
    const camera = new THREE.OrthographicCamera(
      -ORTHO_SIZE / 2,
      ORTHO_SIZE / 2,
      ORTHO_SIZE / 2,
      -ORTHO_SIZE / 2,
      0.1,
      20,
    );
    camera.position.set(0, 1.55, 6);
    camera.lookAt(0, 1.1, 0);

    const previousTarget = renderer.getRenderTarget();
    const previousColor = new THREE.Color();
    renderer.getClearColor(previousColor);
    const previousAlpha = renderer.getClearAlpha();
    const previousAutoClear = renderer.autoClear;
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = true;
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousColor, previousAlpha);
    renderer.autoClear = previousAutoClear;

    target.texture.userData.target = target;
    return target.texture;
  }

  private key(assetId: string, owner: Owner, bucket: SquadInstanceBucket): string {
    return assetId + ":" + owner + ":" + bucket;
  }
}

/** 稳定的伪随机，保证每次重新生成同一档位时队形一致。 */
function formationJitter(index: number, bucket: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + bucket * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

function formationLayout(bucket: SquadInstanceBucket): Array<[number, number]> {
  if (bucket === 1) return [[0, 0]];
  if (bucket === 4) {
    return [
      [-0.34, -0.28],
      [0.34, -0.28],
      [-0.34, 0.28],
      [0.34, 0.28],
    ];
  }
  return [
    [-0.62, -0.4],
    [0, -0.4],
    [0.62, -0.4],
    [-0.62, 0.05],
    [0, 0.05],
    [0.62, 0.05],
    [-0.31, 0.5],
    [0.31, 0.5],
  ];
}

const IDENTITY = new THREE.Quaternion();
