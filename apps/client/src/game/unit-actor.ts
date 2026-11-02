import * as THREE from "three";
import { buildUnit } from "./unit-models";
import type { UnitKind, UnitRig } from "./unit-models";
import type { TeamPalette } from "./building-kit";

export interface UnitActorOptions {
  kind: UnitKind;
  palette: TeamPalette;
  variant?: number;
  phase?: number;
}

export class UnitActor extends THREE.Group {
  readonly kind: UnitKind;
  private readonly rig: UnitRig;
  private phase: number;
  private readonly leftArmRest: number;
  private readonly rightArmRest: number;
  private moving = false;

  constructor(options: UnitActorOptions) {
    super();
    this.kind = options.kind;
    this.rig = buildUnit(options.kind, options.palette, options.variant ?? 0);
    this.add(this.rig.root);
    this.phase = options.phase ?? Math.random() * Math.PI * 2;
    this.leftArmRest = this.rig.leftArm.rotation.x;
    this.rightArmRest = this.rig.rightArm.rotation.x;
  }

  get height(): number {
    return this.rig.height;
  }

  setMoving(moving: boolean): void {
    this.moving = moving;
  }

  update(deltaMs: number): void {
    if (!this.visible) return;
    const speed = this.moving ? 0.012 : 0.0024;
    this.phase += deltaMs * speed;
    const stride = this.moving ? 0.55 : 0.045;
    const swing = Math.sin(this.phase) * stride;
    const lift = Math.abs(Math.sin(this.phase)) * (this.moving ? 0.025 : 0.006);

    this.rig.leftLeg.rotation.x = swing;
    this.rig.rightLeg.rotation.x = -swing;
    this.rig.leftArm.rotation.x = this.leftArmRest - swing * 0.5;
    this.rig.rightArm.rotation.x = this.rightArmRest + swing * 0.45;
    this.rig.torso.position.y = this.rig.kind === "cavalry" ? 0.86 + lift : 0.44 + lift;
    this.rig.head.rotation.z = Math.sin(this.phase * 0.5) * 0.02;
    this.rig.head.rotation.y = Math.sin(this.phase * 0.35) * 0.04;

    if (this.rig.mount) {
      this.rig.mount.position.y = Math.sin(this.phase * 2) * 0.018;
      this.rig.mountLegs.forEach((leg, index) => {
        leg.rotation.x = Math.sin(this.phase * 1.6 + (index % 2 === 0 ? 0 : Math.PI)) * (this.moving ? 0.38 : 0.03);
      });
    }
  }

  dispose(): void {
    this.rig.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    this.remove(this.rig.root);
  }
}
