import type { MapDef } from "@marchlands/sim";
import { isProductionSiteKind } from "@marchlands/sim";

const WIDTH = 1600;
const HEIGHT = 900;
const PAD_X = 90;
const PAD_TOP = 70;
const PAD_BOTTOM = 140;
const OWNER_FILL: Record<number, string> = {
  0: "#b3ab97",
  1: "#57b57a",
  2: "#d0664a",
};
const KIND_RING: Record<string, string> = {
  granary: "#e8c883",
  outpost: "#8d8778",
};

/** 为自制地图画一张战术示意图，用作关卡卡片与全屏预览。 */
export function mapSketch(map: MapDef): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx || map.cities.length === 0) return "";

  const background = ctx.createRadialGradient(WIDTH * 0.5, HEIGHT * 0.42, 80, WIDTH * 0.5, HEIGHT * 0.5, WIDTH * 0.72);
  background.addColorStop(0, "#142016");
  background.addColorStop(0.6, "#0c130e");
  background.addColorStop(1, "#080c09");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const halfW = Math.max(1, map.size[0] / 2);
  const halfH = Math.max(1, map.size[1] / 2);
  const scale = Math.min(
    (WIDTH - PAD_X * 2) / (halfW * 2),
    (HEIGHT - PAD_TOP - PAD_BOTTOM) / (halfH * 2),
  );
  const plateW = halfW * 2 * scale;
  const plateH = halfH * 2 * scale;
  const plateX = (WIDTH - plateW) / 2;
  const plateY = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM - plateH) / 2;
  const toX = (value: number) => plateX + plateW / 2 + value * scale;
  const toY = (value: number) => plateY + plateH / 2 + value * scale;

  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, 10);
  const plate = ctx.createLinearGradient(plateX, plateY, plateX + plateW, plateY + plateH);
  plate.addColorStop(0, "#132016");
  plate.addColorStop(1, "#0b120d");
  ctx.fillStyle = plate;
  ctx.fill();
  ctx.strokeStyle = "rgba(214, 178, 106, 0.2)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(plateX, plateY, plateW, plateH, 10);
  ctx.clip();
  ctx.strokeStyle = "rgba(214, 178, 106, 0.07)";
  ctx.lineWidth = 1;
  const step = scale * 100;
  for (let x = toX(-halfW); x <= toX(halfW) + 0.5; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, plateY);
    ctx.lineTo(x, plateY + plateH);
    ctx.stroke();
  }
  for (let y = toY(-halfH); y <= toY(halfH) + 0.5; y += step) {
    ctx.beginPath();
    ctx.moveTo(plateX, y);
    ctx.lineTo(plateX + plateW, y);
    ctx.stroke();
  }
  ctx.restore();

  const positions = new Map<string, [number, number]>();
  for (const city of map.cities) positions.set(city.id, city.pos);

  ctx.strokeStyle = "rgba(214, 178, 106, 0.34)";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (const edge of map.edges) {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) continue;
    ctx.beginPath();
    ctx.moveTo(toX(from[0]), toY(from[1]));
    ctx.lineTo(toX(to[0]), toY(to[1]));
    ctx.stroke();
  }

  for (const city of map.cities) {
    const x = toX(city.pos[0]);
    const y = toY(city.pos[1]);
    const production = isProductionSiteKind(city.kind);
    const radius = production ? 10 : 6;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(6, 10, 7, 0.72)";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = OWNER_FILL[city.owner] ?? OWNER_FILL[0];
    ctx.fill();
    ctx.strokeStyle = KIND_RING[city.kind] ?? "rgba(10, 15, 11, 0.9)";
    ctx.lineWidth = production ? 3 : 2;
    ctx.stroke();
  }

  ctx.font = '500 15px "Segoe UI", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = "middle";
  for (const city of map.cities) {
    ctx.fillStyle = "rgba(236, 230, 214, 0.62)";
    ctx.fillText(city.id, toX(city.pos[0]) + 16, toY(city.pos[1]) - 12);
  }

  ctx.strokeStyle = "rgba(214, 178, 106, 0.5)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(72, HEIGHT - 104);
  ctx.lineTo(140, HEIGHT - 104);
  ctx.stroke();
  ctx.fillStyle = "#d6b26a";
  ctx.font = '500 34px Georgia, "Songti SC", serif';
  ctx.fillText(map.name || map.slug, 72, HEIGHT - 66);

  return canvas.toDataURL("image/jpeg", 0.84);
}
