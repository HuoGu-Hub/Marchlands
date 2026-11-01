# Marchlands

3D 单图领地争夺，Three.js 客户端 + 确定性 TypeScript 模拟核心。

- 开发合同：docs/Marchlands-开发指南.md
- 页面流程：docs/page-flow.md
- 渲染决策：docs/adr/0001-renderer.md
- 模拟核心：packages/sim
- 地图与规则：packages/content
- 客户端：apps/client
- 自对弈与回放：tools/harness

## 命令

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm validate:content
pnpm sim:forest01
pnpm --filter @marchlands/client dev
pnpm test:e2e
```

客户端默认 `http://127.0.0.1:5188`。开发模式下 `?speed=20` 可加速模拟，便于走完 15 分钟结算；`?scene=height` 打开高低差测试场景。

## Windows 客户端

```bash
pnpm --filter @marchlands/client build
pnpm --filter @marchlands/client package:win
release/Marchlands-win32-x64/Marchlands.exe
```

本机若设置了 `ELECTRON_RUN_AS_NODE=1`，启动 Electron 前先清除该变量。

## 当前状态

- 模拟：派兵、升级、战斗、占领、金币、人口、胜负、时间上限、状态哈希。
- 内容：forest01 七城十二边，rules/1 与 sim 默认规则一致。
- 客户端：八个页面、四向镜头、选中、派兵、升级、AI、音效、设置持久化。
- 表现：Kenney CC0 模型（城堡塔楼、木石城墙、屋顶、树木、岩石、道具）、程序化地面与瓦片纹理、石板路网与中央环岛、三兵单位、战斗飘字、程序化音效。
- HUD：资源卡、等级刻度、人口条、城镇归属色条。
- 美术许可：ASSETS.md。
- PC：Electron 打包，启动、菜单、开局 smoke 通过。
- 高低差：`?scene=height`，0 m 谷地、26.6° 坡道、3 m 高台与高台城，四向可见。
- 未做：美术替换、10 人试玩、正式验收。

## 测试

- `packages/sim`：33 项单测与属性测试。
- `tools/harness`：100 局 AI 自对弈与回放一致性。
- `tests/e2e`：页面流程、派兵占领、暂停恢复、重开确认、设置持久化、时间上限结算、高低差场景。