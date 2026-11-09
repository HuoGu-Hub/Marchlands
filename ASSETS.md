# 美术资源与许可

本轮使用的外部资源全部为 CC0 1.0，可商用、可修改、无需署名。

## Kenney

- Fantasy Town Kit
- Castle Kit
- Nature Kit 2.1

来源：https://kenney.nl/assets
镜像：https://github.com/ETdoFresh/kenney.nl
许可：CC0 1.0 Universal

使用的模型已复制到 `apps/client/src/assets/kenney/`：

- castle：塔基、塔身、塔顶、城墙、门、旗帜、楼梯、立柱
- town：木墙、石墙、门、窗、屋顶、栅栏、树、岩石、喷泉、推车、摊位、灯笼、道路
- nature：松树、橡树、灌木、草、花、蘑菇、岩石

程序化生成的内容：地面纹理、白灰墙与木梁、屋顶瓦片、石板、旗帜与单位、UI。

## 署名（CC BY）

以下素材来自 Sketchfab，许可为 CC BY 4.0，游戏内「设置 → 素材署名」保留作者与来源：

- Low Poly FireBall，作者 Dzénetan Massart，用作法师法术弹
- Free Stone Mage Tower，作者 GameAssetsFin，用作法师塔

## 据点建筑

四个产兵建筑换成 Quaternius Ultimate Fantasy RTS 的模型，CC0；法师塔单独使用 Sketchfab 模型：

| 据点 | 源模型 |
| --- | --- |
| 野蛮人营地 | Barracks_FirstAge_Level1-3 |
| 精锐战士营 | Barracks_SecondAge_Level1-3 |
| 弓箭手营 | Archery_FirstAge_Level1-3 |
| 游侠营地 | Archery_SecondAge_Level1-3 |

转换脚本见 `tools/asset-convert/rts-buildings.mjs`：屋顶材质 `Main` 改名 `team_roof` 参与阵营染色，整体缩放成正比、原点居中、底面贴地，输出到 `apps/client/src/assets/converted/buildings/`。

法师塔使用 Sketchfab 的 Stone Mage Tower，只有一张模型，`converted/buildings/mage.glb`，也是唯一模型。法师塔固定 L1、不可升级，因此不再生成 L1/L2/L3 三份模型。水晶材质改名 `team_roof` 参与阵营染色；塔顶按规则向射程内最近的敌方兵团发射火球。

## 战斗表现

- 箭矢：KayKit Adventurers 包内的 `arrow`，CC0，转成 `apps/client/src/assets/fx/arrow.glb`。
- 法术投射物：Kenney Particle Pack 1.1 的 `magic_04.png`，CC0，放在 `apps/client/public/fx/`，同目录保留 License。

两者只在客户端播放，不参与模拟判定。

## 单位动作

单位模型与动作由仓库内代码生成，随项目许可发布，不引入外部授权素材：

- 近战武器握在右手，手臂旋转带动刀身，攻击剪辑因此有真实的挥砍弧线。
- 单位 GLB 固定导出四个剪辑：`idle`、`walk`、`attack`、`death`。
- 运行时：抵达敌方据点结算战斗时播放一次 `attack`，随后销毁该部队。
- 重新生成资产包：`pnpm --filter @marchlands/client dev` 后执行 `node tools/asset-convert/run.mjs`。

## 未采用：Unity Asset Store

Asset Store 资源含免费包受 Standard Unity Asset Store EULA 限制，只授权用于 Unity 构建的产品。Marchlands 是 Three.js + Electron 产品，且 `.mlpack` 允许玩家解压，两条都不满足，因此不引入，包括 Human Melee Animations FREE。

需要现成动作时优先取 CC0 或明确允许非 Unity 引擎的来源：

- KayKit Character Pack: Adventurers，CC0，glTF 骨骼动画，含 Idle / Walk / Run / Attack / Death
- Quaternius Ultimate Animated Character Pack，CC0
- Kenney Animated Characters，CC0

## 未使用

Quaternius Medieval Village MegaKit 仅用于视觉参考，模型未引入。
