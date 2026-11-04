import { createGame } from "@marchlands/sim";
import { art } from "./assets";
import { assetRegistry } from "./asset-registry";
import { preloadGroundMaterial } from "./ground-material";
import { mapEntry } from "./map-catalog";
import { BattleScene } from "./scene";

/**
 * 关卡预览页：把整张地图渲染成一帧，供脚本截图生成关卡封面。
 * 用法：/?scene=map-preview&map=frontier01
 */
export async function runMapPreview(host: HTMLElement, mapId: string): Promise<void> {
  const entry = mapEntry(mapId);
  if (!entry) throw new Error(`unknown map: ${mapId}`);
  document.body.classList.add("preview-mode");
  const canvas = document.createElement("canvas");
  canvas.id = "preview-canvas";
  host.append(canvas);

  await art.load();
  await preloadGroundMaterial(entry.visual.terrain.material);
  assetRegistry.registerBuiltins();

  const scene = new BattleScene(canvas, entry.map, entry.visual, {});
  const state = createGame(entry.map, 7, entry.rules);
  scene.frameWholeMap(40, 0.98);
  scene.update(state, 0);

  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  requestAnimationFrame(() => {
    scene.update(state, 16);
    requestAnimationFrame(() => {
      window.__mlPreviewReady = true;
    });
  });
}
