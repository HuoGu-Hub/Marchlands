import * as THREE from "three";
import type { Owner } from "@marchlands/sim";
import { assetRegistry } from "./asset-registry";
import { GlbUnitActor } from "./unit-glb";

export interface SquadInstanceEntry {
  x: number;
  y: number;
  z: number;
  scale: number;
}

interface BillboardMesh {
  mesh: THREE.InstancedMesh;
  material: THREE.MeshBasicMaterial;
  geometry: THREE.PlaneGeometry;
  target: THREE.WebGLRenderTarget;
}

const CAPACITY = 4096;
const TARGET_HEIGHT = 0.95;
const VIEW_HEIGHT = 1.05;
const TEXTURE_SIZE = 256;

/**
 * 远处兵团的静态替身。
 * 把 GLB 的行走姿势烘成一张透明贴图，再用 InstancedMesh 画朝向镜头的四边形，
 * 远处人数不减少，但每个兵团不再维护骨骼和逐单位绘制。
 */
export class SquadInstanceField {
  readonly group = new THREE.Group();
  private readonly meshes = new Map<string, BillboardMesh>();
  private readonly pending = new Set<string>();
  private readonly dummy = new THREE.Object3D();
  private renderer: THREE.WebGLRenderer | null = null;
  private camera: THREE.Camera | null = null;
  private disposed = false;

  configure(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    this.renderer = renderer;
    this.camera = camera;
  }

  has(assetId: string, owner: Owner): boolean {
    return this.meshes.has(this.key(assetId, owner));
  }

  async prepare(assetId: string, owner: Owner): Promise<void> {
    const key = this.key(assetId, owner);
    if (this.meshes.has(key) || this.pending.has(key) || this.disposed) return;
    if (!this.renderer || !this.camera) return;
    this.pending.add(key);
    try {
      const built = await assetRegistry.buildAnimated(assetId, { owner, seed: 1 });
      if (this.disposed) return;
      const actor = new GlbUnitActor(built.object, built.animations);
      actor.setMoving(true);
      actor.update(420);
      actor.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(actor);
      const height = box.max.y - box.min.y;
      if (!Number.isFinite(height) || height <= 0.01) {
        actor.dispose();
        return;
      }
      actor.scale.setScalar(TARGET_HEIGHT / height);
      actor.updateMatrixWorld(true);
      const texture = this.renderActor(actor);
      actor.dispose();

      const geometry = new THREE.PlaneGeometry(1, 1);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        // 不透明队列 + alphaTest，避免大量透明替身互相排序造成闪烁。
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
      this.meshes.set(key, { mesh, material, geometry, target: texture.userData.target as THREE.WebGLRenderTarget });
    } catch {
      // 贴图生成失败就继续用真实模型，不能把远景直接抹掉。
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
        const scale = item.scale * VIEW_HEIGHT;
        this.dummy.position.set(item.x, item.y + scale * 0.5, item.z);
        this.dummy.quaternion.copy(this.camera?.quaternion ?? IDENTITY);
        this.dummy.scale.setScalar(scale);
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
  }

  private renderActor(actor: THREE.Object3D): THREE.Texture {
    const renderer = this.renderer as THREE.WebGLRenderer;
    const target = new THREE.WebGLRenderTarget(TEXTURE_SIZE, TEXTURE_SIZE, {
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
    });
    target.texture.colorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.add(actor);
    scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 2.4);
    light.position.set(2, 4, 3);
    scene.add(light);
    const box = new THREE.Box3().setFromObject(actor);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const view = Math.max(size.x, size.y) * 1.12;
    const camera = new THREE.OrthographicCamera(-view / 2, view / 2, view / 2, -view / 2, 0.1, 10);
    camera.position.set(center.x, center.y, 3);
    camera.lookAt(center.x, center.y, 0);

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

  private key(assetId: string, owner: Owner): string {
    return `${assetId}:${owner}`;
  }
}

const IDENTITY = new THREE.Quaternion();
