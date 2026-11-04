import * as THREE from "three";
import { SpriteUnit, SpriteUnitActor, loadSpriteAtlas } from "./sprite-unit";

const PITCH = (28 * Math.PI) / 180;
const DISTANCE = 42;
const VIEW_HEIGHT = 7.2;
const TARGET = new THREE.Vector3(0, 0.7, 0);
const SPACING = 1.7;

export function runSpriteShowcase(host: HTMLElement): void {
  host.innerHTML = [
    '<canvas id="sprite-canvas"></canvas>',
    '<div class="hud">',
    '  <div class="hud-left">',
    '    <div class="chip">八方向图集 <b>512 × 8</b></div>',
    '    <div class="chip">锚点 <b>脚底</b></div>',
    '    <div class="chip">映射 <b id="sprite-flip">逆时针</b></div>',
    '  </div>',
    '  <div class="hint">Q / E 旋转镜头 45° · 空格 翻转映射</div>',
    '</div>',
  ].join("");
  const canvas = host.querySelector<HTMLCanvasElement>("#sprite-canvas");
  if (!canvas) throw new Error("missing sprite canvas");
  void new SpriteShowcase(canvas);
}

function textLabel(text: string, color = "#f2ead7", scale = 0.8): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (context) {
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = '600 76px "Segoe UI", "Microsoft YaHei", sans-serif';
    context.lineJoin = "round";
    context.strokeStyle = "rgba(8, 11, 9, 0.9)";
    context.lineWidth = 10;
    context.strokeText(text, 128, 64);
    context.fillStyle = color;
    context.fillText(text, 128, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(1.1 * scale, 0.55 * scale, 1);
  return sprite;
}

class SpriteShowcase {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly statics: SpriteUnit[] = [];
  private turner: SpriteUnit | null = null;
  private haloed: SpriteUnitActor | null = null;
  private flipLabel: HTMLElement | null = null;
  private cameraYaw = 0;
  private targetYaw = 0;
  private flip = false;
  private raf = 0;
  private last = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.scene.background = new THREE.Color(0x14130f);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 160);
    this.scene.add(new THREE.HemisphereLight(0xf0e4d0, 0x2a211a, 1.6));
    const key = new THREE.DirectionalLight(0xfff1d8, 2.4);
    key.position.set(-8, 16, 12);
    this.scene.add(key);

    this.flipLabel = document.querySelector<HTMLElement>("#sprite-flip");
    this.build();
    void this.load();

    new ResizeObserver(() => this.resize()).observe(canvas.parentElement ?? canvas);
    this.resize();
    window.addEventListener("keydown", this.onKeyDown);
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private build(): void {
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(22, 0.6, 12),
      new THREE.MeshStandardMaterial({ color: 0x2b2721, roughness: 1 }),
    );
    ground.position.set(0, -0.3, 0);
    this.scene.add(ground);

    for (let index = 0; index < 8; index += 1) {
      const marker = textLabel(String(index), "#8ed9a0", 0.72);
      marker.position.set((index - 3.5) * SPACING, 1.35, -2.1);
      this.scene.add(marker);
    }
    const caption = textLabel("图集索引", "#b9c6a6", 0.55);
    caption.position.set(0, 1.9, -2.1);
    this.scene.add(caption);
  }

  private async load(): Promise<void> {
    const [ranger, knight] = await Promise.all([
      loadSpriteAtlas("./sprites/frontier-ranger-boy-atlas"),
      loadSpriteAtlas("./sprites/heavy-shield-knight-atlas"),
    ]);

    for (let index = 0; index < 8; index += 1) {
      const unit = new SpriteUnit(ranger.atlas, ranger.texture, { height: 0.9, flip: this.flip });
      unit.position.set((index - 3.5) * SPACING, 0, -2.1);
      unit.setDirection(index);
      this.scene.add(unit);
      this.statics.push(unit);
    }

    this.turner = new SpriteUnit(knight.atlas, knight.texture, { height: 1.5, flip: this.flip });
    this.turner.position.set(0, 0, 0.9);
    this.scene.add(this.turner);

    // 敌方标识：叠一层浅红光，验证队伍区分方案。
    const haloBody = new SpriteUnit(knight.atlas, knight.texture, { height: 1.5 });
    const haloed = new SpriteUnitActor(haloBody, () => this.cameraYaw, 0xff7a5c);
    haloed.position.set(2.9, 0, 0.9);
    this.scene.add(haloed);
    this.haloed = haloed;
  }

  private readonly frame = (now: number): void => {
    const delta = Math.min(100, now - this.last);
    this.last = now;
    this.cameraYaw += (this.targetYaw - this.cameraYaw) * Math.min(1, delta / 180);

    if (this.turner) {
      const facing = now * 0.0009;
      this.turner.setPose(facing, this.cameraYaw);
    }
    if (this.haloed) {
      this.haloed.rotation.y = now * 0.0009;
      this.haloed.update();
    }
    // 静帧行只固定索引，仅把平面转向镜头，用来检查图集打包与锚点。
    for (const unit of this.statics) unit.mesh.rotation.y = this.cameraYaw;

    const horizontal = DISTANCE * Math.cos(PITCH);
    this.camera.position.set(
      TARGET.x + Math.sin(this.cameraYaw) * horizontal,
      TARGET.y + DISTANCE * Math.sin(PITCH),
      TARGET.z + Math.cos(this.cameraYaw) * horizontal,
    );
    this.camera.lookAt(TARGET);

    this.renderer.render(this.scene, this.camera);
    this.raf = requestAnimationFrame(this.frame);
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "q" || event.key === "Q") this.targetYaw += Math.PI / 4;
    if (event.key === "e" || event.key === "E") this.targetYaw -= Math.PI / 4;
    if (event.code === "Space") {
      event.preventDefault();
      this.flip = !this.flip;
      for (const unit of this.statics) unit.setFlip(this.flip);
      this.turner?.setFlip(this.flip);
      if (this.flipLabel) this.flipLabel.textContent = this.flip ? "顺时针" : "逆时针";
    }
  };

  private resize(): void {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
    const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(VIEW_HEIGHT / 2 / DISTANCE));
    this.camera.updateProjectionMatrix();
  }
}
