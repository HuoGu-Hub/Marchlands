import * as THREE from "three";

export interface UnitActorView {
  setMoving(moving: boolean): void;
  /** 播放一次挥击动作，动作结束后回到行走或待机循环。 */
  playAttack(): void;
  update(deltaMs: number): void;
  dispose(): void;
}

function clipKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * 播放 GLB 单位资产的动画剪辑。骨骼动画与命名节点动画都走 AnimationMixer。
 * 剪辑优先使用 walk / run / move 与 idle / stand，缺失时退回第一个剪辑。
 */
export class GlbUnitActor extends THREE.Group implements UnitActorView {
  private readonly object: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer | null;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private attackAction: THREE.AnimationAction | null = null;
  private moving = false;

  constructor(object: THREE.Object3D, animations: THREE.AnimationClip[]) {
    super();
    this.object = object;
    this.add(object);
    if (animations.length === 0) {
      this.mixer = null;
      return;
    }
    this.mixer = new THREE.AnimationMixer(object);
    for (const clip of animations) {
      const action = this.mixer.clipAction(clip);
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY);
      action.clampWhenFinished = false;
      this.actions.set(clipKey(clip.name), action);
    }
    const first = animations[0];
    const action = this.actions.get(clipKey(first.name));
    if (action) {
      action.play();
      action.setEffectiveWeight(1);
      this.current = action;
    }
    this.mixer.update(0);
  }

  setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    if (!this.mixer) return;
    const next = this.pickClip(moving);
    if (!next || next === this.current) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(0.16);
    next.play();
    if (this.current) this.current.fadeOut(0.16);
    this.current = next;
  }

  playAttack(): void {
    if (!this.mixer) return;
    const action = this.actions.get("attack");
    if (!action || action === this.attackAction) return;
    action.reset();
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(1);
    action.play();
    if (this.current) this.current.fadeOut(0.12);
    this.attackAction = action;
  }

  update(deltaMs: number): void {
    if (!this.mixer) return;
    this.mixer.update(Math.min(100, Math.max(0, deltaMs)) / 1000);
    const attack = this.attackAction;
    if (!attack) return;
    if (attack.time < attack.getClip().duration - 0.02) return;
    this.attackAction = null;
    attack.fadeOut(0.16);
    const next = this.pickClip(this.moving) ?? this.current;
    if (!next || next === attack) return;
    next.reset();
    next.setEffectiveWeight(1);
    next.fadeIn(0.16);
    next.play();
    this.current = next;
  }

  dispose(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.object);
    }
    this.remove(this.object);
  }

  private pickClip(moving: boolean): THREE.AnimationAction | null {
    if (this.actions.size === 0) return null;
    const preferred = moving
      ? ["walk", "run", "move", "runcycle", "walkcycle"]
      : ["idle", "stand", "breath", "idleloop"];
    for (const key of preferred) {
      const action = this.actions.get(key);
      if (action) return action;
    }
    return this.actions.values().next().value ?? null;
  }
}
