import * as THREE from "three";

/**
 * 地表细节材质：宏观烘焙贴图负责颜色分区，细节贴图按世界坐标三平面投影叠加。
 *
 * 整张地图的烘焙贴图只有两三十像素一米，近景全靠细节层：
 * 法线给出草皮、砾石和岩面的起伏，亮度给出比烘焙图细四倍的颗粒，
 * 三平面投影让陡壁和岛体侧面也能拿到不拉伸的贴图。
 */

const URLS = import.meta.glob("../assets/materials/*/*.jpg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const loader = new THREE.TextureLoader();

interface DetailLayer {
  readonly color: THREE.Texture;
  readonly normal: THREE.Texture;
  /** 贴图在线性空间的平均亮度，用来把细节层的明暗拉回原亮度。 */
  readonly meanLuma: number;
}

/** 各贴图在线性空间的平均亮度，由 assets 里的成品图量出来。 */
const MEAN_LUMA: Record<string, number> = {
  ground068: 0.112,
  rocks007: 0.1266,
  snow014: 0.462,
};

const layers = new Map<string, DetailLayer | null>();

function loadTexture(file: string, srgb: boolean): THREE.Texture {
  const texture = loader.load(file);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return texture;
}

function detailLayer(name: string): DetailLayer | null {
  const cached = layers.get(name);
  if (cached !== undefined) return cached;
  const base = `../assets/materials/${name}`;
  const color = URLS[`${base}/color.jpg`];
  const normal = URLS[`${base}/normal.jpg`];
  if (!color || !normal) {
    layers.set(name, null);
    return null;
  }
  const layer: DetailLayer = {
    color: loadTexture(color, true),
    normal: loadTexture(normal, false),
    meanLuma: MEAN_LUMA[name] ?? 0.2,
  };
  layers.set(name, layer);
  return layer;
}

interface StyleDetail {
  readonly ground: string;
  readonly rock: string;
}

/** 每种地貌风格用哪套细节贴图；岩石统一用 rocks007。 */
const STYLE_DETAIL: Record<string, StyleDetail> = {
  frontier: { ground: "ground068", rock: "rocks007" },
  meadow: { ground: "ground068", rock: "rocks007" },
  autumn: { ground: "ground068", rock: "rocks007" },
  ash: { ground: "ground068", rock: "rocks007" },
  coast: { ground: "ground068", rock: "rocks007" },
  snow: { ground: "snow014", rock: "rocks007" },
};

const FRAGMENT_UNIFORMS = `
uniform sampler2D uTerrainGroundColor;
uniform sampler2D uTerrainGroundNormal;
uniform sampler2D uTerrainRockColor;
uniform sampler2D uTerrainRockNormal;
uniform float uTerrainGroundScale;
uniform float uTerrainRockScale;
uniform float uTerrainGroundLuma;
uniform float uTerrainRockLuma;
uniform float uTerrainNormalStrength;
uniform float uTerrainAlbedoStrength;
uniform float uTerrainRockLow;
uniform float uTerrainRockHigh;

varying vec3 vTerrainWorld;
varying vec3 vTerrainNormalW;

vec3 terrainTriplanar( sampler2D map, vec3 p, vec3 n, float scale ) {
  vec3 weights = pow( abs( n ), vec3( 4.0 ) );
  weights /= max( weights.x + weights.y + weights.z, 1e-4 );
  vec3 px = texture2D( map, p.zy * scale ).rgb;
  vec3 py = texture2D( map, p.xz * scale ).rgb;
  vec3 pz = texture2D( map, p.xy * scale ).rgb;
  return px * weights.x + py * weights.y + pz * weights.z;
}

vec3 terrainTriplanarNormal( sampler2D map, vec3 p, vec3 n, float scale ) {
  vec3 weights = pow( abs( n ), vec3( 4.0 ) );
  weights /= max( weights.x + weights.y + weights.z, 1e-4 );
  vec3 nx = texture2D( map, p.zy * scale ).xyz * 2.0 - 1.0;
  vec3 ny = texture2D( map, p.xz * scale ).xyz * 2.0 - 1.0;
  vec3 nz = texture2D( map, p.xy * scale ).xyz * 2.0 - 1.0;
  vec3 px = nx.x * vec3( 0.0, 0.0, 1.0 ) + nx.y * vec3( 0.0, 1.0, 0.0 );
  vec3 py = ny.x * vec3( 1.0, 0.0, 0.0 ) + ny.y * vec3( 0.0, 0.0, 1.0 );
  vec3 pz = nz.x * vec3( 1.0, 0.0, 0.0 ) + nz.y * vec3( 0.0, 1.0, 0.0 );
  return px * weights.x + py * weights.y + pz * weights.z;
}

float terrainRockMix( vec3 n ) {
  return 1.0 - smoothstep( uTerrainRockLow, uTerrainRockHigh, n.y );
}
`;

const FRAGMENT_ALBEDO = `
vec3 terrainBaseNormal = normalize( vTerrainNormalW );
float terrainRock = terrainRockMix( terrainBaseNormal );
vec3 terrainDetailColor = mix(
  terrainTriplanar( uTerrainGroundColor, vTerrainWorld, terrainBaseNormal, uTerrainGroundScale ),
  terrainTriplanar( uTerrainRockColor, vTerrainWorld, terrainBaseNormal, uTerrainRockScale ),
  terrainRock
);
float terrainDetailLuma = dot( terrainDetailColor, vec3( 0.2126, 0.7152, 0.0722 ) );
float terrainMeanLuma = mix( uTerrainGroundLuma, uTerrainRockLuma, terrainRock );
float terrainGain = clamp( terrainDetailLuma / max( terrainMeanLuma, 0.01 ), 0.45, 1.7 );
diffuseColor.rgb *= mix( 1.0, terrainGain, uTerrainAlbedoStrength );
`;

const FRAGMENT_NORMAL = `
vec3 terrainBaseNormal2 = normalize( vTerrainNormalW );
float terrainRock2 = terrainRockMix( terrainBaseNormal2 );
vec3 terrainBump = mix(
  terrainTriplanarNormal( uTerrainGroundNormal, vTerrainWorld, terrainBaseNormal2, uTerrainGroundScale ),
  terrainTriplanarNormal( uTerrainRockNormal, vTerrainWorld, terrainBaseNormal2, uTerrainRockScale ),
  terrainRock2
);
vec3 terrainBent = normalize( terrainBaseNormal2 + terrainBump * uTerrainNormalStrength );
normal = normalize( ( viewMatrix * vec4( terrainBent, 0.0 ) ).xyz );
`;

const VERTEX_PARS = `
varying vec3 vTerrainWorld;
varying vec3 vTerrainNormalW;
`;

export interface TerrainStyleMaterials {
  readonly ground: THREE.MeshStandardMaterial;
  readonly cliff: THREE.MeshStandardMaterial;
}

interface DetailMaterialOptions {
  readonly macro: THREE.Texture | null;
  readonly color: THREE.ColorRepresentation;
  readonly groundLayer: string;
  readonly rockLayer: string;
  readonly vertexColors: boolean;
  readonly side: THREE.Side;
  readonly groundScale: number;
  readonly rockScale: number;
  readonly normalStrength: number;
  readonly albedoStrength: number;
}

function createDetailMaterial(options: DetailMaterialOptions): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: options.color,
    ...(options.macro ? { map: options.macro } : {}),
    roughness: 0.97,
    metalness: 0,
    vertexColors: options.vertexColors,
    side: options.side,
  });
  const ground = detailLayer(options.groundLayer);
  const rock = detailLayer(options.rockLayer);
  if (!ground || !rock) {
    // 细节贴图缺失时退成纯烘焙贴图，地形照常显示。
    return material;
  }

  material.customProgramCacheKey = () => "terrain-detail-v1";
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTerrainGroundColor = { value: ground.color };
    shader.uniforms.uTerrainGroundNormal = { value: ground.normal };
    shader.uniforms.uTerrainRockColor = { value: rock.color };
    shader.uniforms.uTerrainRockNormal = { value: rock.normal };
    shader.uniforms.uTerrainGroundScale = { value: options.groundScale };
    shader.uniforms.uTerrainRockScale = { value: options.rockScale };
    shader.uniforms.uTerrainGroundLuma = { value: ground.meanLuma };
    shader.uniforms.uTerrainRockLuma = { value: rock.meanLuma };
    shader.uniforms.uTerrainNormalStrength = { value: options.normalStrength };
    shader.uniforms.uTerrainAlbedoStrength = { value: options.albedoStrength };
    shader.uniforms.uTerrainRockLow = { value: 0.62 };
    shader.uniforms.uTerrainRockHigh = { value: 0.9 };

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_PARS}`)
      .replace(
        "#include <beginnormal_vertex>",
        "#include <beginnormal_vertex>\nvTerrainNormalW = normalize( mat3( modelMatrix ) * objectNormal );",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvTerrainWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;",
      );

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${FRAGMENT_UNIFORMS}`)
      .replace("#include <map_fragment>", `#include <map_fragment>\n${FRAGMENT_ALBEDO}`)
      .replace("#include <normal_fragment_begin>", `#include <normal_fragment_begin>\n${FRAGMENT_NORMAL}`);
  };
  return material;
}

/** 地形顶面：烘焙贴图 + 细节层。 */
export function createTerrainGroundMaterial(
  macro: THREE.Texture,
  style: string,
): THREE.MeshStandardMaterial {
  const detail = STYLE_DETAIL[style] ?? STYLE_DETAIL.frontier;
  return createDetailMaterial({
    macro,
    color: 0xffffff,
    groundLayer: detail.ground,
    rockLayer: detail.rock,
    vertexColors: false,
    side: THREE.FrontSide,
    groundScale: 1 / 2.4,
    rockScale: 1 / 3.2,
    normalStrength: 0.7,
    albedoStrength: 0.38,
  });
}

/** 陡壁墙面：只用岩石细节，顶点色负责底部压暗。 */
export function createTerrainCliffMaterial(
  style: string,
  color: THREE.ColorRepresentation,
): THREE.MeshStandardMaterial {
  const detail = STYLE_DETAIL[style] ?? STYLE_DETAIL.frontier;
  return createDetailMaterial({
    macro: null,
    color,
    groundLayer: detail.rock,
    rockLayer: detail.rock,
    vertexColors: true,
    side: THREE.DoubleSide,
    groundScale: 1 / 3.4,
    rockScale: 1 / 3.4,
    normalStrength: 0.7,
    albedoStrength: 0.4,
  });
}