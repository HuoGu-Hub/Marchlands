import type { NavGrid } from "./grid";

export function buildClearanceMask(grid: NavGrid, radiusCm: number): Uint8Array {
  const radius = Math.max(0, Math.floor(radiusCm));
  const count = grid.cellCount;
  const mask = new Uint8Array(count);
  if (radius === 0) {
    for (let index = 0; index < count; index += 1) mask[index] = grid.baseWalkable(index) ? 1 : 0;
    return mask;
  }

  const cellSize = grid.cellSizeCm;
  const reach = Math.ceil(radius / cellSize) + 1;
  const limit = 4 * radius * radius;
  for (let z = 0; z < grid.height; z += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const index = grid.index(x, z);
      if (!grid.baseWalkable(index)) continue;
      let open = 1;
      for (let dz = -reach; dz <= reach && open === 1; dz += 1) {
        for (let dx = -reach; dx <= reach; dx += 1) {
          if (dx === 0 && dz === 0) continue;
          const nx = x + dx;
          const nz = z + dz;
          const obstacle = !grid.inBounds(nx, nz) || !grid.baseWalkable(grid.index(nx, nz));
          if (!obstacle) continue;
          const distanceX = dx === 0 ? 0 : (2 * Math.abs(dx) - 1) * cellSize;
          const distanceZ = dz === 0 ? 0 : (2 * Math.abs(dz) - 1) * cellSize;
          if (distanceX * distanceX + distanceZ * distanceZ < limit) {
            open = 0;
            break;
          }
        }
      }
      mask[index] = open;
    }
  }
  return mask;
}
