import * as THREE from "three";
import { buildBuilding } from "./building-types";
import type { BuildingKind, BuildingLevel } from "./building-types";
import type { TeamPalette } from "./building-kit";

export interface BuildingActorState {
  kind: BuildingKind;
  level: BuildingLevel;
  palette: TeamPalette;
  variant?: number;
}

const OUT_MS = 150;
const IN_MS = 240;

function easeIn(value: number): number {
  return value * value;
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function sameState(a: BuildingActorState, b: BuildingActorState): boolean {
  return a.kind === b.kind && a.level === b.level && a.palette === b.palette && a.variant === b.variant;
}

/**
 * A building slot that can swap its model (kind + level + team) with a short
 * squash-and-rise animation. Every model is built at the same origin / ground
 * plane, so the swap never moves the slot's footprint.
 */
export class BuildingActor extends THREE.Group {
  private model: THREE.Group | null = null;
  private state: BuildingActorState;
  private pending: BuildingActorState | null = null;
  private phase: "idle" | "out" | "in" = "idle";
  private elapsed = 0;

  constructor(state: BuildingActorState) {
    super();
    this.state = state;
    this.model = this.createModel(state);
    this.add(this.model);
  }

  get current(): BuildingActorState {
    return this.state;
  }

  get isSwitching(): boolean {
    return this.phase !== "idle";
  }

  set(state: BuildingActorState, animate = true): void {
    if (sameState(this.state, state) && this.pending === null) return;
    if (!animate) {
      this.replace(state);
      this.phase = "idle";
      this.pending = null;
      this.elapsed = 0;
      this.scale.setScalar(1);
      return;
    }
    this.pending = state;
    if (this.phase === "idle") {
      this.phase = "out";
      this.elapsed = 0;
    }
  }

  update(deltaMs: number): void {
    if (this.phase === "idle" || !this.model) return;
    this.elapsed += deltaMs;
    if (this.phase === "out") {
      const t = Math.min(1, this.elapsed / OUT_MS);
      const scale = 1 - 0.94 * easeIn(t);
      this.model.scale.setScalar(Math.max(0.04, scale));
      this.model.position.y = t * 0.12;
      this.model.rotation.y = t * 0.4;
      if (t >= 1) {
        if (this.pending) this.replace(this.pending);
        this.pending = null;
        this.phase = "in";
        this.elapsed = 0;
      }
      return;
    }
    const t = Math.min(1, this.elapsed / IN_MS);
    const scale = 0.04 + 0.96 * easeOutBack(t);
    this.model.scale.setScalar(scale);
    this.model.position.y = (1 - t) * 0.16;
    this.model.rotation.y = (1 - t) * -0.35;
    if (t >= 1) {
      this.model.scale.setScalar(1);
      this.model.position.y = 0;
      this.model.rotation.y = 0;
      if (this.pending) {
        this.phase = "out";
        this.elapsed = 0;
      } else {
        this.phase = "idle";
      }
    }
  }

  dispose(): void {
    if (this.model) this.disposeModel(this.model);
    this.model = null;
  }

  private replace(state: BuildingActorState): void {
    if (this.model) {
      this.remove(this.model);
      this.disposeModel(this.model);
    }
    this.state = state;
    this.model = this.createModel(state);
    this.model.scale.setScalar(0.04);
    this.add(this.model);
  }

  private createModel(state: BuildingActorState): THREE.Group {
    return buildBuilding(state.kind, state.palette, state.level, state.variant ?? 0);
  }

  private disposeModel(model: THREE.Group): void {
    model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
  }
}
