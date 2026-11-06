export interface LevelDef {
  mapId: string;
  title: string;
  blurb: string;
}

export interface SeriesDef {
  id: string;
  /** 系列在战役中的序号，例如“第一章”。 */
  chapter: string;
  title: string;
  levels: LevelDef[];
}

export const CAMPAIGN: SeriesDef[] = [
  {
    id: "frontier",
    chapter: "第一章",
    title: "边境线",
    levels: [
      {
        mapId: "highland01",
        title: "岩脊高地",
        blurb:
          "二十六座产兵据点散落在起伏的岩台上，台地边缘是爬不上去的岩壁，只有坡道能上。抢占台顶就能俯瞰整片谷地。",
      },
      {
        mapId: "frontier01",
        title: "边境线",
        blurb:
          "三十六座产兵据点铺成一张大边地图。道路被中立据点截断时，兵团不能借道；先拿下挡路的城，或者找绕城的连续道路。",
      },
    ],
  },
  {
    id: "north",
    chapter: "第二章",
    title: "北境",
    levels: [
      {
        mapId: "autumnvale01",
        title: "Autumn Vale 01",
        blurb: "秋色谷地：落叶林里藏着三十座据点，土路沿着缓坡绕行，粮仓卡在谷口要道上。",
      },
      {
        mapId: "snowpass01",
        title: "Snow Pass 01",
        blurb: "雪岭关隘：积雪覆盖的山道层层设防，翻过垭口才算进入对方腹地。",
      },
    ],
  },
];

export function previewUrl(mapId: string): string {
  return `${import.meta.env.BASE_URL}previews/${mapId}.jpg`;
}

export function findLevel(mapId: string): { series: SeriesDef; level: LevelDef } | null {
  for (const series of CAMPAIGN) {
    const level = series.levels.find((entry) => entry.mapId === mapId);
    if (level) return { series, level };
  }
  return null;
}

export function defaultLevelId(): string {
  return CAMPAIGN[0].levels[0].mapId;
}
