import { clampInt, divRound } from "./math";

interface AxisSample {
  readonly index: number;
  readonly offsetCm: number;
}

function sampleAxis(valueCm: number, count: number, cellSizeCm: number): AxisSample {
  if (count <= 1) return { index: 0, offsetCm: 0 };
  const half = Math.floor(cellSizeCm / 2);
  const relative = valueCm - half;
  const index = Math.floor(relative / cellSizeCm);
  if (index < 0) return { index: 0, offsetCm: 0 };
  if (index >= count - 1) return { index: count - 2, offsetCm: cellSizeCm };
  return { index, offsetCm: relative - index * cellSizeCm };
}

export function sampleHeightCm(
  heights: Int16Array,
  width: number,
  height: number,
  cellSizeCm: number,
  xCm: number,
  zCm: number,
): number {
  if (width <= 0 || height <= 0) throw new Error("height field must not be empty");
  if (width === 1 && height === 1) return heights[0];
  const x = clampInt(xCm, 0, width * cellSizeCm - 1);
  const z = clampInt(zCm, 0, height * cellSizeCm - 1);
  const column = sampleAxis(x, width, cellSizeCm);
  const row = sampleAxis(z, height, cellSizeCm);
  const x0 = column.index;
  const z0 = row.index;
  const x1 = Math.min(x0 + 1, width - 1);
  const z1 = Math.min(z0 + 1, height - 1);
  const h00 = heights[z0 * width + x0];
  const h10 = heights[z0 * width + x1];
  const h01 = heights[z1 * width + x0];
  const h11 = heights[z1 * width + x1];
  const tx = column.offsetCm;
  const tz = row.offsetCm;
  const top = h00 * (cellSizeCm - tx) + h10 * tx;
  const bottom = h01 * (cellSizeCm - tx) + h11 * tx;
  return divRound(top * (cellSizeCm - tz) + bottom * tz, cellSizeCm * cellSizeCm);
}
