# §11 — 子代理委派头部必填

> **执行时机**：主代理派发**任何做代码任务的子代理**前，把下方 YAML 整块嵌到 prompt 顶部。
> **缺任一字段 = 派发未就绪。**

---

## §11.1 送达机制：先看子代理被授权了什么

**工具授权决定子代理读得到什么。** 常见宿主按 agent 的 frontmatter `tools:` 授予工具，三类载体：

| 载体 | 送达 | 说明 |
|---|---|---|
| **frontmatter `tools:`** | ✅ 工具本身 | 含 `Skill` 才能打开技能目录；含 MCP 工具名才能直接查图谱 |
| **agent 正文** | ✅ 行为契约 | 未被 `Skill` 授权时，这是子代理唯一能读到的载体 |
| 派发提示词内联 | ✅ 即时 | 本文件的 YAML 模板就是这个载体，缺它 = 派发未就绪 |

**没被授权 `Skill` 的子代理打不开技能目录**——对它来说那是死文件。
**没被授权 MCP 的子代理没有 `codegraph_explore`**，但仍可用 CLI（同一能力，非降级）。

> **为什么必须是结构化 YAML，不能用自然语言**：子代理会把叙述当**礼貌建议**跳过
> （「请使用代码分析工具查一下」这类），YAML 才是契约。契约头能显著提高「第一个工具就取图谱」的概率。

---

## §11.2 YAML 头部模板（原样嵌入，缺字段 = critical finding）

```yaml
# === 代码分析工具 强约束 ===
code_analysis_tool: codegraph
mcp_tool_prefix: mcp__codegraph__       # 唯一工具: codegraph_explore
# MCP 与 CLI 是同一条能力的两条入口，不是主备。
# 部分宿主不把 MCP 工具挂进子代理工具表（见 cli_fallback），此时必须走 CLI，
# 不允许因为「工具不在表里」就退化成 Grep —— 那才是真正的能力丢失。
cli_fallback: |
  在任意 shell 里执行(Windows / macOS / Linux 均可):
  codegraph explore "<query>"   # 与 MCP codegraph_explore 输出同形
  codegraph callers <symbol>    # 谁调用它
  codegraph callees <symbol>    # 它调用了谁
  codegraph impact <symbol>     # 改它会影响什么
  codegraph node <symbol|file>  # 单符号源码 + callers
  codegraph status              # 索引是否存在/多大 + 归属哪棵树
  判据: 你的工具表里没有 mcp__codegraph__codegraph_explore = 走 CLI, 不是故障, 不是降级。
  能力不打折: blast radius / callers / callees / 逐字源码 全部拿得到。
  只有 CLI 也不可用才进 references/degradation.md §12.3。
# === 索引归属判定（主代理派发前填，缺此字段 = 派发未就绪）===
# 为什么要这个字段: 多 worktree 场景下，子检出可能没有自己的索引，
# codegraph 会沿父链**借用**上层检出的索引，MCP 返回 "different git working tree" 警告。
# 借来的图谱只对「两棵检出内容不同」的文件是错的，内容一致的文件逐字正确。
codegraph_index_verdict: |
  主代理填。格式(单行):
    codegraph_index_verdict: own | owner=<绝对路径> | distrust_files=0
    codegraph_index_verdict: borrowed | owner=<绝对路径> | distrust_files=<N> | distrust_list=<名单文件绝对路径>
    codegraph_index_verdict: none | owner=none | distrust_files=ALL
  产出方式: 在目标检出跑 `codegraph status <路径>`, 与 `git rev-parse --show-toplevel` 对账。
            判定 borrowed 时, 差集名单 = 两棵树内容不同的文件:
              git -C <目标检出> diff --name-only <owner 检出的 HEAD>
            名单写到临时路径即可, 不要污染工作区。
  子代理照它执行:
    own      → 图谱逐字可信, 正常用
    borrowed → **名单外照常用图谱**(不要退化); 名单内文件图谱给的是 owner 版 → Read 本检出版本;
               本检出独有的新符号图谱查不到 → Read
    none     → 图谱查不到符号 → 走 CLI/Grep 兜底, 返回值标注「结论无图谱支撑」
primitive_enforced: true
must_origin_ref: references/trigger-matrix.md §0 MUST-ORIGIN-1..4
# 不用 call_density_min 这类无法机械判定的字段，改用可逐条判定的 grep 用途分类。
grep_usage_classification: |
  收尾时把本次每个 grep/ls/find 分类:
    验证型 = 已知确切文件/符号, 核对具体细节        -> 正确
    发现型 = 不知道它在哪, 搜「符号还在哪/谁调它/谁写它/改了影响谁」 -> 漏招, 必须 codegraph_explore
  分界线: 搜代码符号 = 发现型; 搜字符串字面量(配置 key/i18n key/env 名) = 验证型。
  发现型 > 0 = 报告里必须列出并补调。
anti_pattern_ref: references/anti-patterns.md §3 #6 ceremonial-call
project_path: "<当前工作区仓根绝对路径>"   # 必传, 显式; 取值 git rev-parse --show-toplevel。刻意不写字面量——写死会在换机器/换 worktree/换 clone 后静默指向不存在的仓

# === 降级协议(修复优先, 不是降级优先) ===
mcp_degradation_policy:
  principle: 默认动作 = 修复, 不是降级
  trigger: |
    1) 工具表里没有 mcp__codegraph__codegraph_explore (= 未挂载, 走 cli_fallback, 不算降级)
    2) codegraph_explore 报 "index not found" / .codegraph/codegraph.db 缺失
    3) 任何 MCP 异常, 或目标 worktree 无 .codegraph/ 索引
  action: |
    1. 先判是「未挂载」还是「异常」: 未挂载 -> 直接走 cli_fallback, 不要报故障
    2. 真异常时报告给主代理, 由主代理决定是否 codegraph init (子代理无权更新索引)
    3. 不接受降级为默认状态
    4. 降级必须走 references/degradation.md, 并在报告中打标记
  verify: 重新 explore 一次(MCP 或 CLI 任一入口), 看是否恢复
  protocol_ref: references/degradation.md

# === kill / spawn 进程红线 ===
forbidden_commands:
  - 按镜像名或端口批量杀进程(taskkill /F /IM、Stop-Process -Name、pkill -f、killall 等)
  - 在子代理内主动 spawn 安装 / 构建 / 包执行进程
only_allowed_kill: |
  只允许按**已确认属于本项目的具体 PID** 终止单个进程。
  终止前必须能说清这个 PID 是什么进程、由谁启动。

# === Shell 执行纪律（主/子代理通用） ===
shell_discipline:
  absolute_paths_only: |
    禁止依赖会话继承的 cwd: 工具可能在两次调用之间重锚工作目录。
    规则: 每条命令显式 cd 到绝对路径; git 一律 `git -C <绝对路径>`; Read/Edit/Write 传绝对路径。
  prove_location_first: |
    验证类命令(typecheck / test / lint)先输出当前工作目录再跑;
    日志里 cwd 与目标目录不符 = 结果作废, 重跑。
  no_pipe_on_long_commands: |
    预期 >30s 的命令不要用 `| grep | head | tail -N`: 块缓冲 + 提前关管道会让日志看起来卡死,
    且失败行被截掉后只剩一堆成功标记, 诱导重跑整条门禁链。
    正确做法 = 后台启动(宿主支持后台执行时), 输出落日志文件后再读。
  narrow_test_scope: |
    只跑受影响文件; 不要用整目录验证局部改动。
    改了共享模块就精确跑其消费方测试, 而不是"跑一遍全目录看有没有红"。

# === 主代理通用约束（必须原样带给子代理） ===
git_readonly: true            # 只允许 status/diff/log/blame/show
no_index_update: true         # 子代理不得 codegraph init / index / sync / uninit
```

---

## §11.3 派发后自检（5 项，任一失败 = 重派）

1. prompt 顶部嵌了 YAML 整块（**不是**叙述式改写）。
2. 子代理报告里检查这些字段是否被引用到：`code_analysis_tool` / `cli_fallback` / `must_origin_ref` /
   `grep_usage_classification` / `anti_pattern_ref` / `mcp_degradation_policy` / `codegraph_index_verdict`。
3. 缺任一字段 → 记 medium finding，要求重做。
4. 子代理产生 child_process / spawn 行为 → **critical finding，立即中断**。
5. 子代理因索引归属问题整体退化成逐文件 Read → medium finding。
   借用的图谱只对「两树内容不同」的文件是错的，名单外照常用（`references/degradation.md` §12.0）。
   判据：报告出现「索引陈旧 / 归属别树 → 我直接读文件」且未按 `codegraph_index_verdict` 分档执行。

**报告验收硬指标**：

- 产出提到任何 references / skill 文件 → **必须 cite 具体行号**，否则 medium finding。
- 产出**未做 grep 用途分类**（只报「用了 codegraph N 次」）→ **medium finding**。
- 产出存在**发现型 grep 却没补招** → medium finding。
- 产出执行了 `forbidden_commands` 任一 → critical finding。
- 产出遇到 MCP 异常但没引用 `mcp_degradation_policy` → medium finding。
- 产出工具表里没有 MCP 工具、却直接用 Grep / Read 做发现型搜索、**全程没走过 `cli_fallback`** →
  **critical finding**（这正是「agent 不用 codegraph」的默认失败形态：工具不在表里 → 静默退化）。

---

## §11.4 子代理的上下文盲区

**根问题**：子代理是独立 session，spawn 时**不会自动加载主代理读过的规则文件、技能或项目约定**。
它只看到主代理 prompt 里显式塞的内容。所以：

- 主代理读过的项目约定（测试账号 / 端口 / 启动命令）→ 子代理看不到。
- codegraph 的 `projectPath` 必传规则 → 子代理不知道，会传错或漏传。
- references 文件的存在 → 子代理不知道。

**解决**：YAML 头部把上述内容**一并显式塞进去**（`project_path`、`mcp_degradation_policy`、
`codegraph_index_verdict` 三个块就是为此设计的）。

---

## 病灶（历史踩坑）

- 子代理把「调一次 codegraph」当仪式——第 2 步 skip 后一路 Read / Grep 干完。
- 子代理不读规则文件——不知道 references / projectPath 规则存在 → 死循环。
- 主代理以为「我在全局规则里写过了」→ 但子代理根本没加载全局规则。
- **工具不在表里就静默退化成 Grep**——MCP 未挂载时**连报错都没有**，
  子代理看不到「我该用 codegraph」的提示，于是「优先用 codegraph」这条规则对它等于不存在。
  **`cli_fallback` 块就是为堵这个洞存在的。**
