import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const URLS = import.meta.glob("../assets/*.glb", { query: "?url", import: "default", eager: true }) as Record<string, string>;

/** 开发预览：?scene=glb&file=_inspect.glb，看一眼单个 GLB 长什么样。 */
export function runGlbViewer(host: HTMLElement): void {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;";
  host.append(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a323a);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  // 金属度高但没有环境贴图时 PBR 会发黑，这里补一个室内环境。
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 500);
  const size = (): void => {
    const w = host.clientWidth || window.innerWidth;
    const h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  size();
  new ResizeObserver(size).observe(host);

  const file = new URLSearchParams(window.location.search).get("file") ?? "";
  const url = Object.entries(URLS).find(([p]) => p.endsWith("/" + file))?.[1];
  if (url) {
    void new GLTFLoader().loadAsync(url).then((gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
      model.position.sub(center);
      scene.add(model);
      camera.position.set(radius * 1.1, radius * 0.55, radius * 1.4);
      camera.lookAt(0, 0, 0);
      camera.near = radius / 100;
      camera.far = radius * 20;
      camera.updateProjectionMatrix();
      let angle = 0;
      const spin = (): void => {
        angle += 0.004;
        camera.position.set(Math.cos(angle) * radius * 1.7, radius * 0.55, Math.sin(angle) * radius * 1.7);
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        requestAnimationFrame(spin);
      };
      requestAnimationFrame(spin);
    });
  }
}
