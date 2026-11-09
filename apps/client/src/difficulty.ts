import type { AiTuning } from "@marchlands/sim";

export type DifficultyId = "easy" | "normal" | "hard";

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  hint: string;
  /** 难度只改决策频率；派兵阈值等规则与玩家共用。 */
  ai: Pick<AiTuning, "decideTicks">;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: "easy",
    label: "轻松",
    hint: "敌军决策间隔更长，适合熟悉地图",
    ai: { decideTicks: 80 },
  },
  {
    id: "normal",
    label: "标准",
    hint: "敌军按常规节奏推进",
    ai: { decideTicks: 60 },
  },
  {
    id: "hard",
    label: "困难",
    hint: "敌军决策更频繁，推进更主动",
    ai: { decideTicks: 40 },
  },
];

export function isDifficultyId(value: unknown): value is DifficultyId {
  return value === "easy" || value === "normal" || value === "hard";
}

export function difficultyDef(id: string | null | undefined): DifficultyDef {
  return DIFFICULTIES.find((entry) => entry.id === id) ?? DIFFICULTIES[1];
}
