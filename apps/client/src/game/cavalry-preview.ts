import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const HORSE_URLS = import.meta.glob("../assets/fx/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const RIDER_URLS = import.meta.glob("../assets/characters/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;

function pick(map: Record<string, string>, name: string): string | null {
  return Object.entries(map).find(([path]) => path.endsWith("/" + name))?.[1] ?? null;
}

/** 开发预览：?scene=cavalry，看马 + 骑手的比例和骑姿能不能用。 */
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
  camera.position.set(3.4, 1.7, 2.2);
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

  const loader = new GLTFLoader();
  const mixers: THREE.AnimationMixer[] = [];
  const poseBones: Array<{ bone: THREE.Object3D; quat: THREE.Quaternion }> = [];

  const horseUrl = pick(HORSE_URLS, "horse.glb");
  if (horseUrl) {
    void loader.loadAsync(horseUrl).then((gltf) => {
      const horse = gltf.scene;
      const box = new THREE.Box3().setFromObject(horse);
      const scale = 1.78 / Math.max(0.001, box.max.y - box.min.y);
      horse.scale.setScalar(scale);
      horse.updateMatrixWorld(true);
      const scaled = new THREE.Box3().setFromObject(horse);
      horse.position.y -= scaled.min.y;
      scene.add(horse);
      const mixer = new THREE.AnimationMixer(horse);
      const gallop = gltf.animations.find((clip) => /gallop/i.test(clip.name)) ?? gltf.animations[0];
      if (gallop) mixer.clipAction(gallop).play();
      mixers.push(mixer);
    });
  }

  const riderUrl = pick(RIDER_URLS, "kaykit-cavalry.glb");
  if (riderUrl) {
    void loader.loadAsync(riderUrl).then((gltf) => {
      const rider = gltf.scene;
      const box = new THREE.Box3().setFromObject(rider);
      rider.scale.setScalar(1.3 / Math.max(0.001, box.max.y - box.min.y));
      rider.updateMatrixWorld(true);
      rider.position.set(0, 1.12, -0.02);
      scene.add(rider);

      const mixer = new THREE.AnimationMixer(rider);
      const ride = gltf.animations.find((clip) => clip.name === "ride") ?? gltf.animations[0];
      if (ride) mixer.clipAction(ride).play();
      mixers.push(mixer);

      // 坐椅子的姿势腿往前伸，混合器之后再补一个外展下垂的骑乘姿态。
      const addOffset = (name: string, x: number, y: number, z: number): void => {
        const bone = rider.getObjectByName(name);
        if (bone) poseBones.push({ bone, quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)) });
      };
      addOffset("upperleg.l", 0.55, 0, -1.05);
      addOffset("upperleg.r", 0.55, 0, 1.05);
      addOffset("lowerleg.l", 1.0, 0, 0);
      addOffset("lowerleg.r", 1.0, 0, 0);
      addOffset("upperarm.l", -0.5, 0, 0.2);
      addOffset("upperarm.r", -0.5, 0, -0.2);
    });
  }

  let last = performance.now();
  const tick = (now: number): void => {
    const delta = Math.min(100, now - last);
    last = now;
    for (const mixer of mixers) mixer.update(delta / 1000);
    // 混合器每帧会重写骨骼，所以偏移要每帧重新叠加，不能只加一次。
    for (const entry of poseBones) entry.bone.quaternion.multiply(entry.quat);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
