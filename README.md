# Marchlands

3D 多图领地争夺，Three.js 客户端 + 确定性 TypeScript 模拟核心。

- 开发合同：docs/Marchlands-开发指南.md
- 页面流程：docs/page-flow.md
- 渲染决策：docs/adr/0001-renderer.md
- 模拟核心：packages/sim
- 地图与规则：packages/content
- 地图编辑器数据层：packages/map-authoring
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
- 地图编辑器：图结构草稿、拖放城镇/粮仓/驻兵点、连路、属性编辑、撤销、实时校验、试玩、保存/载入、自定义地图进入简报并持久化。
- 客户端：八个页面、四向镜头、大地图拖动、选中、派兵、升级、AI、音效、设置持久化、行军路线叠加与改道。
- 表现：Kenney CC0 模型（城堡塔楼、木石城墙、屋顶、树木、岩石、道具）、程序化地面与瓦片纹理、石板路网与中央环岛、Q 版三兵单位、八类建筑模型、战斗飘字、程序化音效。
- HUD：资源卡、等级刻度、人口条、城镇归属色条。
- 美术许可：ASSETS.md。
- PC：Electron 打包，启动、菜单、开局 smoke 通过。
- 高低差：`?scene=height`，0 m 谷地、26.6° 坡道、3 m 高台与高台城，四向可见。
- 未做：美术替换、10 人试玩、正式验收。

## 测试

- `packages/sim`：64 项单测与属性测试。
- `packages/content`：22 项地图与规则校验。
- `packages/map-authoring`：10 项草稿、编译、叶子据点与自定义地图测试。
- `tools/harness`：100 局 AI 自对弈、回放一致性、crossroads01 自对弈。
- `tests/e2e`：页面流程、派兵占领、编辑器建图与试玩返回、暂停恢复、重开确认、设置持久化、新地图选择、时间上限结算、高低差场景。