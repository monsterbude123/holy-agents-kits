---
name: analysis-codegraph
description: 'Code-context tool for repositories indexed by codegraph. Invoke before answering a code question or making a non-trivial edit, and again whenever the investigation direction changes. Use it to locate a symbol, trace a call path, measure the blast radius of a rename or deprecation, survey an unfamiliar subsystem, or diagnose a bug by symbol and call path. One call returns verbatim source grouped by file plus the call graph and blast radius, replacing a Grep + Read + Grep loop. Do not use it for git history, docs, config files, or literal string searches such as finding every console.log.'
---

# Codegraph — 代码图谱分析

Codegraph 是代码感知的索引：知道**符号**、**类型**和符号间的**调用图**。它把「定位 → 看源码 → 摸影响面」合并成一次调用。

> **前提**：仓库装了 codegraph 并建好索引（`.codegraph/`）。缺索引按 `references/degradation.md` 处理；未安装则本技能不适用，按常规 `Read` / `Grep` 工作。

## 工具面（上游有意只暴露一个工具）

MCP server 默认只列出一个工具：`codegraph_explore`。上游的结论是——一个强工具比一排窄工具误选更少，也更省 context。

另 7 个（`node` / `search` / `callers` / `callees` / `impact` / `files` / `status`）功能完整但默认不列出，因为它们返回的内容已经在 `explore` 的 Blast radius 段、Relationships 段和符号体里。

- 需要时可用环境变量 `CODEGRAPH_MCP_TOOLS=explore,node,search,callers` 重新挂上。
- **CLI 永远可用**，不依赖 MCP surface（命令表见 `references/cli.md`）。

> 这 6 个名字**不存在**：`context` · `trace` · `cypher` · `rename` · `detect_changes` · `list_repos`。
> `query` / `impact` 存在，但 MCP 侧对应 `search` / `impact` 且默认不列出——找它们去 CLI。

## 核心纪律

1. **先放大招**：任何「问代码」的问题，第一个工具是 codegraph，不是 `Read` / `Grep`。
2. **方向切换就重调**：问题里出现「在哪 / 谁调用了它 / 谁写入了它 / 还有谁在用 / 改了会影响谁」——这五种问法正是 Blast radius 段与 Relationships 段的标准答案。
3. **一次调用不是任务配额**：换方向、出现新符号、第 N 次改同一文件，都要重新调用。
4. **不用 grep 顶替「发现」**：grep 只用于验证已知位置；不知道在哪时用 codegraph。判据见文末「收尾自检」。

**头号失败模式**：第一次 `explore` 返回大量内容后，agent 觉得「够了」，后续全用 grep 补零碎——工具调过了，分析却降级成了形式主义。解法不是为凑次数做仪式，而是**补掉那些本该由图谱回答的搜索**。

## 调用参数

```text
codegraph_explore({
  query: "<符号名 / 文件名 / 自然语言问题>",   // 必填
  maxFiles: 12,                              // 可选，默认 12；被截断就调高
  projectPath: "<仓库绝对路径>"                // 必填
})
```

| 参数 | 说明 |
|---|---|
| `query` | 要查的符号 / 文件名 / 短词组，自然语言也可以。**至少给一个符号、文件名或短语**，不能只给扩展名 |
| `maxFiles` | 返回源码的文件数上限，默认 12。要更宽的调研就调高，要更小就调低 |
| `projectPath` | **一律显式传当前工作区的仓根绝对路径**，取值 `git rev-parse --show-toplevel`（拿不到就用会话工作目录）。索引 `.codegraph/` **不随 git 传播**，隐式依赖会话默认项目会在 worktree / 新 clone 里静默查错索引或落空；schema 侧也把它列为必填。**不要写成固定字面量**——换机器、换 worktree、换 clone 后会静默指向不存在的仓 |

## 返回体四段

| 段 | 内容 | 用途 |
|---|---|---|
| **Blast radius** | 谁依赖这些符号（callers + tests） | **改之前必读**。HIGH / CRITICAL 先报给用户 |
| **Relationships** | `calls` / `instantiates` / `references` 的调用图 | debug 时定位真实调用路径 |
| **Source Code** | 相关符号的**逐字**源码，按文件分组 | **等同已 Read**，不要再读同一批文件 |
| **Not shown above** | 命中的其它符号清单 | 需要时**再调一次** `explore` 补齐，不是转 Grep 的理由 |

## 什么时候调

**先调，后做任何事**：

- 「X 在哪定义 / X 调谁 / X 的签名、类型、行为是什么」
- 定位 bug 的怀疑符号 + 产生错误输出的调用路径
- 重构或非平凡编辑前，摸**每一个**待改符号的调用方
- 摸不熟的子系统（一次调用完成 survey）
- 端到端追一条流（点名跨流的每个符号）
- 任何范围没锁定到单文件的编辑之前
- **任何时候你「不确定代码现状」**——不需要先找到具体理由

**不要调**（4 类合法例外，完整判据见 `references/trigger-matrix.md` §6）：

| 场景 | 用什么 |
|---|---|
| git 历史 / blame / 这行何时加入 | `git log` / `git blame` |
| 文档 / README / 规则文件 / MDX | `Read` |
| 配置 / env / Dockerfile / JSON schema / 数据库 schema 原文 | `Read` |
| 表面字符串扫描（「找出所有 console.log」「这个 i18n key 在哪」） | `Grep`（**必带 `path`**） |

## 查询写法

一次调用尽量收窄。`query="整个 auth 系统"` 会返回洪水：

```text
✅ query: "useAuth login redirect postAuth"          maxFiles: 8
✅ query: "mutateElement renderScene commitHook flush"（追流时点名每一跳）
✅ query: "how does the editor persist a node position"
❌ query: "auth"                                       （单宽泛词，无收窄）
❌ query: "everything in src/"                          （整个子系统倾倒）
```

## 调用之后

1. 返回体**已经等于 Read 过**——不要为了「确认」再读那些文件。
2. 缺某个符号时，**先给 query 补更多词**（codegraph 会就近匹配）。真没索引上才考虑 Grep。
3. 需要某一处具体行 → 优先**窄 query 补调一次**，而不是打开整个文件。
4. **返回不全就再调一次**（补符号名 / 调高 `maxFiles`）。这一步是最常被跳过的一步。

## MCP 不可用时

- **工具列表里没有** `codegraph_explore`：这是宿主限制（部分子代理运行时不挂 MCP 工具），不是故障。用 CLI，能力不打折。
- **调用持续报错**：先试 CLI；CLI 也不行才按 `references/degradation.md` 真降级。
- **索引缺失 / 归属可疑**：先用 `codegraph status` 判定，再决定是否 `init`。**只有主代理可以更新索引**，子代理必须上报。

## 索引生命周期

- `.codegraph/` 不随 git 传播 → 每个 worktree / 新 clone 都要 `codegraph init`。**缺索引是常态，不是故障**。
- MCP server 自带 auto-sync（OS 文件事件 + 防抖），日常改代码不需要手动 `sync`。
- 返回体提示某几个文件 `may be stale` → **不是失败**，读到的仍是磁盘内容；对那几个文件改用 `Read`，其余照常用。
- 多 worktree 可能借用父目录索引，或被长驻 server 钉死 / 冻结 → 诊断与处置见 `references/degradation.md` §12.1.5。

## 参考文件

| 路径 | 内容 | 何时必读 |
|---|---|---|
| `references/trigger-matrix.md` | §0 四条原语规则 + §1 场景矩阵 + §2 三场景协议 + §5 快速启动 + §6 合法例外 | **任何代码调查开始前** |
| `references/anti-patterns.md` | §3 反模式 7 姿势 + 收尾自检 + 降级前三问 | 收尾自检时 / 提交前 |
| `references/subagent-contract.md` | 子代理委派 YAML 头部 + 派发后自检 | **派发代码任务的子代理前** |
| `references/degradation.md` | 状态判定 + 索引修复 SOP + 多 worktree 归属错乱 + 真降级协议 | MCP 异常 / 索引缺失 / 结果可疑时 |
| `references/cli.md` | CLI 全命令表 + `affected` + 索引目录说明 | **MCP 不可达时首选**；索引维护；排查时 |

## 收尾自检

把本次所有 `grep` / `ls` / `find` 逐条分类（**不是**数 codegraph 调了几次）：

| 类型 | 判据 | 结论 |
|---|---|---|
| **验证型** | 已知确切文件 / 符号，核对一个具体细节 | ✅ Grep / Read 正确 |
| **发现型** | 不知道它在哪，搜「这个符号还在哪 / 谁调它 / 谁写它 / 改了影响谁」 | ❌ **漏招**，补调 `codegraph_explore` |

**分界线**：搜**代码符号**出现在哪 = 发现型（Relationships 段直接给答案）；
搜**字符串字面量**（配置 key / i18n key / 环境变量名 / URL）= 验证型（Grep 正确）。

**发现型 > 0 = 本次有漏招** → 补调后再交。把两个数字（grep 总数 / 其中发现型几次）写进汇报。

## 上游

- GitHub：`https://github.com/colbymchenry/codegraph`
- 索引：`.codegraph/codegraph.db`（SQLite 单文件，FTS5 全文索引 + 向量）

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
