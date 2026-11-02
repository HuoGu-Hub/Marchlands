import * as THREE from "three";
import { ModelBuilder } from "./building-kit";
import type { TeamPalette } from "./building-kit";

export type UnitKind = "infantry" | "shield" | "cavalry" | "archer" | "elite";

export const UNIT_KINDS: UnitKind[] = ["infantry", "shield", "cavalry", "archer", "elite"];

export const UNIT_NAMES: Record<UnitKind, string> = {
  infantry: "步兵",
  shield: "盾兵",
  cavalry: "骑兵",
  archer: "弓兵",
  elite: "精兵",
};

export const UNIT_DESCRIPTIONS: Record<UnitKind, string> = {
  infantry: "单刀 · 皮甲",
  shield: "重甲 · 大盾",
  cavalry: "长枪 · 战马",
  archer: "弓箭 · 兜帽",
  elite: "轻甲 · 羽饰",
};

const GRADIENT = (() => {
  const texture = new THREE.DataTexture(new Uint8Array([110, 180, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

const CACHE = new Map<number, THREE.MeshToonMaterial>();

function paint(color: number): THREE.MeshToonMaterial {
  const key = color >>> 0;
  const cached = CACHE.get(key);
  if (cached) return cached;
  const created = new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT });
  CACHE.set(key, created);
  return created;
}

const SKIN = paint(0xf5c9a0);
const HAIR = paint(0x4a3324);
const STEEL = paint(0xb9c2ca);
const DARK_STEEL = paint(0x77828c);
const GOLD = paint(0xe8bd62);
const LEATHER = paint(0x9a6b42);
const DARK_LEATHER = paint(0x563a26);
const WOOD = paint(0x9a6a3d);
const HORSE = paint(0xa86d47);
const HORSE_LIGHT = paint(0xe0b890);
const HORSE_DARK = paint(0x4c3323);
const WHITE = paint(0xf6efdf);
const INK = paint(0x2a1e17);
const BLUSH = paint(0xeea08b);

const HIP_Y = 0.19;
const SHOULDER_Y = 0.25;
const NECK_Y = 0.45;

export interface UnitRig {
  root: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  mount?: THREE.Group;
  mountLegs: THREE.Group[];
  height: number;
  kind: UnitKind;
}

function part(build: (builder: ModelBuilder) => void): THREE.Group {
  const builder = new ModelBuilder();
  build(builder);
  return builder.finish();
}

function paintTeam(palette: TeamPalette): THREE.MeshToonMaterial {
  const color = new THREE.Color(palette.cloth);
  color.offsetHSL(0, 0.16, 0.08);
  return paint(color.getHex());
}

function paintTrim(palette: TeamPalette): THREE.MeshToonMaterial {
  return paint(new THREE.Color(palette.roofEdge).offsetHSL(0, 0.08, 0.03).getHex());
}

function ball(
  builder: ModelBuilder,
  radius: number,
  sx: number,
  sy: number,
  sz: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const geometry = new THREE.SphereGeometry(radius, 16, 12);
  geometry.scale(sx, sy, sz);
  builder.add(geometry, material, new THREE.Vector3(x, y, z));
}

function capsule(
  builder: ModelBuilder,
  radius: number,
  length: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
  rz = 0,
  sx = 1,
  sy = 1,
  sz = 1,
): void {
  const geometry = new THREE.CapsuleGeometry(radius, length, 6, 14);
  geometry.scale(sx, sy, sz);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  builder.add(geometry, material, new THREE.Vector3(x, y, z), quaternion);
}

function torus(
  builder: ModelBuilder,
  radius: number,
  tube: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = Math.PI / 2,
  ry = 0,
  rz = 0,
): void {
  const geometry = new THREE.TorusGeometry(radius, tube, 10, 28);
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  builder.add(geometry, material, new THREE.Vector3(x, y, z), quaternion);
}

function roundedPanel(
  builder: ModelBuilder,
  width: number,
  height: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): void {
  const shape = new THREE.Shape();
  const w = width / 2;
  const h = height / 2;
  shape.moveTo(-w + 0.02, -h);
  shape.quadraticCurveTo(-w, -h, -w, -h + 0.02);
  shape.lineTo(-w, h - 0.02);
  shape.quadraticCurveTo(-w, h, -w + 0.02, h);
  shape.lineTo(w - 0.02, h);
  shape.quadraticCurveTo(w, h, w, h - 0.02);
  shape.lineTo(w, -h + 0.02);
  shape.quadraticCurveTo(w, -h, w - 0.02, -h);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  builder.add(geometry, material, new THREE.Vector3(x, y, z));
}

function makeTorso(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = paintTeam(palette);
  const trim = paintTrim(palette);
  const armor = kind === "shield" || kind === "cavalry" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    ball(b, 0.22, 1.08, 1.12, 0.92, team, 0, 0.17, 0);
    ball(b, 0.17, 1.0, 0.85, 0.42, armor, 0, 0.17, 0.14);
    torus(b, 0.19, 0.018, DARK_LEATHER, 0, 0.045, 0);
    ball(b, 0.035, 1, 1, 1, GOLD, 0, 0.045, 0.18);
    for (const x of [-0.19, 0.19]) ball(b, 0.075, 1, 1, 1, armor, x, 0.29, 0);
    ball(b, 0.1, 0.95, 1.1, 0.18, team, 0, 0.15, 0.18);

    if (kind === "shield") {
      ball(b, 0.18, 1, 0.9, 0.4, STEEL, 0, 0.18, 0.16);
      torus(b, 0.16, 0.014, GOLD, 0, 0.18, 0.2, 0, 0, 0);
      ball(b, 0.045, 1, 1, 1, GOLD, 0, 0.18, 0.22);
    } else if (kind === "elite") {
      ball(b, 0.19, 1, 0.9, 0.35, DARK_STEEL, 0, 0.18, 0.15);
      for (let row = 0; row < 2; row += 1) {
        for (let column = 0; column < 4; column += 1) {
          ball(b, 0.018, 1, 1, 1, GOLD, -0.075 + column * 0.05, 0.15 + row * 0.05, 0.2);
        }
      }
      torus(b, 0.2, 0.015, GOLD, 0, 0.27, 0, Math.PI / 2, 0, 0.1);
      ball(b, 0.18, 0.95, 1.0, 0.22, team, 0, 0.14, -0.17);
    } else if (kind === "archer") {
      torus(b, 0.2, 0.018, trim, 0, 0.27, 0, Math.PI / 2, 0, 0.15);
      ball(b, 0.19, 0.9, 1.05, 0.2, team, 0, 0.1, -0.16);
    } else if (kind === "cavalry") {
      torus(b, 0.2, 0.015, DARK_STEEL, 0, 0.27, 0);
    } else {
      ball(b, 0.17, 1, 0.85, 0.35, LEATHER, 0, 0.18, 0.16);
      for (const x of [-0.09, 0, 0.09]) ball(b, 0.018, 1, 1, 1, GOLD, x, 0.12, 0.21);
    }
    if (variant % 2 === 0) ball(b, 0.022, 1, 1, 1, GOLD, 0, 0.28, 0.19);
  });
}

function makeHead(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = paintTeam(palette);
  const trim = paintTrim(palette);
  return part((b) => {
    ball(b, 0.21, 1, 1, 0.96, SKIN, 0, 0.12, 0);
    ball(b, 0.07, 1, 1, 1, HAIR, 0, 0.26, -0.12);
    for (const x of [-0.075, 0.075]) {
      ball(b, 0.045, 1, 1.1, 0.55, INK, x, 0.14, 0.185);
      ball(b, 0.014, 1, 1, 1, WHITE, x + 0.012, 0.155, 0.21);
      ball(b, 0.027, 1, 0.8, 0.4, BLUSH, x * 1.75, 0.075, 0.17);
    }
    ball(b, 0.016, 1, 0.8, 0.5, INK, 0, 0.075, 0.205);

    if (kind === "shield") {
      ball(b, 0.225, 1, 1, 1, DARK_STEEL, 0, 0.12, 0.005);
      ball(b, 0.13, 1.0, 0.2, 0.12, INK, 0, 0.15, 0.205);
      for (const x of [-0.13, 0.13]) ball(b, 0.035, 1, 1, 1, GOLD, x, 0.18, 0.18);
      torus(b, 0.2, 0.018, STEEL, 0, 0.13, 0, Math.PI / 2, 0, 0);
      ball(b, 0.03, 1, 1, 1, GOLD, 0, 0.27, 0.16);
    } else if (kind === "archer") {
      ball(b, 0.215, 1, 1, 1, team, 0, 0.16, -0.06);
      torus(b, 0.18, 0.032, trim, 0, 0.12, 0.14, 0.2, 0, 0);
      ball(b, 0.06, 1.1, 0.6, 0.8, team, 0, 0.33, -0.12);
      capsule(b, 0.025, 0.1, GOLD, 0.16, 0.1, 0.08, 0, 0, -0.4);
    } else if (kind === "elite") {
      b.add(
        new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        STEEL,
        new THREE.Vector3(0, 0.2, 0),
      );
      torus(b, 0.21, 0.02, GOLD, 0, 0.19, 0, Math.PI / 2, 0, 0);
      for (const x of [-0.19, 0.19]) ball(b, 0.05, 1, 1, 1, STEEL, x, 0.1, 0.02);
      const plume = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0.13, 0.3, 0),
        new THREE.Vector3(0.26, 0.42, -0.02),
        new THREE.Vector3(0.28, 0.55, -0.06),
      ]);
      b.add(new THREE.TubeGeometry(plume, 8, 0.035, 6, false), team, new THREE.Vector3(0, 0, 0));
      ball(b, 0.06, 1, 1, 1, GOLD, 0.16, 0.28, 0);
    } else if (kind === "cavalry") {
      b.add(
        new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        STEEL,
        new THREE.Vector3(0, 0.19, 0),
      );
      capsule(b, 0.045, 0.1, team, 0, 0.4, -0.03, 0, 0, 0);
      torus(b, 0.2, 0.016, GOLD, 0, 0.16, 0, Math.PI / 2, 0, 0);
      capsule(b, 0.015, 0.06, GOLD, 0, 0.16, 0.2);
    } else {
      b.add(
        new THREE.SphereGeometry(0.225, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        STEEL,
        new THREE.Vector3(0, 0.19, 0),
      );
      torus(b, 0.21, 0.018, DARK_STEEL, 0, 0.18, 0, Math.PI / 2, 0, 0);
      capsule(b, 0.014, 0.06, STEEL, 0, 0.12, 0.21);
      if (variant % 2 === 0) capsule(b, 0.025, 0.09, team, 0, 0.37, -0.02);
    }
  });
}

function makeArm(kind: UnitKind, palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  const armor = kind === "shield" || kind === "cavalry" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    capsule(b, 0.065, 0.08, kind === "archer" ? team : armor, 0, -0.08, 0);
    ball(b, 0.07, 1, 1, 1, kind === "shield" || kind === "elite" ? STEEL : SKIN, 0, -0.17, 0.01);
    if (kind === "shield" || kind === "cavalry") torus(b, 0.055, 0.012, GOLD, 0, -0.02, 0, 0, 0, 0);
  });
}

function makeLeg(kind: UnitKind): THREE.Group {
  return part((b) => {
    capsule(b, 0.078, 0.05, kind === "shield" || kind === "elite" ? DARK_STEEL : DARK_LEATHER, 0, -0.075, 0);
    ball(b, 0.075, 1.05, 0.7, 1.25, DARK_LEATHER, 0, -0.175, 0.025);
    if (kind === "shield" || kind === "elite") torus(b, 0.065, 0.012, STEEL, 0, -0.11, 0, 0, 0, 0);
  });
}

function sword(): THREE.Group {
  return part((b) => {
    const blade = new THREE.CapsuleGeometry(0.045, 0.18, 6, 10);
    blade.scale(1, 1, 0.32);
    b.add(blade, STEEL, new THREE.Vector3(0, 0.2, 0));
    ball(b, 0.05, 1, 0.5, 0.35, STEEL, 0, 0.32, 0);
    capsule(b, 0.025, 0.1, GOLD, 0, 0.075, 0, 0, 0, Math.PI / 2);
    capsule(b, 0.022, 0.05, DARK_LEATHER, 0, 0.0, 0);
    ball(b, 0.035, 1, 1, 1, GOLD, 0, -0.035, 0);
  });
}

function roundShield(palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  const trim = paintTrim(palette);
  return part((b) => {
    const disc = new THREE.CylinderGeometry(0.225, 0.225, 0.045, 32);
    b.add(disc, team, new THREE.Vector3(0, 0, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
    torus(b, 0.22, 0.023, trim, 0, 0, 0.01, 0, 0, 0);
    torus(b, 0.13, 0.013, GOLD, 0, 0, 0.03, 0, 0, 0);
    ball(b, 0.065, 1, 1, 0.55, GOLD, 0, 0, 0.04);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      ball(b, 0.02, 1, 1, 1, GOLD, Math.cos(angle) * 0.17, Math.sin(angle) * 0.17, 0.03);
    }
  });
}

function bow(): THREE.Group {
  return part((b) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, -0.36, 0),
      new THREE.Vector3(0.16, -0.2, 0),
      new THREE.Vector3(0.2, 0, 0),
      new THREE.Vector3(0.16, 0.2, 0),
      new THREE.Vector3(0.02, 0.36, 0),
    ]);
    b.add(new THREE.TubeGeometry(curve, 14, 0.02, 6, false), WOOD, new THREE.Vector3(0, 0, 0));
    capsule(b, 0.005, 0.56, WHITE, 0.03, 0, 0);
    capsule(b, 0.022, 0.08, DARK_LEATHER, 0.18, 0, 0);
    ball(b, 0.026, 1, 1, 1, GOLD, 0.02, 0.37, 0);
    ball(b, 0.026, 1, 1, 1, GOLD, 0.02, -0.37, 0);
  });
}

function lance(palette: TeamPalette): THREE.Group {
  return part((b) => {
    capsule(b, 0.022, 0.62, WOOD, 0, 0.2, 0);
    b.add(new THREE.ConeGeometry(0.05, 0.14, 10), STEEL, new THREE.Vector3(0, 0.66, 0));
    const team = paintTeam(palette);
    ball(b, 0.09, 1.2, 0.7, 0.2, team, 0.1, 0.51, 0);
    ball(b, 0.03, 1, 1, 1, GOLD, 0, 0.06, 0);
  });
}

function quiver(palette: TeamPalette): THREE.Group {
  const team = paintTeam(palette);
  return part((b) => {
    capsule(b, 0.06, 0.16, DARK_LEATHER, 0, 0.02, 0, 0, 0, -0.22);
    torus(b, 0.06, 0.015, team, 0, 0.1, 0, 0, 0, 0);
    for (const x of [-0.035, 0, 0.035]) {
      capsule(b, 0.007, 0.16, WOOD, x, 0.17, 0, 0, 0, -0.22);
      ball(b, 0.02, 1, 1.4, 0.6, WHITE, x, 0.26, 0);
    }
  });
}

function makeHumanoid(kind: UnitKind, palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const torso = makeTorso(kind, palette, variant);
  torso.position.y = HIP_Y;
  root.add(torso);

  const head = makeHead(kind, palette, variant);
  head.position.y = NECK_Y;
  torso.add(head);

  const leftArm = makeArm(kind, palette);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(kind === "archer" ? -1.0 : -0.4, 0, kind === "archer" ? -0.25 : -0.3);
  torso.add(leftArm);

  const rightArm = makeArm(kind, palette);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(-0.6, 0, 0.3);
  torso.add(rightArm);

  const leftLeg = makeLeg(kind);
  leftLeg.position.set(-0.095, HIP_Y, 0);
  root.add(leftLeg);
  const rightLeg = makeLeg(kind);
  rightLeg.position.set(0.095, HIP_Y, 0);
  root.add(rightLeg);

  if (kind === "archer") {
    const bag = quiver(palette);
    bag.position.set(0.11, 0.12, -0.15);
    torso.add(bag);
    const weapon = bow();
    weapon.position.set(-0.02, -0.17, 0.16);
    weapon.rotation.set(0.1, 0, 0.08);
    leftArm.add(weapon);
  } else if (kind === "shield") {
    const weapon = sword();
    weapon.position.set(0.01, -0.17, 0.04);
    weapon.rotation.set(0.2, 0, -0.2);
    rightArm.add(weapon);
    const shield = roundShield(palette);
    shield.position.set(-0.04, -0.12, 0.12);
    shield.rotation.set(0.05, -0.2, 0.05);
    leftArm.add(shield);
  } else if (kind === "elite") {
    const weapon = sword();
    weapon.position.set(0.01, -0.17, 0.04);
    weapon.rotation.set(0.2, 0, -0.2);
    rightArm.add(weapon);
  } else if (kind === "cavalry") {
    const weapon = lance(palette);
    weapon.position.set(0, -0.16, 0.02);
    rightArm.add(weapon);
    const shield = roundShield(palette);
    shield.position.set(-0.04, -0.12, 0.12);
    shield.rotation.set(0.05, -0.2, 0.05);
    leftArm.add(shield);
  } else {
    const weapon = sword();
    weapon.position.set(0.01, -0.17, 0.04);
    weapon.rotation.set(0.2, 0, -0.2);
    rightArm.add(weapon);
  }

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    mountLegs: [],
    height: 0.9,
    kind,
  };
}

function makeHorseLeg(x: number, z: number): THREE.Group {
  return part((b) => {
    capsule(b, 0.065, 0.16, HORSE, 0, -0.11, 0);
    ball(b, 0.075, 1.05, 0.7, 1.25, HORSE_DARK, 0, -0.235, 0.02);
  }).translateX(x).translateZ(z);
}

function makeCavalry(palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const mount = new THREE.Group();
  root.add(mount);
  const horse = part((b) => {
    ball(b, 0.26, 1.0, 1.0, 1.45, HORSE, 0, 0.42, 0);
    ball(b, 0.2, 0.9, 0.9, 0.9, HORSE, 0, 0.48, 0.3);
    capsule(b, 0.11, 0.16, HORSE, 0, 0.62, 0.3, 0.55, 0, 0);
    ball(b, 0.2, 1.0, 1.0, 0.95, HORSE, 0, 0.74, 0.44);
    ball(b, 0.12, 1.0, 0.85, 1.1, HORSE_LIGHT, 0, 0.68, 0.6);
    ball(b, 0.05, 1, 0.8, 0.7, HORSE_DARK, 0, 0.7, 0.69);
    for (const x of [-0.085, 0.085]) {
      b.add(new THREE.ConeGeometry(0.045, 0.12, 10), HORSE_DARK, new THREE.Vector3(x, 0.94, 0.38));
      ball(b, 0.03, 1, 1, 0.6, INK, x, 0.76, 0.59);
      ball(b, 0.01, 1, 1, 1, WHITE, x + 0.01, 0.77, 0.61);
    }
    const mane = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.92, 0.32),
      new THREE.Vector3(0, 0.82, 0.24),
      new THREE.Vector3(0, 0.72, 0.18),
    ]);
    b.add(new THREE.TubeGeometry(mane, 6, 0.045, 8, false), HORSE_DARK, new THREE.Vector3(0, 0, 0));
    const tail = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.5, -0.4),
      new THREE.Vector3(0, 0.38, -0.52),
      new THREE.Vector3(0, 0.24, -0.55),
    ]);
    b.add(new THREE.TubeGeometry(tail, 6, 0.04, 8, false), HORSE_DARK, new THREE.Vector3(0, 0, 0));
    const team = paintTeam(palette);
    ball(b, 0.18, 0.35, 0.65, 1.3, team, -0.24, 0.44, 0);
    ball(b, 0.18, 0.35, 0.65, 1.3, team, 0.24, 0.44, 0);
    ball(b, 0.16, 0.95, 0.28, 1.15, team, 0, 0.56, 0);
    ball(b, 0.13, 0.9, 0.35, 1.0, DARK_LEATHER, 0, 0.57, 0);
    torus(b, 0.15, 0.014, GOLD, 0, 0.58, 0, Math.PI / 2, 0, 0);
  });
  mount.add(horse);

  const mountLegs: THREE.Group[] = [];
  for (const x of [-0.14, 0.14]) {
    for (const z of [-0.24, 0.24]) {
      const leg = makeHorseLeg(x, z);
      leg.position.y = 0.22;
      mount.add(leg);
      mountLegs.push(leg);
    }
  }

  const torso = makeTorso("cavalry", palette, variant);
  torso.position.set(0, 0.62, -0.12);
  root.add(torso);
  const head = makeHead("cavalry", palette, variant);
  head.position.y = NECK_Y;
  torso.add(head);
  const leftArm = makeArm("cavalry", palette);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(-0.5, 0, -0.35);
  torso.add(leftArm);
  const rightArm = makeArm("cavalry", palette);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(-0.55, 0, 0.3);
  torso.add(rightArm);
  const weapon = lance(palette);
  weapon.position.set(0, -0.16, 0.02);
  rightArm.add(weapon);
  const shield = roundShield(palette);
  shield.position.set(-0.05, -0.12, 0.12);
  shield.rotation.set(0.05, 0.45, 0.05);
  leftArm.add(shield);

  const leftLeg = part((b) => {
    capsule(b, 0.075, 0.1, LEATHER, 0, -0.08, 0.02, -0.7, 0, 0);
    ball(b, 0.07, 1, 0.8, 1.2, DARK_LEATHER, 0, -0.18, 0.07);
  });
  leftLeg.position.set(-0.2, 0.64, -0.02);
  root.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.2;
  root.add(rightLeg);

  return {
    root,
    torso,
    head,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg,
    mount,
    mountLegs,
    height: 1.32,
    kind: "cavalry",
  };
}

export function buildUnit(kind: UnitKind, palette: TeamPalette, variant: number = 0): UnitRig {
  const rig = kind === "cavalry" ? makeCavalry(palette, variant) : makeHumanoid(kind, palette, variant);
  rig.root.name = "unit-" + kind;
  rig.root.userData.unitKind = kind;
  return rig;
}
