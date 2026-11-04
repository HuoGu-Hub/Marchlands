import type { AiTuning } from "@marchlands/sim";

export type DifficultyId = "easy" | "normal" | "hard";

export interface DifficultyDef {
  id: DifficultyId;
  label: string;
  hint: string;
  ai: AiTuning;
}

export const DIFFICULTIES: DifficultyDef[] = [
  {
    id: "easy",
    label: "轻松",
    hint: "敌军集结迟缓，适合熟悉地图",
    ai: { decideTicks: 80, sendThresholdPercent: 72 },
  },
  {
    id: "normal",
    label: "标准",
    hint: "敌军按常规节奏推进",
    ai: { decideTicks: 40, sendThresholdPercent: 60 },
  },
  {
    id: "hard",
    label: "困难",
    hint: "敌军频繁出击且更早满编",
    ai: { decideTicks: 24, sendThresholdPercent: 50 },
  },
];

export function isDifficultyId(value: unknown): value is DifficultyId {
  return value === "easy" || value === "normal" || value === "hard";
}

export function difficultyDef(id: string | null | undefined): DifficultyDef {
  return DIFFICULTIES.find((entry) => entry.id === id) ?? DIFFICULTIES[1];
}
