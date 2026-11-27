---
name: baidu-netdisk-mcp
description: >
  盘点与整理百度网盘（通过 baidu-server MCP 工具）。把网盘目录树灌进本地 SQLite 后做体量汇总、
  md5 重复检测、路径深度检查，据此执行「隔离重复副本 / 按用途分类重排 / 生成索引」。
  Use when the user mentions 百度网盘、网盘空间、整理网盘、网盘很乱、盘点、扫网盘、
  重复文件、归类、腾空间，或需要 baidu-server 的 file_list / file_move / file_upload_by_content 等工具。
  触发词：百度网盘、网盘、网盘空间、整理网盘、网盘很乱、盘点网盘、扫描网盘、重复文件、归类、腾空间。
license: MIT
---

# baidu-netdisk-mcp

## 第一屏：怎么做（主轴）

- **要目录的权威体积** = 用网盘自己的 `dirsize` 接口（一次可提交一批目录），**别用枚举文件的方式自己加总**
- **看清网盘有什么、多久没碰** = `scan` 灌本地库 + `stats`/`du`/`dup`/`deep` 本地查
- **找重复** = `dup --min-size=50MB` 看 md5 相同组 → `plan` 校验 → `move` 隔离到 `/90_待清理/`
- **按用途重排** = 写 spec（{from,to,name}）→ `plan` 校验源路径在库中 → `move` 执行 → 写 `/99_索引/` 索引
- **备份模型到网盘** = `model-backup.mjs pack`（模型 + 同名附件 → 加密 zip）→ `upload` → 台账；还原走 `restore`
- **传文件（要进度/续传/校验）** = `transfer.mjs upload|download` —— 原生分片上传，每片一个进度刻度，断点续传，sha256 校验
  （**只支持单文件**，目录要先打包；续传会在本地文件已改变时自动作废重来）
- **只查一两个目录** = 直接用 `file_list` / `file_meta` 工具，别灌库
- **岔路**：`scan` 撞上限 → 调大 `--depth`/`--max-dirs` 增量续灌；`move` 报 -9 → 源已被搬走，回目标核对；报 -8 → 目录太大，改 `--async=1`

**动手前先扫一眼 `references/counter-examples.md`**——里面是这次实际踩过的 27 个坑
（枚举算体积会少一半、按 100 判断末页、`make_dir` 默认重命名、`async=1` 误判失败…），
照着避坑比读脚本源码快得多。

## 步骤

1. **灌库** —— `scan` 带深度与目录数双上限 → 本地 SQLite；完成判据：stderr 出现 `scan done: dirs=… files=… bytes=…` 且**没有** `撞上限提前截断`
2. **量化** —— `stats`/`du`/`big`/`dup`/`deep` → 得到「谁占地方、哪些重复、哪些路径过深」
3. **定分类法** —— 按**用途**而非来源划分顶层；每个分类都要能回答「新东西往哪放」
4. **隔离重复** —— md5 相同的一侧 `move` 到 `/90_待清理/重复副本/`；不删，等用户确认后再由客户端删
5. **重排** —— spec 列 {from,to,name}，`plan` 校验源路径在库中（打错路径当场暴露），再 `move`
6. **写索引** —— `/99_索引/` 放 README：每目录放什么 + 体量 + 待用户决策的清单

## 判断依据（挂在步骤上）

- **Step 1 的上限** —— `MAX_DEPTH`/`MAX_DIRS` 是硬约束，撞上限时所有体量数字都是**下界**不是真值，报告里要说明
- **Step 1 的枚举只用于找重复/看时间，不用于算体积** —— openapi 的 `list`/`filemetas` 对目录 `size` 恒为 0，枚举文件累加出来的目录体积在深层树上会严重偏小（实测一棵树枚举得 281 GB、实际 727 GB）；**目录体积一律走 `references/dirsize.md` 里的 dirsize 接口**
- **Step 1 的增量** —— 目录要记录「当时探到下面几层」，只有探得够深才跳过；只记时间戳会让根目录一命中新鲜就整棵短路，深灌永远不发生
- **Step 2 的重复判定** —— 只有 md5 完全相同才算重复；目录名相似、目录名里的标称体积相似都不算
- **Step 2 的体量汇总** —— 目录体积按 `parent` + 路径绝对层数自底向上汇总；用递归 CTE 会把祖先-后代组合全展开再 JOIN 文件，几十万行起步直接卡死
- **Step 4 默认隔离而非删除** —— 先 move 到 `/90_待清理/`，由用户在客户端删，可逆
- **Step 4 的删除工具** —— MCP **有** `file_delete`（入参 `filelist` 为路径字符串数组的 JSON 串、`ondup`）；但按「破坏性操作先确认」的规矩，只在用户明确点头后用，且先把待删清单给人过目
- **Step 4 的保留侧** —— 保留用户更可能用的那侧（主模型库、完整课程包）；拿不准就两份都留并标注
- **Step 5 的移动粒度** —— 超大目录整棵 move 会被同步模式拒（-8），用 `--async=1` 提交后轮询；小批量 + 逐项解析 `info[]` 才能定位失败项
- **破坏性操作** —— 删除、覆盖、批量移动/改名执行前必须让用户确认，别自行决定

## 循环与退出

```
灌库 → 量化 → (有重复? → 隔离) → (要重排? → 分类 + spec) → move → 复核 → 索引
```

**退出条件**：根目录只剩分类目录 + 索引 + 待清理区，且索引里的体量与库内一致

## §4 脚本

**执行方式：直接跑下面这些命令，不要先读脚本源码。** 命令复制即可运行；
只有当命令**报错**或**输出看不懂**时，才去读源码；参数不确定先跑 `--help`，不要靠读源码猜参数。

```bash
# 技能安装目录：默认 ~/.agents/skills；ZCode 等宿主装在 ~/.zcode/skills，用 BAIDU_SKILL_DIR 覆盖
SK="${BAIDU_SKILL_DIR:-$HOME/.agents/skills/baidu-netdisk-mcp}"

node "$SK/scripts/baidu-netdisk-db.mjs" --help
node "$SK/scripts/baidu-netdisk-db.mjs" scan --roots="/" --depth=5 --max-dirs=1500
node "$SK/scripts/baidu-netdisk-db.mjs" stats
node "$SK/scripts/baidu-netdisk-db.mjs" du --path=/02_课程 --depth=2
node "$SK/scripts/baidu-netdisk-db.mjs" big --min=5GB
node "$SK/scripts/baidu-netdisk-db.mjs" dup --min-size=50MB
node "$SK/scripts/baidu-netdisk-db.mjs" deep --max-depth=5
node "$SK/scripts/baidu-netdisk-db.mjs" find --name=safetensors --path=/01_AI
node "$SK/scripts/baidu-netdisk-db.mjs" plan --spec=spec.json --out=move_plan.json
node "$SK/scripts/baidu-netdisk-move.mjs" --spec=spec.json --batch=10

# 模型备份到网盘（加密压缩 → 上传 → 台账）
node "$SK/scripts/model-backup.mjs" pick --root=<模型库根> --include=loras --limit=5
node "$SK/scripts/model-backup.mjs" pack --root=<模型库根> --include=loras --limit=2
node "$SK/scripts/model-backup.mjs" verify --pack=<包.zip> --password=<密码>
node "$SK/scripts/model-backup.mjs" restore --pack=<包.zip> --to=<还原目录> --password=<密码>
node "$SK/scripts/model-backup.mjs" upload --pack=<包.zip> --remote=/apps/bdpan/model-backup/x.zip

# 传输层（原生分片：进度 + 速度 + 断点续传 + sha256 校验）
node "$SK/scripts/transfer.mjs" upload   --file=<本地文件> --remote=/99_索引/x.zip --slice=32MB
node "$SK/scripts/transfer.mjs" download --remote=/apps/bdpan/x.zip --to=<本地文件> --expect-sha256=<hex>
node "$SK/scripts/transfer.mjs" hash     --file=<本地文件>
node "$SK/scripts/transfer.mjs" ledger

# 脚本自检（只测参数解析等纯函数，不连网、不碰盘点库）——改完脚本跑一遍
node "$SK/scripts/selftest.mjs"
```

在本仓里开发时也可用仓根相对写法 `node skills/baidu-netdisk-mcp/scripts/...` —— 那是**仓内**写法，
技能被安装到别处后不成立，别照抄那一条。

对应关系：`--help` 列出全部子命令与参数 · `scan` 灌库（增量，`--force` 全量重扫）· `stats` 一级目录体量排行 ·
`du` 任意子树汇总 · `big` 大目录 · `dup` md5 重复 · `deep` 路径过深的文件 · `find` 文件名检索 ·
`dump` 导出子树为 JSON · `plan` 移动前用库校验 spec · `reset` 清空缓存 · `baidu-netdisk-move.mjs` 执行移动 ·
`model-backup.mjs` 备份模型（模型 + 同名附件 → 加密 zip → 上传 → 台账），方法与还原流程见
`references/model-backup-method.md` · `scripts/transfer.mjs` 传输层（上传/下载/哈希/台账，**进度 + 续传 + 校验**）·
`scripts/hashes.mjs`（流式哈希）与 `scripts/xpan-api.mjs`（百度原生协议）是它用的库模块，不要单独跑。

stdout 是单行 JSON 信封（`{"ok":true,"data":...}`），人读表格与进度在 stderr。

三个脚本共用 `scripts/args.mjs` 解析参数：数字与体积（`50MB`/`5gb`/`1.5GB`）都能认，
**解析不出来直接报错退出 1**——不静默当成 0。它是库模块，不要单独跑。

**运行时**：Node ≥ 22.13（`node:sqlite` 自该版本起免 `--experimental-sqlite`；22.5~22.12 需加标志）。

机器本地路径（ZCode 配置、盘点库文件位置）**不入本仓**：脚本按 `ZCODE_CFG` → `BAIDU_DB` 环境变量 →
`config.json` → 默认值 的顺序解析（见 `.env.example`）。

Git Bash 下跑这两个脚本必须加 `MSYS2_ARG_CONV_EXCL='*'`，否则 `/课程` 会被转成 Git 安装目录下的 `课程`（形如 `Program Files/Git/课程`）。

## §5 参考文件

- `references/api-quirks.md` —— 百度网盘 MCP 的九个 API 陷阱（分页每页 10 条、`make_dir` 默认重命名、`category` 字段不可靠、`file_move` 的 async 语义、depth 记的是相对层数、路径含 `+`/全角括号报 1002、`file_list` 不返回 mtime、`file_upload_by_content` 不覆盖同名、ZCode 里显示红色/toolCount=0）；**排查报错或算出来的体量不对时读**
- `references/dirsize.md` —— 拿目录**权威体积**的正确接口（openapi 的 `method=dirsize` 提交任务 + web 端 `/mid_mucw/api/ostp/file/taskQuery` 取结果）、为什么自己枚举加总会偏低、以及怎么从网盘 JS bundle 里挖出未知接口；**要目录大小、或要查「网盘到底调了哪个接口」时读**
- `references/counter-examples.md` —— **反例清单**：这次实际犯过的 27 个错（枚举算体积、猜接口名、`category` 判目录、按 100 判断末页、`make_dir` 默认 rtype、`async=1` 误判失败、`AbortSignal.timeout` 提前退出、Git Bash 路径转换、并发开 mcp-remote、以为 MCP 没有删除…）；**动手前先扫一眼，能省掉几小时的错**
- `references/model-backup-method.md` —— **模型备份方法（我们自己的做法）**：选模型 → 收集同名附件 → zip 加密 → 上传网盘 → 台账，含目录命名约定、密码约定、还原流程与踩过的坑；**要备份模型到网盘、或要还原某个备份时读**
- `references/transfer-protocol.md` —— **传输协议与实测边界**：百度原生分片上传三段式（precreate/superfile2/create）、服务端驱动的续传、下载 dlink 与 Range、**两级哈希口径**（片级 md5 / 文件级 sha256 / 网盘 md5 为何不能当尺子）、bdpan CLI 的实测边界与速度基线；**要传大文件、排查上传下载、或做同步之前读**
- `references/governance-playbook.md` —— 治理决策手册（分类法怎么设计、怎么识别「体量-用途错配」、隔离与删除的取舍、索引怎么写）；**定分类法或用户问「该删什么」时读**
- `references/INDEX.md` —— 本目录索引

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
