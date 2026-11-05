export interface CreditEntry {
  /** 素材包名。 */
  name: string;
  author: string;
  license: "CC0" | "CC BY 4.0";
  url: string;
  /** 用在哪里，给玩家看的短说明。 */
  usage: string;
}

/** 设置页署名列表；CC-BY 条目必须保留作者和来源链接。 */
export const CREDITS: CreditEntry[] = [
  {
    name: "Fantasy Town Kit / Castle Kit / Nature Kit",
    author: "Kenney",
    license: "CC0",
    url: "https://kenney.nl/assets",
    usage: "场景建筑与植被",
  },
  {
    name: "Particle Pack 1.1",
    author: "Kenney",
    license: "CC0",
    url: "https://kenney.nl/assets/particle-pack",
    usage: "法术投射物光效",
  },
  {
    name: "Character Pack: Adventurers",
    author: "KayKit",
    license: "CC0",
    url: "https://kaylousberg.com",
    usage: "兵种模型与动作",
  },
  {
    name: "Medieval Builder Pack",
    author: "KayKit",
    license: "CC0",
    url: "https://kaylousberg.com",
    usage: "建筑部件",
  },
  {
    name: "Ultimate Animated Animals",
    author: "Quaternius",
    license: "CC0",
    url: "https://quaternius.com",
    usage: "战马",
  },
  {
    name: "Ultimate Fantasy RTS",
    author: "Quaternius",
    license: "CC0",
    url: "https://quaternius.com",
    usage: "产兵建筑",
  },
  {
    name: "Low Poly FireBall",
    author: "Dzénetan Massart",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/low-poly-fireball-boule-de-feu-en-low-poly-b722efe7ec084dafbe41427714dc5711",
    usage: "法师法术弹",
  },
  {
    name: "Free Stone Mage Tower",
    author: "GameAssetsFin",
    license: "CC BY 4.0",
    url: "https://sketchfab.com/3d-models/free-stone-mage-tower-c5cb72c0bf994317912d45d2b61f7aa6",
    usage: "法师塔",
  },
];
