# Marchlands 开发指南

**版本** v0.1  
**日期** 2026-11-01  
**当前里程碑** M1 首图单机一局  
**适用对象** 参与本项目的 Agent 与人类开发者

本文件是当前开发的执行合同。它规定做什么、按什么规则做、做到什么程度算完成。  
背景、取舍和完整路线在 [开发方案](../plans/Marchlands-开发方案.html)；两者冲突时，以本文件为准，并先更新本文件。

---

## 0. 开始前先读这三条

1. **只做 M1。** 当前只做一张图、单机一局、完整页面。Agent、服务器、法术、塔、城堡、新机制都不做。
2. **不复制原作资产与关卡。** .work/original 只读，用于理解规则和节奏；不把原作 PNG、OGG、文本、坐标或节点直接放进项目。
3. **模拟核心保持纯净。** packages/sim 不得 import Cocos、DOM、Node API；不得使用 Math.random、Date.now；所有随机来自种子。

**当前下一步** 建仓库骨架；先落 forest01.json、rules/1.json 和页面流程图，不写 3D 美术。

如果任务超出“做与不做”清单，先停下，向用户确认，不要自行扩张。

### 0.1 工作方式

- 每次只做一个里程碑子项，完成后再开下一个。
- 先改本文件的契约，再改代码；不要默默改规则。
- 每完成一项，更新第 15 节的勾选状态。
- 不把 .work 加入版本库，不把原作资源放进构建。
- 如果初始化 git，按模块提交，提交信息用中文；不要提交 .work、build、library、temp。
- 遇到阻塞，记录在 docs/blockers.md，写清楚复现、影响和需要的决定。

---

## 1. M1 完成定义

M1 完成 = 以下全部成立：

- 从主菜单开始 forest01，1 人类 + 1 AI，7 座城，能完整打完一局。
- 能赢、能输、能重开、能回主菜单、能退出。
- 所有页面可走通：启动、主菜单、简报、对局、暂停、结算、设置、退出确认。
- 1280×720 与 1920×1080 下页面不重叠、不缺字、没有无响应按钮。
- 目标机器 1080p 60 帧；加载 forest01 不超过 5 秒。
- Node 与 PC 客户端对同一指令流得到相同状态哈希。
- 3 节点高低差测试场景能跑：单位上下坡、四向可见、城市不悬空。
- 10 名外部玩家能自行完成一局；0 个 P0/P1 缺陷。

不满足以上任何一条，M1 不算完成。

---

## 2. 本轮范围

### 2.1 做

- 1 张图：forest01。7 城，2 玩家，5 中立城，所有 layer 0。
- 1 人类 + 1 AI；2 个玩家。
- 城镇与中立城；派兵、行军、战斗、占领、升级。
- 人口增长、金币收入与 HUD 显示；不做金币消费。
- 胜负：占满 7 城或消灭 AI；15 分钟硬上限，按城市数、人口判定。
- 3D 地形、四向镜头、单位、选中与派兵交互。
- 完整页面流程与设置。
- 设置持久化、重开、结算统计；不做对局中途存档。
- 3 节点高低差测试场景，只验证管线，不作为正式关卡。

### 2.2 不做

- 不做第二张图、不做 5 图、不做 15 图。
- 不做塔、城堡、铁匠铺、马厩、法术、市场、高地战斗加成。
- 不做 Agent、MCP、HTTP、在线榜单、账号、服务器。
- 不做人类 PvP、地图工坊、移动端、全程配音、第二生态。
- 不做自由 360° 镜头，不做实时方向光阴影，不做破坏地形。

### 2.3 首图目标

内部代号 forest01。为了规避直接复制原作关卡，正式布局由我们重画：7 城、2 玩家、5 中立，拓扑和节奏接近，坐标与节点不复用。

**首图初始数据**

不要写脚本把原作 st1_forest01.txt 直接转成 forest01.json。下表是重画后的目标数据，坐标、节点、边都不沿用原作。

坐标单位：分米。地图 600 × 600 dm，即 60 × 60 m。

| 城市 | 归属 | 等级 | 初始人口 | 人口上限 | 坐标 x,z | 类型 |
|---|---|---|---|---|---|---|
| c1 | p1 | 3 | 30 | 65 | -220, 0 | 城镇 |
| c2 | p2 | 2 | 20 | 45 | 220, 0 | 城镇 |
| c3 | 中立 | 2 | 20 | 45 | 0, 0 | 城镇 |
| c4 | 中立 | 1 | 10 | 30 | -120, 120 | 城镇 |
| c5 | 中立 | 1 | 10 | 30 | 120, 120 | 城镇 |
| c6 | 中立 | 1 | 10 | 30 | -120, -120 | 城镇 |
| c7 | 中立 | 1 | 10 | 30 | 120, -120 | 城镇 |

**首图拓扑**

7 个城市节点，12 条无向边。首版直接连接，不加 waypoint；第二阶段再加路径点。

~~~text
c1 - c4
c1 - c6
c1 - c3
c2 - c5
c2 - c7
c2 - c3
c4 - c5
c6 - c7
c4 - c3
c5 - c3
c6 - c3
c7 - c3
~~~

**首图规则**

- 所有城市 layer 0，高度 0 m。
- p1 从 c1 出发，p2 从 c2 出发。
- 中立城被占领后归占领者，等级保留，人口为战斗剩余。
- 首图没有法术、没有特殊建筑、没有金币消费。

### 2.4 页面目标

| 页面 | 必须有的元素 | 去向 |
|---|---|---|
| 启动 | Logo、加载条、版本号；加载失败显示错误与重试 | 主菜单 |
| 主菜单 | 开始游戏、设置、退出 | 简报、设置、退出确认 |
| 简报 | 标题、三行目标、开始、返回 | 对局、主菜单 |
| 对局 | HUD、选中城信息、人口、城市数、金币、计时、暂停 | 暂停、结算 |
| 暂停 | 继续、重开、返回主菜单；重开要确认 | 对局、对局、主菜单 |
| 结算 | 胜利/失败、统计、重玩、主菜单 | 对局、主菜单 |
| 设置 | 分辨率、窗口模式、主音量、语言占位、保存、返回 | 主菜单 |
| 退出确认 | 取消、退出 | 主菜单、桌面 |

“页面正常”的验收路径：

~~~text
启动 -> 主菜单 -> 简报 -> 对局 -> 暂停 -> 继续 -> 结算 -> 重玩 -> 对局 -> 暂停 -> 主菜单 -> 设置 -> 返回 -> 退出确认 -> 取消 -> 主菜单
~~~

每一步都要能到，不重叠、不缺字、没有无响应按钮。ESC 键在暂停、设置、退出确认里行为一致。

---

## 3. 里程碑与闸门

| 里程碑 | 周 | 交付 | 通过标准 |
|---|---|---|---|
| M1.1 数据与页面图 | 1 | forest01 JSON、页面流程图、3D 镜头 spike | 7 城数据可加载；目标机 60 帧 |
| M1.2 模拟核心 | 2 | 城镇、派兵、战斗、升级、胜负、状态哈希 | Node + Chrome 5 分钟对局哈希一致 |
| M1.3 3D 灰盒 | 3 | 地形、四向镜头、7 城、单位、选中与派兵 | forest01 灰盒可玩；四向截图 |
| M1.4 AI 与胜负 | 4 | 1 档 AI、胜负、HUD、计时、暂停、高低差测试 | AI 能结束一局；测试场景能上下坡 |
| M1.5 页面 | 5 | 主菜单、简报、暂停、结算、设置、退出 | 全路径可走；无断头路 |
| M1.6 美术与音频 | 6 | 森林地形、城镇 3 级、2 阵营、单位、UI、占位音 | 四向无穿模；UI 不重叠 |
| M1.7 试玩与修复 | 7 | 10 人试玩、性能、bugfix | P0/P1 清零；60 帧 |
| M1.8 验收 | 8 | 录屏、验收报告、Go/No-Go | 第 1 节全部成立 |

**闸门 G1**：第 8 周。G1 不过，不开第二张图，不加 Agent，不做服务器。

---

## 4. 技术栈与仓库

- 渲染：Three.js；PC 外壳：Electron；TypeScript。
- 选择原因见 docs/adr/0001-renderer.md；模拟核心与渲染完全解耦。
- 包管理：pnpm + Turborepo。
- 测试：Vitest、fast-check、Playwright。
- 首轮不引入后端、数据库、Redis、Docker。

**目标仓库结构**

~~~text
marchlands/
  apps/
    client/                 Three.js + Vite 客户端
  packages/
    sim/                    确定性模拟核心
    content/                地图、规则、文本
  tools/
    map-export/             干净房间数据导出与校验
  docs/
    Marchlands-开发指南.md
  plans/
    Marchlands-开发方案.html
  tests/
    e2e/                    Playwright 页面流程
~~~

**模块边界**

- apps/client 可以 import packages/sim 与 packages/content。
- packages/sim 只能 import packages/sim 内部文件与纯 TS 工具。
- packages/sim 不得 import Cocos、DOM、Node、fs、path、process。
- packages/content 只放数据与数据校验，不放游戏逻辑。
- tools/map-export 可以读 .work/original 做参考，但输出必须是重画后的数据，不得包含原作资源。

**建议文件**

~~~text
packages/sim/src/
  types.ts        状态、指令、事件类型
  game.ts         createGame / step / finish
  path.ts         图、最短路径、ETA
  combat.ts       战斗结算
  economy.ts      人口、金币、升级
  ai.ts           一档 AI
  hash.ts         状态序列化与哈希
  index.ts        导出

packages/content/maps/
  forest01.json

packages/content/rules/
  1.json

tools/map-export/
  build-forest01.ts
  validate-map.ts
~~~

---

## 5. 核心规则

### 5.1 时间、坐标、单位

- 模拟 20 Hz，1 tick = 50 ms。
- 首图坐标单位：分米。地图 600 × 600 dm，即 60 × 60 m。
- 渲染比例：1 dm = 0.1 m。渲染层把模拟坐标除以 10。
- 移动速度：60 dm/s = 3 dm/tick。
- 所有位置、人口、金币在模拟里用整数；人口增长与金币用“千分位余数”累积。
- 1 人口 = 1 个整数单位；内部增长用 milli-pop，1000 milli = 1 pop。
- 1 金币 = 1 个整数单位；内部收入用 milli-gold，1000 milli = 1 gold。

### 5.2 人口、金币、升级

**人口上限与升级**

| 等级 | 人口上限 | 升级消耗 | 防御系数 |
|---|---|---|---|
| 1 | 30 | 15 | 1.00 |
| 2 | 45 | 22 | 1.10 |
| 3 | 65 | 32 | 1.20 |

- 升级消耗 = 当前等级人口上限的 50%，向下取整。
- 升级条件：等级 < 3，当前人口 >= 升级消耗。
- 升级后：扣除人口、等级 +1、人口上限取新等级表、防御系数取新表。
- 首图最高 3 级。

**人口增长**

- 每秒增长：1.0 + 0.25 × (等级 - 1) pop/s。
- 每 tick 增长：50 / 62 / 75 milli-pop，对应等级 1/2/3。
- 到达人口上限停止增长。
- 被攻击后人口下降，增长继续。

**金币**

- 每座己方城按自身等级产生收入，累加到该玩家金币。
- 每 tick 收入：100 / 125 / 150 milli-gold，对应等级 1/2/3。
- 首轮只累计与显示，不消费。

### 5.3 派兵、寻路、战斗

**派兵**

- 指令只允许从己方城出发。
- 目标可以是己方城、敌方城、中立城。
- 派出数量 = floor(当前人口 × 50%)，最少 1。
- 当前人口 < 2 时拒绝派兵。
- 出发时立即扣除人口；到达前城市可继续增长。
- 同一城市可以同时派出多支队伍。

**寻路**

- 图是无向图；边权为两点距离。
- 用 Dijkstra 找最短路径；节点数 7，直接缓存 path。
- 路径总长度换算成 ETA ticks：ceil(distance / 3)。
- 队伍沿路径匀速移动；到达目标城后结算。
- 同 tick 到达的多支队伍按 squadId 升序结算。

**战斗**

~~~text
A = 进攻方兵力
D = floor(守方人口 × 守方防御系数)

if A > D:
    占领
    新城主 = 进攻方
    新城人口 = A - D，且不超过人口上限
else:
    守方保留
    守方人口 = min(原人口, max(0, D - A))
~~~

防御系数大于 1 时，D 可能大于原人口；守方人口不能因被攻击而增加。

- 首轮没有塔、没有铁匠铺、没有高地修正。
- 守方是中立城时，防御系数按等级表。
- 若目标在到达前已被同玩家占领，按增援处理：人口相加，封顶人口上限，溢出丢弃。
- 若目标在到达前被其他玩家占领，按敌方城结算。
- 战斗结算发事件，UI 据此播特效与更新数字。

### 5.4 胜负

- 任一玩家拥有全部 7 城，立即胜利。
- 任一玩家城市数为 0，立即失败。
- 到达 18000 tick，即 15 分钟：
  - 城市数多者胜。
  - 城市数相同，总人口多者胜。
  - 再相同，金币多者胜。
  - 仍相同，平局。
- 结算后停止模拟，只允许重开或回主菜单。

### 5.5 AI

一档 AI，不读玩家操作，不用额外资源。每 40 tick，即 2 秒，决策一次：

1. 若某己方城人口 >= 60% 上限，且存在守方防御 < 出兵数的目标，向最近的可攻下目标派兵。
2. 若没有可攻下目标，且人口 >= 80% 上限、等级 < 3，升级。
3. 若人口已到 80% 且仍无必胜目标，向防御不超过出兵数 2 倍的目标派兵，避免人口顶满。
4. 若 600 tick 没有动作，最强城向最近目标派兵，保证对局推进。
5. 不主动放弃城市；不修改资源；不预测玩家指令。

AI 必须能完成：至少一次占领、一次升级、一次进攻；15 分钟内结束一局。

### 5.6 事件

每 tick 生成事件数组，UI 消费后清空。首轮事件：

| 事件 | 字段 | 用途 |
|---|---|---|
| squadSpawned | squadId, from, to, count, arrivalTick | 画队伍、播放出发 |
| squadArrived | squadId, cityId | 到达 |
| combatResolved | cityId, attacker, defender, attackerLoss, defenderLoss, captured | 数字与特效 |
| cityCaptured | cityId, fromOwner, toOwner, pop | 旗色、音效 |
| upgradeCompleted | cityId, level | 升级特效 |
| gameOver | winner, reason | 结算页 |

事件只用于表现与日志，不反向驱动模拟。

---

## 6. 数据契约

### 6.1 地图 JSON

~~~json
{
  "schema": 1,
  "slug": "forest01",
  "name": "Forest 01",
  "biome": "forest",
  "size": [600, 600],
  "scale": 0.1,
  "ruleset": "1",
  "players": [
    {"id": 1, "name": "Player", "color": "green", "ai": false},
    {"id": 2, "name": "AI", "color": "red", "ai": true}
  ],
  "cities": [
    {"id": "c1", "kind": "town", "owner": 1, "level": 3, "pop": 30, "pos": [-220, 0], "layer": 0},
    {"id": "c2", "kind": "town", "owner": 2, "level": 2, "pop": 20, "pos": [220, 0], "layer": 0},
    {"id": "c3", "kind": "town", "owner": 0, "level": 2, "pop": 20, "pos": [0, 0], "layer": 0},
    {"id": "c4", "kind": "town", "owner": 0, "level": 1, "pop": 10, "pos": [-120, 120], "layer": 0},
    {"id": "c5", "kind": "town", "owner": 0, "level": 1, "pop": 10, "pos": [120, 120], "layer": 0},
    {"id": "c6", "kind": "town", "owner": 0, "level": 1, "pop": 10, "pos": [-120, -120], "layer": 0},
    {"id": "c7", "kind": "town", "owner": 0, "level": 1, "pop": 10, "pos": [120, -120], "layer": 0}
  ],
  "edges": [
    {"from": "c1", "to": "c4", "length": 156},
    {"from": "c1", "to": "c6", "length": 156},
    {"from": "c1", "to": "c3", "length": 220},
    {"from": "c2", "to": "c5", "length": 156},
    {"from": "c2", "to": "c7", "length": 156},
    {"from": "c2", "to": "c3", "length": 220},
    {"from": "c4", "to": "c5", "length": 240},
    {"from": "c6", "to": "c7", "length": 240},
    {"from": "c4", "to": "c3", "length": 170},
    {"from": "c5", "to": "c3", "length": 170},
    {"from": "c6", "to": "c3", "length": 170},
    {"from": "c7", "to": "c3", "length": 170}
  ],
  "objectives": [{"type": "capture_all"}, {"type": "time_limit", "ticks": 18000}]
}
~~~

- 地图坐标是分米；渲染除以 10。
- 首图所有 layer 0；字段保留，测试场景可复用。
- 地图数据必须通过 validate-map：7 城、2 玩家、5 中立、图连通、无自环、无重复边、每条边有正整数 length。

### 6.2 状态与指令

~~~ts
export type CityId = string;
export type PlayerId = 1 | 2;

export interface CityState {
  id: CityId;
  owner: 0 | PlayerId;
  level: 1 | 2 | 3;
  pop: number;
  maxPop: number;
  growthCarry: number;
  pos: [number, number];
  layer: number;
}

export interface SquadState {
  id: string;
  owner: PlayerId;
  from: CityId;
  to: CityId;
  count: number;
  path: CityId[];
  departTick: number;
  arrivalTick: number;
}

export interface SimState {
  tick: number;
  seed: number;
  slug: string;
  status: "playing" | "finished";
  winner: 0 | PlayerId;
  finishReason: "capture_all" | "eliminated" | "time_limit" | "draw" | null;
  players: PlayerState[];
  cities: CityState[];
  squads: SquadState[];
  events: SimEvent[];
  rules: Ruleset;
  map: MapDef;
  graph: MapGraph;
  nextSquad: number;
}

export interface CommandRejection {
  command: Command;
  reason: string;
}

export interface StepResult {
  state: SimState;
  rejected: CommandRejection[];
}

export type Command =
  | { type: "send"; from: CityId; to: CityId }
  | { type: "upgrade"; city: CityId };

export function createGame(map: MapDef, seed: number, rules?: Ruleset): SimState;
export function step(state: SimState, commands: Command[]): StepResult;
export function hash(state: SimState): string;
~~~

MapDef 对应 6.1 的地图 JSON；SimEvent 对应 5.6 的事件表。具体字段以两处表为准，不要另造一套命名。

- graph 是运行时路径缓存，不序列化、不参与哈希；map 与 rules 随状态只读共享。
- 不传 rules 时使用 sim 内置 DEFAULT_RULESET，内容包测试会校验它与 rules/1.json 完全一致。

- step 是纯函数：不读全局，不写文件，不依赖时间。
- 指令在 tick 开始时校验，在 tick 边界生效。
- 无效指令返回 rejected，不改变状态；首轮 UI 只发合法指令，但 sim 仍要防御性校验。

### 6.3 规则 JSON

~~~json
{
  "ruleset": "1",
  "tickHz": 20,
  "maxTicks": 18000,
  "sendRatio": 0.5,
  "speedDmPerSecond": 60,
  "maxLevel": 3,
  "levels": [
    {"level": 1, "maxPop": 30, "upgradeCost": 15, "defense": 1.0, "growthMilli": 50, "goldMilli": 100},
    {"level": 2, "maxPop": 45, "upgradeCost": 22, "defense": 1.1, "growthMilli": 62, "goldMilli": 125},
    {"level": 3, "maxPop": 65, "upgradeCost": 32, "defense": 1.2, "growthMilli": 75, "goldMilli": 150}
  ]
}
~~~

### 6.4 哈希与回放

- 每 20 tick 计算一次状态哈希。
- 哈希输入：tick、seed、slug、status、winner、finishReason、nextSquad、rules、玩家金币、所有城市、所有队伍；按 id 排序。
- 不参与哈希：map、graph、events；这三项不影响模拟结果。
- 回放文件：map slug、map hash、ruleset、seed、指令数组、检查点哈希、结果。
- 首轮不实现回放 UI；先保证 harness 能导出与重放。
- Node 与 PC 客户端必须对同一回放得到相同最终哈希。

---

## 7. 模拟核心实现

### 7.1 tick 顺序

1. 应用本 tick 指令：校验、扣人口、生成 squad、升级。
2. 人口增长与金币收入，按城市 id 升序。
3. 队伍推进；到达到期队伍，按 squadId 升序结算。
4. 战斗结算，更新城市归属与人口。
5. 检查胜负与时间上限。
6. 清理过期事件，生成 tick 事件。
7. tick +1。

### 7.2 边界情况

- 城市人口为 0 但仍归属某玩家；下一次任何进攻都能占领。
- 队伍到达时目标已不存在，直接丢弃并记 rejected。
- 同一 tick 多队到达同一城，按 squadId 升序；后到队伍按最新归属结算。
- 增援超过人口上限，溢出丢弃，不返还。
- 升级时人口刚好等于消耗，允许升级，人口变 0。
- 时间上限到达时，先结算本 tick 战斗，再判胜负。
- 所有数组按 id 排序，禁止依赖对象键顺序。

### 7.3 确定性

- 禁止 Math.random、Date.now、performance.now 进入 sim。
- 随机只用种子 xorshift128+；首轮 AI 可以完全确定，不需要随机。
- 边长度在 map JSON 里写死为整数；sim 运行时不做 sqrt 或浮点路径计算。
- 浮点只用于渲染；战斗、人口、金币、路径代价用整数。
- 等长路径按城市 id 字典序选择，保证稳定。
- 路径缓存按 from/to 排序键；不能依赖 Map 插入顺序。
- state hash 覆盖所有影响结果的字段。

---

## 8. 3D 与渲染

### 8.1 场景

- 首图是 60 × 60 m 的桌面沙盘。
- 7 座城，2 个阵营，基础单位。
- 地形、河流、树、石、道路都可有，但不要做第二生态。
- 先灰盒：方块地形、方块城、胶囊单位；灰盒可玩后再换美术。

### 8.2 相机

| 项 | 值 |
|---|---|
| 投影 | 正交 |
| 俯仰 | 55° |
| 方位 | 45° / 135° / 225° / 315° |
| 正交高度 | 34 m |
| 旋转中心 | 地图中心 |
| 过渡 | 620 ms |
| 缩放 | 1.0–1.3 |
| 自由旋转 | 不允许 |
| 阴影 | blob 阴影 + 烘焙 AO |

- 相机位置由地图中心、方位、俯仰、距离计算；lookAt 地图中心。
- Q/E 旋转 90°；滚轮缩放；不做自由环绕。
- 点击命中优先用屏幕空间投影：把城市位置投到屏幕，命中半径 40 px；不做复杂 3D 拾取。

### 8.3 高低差测试场景

独立场景 HeightTest，不进入正式流程：

- 3 个节点：layer 0 起点、layer 2 高台、一条坡道。
- 1 座高台城，城市底座压平。
- 1 队单位从低到高，验证坡道、朝向、速度。
- 四个方位截图，检查遮挡、高台轮廓、路径可读。

验收：单位能上下坡；高台城四向可见；不悬空、不穿模。

### 8.4 性能

- 目标 GTX 1050 / 核显笔记本，1080p 60 帧。
- 首图上限：7 城、4 支队伍、20 个蒙皮单位、3 万三角面、80 draw call。
- 四向切换不超过 1 帧卡顿。
- 加载 forest01 不超过 5 秒。
- 不做实时方向光阴影；不做全屏后处理堆叠。

---

## 9. 页面与 UI

### 9.1 通用

- 分辨率：1280×720、1920×1080；16:9 优先。
- 语言：简中；所有文本走 key，不硬编码。
- 按钮：最小 44 px 高；hover、pressed、disabled 三态。
- 弹窗：暂停、退出确认、重开确认；ESC 行为一致。
- 加载：显示当前步骤；失败显示错误码与重试。
- 文本：最长文案不溢出；中文不用生僻字。

### 9.2 对局 HUD

- 左上：城市数、总人口、金币。
- 右上：计时、暂停按钮。
- 底部：选中城面板，显示等级、人口/上限、升级按钮、派兵提示。
- 选中城：地面环、屏幕空间描边、目标线。
- 派兵：点目标城；合法目标高亮；非法目标变灰。
- 战斗/占领：数字飘字、阵营色变化、音效。
- 胜利/失败：0.8 秒后进入结算页，不卡死。

### 9.3 页面验收

- 每个按钮都能点，且到达预期页面。
- 无重叠、无缺字、无截断、无无响应按钮。
- 暂停后继续，计时与模拟不跳变。
- 重开清空旧状态；返回主菜单再开始，状态干净。
- 设置修改后立即生效；返回主菜单不丢设置。
- 退出确认取消后回到原页面。

---

## 10. 实施顺序

### 第 1 周：数据、页面图、3D spike

- 写 forest01 JSON 与 rules 1 JSON。
- 画页面流程图。
- Three.js 空场景 + 正交相机 + 四向旋转 + 灰盒地形。
- 验收：目标机 60 帧；7 城可加载。

### 第 2 周：模拟核心

- types、createGame、step、path、combat、economy、hash。
- CLI harness：加载 forest01，跑脚本指令流 100 局；AI 在 M1.4 接入。
- 验收：Node + Chrome 5 分钟对局哈希一致；无死锁。

### 第 3 周：3D 灰盒

- 7 城、路径、单位、选中、派兵。
- 四向镜头、遮挡渐隐。
- 验收：灰盒可完整玩一局。

### 第 4 周：AI、胜负、HUD、高低差

- 一档 AI；胜负与 15 分钟上限。
- HUD、计时、暂停。
- HeightTest 场景。
- 验收：AI 能结束一局；测试场景能上下坡。

### 第 5 周：页面

- 启动、主菜单、简报、暂停、结算、设置、退出确认。
- 全路径可走。
- 验收：页面流程图全部可点。

### 第 6 周：美术与音频

- 森林地形、城镇 3 级、2 阵营、单位、UI 图标。
- 占位音替换；音量设置。
- 验收：四向无穿模；UI 不重叠。

### 第 7 周：试玩与修复

- 10 名外部玩家。
- 性能采集、最长文本、边界操作。
- 验收：P0/P1 清零；60 帧。

### 第 8 周：验收

- 录屏、验收报告、Go/No-Go。
- 决定是否开第二张图。
- 验收：第 1 节全部成立。

---

## 11. 测试与命令

目标命令，仓库建立后补齐：

~~~bash
pnpm install
pnpm --filter @marchlands/sim test
pnpm --filter @marchlands/sim test:determinism
pnpm sim:forest01
pnpm --filter @marchlands/client dev
pnpm test:e2e
~~~

**必须有的测试**

- 规则单测：派兵、升级、战斗、占领、胜负、时间上限。
- 属性测试：人口不为负、金币不为负、城市归属合法、队伍不重复结算。
- 确定性：同一地图、种子、指令流，Node 与浏览器哈希一致。
- AI 自对弈：100 局，全部 15 分钟内结束；座位镜像后由另一方获胜。
- forest01 起始表给 p1 优势，AI 自对弈固定 p1 获胜属预期；平衡通过镜像测试验证，不靠随机。
- 页面流程：Playwright 从主菜单走到结算，再重开、回菜单、设置、退出。
- 3D：四向截图；HeightTest 上下坡；遮挡检查。
- 性能：1080p 60 帧；加载 ≤ 5 秒；10 局无显存增长。

---

## 12. 禁止与取舍

**禁止**

- 禁止把原作 PNG、OGG、TXT、坐标、节点、UI 直接复制进项目。
- 禁止在 sim 里 import Three.js、DOM、Node API。
- 禁止在 sim 里使用 Math.random、Date.now。
- 禁止首轮加 Agent、服务器、法术、塔、城堡、新机制。
- 禁止自由 360° 镜头。
- 禁止为了“以后可能用”提前抽象复杂系统；先让一局跑通。

**取舍顺序**

进度落后时，按这个顺序砍：

1. 美术精度与音效。
2. 设置页的非必要项。
3. 动画与特效。
4. UI 装饰。

不要砍：

- 胜负与 15 分钟上限。
- 主菜单、暂停、结算、重开。
- forest01 的 7 城与 2 玩家。
- 3D 四向镜头。
- 确定性哈希。

---

## 13. 待确认决策

以下是当前采用的假设，用户确认后才改：

| 决策 | 当前假设 | 影响 |
|---|---|---|
| 首图 | forest01，重画 7 城 2 玩家 5 中立 | 决定第一周数据 |
| 3D 方案 | 全 3D 低模，正交四向 | 决定美术与性能 |
| 页面范围 | 启动、主菜单、简报、对局、暂停、结算、设置、退出 | 决定第 5 周工作量 |
| Agent | 第二阶段，首轮完全不接 | 决定仓库是否引入 protocol |
| 服务器 | 第三阶段，首轮不接 | 决定是否写后端 |
| 周期 | 2–3 人 8 周 | 决定砍范围顺序 |
| 预算 | 首轮 5–9 万 | 决定外包量 |

如果用户改了任何一条，先更新本文件，再改代码。

---

## 14. 参考

- 完整方案：[Marchlands 开发方案](../plans/Marchlands-开发方案.html)
- 运行架构：[architecture.html](../plans/diagrams/architecture.html)
- Agent 时序：[agent-sequence.html](../plans/diagrams/agent-sequence.html)
- 原作分析目录：.work/original，只读，不提交，不发行
- 原作脚本：.work/original/LandGrabbers/Resources/scripts/levels/st1_forest01.txt

---

## 15. 进度

- [x] M1.1 数据与页面图：forest01、rules/1、校验、页面流程图
- [x] M1.2 模拟核心：33 项单测、属性测试、100 局自对弈、回放哈希
- [x] M1.3 3D 灰盒：四向镜头、地形、7 城、单位、选中与派兵
- [x] M1.4 AI 与胜负、HUD、计时；高低差测试场景待做
- [x] M1.5 页面：八个页面可走，Playwright 5 条流程通过
- [ ] M1.6 美术与音频
- [ ] M1.7 试玩与修复
- [ ] M1.8 验收
