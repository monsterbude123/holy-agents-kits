# codegraph CLI 参考

> **来源**：上游 `https://github.com/colbymchenry/codegraph` README 的 CLI Reference 章节。
>
> **CLI 永远可用**，不依赖 MCP surface —— 隐藏的 7 个 MCP 工具全部有 CLI 等价物。
>
> ⚠️ **索引更新权限**：按 `references/trigger-matrix.md` §0，**只有主代理可执行 `init` / `index` / `sync` / `uninit`**，
> 子代理必须报告给主代理。

---

## 索引管理（**主代理专属**）

| 命令 | 作用 | 何时用 |
|---|---|---|
| `codegraph init [path]` | 初始化项目 + 建图（一步到位） | worktree / 新检出**没有 `.codegraph/` 时**（索引不随 git 传播，这是常态不是故障） |
| `codegraph index [path]` | 全量索引 | 首次建图后要强制重建时（`--force` 重索引 / `--quiet` 少输出） |
| `codegraph sync [path]` | 增量更新 | 常规刷新。**正常情况下不需要** —— MCP server 有 auto-sync |
| `codegraph uninit [path]` | 解除项目关联（`--force` 跳确认） | 清理 |
| `codegraph status [path]` | 统计信息 | **排查第一步**：确认索引是否存在、多大、多少符号；带路径跑 = CLI 归属判定，与 MCP 结果对账（见 `references/degradation.md` §12.1.5） |
| `codegraph unlock [path]` | 删掉卡住索引的 stale lock | `init` / `index` 卡住不动的常见原因 |

## 查询（`codegraph_explore` 的 CLI 等价物）

| 命令 | 作用 |
|---|---|
| `codegraph explore <query>` | 相关符号源码 + 调用路径，**与 MCP `codegraph_explore` 输出同形** |
| `codegraph node <symbol\|file>` | 单个符号的源码 + callers；或按行号读文件 |
| `codegraph query <search>` | 搜符号（`--kind` / `--limit` / `--json`） |
| `codegraph callers <symbol>` | 谁调用了它（`--limit` / `--json`） |
| `codegraph callees <symbol>` | 它调用了谁（`--limit` / `--json`） |
| `codegraph impact <symbol>` | 改这个符号会影响什么（`--depth` / `--json`） |
| `codegraph files [path]` | 文件结构（`--format` / `--filter` / `--max-depth` / `--json`） |

> MCP 不可达时走这些 CLI，能力**不打折**——比降级到 Grep 好得多（见 `references/degradation.md`）。

---

## `codegraph affected` —— 找受改动影响的测试文件

传递追踪 import 依赖，找出改这些文件会波及哪些测试。

```bash
codegraph affected src/utils.ts src/api.ts         # 传文件参数
git diff --name-only | codegraph affected --stdin   # 从 git diff 管道
codegraph affected src/auth.ts --filter "e2e/*"     # 自定义测试文件匹配模式
```

| 选项 | 说明 | 默认 |
|---|---|---|
| `--stdin` | 从 stdin 读文件列表 | `false` |
| `-d, --depth <n>` | 最大依赖遍历深度 | `5` |
| `-f, --filter <glob>` | 自定义测试文件 glob | 自动检测 |
| `-j, --json` | JSON 输出 | `false` |
| `-q, --quiet` | 只输出文件路径 | `false` |

### ⚠️ `affected` 偏保守，接门禁前先验证

`affected` 走的是**依赖传递闭包**，默认深度 5。经过 barrel 聚合文件（`index.ts` 之类）时，
一条浅层依赖会被放大成整棵子树，结果通常**偏宽**：包含与改动文件没有直接关系的测试。

**结论**：它适合当「人工排查受影响面」的辅助，**不适合直接当"只跑受影响测试"的选择器**——
后者要精确（跑得少而准），前者是保守过宽（跑得多但不漏）。

接门禁前先验证收窄手段：`--depth 1`、精确 `--filter` glob、与现有测试选择策略对比。
**未验证前不要替换现有门禁。**

---

## 其它

| 命令 | 作用 |
|---|---|
| `codegraph daemon` | 管理后台 daemon（别名 `daemons`） |
| `codegraph telemetry [on\|off]` | 匿名使用遥测开关（**建议 `off`**） |
| `codegraph upgrade [version]` | 升级（`--check` 只检查） |
| `codegraph version` | 打印版本（`-v` / `--version`） |
| `codegraph install` / `uninstall` | 安装器（`uninstall --keep-cli` 只删配置） |

---

## 索引目录

```
.codegraph/
├── .gitignore     # 索引文件自我忽略
└── codegraph.db   # SQLite 数据库(FTS5 全文索引 + 向量)
```

SQLite 单文件即包含全部符号与边，**无需旁路缓存**。
索引目录**不随 git 传播**（已由自身 `.gitignore` 忽略），所以 worktree / 新 clone 都需要
`codegraph init`（见上表）——**这是常态，不是故障**。

查索引现状用 `codegraph status`（文件数 / 节点数 / 边数 / 库大小 / backend）。

## Auto-Sync（MCP server 内建，默认开启）

MCP server 用**原生 OS 文件事件** watch 项目，短 quiet window 防抖，只过滤源文件，增量同步。
**所以日常改代码不需要手动 `codegraph sync`。**

`explore` 返回体顶部的 `edited since the last index sync — entries may be stale` 提示就是这套机制的产物：
**它不是故障，返回的仍是 on-disk 逐字源码**，按提示对那几个文件改用 `Read` 即可（见 `references/degradation.md` §12.0）。

> ⚠️ watcher 失效是**静默**的：Linux 侧多 worktree 并开可能撞 `fs.inotify.max_user_watches`
> 上限，撞线后未注册的目录悄悄失去 live watching——索引看着正常、新改动永远不进。
> 判据与处置见 `references/degradation.md` §12.1.5。
