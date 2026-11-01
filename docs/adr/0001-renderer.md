# ADR 0001：渲染层从 Cocos Creator 改为 Three.js + Electron

日期：2026-11-01
状态：已采纳

## 背景

原方案选 Cocos Creator 3.8，目标是 Windows x64 原生构建。实际排期时发现两个阻塞：

1. Cocos 场景必须由编辑器创建并序列化，.scene 依赖压缩 UUID、.meta 与编辑器生成的 settings。没有编辑器交互就无法稳定产出场景，后续每个节点都要人工点。
2. 原生 Windows 构建依赖 Visual Studio、CMake 与 Cocos 原生模板，当前机器未验证；代理无法在无人值守下完成构建与截图验证。

模拟核心是纯 TypeScript，与引擎无关。阻塞只在渲染与外壳。

## 决策

- 渲染改用 Three.js，Vite 构建，浏览器内运行。
- PC 客户端用 Electron 包装，保留 Windows 可执行文件形态。
- 页面用 DOM + CSS，不引入 React；状态与路由自己管。
- packages/sim 与 packages/content 不改，继续被客户端、harness、未来 Agent 共用。

## 后果

- 可以在无编辑器的情况下生成场景、运行、截图、做 Playwright 端到端。
- 需要自己做相机控制、拾取、阴影与 UI，Three.js 生态可直接补。
- Electron 包体比原生大，约 100 MB 量级；M1 可接受。
- 放弃 Cocos 的编辑器资产管线；美术导入改为 glTF。
- 如果之后必须回 Cocos，只需重写 apps/client 的渲染与页面层，sim、content、harness、协议不变。

## 不变

- 3D、正交四向镜头、60×60 m 沙盘、1280×720 与 1920×1080。
- 20 Hz 固定步长、状态哈希、回放。
- 禁止在 sim 里 import 渲染或平台 API。
