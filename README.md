# Marchlands

3D 多图领地争夺，Three.js 客户端 + 确定性 TypeScript 模拟核心。

- 开发合同：docs/Marchlands-开发指南.md
- 页面流程：docs/page-flow.md
- 渲染决策：docs/adr/0001-renderer.md
- 模拟核心：packages/sim
- 地图与规则：packages/content
- 地图编辑器数据层：packages/map-authoring
- 网格导航核心：packages/nav
- 资产包格式与校验：packages/asset-pack
- 资产包说明：docs/Marchlands-资产包.md
- 地形高度与寻路：docs/Marchlands-地形高度与寻路.md
- 网格导航与地形编辑：docs/Marchlands-网格导航.md
- 模型转换：tools/asset-convert
- 客户端：apps/client
- 自对弈与回放：tools/harness

## 命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm validate:content
pnpm build:crossroads01
pnpm sim:forest01
pnpm --filter @marchlands/client dev
pnpm test:e2e
```

客户端默认 `http://127.0.0.1:5188`。开发模式下 `?speed=20` 可加速模拟，便于走完 15 分钟结算；`?map=crossroads01` 打开第二张 20 据点地图；`?scene=height` 打开高低差测试场景。

## Windows 客户端

```bash
pnpm --filter @marchlands/client build
pnpm --filter @marchlands/client package:win
release/Marchlands-win32-x64/Marchlands.exe
```

本机若设置了 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 前先清除该变量。

## 当前状态

- 模拟：派兵、升级、战斗、占领、金币、人口、胜负、时间上限、状态哈希、粮仓增幅、临时驻兵点、行军改道、兵团粮草。
- 内容：forest01、crossroads01、frontier01 三张官方图；rules/1 与 sim 默认规则一致。
- 地图编辑器：图结构草稿、拖放城镇/粮仓/驻兵点、连路、属性编辑、撤销、实时校验、试玩、保存/载入、自定义地图进入简报并持久化。地形风格、程序化地形块、树木/岩石/城镇装饰、建筑外观、自由摆放、导入 .mlpack 资产包、导出内置 GLB 资产包与地基模型槽位已接入；地图视觉不影响模拟。网格图支持新建或从据点图转换，抬高/降低/平滑/坡道/悬崖/水面/地表/阻挡/可走刷、导航预览与路径测试。道路可拖动绘制，选中后拖动控制点改形状，双击线段加点、右键删点，宽度逐路固定；支持不接据点的自由端点道路；新增据点不会自动连路。
- 客户端：八个页面、四向镜头、大地图拖动、选中、派兵、升级、AI、音效、设置持久化、行军路线叠加与改道。
- 表现：Kenney CC0 模型（城堡塔楼、木石城墙、屋顶、树木、岩石、道具）、程序化地面与瓦片纹理、石板路网与中央环岛、Q 版三兵单位、八类建筑模型、战斗飘字、程序化音效。地图视觉层支持地形风格、程序化草丘/岩脊/台地/池塘/农田/树林/废墟/营地、装饰自由摆放与资产包模型。
- 建筑运行时：程序化建筑、15 种城镇组合、城墙、塔楼、粮仓已导出 GLB 并由资产注册表加载；队伍色通过 `team_roof/team_edge/team_cloth` 材质角色在运行时染色。
- 单位资产：地图可为绿方/红方指定 GLB 单位；支持骨骼动画与命名节点动画，优先播放 `walk`/`idle` 剪辑，缺失时回退程序化单位。
- 地形高度：城市、道路、装饰、兵团贴地；道路随地形起伏；编辑器点击射线命中地形网格。
- 坡度寻路：地图编译时采样每条边的爬升写入 `grade`，Dijkstra 与 ETA 使用 `length × (1 + grade × 3)` 的代价，平地路线优先。
- 网格导航：新增 `packages/nav`，1 米网格、整数厘米坐标与代价、8 方向 A*、禁止贴角、坡度/台阶判定、单位半径膨胀、路径平滑与缓存；8800 格单次寻路基准约 1.5 ms。
- 网格地图数据：`MapDocument` v3、`MapDef` v2，烘焙高度、地表、阻挡与可走覆盖位图、地图内容哈希、schema 2 自动升级；网格图可编译、校验并载入模拟，旧三图继续按据点图运行。
- 网格地形编辑：客户端按地图中心偏移采样网格高度与地表颜色，编辑器提供地形笔刷、导航预览和 A* 路径测试。
- 编辑器性能：道路、装饰、地形与据点只重建对应图层，地形更新复用岛屿边缘与天空氛围；装饰改为差异更新；网格可达性校验延迟 300 ms；道路控制点提交约 23 ms，地形笔刷约 27 ms，装饰放置约 40–68 ms，据点新增约 35 ms。
- 网格移动：网格图兵团连续移动、占领、粮草、AI 寻路、驻兵点区域拦截与遭遇战；据点图地图继续使用原有边移动。
- 模型格式：城堡 17 个 OBJ 已转 GLB 并切换运行时；建筑、城墙、城镇、单位、地形与 Kenney 资源已生成 118 个 GLB 的统一转换包，见 release/Marchlands-models-converted.mlpack。
- HUD：资源卡、等级刻度、人口条、城镇归属色条。
- 美术许可：ASSETS.md。
- PC：Electron 打包，启动、菜单、开局 smoke 通过。
- 高低差：`?scene=height`，0 m 谷地、26.6° 坡道、3 m 高台与高台城，四向可见。
- 未做：官方图迁移、战争迷雾、10 人试玩、正式验收。

## 测试

- `packages/sim`：73 项单测与属性测试。
- `packages/content`：28 项地图与规则校验。
- `packages/asset-pack`：6 项资产包格式与转换包测试。
- `packages/map-authoring`：35 项草稿、编译、网格数据、笔刷、道路、桥梁、可达性、叶子据点与自定义地图测试。
- `packages/nav`：21 项 A* 正确性、确定性、坡度、台阶、膨胀阻挡、平滑、打包与 8800 格基准。
- `packages/harness`：5 项 100 局 AI 自对弈、回放一致性、crossroads01 自对弈。
- `tools/map-export`：2 项官方图导出测试。
- `tests/e2e`：页面流程、派兵占领、编辑器建图与试玩返回、网格图刷地形/导航预览/路径测试/试玩、道路绘制与拖动改形、自由端点道路、暂停恢复、重开确认、设置持久化、新地图选择、时间上限结算、高低差场景。