export type Resolution = "1280x720" | "1920x1080";
export type WindowMode = "windowed" | "fullscreen";

export interface Settings {
  resolution: Resolution;
  windowMode: WindowMode;
  volume: number;
  language: string;
}

const KEY = "marchlands.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  resolution: "1280x720",
  windowMode: "windowed",
  volume: 70,
  language: "zh-CN",
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
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
