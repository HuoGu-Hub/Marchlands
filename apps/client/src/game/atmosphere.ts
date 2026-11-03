import * as THREE from "three";

export interface AtmosphereProfile {
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  haze: number;
  cloud: number;
}

const PROFILES: Record<string, AtmosphereProfile> = {
  frontier: {
    skyTop: 0x2f6f9e,
    skyMid: 0x79aecd,
    skyHorizon: 0xc3d7df,
    haze: 0xb9ced8,
    cloud: 0xf4f7f2,
  },
  meadow: {
    skyTop: 0x5aa0cb,
    skyMid: 0xa4c9dc,
    skyHorizon: 0xdfe9e4,
    haze: 0xd2e1dd,
    cloud: 0xf7faf4,
  },
  autumn: {
    skyTop: 0x6f8fb4,
    skyMid: 0xc2b7a8,
    skyHorizon: 0xe8dcc8,
    haze: 0xdccdba,
    cloud: 0xf6efe4,
  },
  ash: {
    skyTop: 0x55616c,
    skyMid: 0x8d9195,
    skyHorizon: 0xc2c3bf,
    haze: 0xb6b8b4,
    cloud: 0xdededb,
  },
  coast: {
    skyTop: 0x4990bb,
    skyMid: 0x9dc6d8,
    skyHorizon: 0xdfe8e4,
    haze: 0xcfe0de,
    cloud: 0xf5f8f4,
  },
  snow: {
    skyTop: 0x6094bd,
    skyMid: 0xb3cadb,
    skyHorizon: 0xe6ecef,
    haze: 0xd6e0e5,
    cloud: 0xf9fbfd,
  },
};

export function atmosphereProfile(style: string | undefined): AtmosphereProfile {
  return PROFILES[style ?? "frontier"] ?? PROFILES.frontier;
}

export interface AtmosphereOptions {
  centerX: number;
  centerZ: number;
  radius: number;
  topY: number;
  depth: number;
  style?: string;
  seed?: number;
}

export interface Atmosphere {
  group: THREE.Group;
  background: THREE.Texture;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  update(elapsedMs: number): void;
  dispose(): void;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function skyTexture(profile: AtmosphereProfile): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, hex(profile.skyTop));
    gradient.addColorStop(0.42, hex(profile.skyMid));
    gradient.addColorStop(0.74, hex(profile.skyHorizon));
    gradient.addColorStop(1, hex(profile.haze));
    context.fillStyle = gradient;
    context.fillRect(0, 0, 4, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

function cloudTexture(seed: number): THREE.CanvasTexture {
  const size = 768;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const random = seeded(seed);
  if (context) {
    context.clearRect(0, 0, size, size);
    for (let index = 0; index < 120; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.65) * size * 0.46;
      const x = size / 2 + Math.cos(angle) * distance;
      const y = size / 2 + Math.sin(angle) * distance;
      const radius = 20 + random() * 86;
      const alpha = 0.14 + random() * 0.34;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "destination-in";
    const mask = context.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.5);
    mask.addColorStop(0, "rgba(255,255,255,0.9)");
    mask.addColorStop(0.6, "rgba(255,255,255,0.62)");
    mask.addColorStop(0.9, "rgba(255,255,255,0.22)");
    mask.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = mask;
    context.fillRect(0, 0, size, size);
    context.globalCompositeOperation = "source-over";
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hex(color: number): string {
  return "#" + color.toString(16).padStart(6, "0");
}

function cloudSpriteTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context) {
    const random = seeded(90210);
    for (let index = 0; index < 26; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.pow(random(), 0.8) * size * 0.24;
      const x = size / 2 + Math.cos(angle) * distance;
      const y = size / 2 + Math.sin(angle) * distance * 0.55;
      const radius = 24 + random() * 54;
      const gradient = context.createRadialGradient(x, y - radius * 0.18, radius * 0.1, x, y, radius);
      gradient.addColorStop(0, "rgba(255,255,255,0.95)");
      gradient.addColorStop(0.55, "rgba(252,253,255,0.6)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.beginPath();
      context.ellipse(x, y, radius, radius * 0.72, 0, 0, Math.PI * 2);
      context.fill();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function buildCloudBank(
  profile: AtmosphereProfile,
  centerX: number,
  centerZ: number,
  radius: number,
  cloudSeaY: number,
  depth: number,
  seed: number,
): THREE.Group {
  const group = new THREE.Group();
  const texture = cloudSpriteTexture();
  const random = seeded(seed + 977);
  const materials = [0.5, 0.34, 0.22].map(
    (opacity) =>
      new THREE.SpriteMaterial({
        map: texture,
        color: new THREE.Color(profile.cloud),
        transparent: true,
        opacity,
        depthWrite: false,
        fog: true,
      }),
  );
  for (let index = 0; index < 64; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = radius * (1.12 + random() * 1.5);
    const sprite = new THREE.Sprite(materials[index % materials.length]);
    const size = 16 + random() * 42;
    sprite.position.set(
      centerX + Math.cos(angle) * distance,
      cloudSeaY + (random() - 0.9) * depth * 0.35,
      centerZ + Math.sin(angle) * distance,
    );
    sprite.scale.set(size, size * 0.55, 1);
    sprite.renderOrder = 1;
    group.add(sprite);
  }
  return group;
}

export function buildAtmosphere(options: AtmosphereOptions): Atmosphere {
  const profile = atmosphereProfile(options.style);
  const cloudRandom = seeded(options.seed ?? 77);
  const group = new THREE.Group();
  group.name = "atmosphere";

  const sky = skyTexture(profile);
  const cloudSeaY = options.topY - options.depth * 1.02;
  const layers: THREE.Mesh[] = [];
  const layerSpeeds: number[] = [];
  const layerConfigs: Array<{ size: number; opacity: number; y: number; rotate: number }> = [
    { size: options.radius * 6.2, opacity: 0.58, y: cloudSeaY, rotate: 0 },
    { size: options.radius * 4.4, opacity: 0.4, y: cloudSeaY - options.depth * 0.26, rotate: 0.7 },
  ];
  for (const config of layerConfigs) {
    const texture = cloudTexture(Math.floor(cloudRandom() * 100000) + 13);
    texture.center.set(0.5, 0.5);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(config.size, config.size),
      new THREE.MeshBasicMaterial({
        map: texture,
        color: new THREE.Color(profile.cloud),
        transparent: true,
        opacity: config.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = config.rotate;
    mesh.position.set(options.centerX, config.y, options.centerZ);
    mesh.renderOrder = -1;
    group.add(mesh);
    layers.push(mesh);
    layerSpeeds.push(0.000021 + cloudRandom() * 0.00003);
  }

  group.add(
    buildCloudBank(
      profile,
      options.centerX,
      options.centerZ,
      options.radius,
      cloudSeaY,
      options.depth,
      options.seed ?? 77,
    ),
  );

  const fogNear = options.radius * 2.15;
  const fogFar = options.radius * 5.2;

  return {
    group,
    background: sky,
    fogColor: profile.haze,
    fogNear,
    fogFar,
    update(elapsedMs: number): void {
      layers.forEach((layer, index) => {
        const spin = elapsedMs * layerSpeeds[index];
        layer.rotation.z = layerConfigs[index].rotate + spin;
      });
    },
    dispose(): void {
      group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material?.dispose();
      });
      sky.dispose();
    },
  };
}