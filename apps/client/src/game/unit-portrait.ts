import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import { GlbUnitActor } from "./unit-glb";
import { paletteFor } from "./buildings";
import { UnitActor } from "./unit-actor";
import type { UnitKind } from "./unit-models";

/**
 * 单个兵团皮肤的正面照。
 * ?scene=unit-portrait&skin=frontier-infantry-A
 * 供 tools/portraits 批量截成卡片图。
 */

const WIDTH = 600;
const HEIGHT = 750;

const UNIT_URLS = import.meta.glob("../assets/characters/*.glb", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

function urlFor(key: string): string | null {
  for (const [path, url] of Object.entries(UNIT_URLS)) {
    if (path.endsWith(`/${key}.glb`)) return url;
  }
  return null;
}

function backdropTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#435346");
    gradient.addColorStop(0.55, "#2b382f");
    gradient.addColorStop(1, "#19221b");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 32, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function shadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createRadialGradient(128, 128, 8, 128, 128, 126);
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.62)");
    gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.32)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 只把 team_ 前缀材质换成阵营色，其余保持手绘固有色。 */
function tintTeam(object: THREE.Object3D, color: number): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = materials.map((material) => {
      if (!material.name.toLowerCase().startsWith("team")) return material;
      const clone = material.clone();
      clone.name = material.name;
      const standard = clone as THREE.MeshStandardMaterial;
      if (standard.color) standard.color.setHex(color);
      clone.userData.shared = false;
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

export function runUnitPortrait(host: HTMLElement, key: string): void {
  host.innerHTML = "";
  const canvas = document.createElement("canvas");
  canvas.id = "portrait-canvas";
  canvas.style.display = "block";
  canvas.style.width = `${WIDTH}px`;
  canvas.style.height = `${HEIGHT}px`;
  host.append(canvas);
  (window as unknown as Record<string, unknown>).__mlPortraitReady = false;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = backdropTexture();
  scene.add(new THREE.HemisphereLight(0xf5ead4, 0x1b2319, 1.55));
  const keyLight = new THREE.DirectionalLight(0xfff2dc, 2.7);
  keyLight.position.set(-2.6, 3.4, 3.8);
  scene.add(keyLight);
  const fill = new THREE.DirectionalLight(0x9fb7d8, 0.85);
  fill.position.set(2.6, 2.2, 2.4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffd3a0, 1.65);
  rim.position.set(0.8, 3.2, -2.8);
  scene.add(rim);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(0.95, 64),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.scale.set(1.15, 0.62, 1);
  floor.position.y = 0.002;
  scene.add(floor);

  const camera = new THREE.PerspectiveCamera(30, WIDTH / HEIGHT, 0.1, 30);
  camera.position.set(0, 1.08, 5);
  camera.lookAt(0, 0.9, 0);

  const finish = (): void => {
    renderer.render(scene, camera);
    requestAnimationFrame(() => {
      renderer.render(scene, camera);
      (window as unknown as Record<string, unknown>).__mlPortraitReady = true;
    });
  };

  const frontier = /^frontier-(infantry|shield|cavalry|archer|elite)-([AB])$/.exec(key);
  if (frontier) {
    // 边军 GLB 的骨骼导出仍有问题，卡片先用同兵种的程序化正面照占位。
    const kind = frontier[1] as UnitKind;
    const actor = new UnitActor({ kind, palette: paletteFor(1), variant: frontier[2] === "B" ? 1 : 0, phase: 0.7 });
    if (kind === "cavalry") actor.rotation.y = -0.55;
    actor.update(900);
    actor.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(actor);
    const size = box.getSize(new THREE.Vector3());
    const targetHeight = kind === "cavalry" ? 2.05 : 1.72;
    actor.scale.setScalar(targetHeight / Math.max(0.001, size.y));
    actor.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(actor);
    actor.position.x -= (scaled.min.x + scaled.max.x) / 2;
    actor.position.z -= (scaled.min.z + scaled.max.z) / 2;
    actor.position.y -= scaled.min.y;
    actor.updateMatrixWorld(true);
    scene.add(actor);
    finish();
    return;
  }

  const url = urlFor(key);
  if (!url) {
    console.error("[unit-portrait] missing model", key);
    finish();
    return;
  }

  new GLTFLoader()
    .loadAsync(url)
    .then((gltf) => {
      const actor = new GlbUnitActor(cloneSkeleton(gltf.scene), gltf.animations);
      tintTeam(actor, paletteFor(1).cloth);
      actor.setMoving(false);
      actor.update(650);
      actor.updateMatrixWorld(true);

      const box = new THREE.Box3().setFromObject(actor);
      const size = box.getSize(new THREE.Vector3());
      const scale = 1.72 / Math.max(0.001, size.y);
      actor.scale.setScalar(scale);
      actor.updateMatrixWorld(true);

      const scaled = new THREE.Box3().setFromObject(actor);
      actor.position.x -= (scaled.min.x + scaled.max.x) / 2;
      actor.position.z -= (scaled.min.z + scaled.max.z) / 2;
      actor.position.y -= scaled.min.y;
      actor.updateMatrixWorld(true);
      scene.add(actor);
      finish();
    })
    .catch((error) => {
      console.error("[unit-portrait] load failed", key, error);
      finish();
    });
}
