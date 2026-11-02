# 资产包格式

Marchlands 的地图外观由资产 ID 引用，资产可以来自内置目录，也可以来自玩家导入的 `.mlpack`。资产只影响画面，不进入模拟状态、状态哈希或回放判定。

## 文件结构

`.mlpack` 是 ZIP 容器，文件名不参与解析，内容必须包含：

~~~text
pack.json
models/tree.glb
models/tower.glb
~~~

- 只接受 glTF 2.0 二进制 `.glb`。
- 不接受脚本、可执行文件、HTML、纹理目录或外部 URL。
- 单个资产包最大 64 MB，最多 512 个文件，单个模型最大 32 MB。
- `pack.json` 最大 16 MB。

## pack.json

~~~json
{
  "format": "mlpack",
  "version": 1,
  "id": "com.example.frontier",
  "name": "边境扩展包",
  "author": "example",
  "description": "玩家自制地形与建筑",
  "assets": [
    {
      "id": "com.example:hill",
      "kind": "terrain",
      "label": "荒丘",
      "file": "models/hill.glb",
      "scale": 1,
      "rotation": 0,
      "footprint": 10,
      "height": 4
    },
    {
      "id": "com.example:tower",
      "kind": "building",
      "label": "边境塔楼",
      "file": "models/tower.glb",
      "scale": 1,
      "teamColor": true,
      "footprint": 6,
      "height": 8
    }
  ]
}
~~~

| 字段 | 必填 | 说明 |
|---|---|---|
| `format` | 是 | 固定为 `mlpack` |
| `version` | 是 | 固定为 `1` |
| `id` | 是 | 资产包命名空间，小写字母开头，只含小写字母、数字、`_ . -` |
| `name` | 是 | 显示名称 |
| `author` | 否 | 作者 |
| `description` | 否 | 简介 |
| `assets` | 是 | 1 到 256 个资产 |

资产字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `命名空间:路径`，例如 `com.example:tower`，全局唯一 |
| `kind` | 是 | `terrain`、`prop`、`building`、`unit` |
| `label` | 是 | 编辑器显示名称 |
| `file` | 是 | 包内 `.glb` 路径，不能包含 `..` 或绝对路径 |
| `scale` | 否 | 默认缩放，0.01 到 100 |
| `rotation` | 否 | 默认朝向，单位为度 |
| `footprint` | 否 | 占地直径，单位为米 |
| `height` | 否 | 模型高度，单位为米 |
| `teamColor` | 否 | 是否把材质名以 `team` 开头的材质染成队伍色 |
| `tags` | 否 | 编辑器分组标签，最多 12 个 |
| `thumbnail` | 否 | 包内图片路径，当前仅保留字段 |

资产 ID 的命名空间必须与包 ID 一致，避免不同作者的资产互相覆盖。内置资产使用 `builtin:` 命名空间。

## 模型约定

- 单位：米。
- 坐标：Y 向上。
- 原点：模型底面中心，直接落在放置点。
- 朝向：默认面向 `-Z`。
- 建筑与地形：建议提供 `footprint` 和 `height`，编辑器用它们绘制占地预览。
- 队伍色：需要随阵营变色的材质命名为 `team`、`team_primary` 或 `team_secondary`，并在资产条目中设置 `"teamColor": true`。
- 单位动画：建议使用 glTF 骨骼动画，剪辑名固定为 `idle`、`walk`、`attack`、`death`。当前版本只渲染建筑、地形与装饰；单位资产导入已进入格式，但还没有接入战斗动画。
- 地形资产只提供外观，不提供寻路或可通行数据。行军仍然由据点与道路图决定。

## 导入与持久化

1. 打开地图编辑器。
2. 点击左侧“导入 .mlpack”。
3. 选择资产包，导入成功后资产会出现在“地形”“装饰”或建筑外观列表中。
4. 放置资产并保存地图，地图文件只记录资产 ID。
5. 资产包会写入浏览器 IndexedDB；重新打开游戏后自动载入。

编辑器还提供“导出内置包”，把客户端内置的 Kenney GLB 模型打包为 `.mlpack` 示例。导出包使用 `com.marchlands:` 命名空间，可以再次导入，用于检查格式或作为自制资产包的起点。

如果地图引用了一个未载入的资产：

- 编辑器状态栏显示缺失数量。
- 游戏场景跳过该资产，不影响模拟。
- 重新导入同一命名空间的资产包即可恢复显示。

## 内置资产

内置资产使用 `builtin:` 命名空间，由客户端注册：

- `builtin:terrain.hill`、`ridge`、`mesa`、`pond`、`field`、`grove`、`ruin`、`camp`。
- `builtin:building.town`、`tower`、`granary`。
- `builtin:prop.*`：Kenney 城镇、自然与城堡构件。
- 内置资产是玩家资产缺失时的回退，不依赖资产包。

## 全模型转换

仓库提供一条可重复执行的转换管线，把当前所有模型族统一导出为 glTF 2.0 二进制：

~~~bash
pnpm --filter @marchlands/client dev
node tools/asset-convert/run.mjs
~~~

输出：

- §release/Marchlands-models-converted.mlpack§：105 个资产的完整快照。
- §release/converted-models/§：逐个 GLB 与 §manifest.json§。
- §apps/client/src/assets/kenney/castle-glb/§：城堡运行时使用的 17 个 GLB。

覆盖范围：

| 来源 | 数量 | 说明 |
|---|---|---|
| 城堡 OBJ | 17 | 已转 GLB，运行时已切换 |
| 程序化建筑 | 8 类 × 3 级 | 单建筑 GLB |
| 城墙 / 城镇组合 | 3 + 3 | 含墙体的城镇快照 |
| 单位 | 5 | 保留 §torso/head/leftArm/rightArm/leftLeg/rightLeg/mount§ 节点名 |
| 地形块 | 8 | 边境风格快照 |
| Kenney GLB | 45 | 原样复制 |

转换场景入口是 §/?scene=convert§。它只用于开发和资产生产，不参与正常对局。

运行时现状：城堡已直接读取 GLB；建筑、单位、地形仍使用程序化构建，转换产物用于后续切换到统一 GLB 加载。单位 GLB 的节点名已经保留，下一阶段可以直接接入部件动画或骨骼动画。

## 当前限制

- 内置建筑、单位、地形仍走程序化构建；转换后的 GLB 快照在 §release§ 中，尚未全部替换运行时。
- 单位 GLB 保留命名部件，但战斗渲染仍使用程序化 §UnitActor§。
- 地形资产不改变地面高度、碰撞或寻路。
