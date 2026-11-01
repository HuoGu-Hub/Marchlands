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

客户端默认 `http://127.0.0.1:5188`。开发模式下 `?speed=20` 可加速模拟，便于走完 15 分钟结算。

## 当前状态

- 模拟：派兵、升级、战斗、占领、金币、人口、胜负、时间上限、状态哈希。
- 内容：forest01 七城十二边，rules/1 与 sim 默认规则一致。
- 客户端：启动、主菜单、简报、对局、暂停、结算、设置、退出确认；四向镜头、选中、派兵、升级、AI。
- 未做：高低差测试场景、Electron 打包、音频、美术替换。

## 测试

- `packages/sim`：33 项单测与属性测试。
- `tools/harness`：100 局 AI 自对弈与回放一致性。
- `tests/e2e`：Playwright 页面流程、派兵占领、暂停恢复、重开确认、设置持久化、时间上限结算。
