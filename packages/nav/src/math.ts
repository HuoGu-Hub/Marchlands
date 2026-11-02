export function isqrt(value: number): number {
  if (value <= 0) return 0;
  let root = Math.floor(Math.sqrt(value));
  while ((root + 1) * (root + 1) <= value) root += 1;
  while (root * root > value) root -= 1;
  return root;
}

export function divRound(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new Error("denominator must be positive");
  return Math.floor((numerator + denominator / 2) / denominator);
}

export function divTrunc(numerator: number, denominator: number): number {
  return Math.trunc(numerator / denominator);
}

export function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
