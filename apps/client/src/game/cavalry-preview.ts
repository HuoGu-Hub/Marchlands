import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const CHARACTER_URLS = import.meta.glob("../assets/characters/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** 开发预览：?scene=cavalry，看骑兵模型的比例、骑姿和跑动。 */
export function runCavalryPreview(host: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;";
  host.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2c3a2c);
  scene.add(new THREE.HemisphereLight(0xf5ead4, 0x1b2319, 1.5));
  const sun = new THREE.DirectionalLight(0xffe9c8, 2.4);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x9fb7d8, 0.9);
  rim.position.set(-4, 3, -5);
  scene.add(rim);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(6, 48),
    new THREE.MeshStandardMaterial({ color: 0x4a5a3f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  const view = new URLSearchParams(window.location.search).get("cam") ?? "side";
  const spots: Record<string, [number, number, number]> = {
    side: [3.4, 1.7, 2.2],
    front: [0.4, 1.6, 4.2],
    back: [0.2, 1.8, -4.2],
    top: [2.6, 3.6, 2.6],
  };
  camera.position.set(...(spots[view] ?? spots.side));
  camera.lookAt(0, 0.95, 0);

  const resize = (): void => {
    const width = host.clientWidth || window.innerWidth;
    const height = host.clientHeight || window.innerHeight;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  };
  resize();
  new ResizeObserver(resize).observe(host);

  const url = Object.entries(CHARACTER_URLS).find(([path]) => path.endsWith("/cavalry.glb"))?.[1];
  let mixer: THREE.AnimationMixer | null = null;
  if (url) {
    void new GLTFLoader().loadAsync(url).then((gltf) => {
      scene.add(gltf.scene);
      mixer = new THREE.AnimationMixer(gltf.scene);
      const gallop = gltf.animations.find((clip) => /horse-Gallop$/i.test(clip.name));
      const ride = gltf.animations.find((clip) => /rider-ride/i.test(clip.name));
      if (gallop) mixer.clipAction(gallop).play();
      if (ride) mixer.clipAction(ride).play();
    });
  }

  let last = performance.now();
  const tick = (now: number): void => {
    const delta = Math.min(100, now - last);
    last = now;
    if (mixer) mixer.update(delta / 1000);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
