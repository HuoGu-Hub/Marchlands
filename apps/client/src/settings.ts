import { isDifficultyId } from "./difficulty";
import type { DifficultyId } from "./difficulty";

export type Resolution = "1280x720" | "1920x1080";
export type WindowMode = "windowed" | "fullscreen";

export interface Settings {
  resolution: Resolution;
  windowMode: WindowMode;
  volume: number;
  language: string;
  /** 上一次选择的对局难度。 */
  difficulty: DifficultyId;
  /** 各兵种出场皮肤：兵种 → 资产 id，缺省用程序化模型。 */
  unitSkins: Record<string, string>;
}

const KEY = "marchlands.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  resolution: "1280x720",
  windowMode: "windowed",
  volume: 70,
  language: "zh-CN",
  difficulty: "normal",
  unitSkins: {
    barbarian: "builtin:unit.kaykit-barbarian",
    warrior: "builtin:unit.kaykit-knight",
    archer: "builtin:unit.kaykit-rogue-hooded",
    ranger: "builtin:unit.kaykit-rogue",
    mage: "builtin:unit.kaykit-mage",
    cavalry: "builtin:unit.cavalry",
  },
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      difficulty: isDifficultyId(parsed.difficulty) ? parsed.difficulty : DEFAULT_SETTINGS.difficulty,
      unitSkins: parsed.unitSkins ?? {},
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage can be unavailable in private mode; settings stay in memory
  }
}
