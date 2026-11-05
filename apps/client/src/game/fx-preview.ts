import * as THREE from "three";
import type { SimState } from "@marchlands/sim";
import { ProjectileField } from "./projectiles";

const HOST_STYLE = "position:absolute;inset:0;";

/** 开发预览：?scene=fx，两支敌对兵团对射，用来看箭矢和法术的飞行与朝向。 */
export function runFxPreview(host: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = HOST_STYLE;
  host.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b231d);
  scene.add(new THREE.HemisphereLight(0xf5ead4, 0x1b2319, 1.6));
  const sun = new THREE.DirectionalLight(0xffe9c8, 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x3d4a36, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
  camera.position.set(0, 2.8, 6.4);
  camera.lookAt(0, 1.05, 0);

  const marker = (x: number, color: number): THREE.Mesh => {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 1.1, 12),
      new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    mesh.position.set(x, 0.55, 0);
    scene.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.6, 0.72, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, 0);
    scene.add(ring);
    return mesh;
  };
  marker(-2.6, 0x8ed9a0);
  marker(2.6, 0xef9278);

  const field = new ProjectileField();
  field.load();
  scene.add(field.group);

  const fakeState = {
    squads: [
      { id: "a", owner: 1, unitKind: "archer", engagedWith: "b" },
      { id: "b", owner: 2, unitKind: "mage", engagedWith: "a" },
    ],
  } as unknown as SimState;
  const anchors: Record<string, THREE.Vector3> = {
    a: new THREE.Vector3(-2.6, 1.1, 0),
    b: new THREE.Vector3(2.6, 1.1, 0),
  };

  const resize = (): void => {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(host);

  let last = performance.now();
  const tick = (now: number): void => {
    const delta = Math.min(100, now - last);
    last = now;
    field.update(fakeState, delta, (id) => anchors[id]?.clone() ?? null);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
