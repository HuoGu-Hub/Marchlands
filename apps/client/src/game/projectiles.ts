import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Owner, SimState } from "@marchlands/sim";
import { TEAM_COLORS } from "./asset-registry";

const ARROW_URLS = import.meta.glob("../assets/fx/*.glb", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** 箭矢飞行时间与射程的关系：够远就飞得久一点，但不超过这个值。 */
const ARROW_FLIGHT_MS = 340;
const BOLT_FLIGHT_MS = 420;
/** 每次齐射间隔，避免每帧都刷。 */
const VOLLEY_INTERVAL_MS = 520;
const MAX_LIVE = 96;

interface Laser {
  object: THREE.Object3D;
  parts: Array<{ material: THREE.Material & { opacity: number }; baseOpacity: number }>;
  age: number;
  life: number;
}

interface Shot {
  object: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  delay: number;
  age: number;
  duration: number;
  arc: number;
  kind: "arrow" | "bolt";
  bolt?: THREE.Sprite;
  core?: THREE.Mesh;
}

/**
 * 远程攻击的飞行物表现：箭矢用冒险家包里的模型，法术用粒子贴图。
 * 只负责好看，伤害仍由模拟结算。
 */
export class ProjectileField {
  readonly group = new THREE.Group();
  private arrowTemplate: THREE.Object3D | null = null;
  private fireballTemplate: THREE.Object3D | null = null;
  private glow: THREE.Texture | null = null;
  private readonly live: Shot[] = [];
  private readonly lasers: Laser[] = [];
  private readonly cooldowns = new Map<string, number>();
  private loaded = false;

  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const loader = new GLTFLoader();
    const arrowUrl = Object.entries(ARROW_URLS).find(([path]) => path.endsWith("arrow.glb"))?.[1];
    if (arrowUrl) {
      void loader
        .loadAsync(arrowUrl)
        .then((gltf) => {
          this.arrowTemplate = gltf.scene;
          this.arrowTemplate.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (mesh.isMesh) mesh.frustumCulled = false;
          });
        })
        .catch(() => {
          this.arrowTemplate = null;
        });
    }
    const fireballUrl = Object.entries(ARROW_URLS).find(([path]) => path.endsWith("fireball.glb"))?.[1];
    if (fireballUrl) {
      void loader
        .loadAsync(fireballUrl)
        .then((gltf) => {
          this.fireballTemplate = gltf.scene;
          this.fireballTemplate.traverse((node) => {
            const mesh = node as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.frustumCulled = false;
              mesh.material = (mesh.material as THREE.Material).clone();
              (mesh.material as THREE.MeshStandardMaterial).emissive?.setHex(0xff8a3c);
              (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
            }
          });
        })
        .catch(() => {
          this.fireballTemplate = null;
        });
    }
    this.glow = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}fx/magic_04.png`);
    this.glow.colorSpace = THREE.SRGBColorSpace;
  }

  /** 法师塔开火：一道火红色激光，不再发射飞行火球。 */
  launchTowerLaser(_owner: Owner, from: THREE.Vector3, to: THREE.Vector3): void {
    this.spawnLaser(from, to);
  }

  /** 箭塔开火：复用箭矢模型，略放大后从塔顶射向目标。 */
  launchArrowTowerShot(owner: Owner, from: THREE.Vector3, to: THREE.Vector3): void {
    this.spawn("arrow", owner, from, to, 0, 1.4);
  }

  /** 火红激光：外层红光 + 白热核心，两端各闪一下。 */
  private spawnLaser(from: THREE.Vector3, to: THREE.Vector3): void {
    const direction = to.clone().sub(from);
    const length = direction.length();
    if (length < 0.05) return;

    const group = new THREE.Group();
    const parts: Laser["parts"] = [];
    const axis = new THREE.Vector3(0, 1, 0);
    const quaternion = new THREE.Quaternion().setFromUnitVectors(axis, direction.clone().normalize());

    const addBeam = (radius: number, color: number, baseOpacity: number): void => {
      const geometry = new THREE.CylinderGeometry(radius, radius, length, 10, 1, true);
      geometry.translate(0, length / 2, 0);
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: baseOpacity,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const beam = new THREE.Mesh(geometry, material);
      beam.position.copy(from);
      beam.quaternion.copy(quaternion);
      beam.renderOrder = 30;
      group.add(beam);
      parts.push({ material, baseOpacity });
    };
    addBeam(0.22, 0xff3a12, 0.45);
    addBeam(0.075, 0xfff1d0, 1);

    if (this.glow) {
      const addFlash = (color: number, size: number, point: THREE.Vector3): void => {
        const material = new THREE.SpriteMaterial({
          map: this.glow,
          color,
          transparent: true,
          opacity: 0.95,
          depthTest: false,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
        const flash = new THREE.Sprite(material);
        flash.position.copy(point);
        flash.scale.setScalar(size);
        flash.renderOrder = 31;
        group.add(flash);
        parts.push({ material, baseOpacity: 0.95 });
      };
      addFlash(0xff5a1e, 2.4, from);
      addFlash(0xff8a3a, 3.2, to);
    }

    this.group.add(group);
    this.lasers.push({ object: group, parts, age: 0, life: 360 });
  }

  /** 交战中且是远程兵种的兵团每半秒放一轮；位置由场景解析。 */
  update(state: SimState, deltaMs: number, resolve: (id: string) => THREE.Vector3 | null): void {
    const dt = Math.min(100, Math.max(0, deltaMs));
    for (const squad of state.squads) {
      const target = squad.engagedWith;
      if (!target) continue;
      const kind = squad.unitKind ?? "barbarian";
      const ranged = kind === "archer" || kind === "mage";
      if (!ranged) continue;
      const key = squad.id;
      const next = (this.cooldowns.get(key) ?? 0) - dt;
      if (next > 0) {
        this.cooldowns.set(key, next);
        continue;
      }
      this.cooldowns.set(key, VOLLEY_INTERVAL_MS);
      const from = resolve(squad.id);
      const to = resolve(target);
      if (!from || !to) continue;
      const count = kind === "archer" ? 3 : 2;
      for (let index = 0; index < count; index += 1) {
        this.spawn(kind === "archer" ? "arrow" : "bolt", squad.owner, from, to, index * 70);
      }
    }

    for (let index = this.live.length - 1; index >= 0; index -= 1) {
      const shot = this.live[index];
      shot.age += dt;
      const t = (shot.age - shot.delay) / shot.duration;
      if (t < 0) {
        shot.object.visible = false;
        continue;
      }
      if (t >= 1) {
        this.release(shot);
        this.live.splice(index, 1);
        continue;
      }
      shot.object.visible = true;
      const point = shot.from.clone().lerp(shot.to, t);
      point.y += Math.sin(Math.PI * t) * shot.arc;
      shot.object.position.copy(point);
      const ahead = shot.from.clone().lerp(shot.to, Math.min(1, t + 0.05));
      ahead.y += Math.sin(Math.PI * Math.min(1, t + 0.05)) * shot.arc;
      shot.object.lookAt(ahead);
      if (shot.bolt) {
        const fade = 1 - Math.max(0, t - 0.75) / 0.25;
        shot.bolt.material.opacity = Math.max(0, fade);
        const scale = 0.5 + t * 0.5;
        shot.bolt.scale.setScalar(scale);
      }
    }

    for (let index = this.lasers.length - 1; index >= 0; index -= 1) {
      const laser = this.lasers[index];
      laser.age += dt;
      const fade = 1 - laser.age / laser.life;
      if (fade <= 0) {
        this.releaseLaser(laser);
        this.lasers.splice(index, 1);
        continue;
      }
      for (const part of laser.parts) part.material.opacity = part.baseOpacity * fade;
    }
  }

  private releaseLaser(laser: Laser): void {
    this.group.remove(laser.object);
    for (const part of laser.parts) part.material.dispose();
    laser.object.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
  }

  private spawn(
    kind: "arrow" | "bolt",
    owner: Owner,
    from: THREE.Vector3,
    to: THREE.Vector3,
    delay: number,
    scale = 1,
    durationMs?: number,
  ): void {
    if (this.live.length >= MAX_LIVE) return;
    const start = from.clone();
    const end = to.clone();
    // 每次落点散开一点，避免所有飞行物叠在一条线上。
    end.x += (Math.random() - 0.5) * 0.6;
    end.z += (Math.random() - 0.5) * 0.6;
    end.y += (Math.random() - 0.5) * 0.25;
    const distance = start.distanceTo(end);
    const duration = kind === "arrow" ? ARROW_FLIGHT_MS : BOLT_FLIGHT_MS;

    let object: THREE.Object3D;
    if (kind === "arrow") {
      // 模型本身沿 Y 轴，装进容器后统一转成 +Z，再由 lookAt 指向飞行方向。
      const holder = new THREE.Group();
      const model = this.arrowTemplate ? this.arrowTemplate.clone(true) : makeFallbackArrow();
      model.rotation.x = Math.PI / 2;
      model.scale.setScalar(1.15 * scale);
      holder.add(model);
      object = holder;
    } else if (this.fireballTemplate) {
      // 火球模型长轴朝 -Z，转半圈让它对着飞行方向。
      const holder = new THREE.Group();
      const model = this.fireballTemplate.clone(true);
      model.rotation.y = Math.PI;
      model.scale.setScalar(0.55 * scale);
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glow,
          color: 0xffa04a,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      halo.scale.setScalar(1.1 * scale);
      holder.add(model, halo);
      object = holder;
      (object as THREE.Group).userData.glow = halo;
    } else {
      // 没有模型时退回实体核心 + 加色光晕。
      const holder = new THREE.Group();
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.13 * scale, 16, 12),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(TEAM_COLORS[owner] ?? 0x9fd4ff).lerp(new THREE.Color(0xffffff), 0.55),
          toneMapped: false,
        }),
      );
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glow,
          color: TEAM_COLORS[owner] ?? 0x9fd4ff,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      sprite.scale.setScalar(0.95 * scale);
      holder.add(core, sprite);
      object = holder;
      (object as THREE.Group).userData.glow = sprite;
      (object as THREE.Group).userData.core = core;
    }
    object.visible = false;
    this.group.add(object);
    this.live.push({
      object,
      from: start,
      to: end,
      delay,
      age: 0,
      duration: durationMs ?? Math.min(duration + distance * 40, 900),
      arc: kind === "arrow" ? Math.min(1.4, distance * 0.12) : 0.1,
      kind,
      ...(kind === "bolt"
        ? {
            bolt: (object as THREE.Group).userData.glow as THREE.Sprite,
            core: (object as THREE.Group).userData.core as THREE.Mesh,
          }
        : {}),
    });
  }

  private release(shot: Shot): void {
    this.group.remove(shot.object);
    if (shot.bolt) shot.bolt.material.dispose();
    if (shot.core) {
      shot.core.geometry.dispose();
      (shot.core.material as THREE.Material).dispose();
    }
  }

  dispose(): void {
    for (const shot of this.live) this.release(shot);
    this.live.length = 0;
    for (const laser of this.lasers) this.releaseLaser(laser);
    this.lasers.length = 0;
    this.cooldowns.clear();
    this.glow?.dispose();
    this.glow = null;
  }
}

function makeFallbackArrow(): THREE.Object3D {
  const geometry = new THREE.CylinderGeometry(0.012, 0.012, 0.62, 4);
  const material = new THREE.MeshBasicMaterial({ color: 0xd8c9a6 });
  return new THREE.Mesh(geometry, material);
}
