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

/** 兵种 GLB 自带展示用的地面与背景板，进场前必须摘掉，否则会跟着单位一起缩放。 */
const STAGE_NODE_NAMES = new Set(["ground", "backdrop"]);

function stripStageNodes(object: THREE.Object3D): void {
  const stage: THREE.Object3D[] = [];
  object.traverse((node) => {
    if (STAGE_NODE_NAMES.has(node.name.toLowerCase())) stage.push(node);
  });
  for (const node of stage) node.removeFromParent();
}

/**
 * 资产剪辑名可能是 act_U01-A_idle 这类带前缀的命名，
 * 精确名找不到时按结尾段匹配，保证 idle / walk / attack 仍能对上。
 */
function findClip(actions: Map<string, THREE.AnimationAction>, keys: string[]): THREE.AnimationAction | null {
  for (const key of keys) {
    const exact = actions.get(key);
    if (exact) return exact;
  }
  for (const key of keys) {
    for (const [name, action] of actions) {
      if (name.endsWith(key)) return action;
    }
  }
  return null;
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
  /** 每个小兵自己的播放速度，让同一队列的动作逐渐错开。 */
  private timeScale = 1;
  /** 相位偏移，切到待机时也要沿用，否则整队一站定就同步呼吸。 */
  private phaseSeconds = 0;

  constructor(object: THREE.Object3D, animations: THREE.AnimationClip[]) {
    super();
    stripStageNodes(object);
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
    // 骑兵这类组合模型：马的剪辑负责移动，骑手的坐姿要一直叠在上面。
    for (const [name, action] of this.actions) {
      if (!name.endsWith("ride")) continue;
      action.setEffectiveWeight(1);
      action.play();
      break;
    }
    // 剪辑顺序不固定，优先播放待机，避免一进场就循环挥击。
    const first = animations[0];
    const action =
      this.pickClip(false) ??
      this.actions.get(clipKey(first.name)) ??
      findClip(this.actions, [clipKey(first.name)]);
    if (action) {
      action.play();
      action.setEffectiveWeight(1);
      this.current = action;
    }
    this.mixer.update(0);
  }

  /**
   * 设置这个单位的播放相位与速度。
   * 相位直接推进混音器，速度让每个小兵慢慢漂开，避免整队同频。
   */
  setVariation(phaseMs: number, speed = 1): void {
    this.timeScale = Math.max(0.5, Math.min(1.5, speed));
    this.phaseSeconds = Math.max(0, phaseMs) / 1000;
    if (!this.mixer) return;
    this.mixer.update(this.phaseSeconds);
  }

  /** 把剪辑推到各自的相位，避免切动作时全体归零。 */
  private seedAction(action: THREE.AnimationAction): void {
    const duration = action.getClip().duration;
    if (duration > 0) action.time = this.phaseSeconds % duration;
  }

  setMoving(moving: boolean): void {
    if (this.moving === moving) return;
    this.moving = moving;
    if (!this.mixer) return;
    const next = this.pickClip(moving);
    if (!next || next === this.current) return;
    next.reset();
    this.seedAction(next);
    next.setEffectiveWeight(1);
    next.fadeIn(0.16);
    next.play();
    if (this.current) this.current.fadeOut(0.16);
    this.current = next;
  }

  playAttack(): void {
    if (!this.mixer) return;
    const action = findClip(this.actions, ["attack", "kick", "headbutt"]);
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
    this.mixer.update((Math.min(100, Math.max(0, deltaMs)) * this.timeScale) / 1000);
    const attack = this.attackAction;
    if (!attack) return;
    if (attack.time < attack.getClip().duration - 0.02) return;
    this.attackAction = null;
    attack.fadeOut(0.16);
    const next = this.pickClip(this.moving) ?? this.current;
    if (!next || next === attack) return;
    next.reset();
    this.seedAction(next);
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
      ? ["gallop", "walk", "run", "move", "runcycle", "walkcycle"]
      : ["idle", "stand", "breath", "idleloop"];
    return findClip(this.actions, preferred) ?? this.actions.values().next().value ?? null;
  }
}
