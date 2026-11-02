import * as THREE from "three";
import { ModelBuilder } from "./building-kit";
import type { TeamPalette } from "./building-kit";

const GRADIENT = (() => {
  const data = new Uint8Array([96, 172, 255]);
  const texture = new THREE.DataTexture(data, 3, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

const PAINT_CACHE = new Map<number, THREE.MeshToonMaterial>();

function paint(color: number, _options?: unknown): THREE.MeshToonMaterial {
  const key = color >>> 0;
  const existing = PAINT_CACHE.get(key);
  if (existing) return existing;
  const created = new THREE.MeshToonMaterial({ color, gradientMap: GRADIENT });
  PAINT_CACHE.set(key, created);
  return created;
}

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
  shield: "重甲 · 盾牌",
  cavalry: "长枪 · 战马",
  archer: "弓箭 · 箭袋",
  elite: "轻甲 · 精锐",
};

const SKIN = paint(0xd7b08a, { rough: 0.9 });
const HAIR = paint(0x4a3324, { rough: 1 });
const STEEL = paint(0x969da5, { rough: 0.42, metal: 0.35 });
const DARK_STEEL = paint(0x5f666e, { rough: 0.5, metal: 0.3 });
const GOLD = paint(0xc9a24e, { rough: 0.4, metal: 0.45 });
const LEATHER = paint(0x7a5637, { rough: 0.95 });
const DARK_LEATHER = paint(0x4a3322, { rough: 1 });
const WOOD = paint(0x6b4a2f, { rough: 0.95 });
const BOW_WOOD = paint(0x8a643c, { rough: 0.9 });
const HORSE = paint(0x6b4a35, { rough: 0.95 });
const HORSE_DARK = paint(0x3e2d20, { rough: 1 });
const HORSE_LIGHT = paint(0x9a7252, { rough: 0.95 });
const CLOTH_WHITE = paint(0xd8cfb6, { rough: 0.95 });

const HIP_Y = 0.32;
const SHOULDER_Y = 0.27;
const NECK_Y = 0.34;

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

function teamMat(palette: TeamPalette): THREE.MeshToonMaterial {
  return paint(palette.cloth);
}

function makeTorso(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = teamMat(palette);
  const trim = paint(palette.roofEdge, { rough: 0.85 });
  const armor = kind === "shield" || kind === "cavalry" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    b.box([0.24, 0.12, 0.17], LEATHER, 0, 0.06, 0);
    b.box([0.3, 0.22, 0.2], armor, 0, 0.2, 0);
    b.box([0.11, 0.26, 0.012], team, -0.075, 0.13, 0.112);
    b.box([0.11, 0.26, 0.012], team, 0.075, 0.13, 0.112);
    b.box([0.24, 0.22, 0.012], team, 0, 0.13, -0.112);
    b.box([0.032, 0.3, 0.012], team, 0, 0.17, 0.115, 0, 0, 0.55);
    b.box([0.29, 0.045, 0.19], DARK_LEATHER, 0, 0.055, 0);
    for (const x of [-0.09, 0.09]) {
      b.box([0.1, 0.12, 0.18], armor, x, -0.01, 0.01);
      b.box([0.11, 0.03, 0.19], GOLD, x, -0.08, 0.01);
    }
    b.box([0.06, 0.045, 0.02], GOLD, 0, 0.055, 0.105);
    b.box([0.08, 0.08, 0.045], DARK_LEATHER, 0.13, 0.02, 0.09);
    b.box([0.05, 0.05, 0.04], GOLD, -0.13, 0.02, 0.09);
    b.box([0.12, 0.03, 0.14], team, 0, 0.335, 0);
    for (const x of [-0.18, 0.18]) {
      b.box([0.095, 0.04, 0.145], team, x, 0.31, 0);
    }
    b.box([0.02, 0.02, 0.02], GOLD, 0.07, 0.09, 0.112);

    if (kind === "shield") {
      b.box([0.22, 0.16, 0.025], STEEL, 0, 0.21, 0.113);
      b.box([0.1, 0.1, 0.03], STEEL, 0, 0.11, 0.115);
      b.box([0.32, 0.1, 0.22], DARK_STEEL, 0, 0.33, 0);
      b.box([0.24, 0.08, 0.02], STEEL, 0, 0.28, 0.112);
      for (const x of [-0.16, 0.16]) {
        b.add(new THREE.SphereGeometry(0.09, 7, 5), STEEL, new THREE.Vector3(x, 0.3, 0));
      }
      for (const x of [-0.11, -0.035, 0.04, 0.115]) {
        b.box([0.06, 0.05, 0.018], STEEL, x, 0.12, 0.11);
      }
    } else if (kind === "elite") {
      b.box([0.2, 0.14, 0.02], GOLD, 0, 0.2, 0.114);
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          b.box([0.045, 0.045, 0.014], STEEL, -0.11 + column * 0.055, 0.11 + row * 0.05, 0.108);
        }
      }
      b.box([0.3, 0.035, 0.19], GOLD, 0, 0.31, 0);
      for (const x of [-0.19, 0.19]) {
        b.add(new THREE.SphereGeometry(0.085, 7, 5), STEEL, new THREE.Vector3(x, 0.3, 0));
      }
    } else if (kind === "cavalry") {
      b.box([0.31, 0.05, 0.21], DARK_STEEL, 0, 0.31, 0);
      for (const x of [-0.19, 0.19]) {
        b.add(new THREE.SphereGeometry(0.08, 7, 5), DARK_STEEL, new THREE.Vector3(x, 0.3, 0));
      }
      b.box([0.045, 0.34, 0.02], team, 0.1, 0.15, 0.112);
    } else if (kind === "archer") {
      b.box([0.035, 0.36, 0.02], DARK_LEATHER, 0.11, 0.16, 0.106);
      b.box([0.12, 0.06, 0.02], LEATHER, -0.12, 0.25, 0.11);
    } else {
      b.box([0.32, 0.035, 0.19], DARK_LEATHER, 0, 0.31, 0);
      b.box([0.04, 0.3, 0.018], DARK_LEATHER, -0.1, 0.16, 0.108);
      b.box([0.04, 0.3, 0.018], DARK_LEATHER, 0.1, 0.16, 0.108);
      for (const y of [0.1, 0.17, 0.24]) {
        b.box([0.02, 0.02, 0.02], GOLD, -0.1, y, 0.118);
        b.box([0.02, 0.02, 0.02], GOLD, 0.1, y, 0.118);
      }
    }

    if (kind === "infantry" || kind === "elite") {
      b.box([0.055, 0.34, 0.035], DARK_LEATHER, -0.14, 0.01, 0.02, 0, 0, 0.25);
      b.box([0.065, 0.03, 0.045], GOLD, -0.18, -0.15, 0.02, 0, 0, 0.25);
    }
    if (kind === "elite") {
      const cape = new THREE.Shape();
      cape.moveTo(-0.16, 0.3);
      cape.lineTo(0.16, 0.3);
      cape.lineTo(0.12, -0.28);
      cape.lineTo(0, -0.34);
      cape.lineTo(-0.12, -0.28);
      cape.closePath();
      b.shape(cape, team, 0, 0, -0.118);
    }

    if (kind === "archer") {
      b.cylinder(0.055, 0.055, 0.3, 7, DARK_LEATHER, -0.1, 0.2, -0.13, 0, 0, -0.22);
      for (const offset of [-0.02, 0.02]) {
        b.cylinder(0.006, 0.006, 0.2, 4, WOOD, -0.08 + offset, 0.4, -0.13, 0, 0, -0.22);
        b.box([0.03, 0.05, 0.006], CLOTH_WHITE, -0.08 + offset, 0.49, -0.13);
      }
    }

    b.cylinder(0.05, 0.055, 0.08, 7, SKIN, 0, NECK_Y + 0.01, 0);
    b.box([0.06, 0.06, 0.06], team, 0, NECK_Y + 0.01, 0);
    if (variant % 2 === 0) b.box([0.03, 0.14, 0.02], trim, 0, 0.32, 0.12);
  });
}

function makeHead(kind: UnitKind, palette: TeamPalette, variant: number): THREE.Group {
  const team = teamMat(palette);
  const trim = paint(palette.roofEdge);
  return part((b) => {
    b.cylinder(0.048, 0.052, 0.06, 7, SKIN, 0, 0.02, 0);
    b.add(new THREE.DodecahedronGeometry(0.1, 0), SKIN, new THREE.Vector3(0, 0.12, 0));
    b.box([0.02, 0.018, 0.02], SKIN, 0, 0.1, 0.105);
    for (const x of [-0.035, 0.035]) {
      b.box([0.018, 0.02, 0.01], paint(0x2a211a), x, 0.13, 0.102);
    }
    b.box([0.14, 0.05, 0.12], HAIR, 0, 0.055, -0.02);

    if (kind === "shield") {
      b.box([0.19, 0.2, 0.2], STEEL, 0, 0.13, 0);
      b.box([0.15, 0.025, 0.02], paint(0x1b1a18), 0, 0.145, 0.102);
      for (const x of [-0.065, 0.065]) {
        b.box([0.02, 0.11, 0.01], paint(0x2a211a), x, 0.19, 0.102);
      }
      b.box([0.2, 0.025, 0.21], DARK_STEEL, 0, 0.24, 0);
    } else if (kind === "archer") {
      b.add(new THREE.ConeGeometry(0.15, 0.2, 7), team, new THREE.Vector3(0, 0.23, -0.1), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.22, 0, 0)));
      for (const x of [-0.13, 0.13]) b.box([0.06, 0.16, 0.18], team, x, 0.1, -0.04);
      b.box([0.26, 0.05, 0.1], trim, 0, 0.03, 0.1);
      b.box([0.02, 0.08, 0.02], GOLD, 0.14, 0.08, 0.05);
    } else if (kind === "elite") {
      b.cylinder(0.11, 0.12, 0.08, 8, STEEL, 0, 0.17, 0);
      b.add(new THREE.SphereGeometry(0.105, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), STEEL, new THREE.Vector3(0, 0.21, 0));
      b.box([0.21, 0.025, 0.21], GOLD, 0, 0.15, 0);
      b.box([0.025, 0.025, 0.14], GOLD, 0.06, 0.235, -0.02);
      b.box([0.035, 0.2, 0.08], team, 0.11, 0.3, -0.05, 0, 0, -0.45);
      b.box([0.025, 0.13, 0.05], paint(0xf1e4c8), 0.14, 0.35, -0.03, 0, 0, -0.62);
    } else if (kind === "cavalry") {
      b.cylinder(0.11, 0.12, 0.08, 8, DARK_STEEL, 0, 0.17, 0);
      b.add(new THREE.ConeGeometry(0.13, 0.13, 8), STEEL, new THREE.Vector3(0, 0.25, 0));
      b.box([0.02, 0.2, 0.18], CLOTH_WHITE, 0, 0.08, -0.04);
      b.box([0.14, 0.03, 0.14], GOLD, 0, 0.13, 0.08);
    } else {
      b.cylinder(0.115, 0.12, 0.09, 8, STEEL, 0, 0.16, 0);
      b.add(new THREE.SphereGeometry(0.11, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), STEEL, new THREE.Vector3(0, 0.19, 0));
      b.box([0.024, 0.1, 0.02], STEEL, 0, 0.14, 0.108);
      if (variant % 2 === 0) b.box([0.02, 0.1, 0.06], team, 0, 0.28, 0);
    }
  });
}

function makeArm(kind: UnitKind, palette: TeamPalette, side: number): THREE.Group {
  const team = teamMat(palette);
  const armor = kind === "shield" || kind === "cavalry" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    b.box([0.1, 0.18, 0.11], armor, 0, -0.09, 0);
    b.add(new THREE.SphereGeometry(0.055, 7, 5), armor, new THREE.Vector3(0, -0.18, 0.01));
    b.box([0.09, 0.15, 0.095], kind === "archer" ? LEATHER : armor, 0, -0.26, 0.01);
    b.box([0.095, 0.04, 0.1], team, 0, -0.04, 0);
    if (kind === "shield" || kind === "elite" || kind === "cavalry") {
      b.add(new THREE.SphereGeometry(0.085, 7, 5), STEEL, new THREE.Vector3(0, -0.01, 0));
      b.box([0.1, 0.06, 0.11], STEEL, 0, -0.3, 0.01);
    }
    if (kind === "archer") {
      b.box([0.095, 0.07, 0.1], DARK_LEATHER, 0, -0.33, 0.02);
      b.box([0.1, 0.03, 0.105], GOLD, 0, -0.28, 0.01);
    } else {
      b.add(new THREE.SphereGeometry(0.06, 6, 5), SKIN, new THREE.Vector3(0, -0.34, 0.02));
    }
    if (side < 0 && (kind === "shield" || kind === "cavalry")) {
      b.box([0.1, 0.03, 0.1], GOLD, 0, -0.05, 0.02);
    }
  });
}

function makeLeg(kind: UnitKind, side: number): THREE.Group {
  const armor = kind === "shield" ? STEEL : kind === "elite" ? DARK_STEEL : LEATHER;
  return part((b) => {
    b.box([0.105, 0.2, 0.115], kind === "shield" || kind === "elite" ? DARK_LEATHER : LEATHER, 0, -0.1, 0);
    b.box([0.09, 0.18, 0.1], armor, 0, -0.28, 0);
    if (kind === "shield" || kind === "elite") b.box([0.1, 0.05, 0.11], STEEL, 0, -0.2, 0);
    b.box([0.12, 0.08, 0.19], DARK_LEATHER, 0, -0.4, 0.035);
    b.box([0.12, 0.02, 0.2], DARK_STEEL, 0, -0.445, 0.035);
    if (side > 0) b.box([0.02, 0.2, 0.02], kind === "elite" ? GOLD : DARK_LEATHER, 0.06, -0.1, 0);
  });
}

function sword(): THREE.Group {
  return part((b) => {
    b.box([0.042, 0.34, 0.014], STEEL, 0, 0.24, 0);
    b.box([0.012, 0.28, 0.004], paint(0x6f767d), 0, 0.24, 0.009);
    b.add(new THREE.ConeGeometry(0.042, 0.08, 4), STEEL, new THREE.Vector3(0, 0.45, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)));
    b.box([0.16, 0.03, 0.04], GOLD, 0, 0.06, 0);
    b.cylinder(0.022, 0.024, 0.13, 6, LEATHER, 0, 0.0, 0);
    b.add(new THREE.SphereGeometry(0.032, 6, 5), GOLD, new THREE.Vector3(0, -0.075, 0));
  });
}

function kiteShield(palette: TeamPalette, kind: UnitKind): THREE.Group {
  const team = teamMat(palette);
  return part((b) => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.16, 0.2);
    shape.lineTo(0.16, 0.2);
    shape.lineTo(0.16, -0.06);
    shape.lineTo(0, -0.34);
    shape.lineTo(-0.16, -0.06);
    shape.closePath();
    b.shape(shape, paint(0x3d4248), 0, 0, -0.01);
    b.shape(shape, team, 0, 0, 0.012);
    b.box([0.035, 0.42, 0.035], DARK_STEEL, 0, -0.04, 0.005);
    b.box([0.3, 0.035, 0.035], DARK_STEEL, 0, 0.17, 0.005);
    b.box([0.3, 0.035, 0.035], DARK_STEEL, 0, 0.1, 0.005);
    b.box([0.028, 0.35, 0.03], GOLD, 0, -0.06, 0.025);
    b.box([0.24, 0.028, 0.03], GOLD, 0, 0.14, 0.025);
    b.add(new THREE.SphereGeometry(0.055, 6, 5), GOLD, new THREE.Vector3(0, 0.04, 0.045));
    if (kind === "elite") b.box([0.2, 0.02, 0.03], GOLD, 0, -0.2, 0.02);
  });
}

function roundShield(palette: TeamPalette): THREE.Group {
  const team = teamMat(palette);
  return part((b) => {
    b.cylinder(0.19, 0.19, 0.035, 12, DARK_STEEL, 0, 0, 0, Math.PI / 2, 0, 0);
    b.cylinder(0.16, 0.16, 0.04, 12, team, 0, 0, 0.02, Math.PI / 2, 0, 0);
    b.cylinder(0.05, 0.05, 0.05, 8, GOLD, 0, 0, 0.03, Math.PI / 2, 0, 0);
    for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      b.box([0.02, 0.2, 0.02], GOLD, Math.cos(angle) * 0.095, Math.sin(angle) * 0.095, 0.03, 0, 0, angle);
    }
  });
}

function bow(): THREE.Group {
  return part((b) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.02, -0.44, 0),
      new THREE.Vector3(0.14, -0.24, 0),
      new THREE.Vector3(0.2, 0, 0),
      new THREE.Vector3(0.14, 0.24, 0),
      new THREE.Vector3(0.02, 0.44, 0),
    ]);
    b.add(new THREE.TubeGeometry(curve, 14, 0.016, 5, false), BOW_WOOD, new THREE.Vector3(0, 0, 0));
    b.box([0.006, 0.86, 0.006], paint(0x3c3326), 0.03, 0, 0);
    b.cylinder(0.024, 0.024, 0.12, 6, LEATHER, 0.2, 0, 0);
    b.box([0.012, 0.1, 0.012], GOLD, 0.2, 0.06, 0);
    b.box([0.012, 0.1, 0.012], GOLD, 0.2, -0.06, 0);
    b.cone(0.014, 0.06, 4, GOLD, 0.02, 0.47, 0);
    b.cone(0.014, 0.06, 4, GOLD, 0.02, -0.47, 0);
  });
}

function lance(): THREE.Group {
  return part((b) => {
    b.cylinder(0.012, 0.016, 1.05, 6, WOOD, 0, 0.3, 0);
    b.add(new THREE.ConeGeometry(0.03, 0.16, 5), STEEL, new THREE.Vector3(0, 0.9, 0));
    b.box([0.16, 0.13, 0.01], paint(0xe8e0c8), 0.09, 0.72, 0);
    b.box([0.03, 0.03, 0.04], GOLD, 0, 0.08, 0);
  });
}

function quiver(palette: TeamPalette): THREE.Group {
  const team = teamMat(palette);
  return part((b) => {
    b.cylinder(0.06, 0.07, 0.3, 7, DARK_LEATHER, 0, 0.02, 0, 0, 0, -0.25);
    b.cylinder(0.065, 0.065, 0.03, 7, team, 0, 0.15, 0, 0, 0, -0.25);
    for (const offset of [-0.035, 0, 0.035]) {
      b.cylinder(0.006, 0.006, 0.26, 4, WOOD, offset, 0.2, 0, 0, 0, -0.25);
      b.box([0.03, 0.06, 0.006], CLOTH_WHITE, offset - 0.01, 0.32, 0);
    }
  });
}

function addSword(arm: THREE.Group): void {
  const weapon = sword();
  weapon.position.set(0.015, -0.34, 0.06);
  weapon.rotation.set(0.35, 0.1, -0.18);
  arm.add(weapon);
}

function addShield(arm: THREE.Group, palette: TeamPalette, kind: UnitKind, side = 1): void {
  const shield = kind === "elite" ? roundShield(palette) : kiteShield(palette, kind);
  shield.position.set(-0.04, -0.3, 0.15);
  shield.rotation.set(0.05, -0.18 * side, 0.05);
  arm.add(shield);
}

function addBow(arm: THREE.Group): void {
  const weapon = bow();
  weapon.position.set(-0.02, -0.32, 0.2);
  weapon.rotation.set(0.06, 0.02, 0.08);
  arm.add(weapon);
}

function addLance(arm: THREE.Group): void {
  const weapon = lance();
  weapon.position.set(0, -0.32, 0.02);
  weapon.rotation.set(0.12, 0, 0);
  arm.add(weapon);
}

function makeHumanoid(kind: UnitKind, palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const torso = makeTorso(kind, palette, variant);
  torso.position.y = HIP_Y;
  root.add(torso);

  const head = makeHead(kind, palette, variant);
  head.position.y = NECK_Y;
  head.scale.setScalar(1.42);
  torso.add(head);

  const leftArm = makeArm(kind, palette, -1);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(kind === "archer" ? -1.05 : -0.45, 0, kind === "archer" ? -0.2 : -0.12);
  leftArm.scale.set(1.12, 0.78, 1.12);
  torso.add(leftArm);

  const rightArm = makeArm(kind, palette, 1);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(kind === "cavalry" ? -0.55 : -0.7, 0, 0.14);
  rightArm.scale.set(1.12, 0.78, 1.12);
  torso.add(rightArm);

  const leftLeg = makeLeg(kind, -1);
  leftLeg.position.set(-0.095, HIP_Y, 0);
  leftLeg.scale.set(1.18, 0.72, 1.18);
  root.add(leftLeg);

  const rightLeg = makeLeg(kind, 1);
  rightLeg.position.set(0.095, HIP_Y, 0);
  rightLeg.scale.set(1.18, 0.72, 1.18);
  root.add(rightLeg);

  if (kind === "archer") {
    const bag = quiver(palette);
    bag.position.set(0.1, 0.1, -0.14);
    torso.add(bag);
    addBow(leftArm);
  } else if (kind === "shield") {
    addSword(rightArm);
    addShield(leftArm, palette, kind);
  } else if (kind === "elite") {
    addSword(rightArm);
  } else if (kind === "cavalry") {
    addLance(rightArm);
    addShield(leftArm, palette, "shield");
  } else {
    addSword(rightArm);
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
    height: 1.0,
    kind,
  };
}

function makeHorseLeg(x: number, z: number): THREE.Group {
  return part((b) => {
    b.box([0.075, 0.26, 0.09], HORSE, 0, -0.13, 0);
    b.box([0.055, 0.22, 0.06], HORSE_DARK, 0, -0.35, 0.01);
    b.box([0.08, 0.06, 0.1], HORSE_DARK, 0, -0.48, 0.02);
  }).translateX(x).translateZ(z);
}

function makeCavalry(palette: TeamPalette, variant: number): UnitRig {
  const root = new THREE.Group();
  const mount = new THREE.Group();
  root.add(mount);
  const horse = part((b) => {
    b.cylinder(0.2, 0.22, 0.66, 9, HORSE, 0, 0.76, -0.02, Math.PI / 2, 0, 0);
    b.add(new THREE.SphereGeometry(0.2, 8, 6), HORSE, new THREE.Vector3(0, 0.76, 0.28));
    b.add(new THREE.SphereGeometry(0.2, 8, 6), HORSE, new THREE.Vector3(0, 0.76, -0.28));
    b.cylinder(0.12, 0.18, 0.48, 8, HORSE, 0, 1.0, 0.42, 0.65, 0, 0);
    b.add(new THREE.SphereGeometry(0.22, 10, 8), HORSE, new THREE.Vector3(0, 1.08, 0.68));
    b.box([0.24, 0.05, 0.3], teamMat(palette), 0, 1.23, 0.62, -0.1, 0, 0);
    b.box([0.16, 0.14, 0.2], HORSE_LIGHT, 0, 1.0, 0.86);
    b.box([0.06, 0.04, 0.07], HORSE_DARK, 0, 1.04, 0.95);
    for (const x of [-0.09, 0.09]) {
      b.cone(0.035, 0.13, 4, HORSE_DARK, x, 1.32, 0.64);
      b.add(new THREE.SphereGeometry(0.026, 6, 5), paint(0x241a14), new THREE.Vector3(x, 1.12, 0.86));
      b.add(new THREE.SphereGeometry(0.008, 5, 4), paint(0xf4ecdb), new THREE.Vector3(x + 0.008, 1.128, 0.88));
    }
    b.box([0.04, 0.3, 0.08], HORSE_DARK, 0, 1.06, 0.36, 0.65, 0, 0);
    b.box([0.08, 0.14, 0.05], HORSE_DARK, 0, 1.29, 0.62, -0.2, 0, 0);
    b.box([0.07, 0.18, 0.04], HORSE_DARK, 0, 1.28, 0.58, -0.2, 0, 0);
    b.box([0.012, 0.012, 0.32], DARK_LEATHER, 0.07, 1.04, 0.72, -0.35, 0, 0);
    b.cylinder(0.05, 0.012, 0.32, 5, HORSE_DARK, 0, 0.72, -0.46, Math.PI / 2, 0, 0);
    const cloth = teamMat(palette);
    b.box([0.42, 0.02, 0.5], cloth, 0, 0.95, -0.02);
    for (const side of [-1, 1]) {
      b.box([0.014, 0.24, 0.48], cloth, side * 0.21, 0.83, -0.02);
      b.box([0.014, 0.035, 0.52], GOLD, side * 0.215, 0.7, -0.02);
    }
    b.box([0.2, 0.06, 0.34], DARK_LEATHER, 0, 0.96, -0.02);
    b.box([0.08, 0.1, 0.04], GOLD, 0, 0.96, 0.18);
  });
  mount.add(horse);

  const mountLegs: THREE.Group[] = [];
  for (const x of [-0.14, 0.14]) {
    for (const z of [-0.26, 0.26]) {
      const leg = makeHorseLeg(x, z);
      leg.position.y = 0.56;
      mount.add(leg);
      mountLegs.push(leg);
    }
  }

  const torso = makeTorso("cavalry", palette, variant);
  torso.position.set(0, 1.02, -0.2);
  root.add(torso);
  const head = makeHead("cavalry", palette, variant);
  head.position.y = NECK_Y;
  head.scale.setScalar(1.38);
  torso.add(head);
  const leftArm = makeArm("cavalry", palette, -1);
  leftArm.position.set(-0.205, SHOULDER_Y, 0);
  leftArm.rotation.set(-0.55, 0, -0.2);
  leftArm.scale.set(1.12, 0.8, 1.12);
  torso.add(leftArm);
  const rightArm = makeArm("cavalry", palette, 1);
  rightArm.position.set(0.205, SHOULDER_Y, 0);
  rightArm.rotation.set(-0.5, 0, 0.18);
  rightArm.scale.set(1.12, 0.8, 1.12);
  torso.add(rightArm);
  addLance(rightArm);
  const shield = kiteShield(palette, "shield");
  shield.position.set(-0.12, -0.28, 0.03);
  shield.rotation.set(0.05, 0.55, 0.08);
  leftArm.add(shield);

  const leftLeg = part((b) => {
    b.box([0.1, 0.26, 0.12], LEATHER, 0, -0.12, 0.04, -0.7, 0, 0);
    b.box([0.09, 0.12, 0.2], DARK_LEATHER, 0, -0.26, 0.12);
  });
  leftLeg.position.set(-0.22, 1.03, -0.02);
  root.add(leftLeg);
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.22;
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
    height: 1.62,
    kind: "cavalry",
  };
}

export function buildUnit(kind: UnitKind, palette: TeamPalette, variant: number = 0): UnitRig {
  const rig = kind === "cavalry" ? makeCavalry(palette, variant) : makeHumanoid(kind, palette, variant);
  rig.root.name = "unit-" + kind;
  rig.root.userData.unitKind = kind;
  return rig;
}
