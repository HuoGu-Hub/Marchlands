import * as THREE from "three";
import { art } from "./assets";

const PIECES = [
  "wallWood",
  "wallWoodDoor",
  "wallWoodCorner",
  "wallWoodWindowSmall",
  "roofHighGable",
  "roofGableEnd",
  "roofCorner",
  "roofPoint",
  "roofFlat",
  "wall",
  "wallDoor",
  "wallCorner",
  "fence",
  "fenceGate",
  "treeHigh",
  "lantern",
];

export function runPieceViewer(host: HTMLElement): void {
  host.innerHTML = `<canvas id="piece-canvas"></canvas><div class="hud"><div class="hud-left"><div class="chip">Pieces <b id="piece-status">loading</b></div></div></div>`;
  const canvas = host.querySelector<HTMLCanvasElement>("#piece-canvas");
  if (!canvas) throw new Error("missing canvas");
  const status = host.querySelector<HTMLElement>("#piece-status");
  void art.load((done, total) => {
    if (status) status.textContent = `${done}/${total}`;
  }).then(() => {
    if (status) status.textContent = "ready";
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101710);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    scene.add(new THREE.HemisphereLight(0xdce8cb, 0x1b2618, 1.5));
    const sun = new THREE.DirectionalLight(0xffe2b0, 2.4);
    sun.position.set(20, 40, 20);
    scene.add(sun);
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(34, 0.6, 34),
      new THREE.MeshStandardMaterial({ color: 0x3b4d33, roughness: 1 }),
    );
    ground.position.y = -0.3;
    scene.add(ground);

    PIECES.forEach((name, index) => {
      const col = index % 4;
      const row = Math.floor(index / 4);
      const x = (col - 1.5) * 7;
      const z = (row - 1.5) * 7;
      const piece = art.model(name) ?? art.castle(name, 0x5cc07f);
      if (piece) {
        piece.position.set(x, 0, z);
        piece.scale.setScalar(3);
        piece.rotation.y = Math.PI / 4;
        scene.add(piece);
      }
      const label = makeLabel(name);
      label.position.set(x, 6, z);
      scene.add(label);
    });

    const resize = () => {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      renderer.setSize(w, h, false);
      const aspect = w / h;
      const view = 38;
      camera.left = (-view * aspect) / 2;
      camera.right = (view * aspect) / 2;
      camera.top = view / 2;
      camera.bottom = -view / 2;
      camera.updateProjectionMatrix();
    };
    resize();
    new ResizeObserver(resize).observe(canvas);

    const yaw = Math.PI / 4;
    const horizontal = Math.cos((55 * Math.PI) / 180) * 70;
    camera.position.set(Math.sin(yaw) * horizontal, Math.sin((55 * Math.PI) / 180) * 70, Math.cos(yaw) * horizontal);
    camera.lookAt(0, 2, 0);
    renderer.setAnimationLoop(() => renderer.render(scene, camera));
  });
}

function makeLabel(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 38px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.strokeStyle = "rgba(8,11,9,0.85)";
    context.lineWidth = 7;
    context.strokeText(text, 256, 48);
    context.fillStyle = "#f2ead7";
    context.fillText(text, 256, 48);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(6, 1.2, 1);
  return sprite;
}
