# §12 — MCP 异常处理 / 降级协议

> **核心精神**：**默认动作 = 修复，不是降级。** 先试修复，修复失败才降级。降级路径**不阻塞**修复流程。

---

## §12.0 状态判定（先分清，别一上来就降级）

| 状态 | 判据 | 处置 |
|---|---|---|
| **正常** | `codegraph_explore` 正常返回源码 + Relationships + Blast radius | 不触发任何降级 |
| **索引陈旧** | 返回体顶部出现「edited since the last index sync — entries may be stale」 | **不是降级理由**。读到的仍是 on-disk 逐字源码；按提示对那几个文件改用 `Read` 即可 |
| **索引借用** | 返回体顶部出现「results below come from a different git worktree」/ `status` 显示索引来自别的目录 | **不是降级理由，也不是「整棵不可信」**。图谱只对「两树内容不同」的文件是错的；两树一致的文件**逐字正确，照常用**。按差集处理 → §12.1.5 |
| **索引缺失** | worktree / 新检出没有 `.codegraph/` | **不是 MCP 不可达**。走 §12.1 修复，优先 CLI |
| **MCP 不可达** | MCP 工具在列表里、但调用持续异常 | **先试 CLI**（§12.2）——能力不打折，**这不算降级** |
| **MCP 未挂载** | **工具列表里根本没有** `codegraph_explore` | **不是故障，更不是降级理由**。用 CLI（§12.2），输出与 MCP 同形。这是**宿主限制**，不是索引问题——不要为此去找主代理「修 MCP」 |
| **全不可用** | MCP 未挂载**且** CLI 也不可用 | 走 §12.3 降级 |

> **「未挂载」必须与「不可达」分开判。** 前者连报错都不会出现（工具压根不在函数表里），
> 后者调用被投递了但返回错误。两者的正确动作**完全相同**：走 CLI，能力不打折。

> **`stale` ≠ `不可达`。** 「返回提示 stale」不构成转 Grep 的许可证。
> 有 stale 文件时，图谱仍会完整返回其它文件的逐字源码与关系，能力并未降级。

> **索引缺失也不等于不可达。** 上游说明：server 自己的根没有 `.codegraph/` 时工具仍可用，
> 传 `projectPath` 可以查询任何已索引的项目；没有索引的路径返回**干净指引**而不是报错。

---

## §12.1 索引缺失的修复 SOP（**只有主代理有权执行 · 优先 CLI**）

| 步骤 | 命令 | 说明 |
|---|---|---|
| 1 | `codegraph status` | 先看索引到底有没有、多大（**排查第一步**） |
| 2 | `codegraph init` | worktree / 新检出建索引。**索引不随 git 传播，缺是常态不是故障** |
| 3 | 若 `init` / `index` **卡住不动** | `codegraph unlock` —— stale lock 是常见原因 |
| 4 | 常规刷新 | `codegraph sync`（**通常不需要**：MCP server 有 auto-sync，事件防抖增量同步） |
| 5 | 验证 | 再跑一次 `codegraph_explore`。**若本会话在 init 前已查过该路径 → 重启会话再验**（长驻 server 会把首次归属判定钉死，见 §12.1.5） |
| 6 | **子代理无权执行本 SOP**，必须报告给主代理 |

> **不接受「索引缺失」成为默认状态。** 它是环境问题，报告 + 修复，不是降级理由。
> 完整命令表见 `references/cli.md`。

---

## §12.1.5 多 worktree 索引归属错乱：借用 / 钉死 / 冻结

> §12.0 状态表只覆盖「索引在不在 / MCP 通不通」。下面三个模式里索引**存在**，只是不属于你
> 正在查的那棵树——症状是「结果可疑」而非「调用失败」，最易演成「不信图谱 → 整体退回 Grep」。

**判定口诀：CLI 对、MCP 错 = server 归属钉死，重启会话是唯一解；`sync` / `index -f` 都治不了它。**

| 模式 | 机理 | 症状 | 解法 |
|---|---|---|---|
| **借用**（静默查错树） | 子检出无自己的索引，查询沿父链上溯命中**上层检出**索引（schema：nearest `.codegraph/` *at or above* that path） | 返回**另一分支**的代码 +「belongs to a different git working tree」警告；比返回空更危险——结果看着有，只是属于别的分支 | **按差集不信，不是整棵不信**：借用时 Source Code 是 **owner 树的磁盘内容**，worktree 改过的文件它给 owner 版，行号都对不上；但**两树内容一致的文件逐字正确** → 名单外照常用图谱，只对名单内文件 `Read` 本检出版本（名单生成方式见 `references/subagent-contract.md` §11.2）。该检出仍建议跑 `codegraph init`（§12.1） |
| **钉死** | 长驻 server **首次**见到某路径时把归属判定锁死整个进程生命周期；事后在该检出 `init` / `index -f` 都掰不回 | CLI `codegraph status <path>` 判定正确，MCP 仍打错库 + 挂同一个假警告 | **重启会话** |
| **冻结** | `.codegraph/` 删了重建 / 同路径重建，server 仍握已删库的句柄 | 删掉的符号还在、新符号永远查不到、`sync` 救不回——「索引看着正常」 | 重启会话。Windows 上删不掉被打开的文件，同一根因表现为 `index` 报 EPERM |

**诊断顺序**（在出问题的检出里跑）：

1. `ls .codegraph/` —— 判据是 **`codegraph.db` 存在**，不是目录存在。
2. `codegraph status` —— CLI 视角的归属与规模。
3. `codegraph index -f` —— 强制全量重建；**不是 `sync`**（sync 只增量，救不了钉死 / 冻结）。
4. 再查一次 CLI；**CLI 对、MCP 还错 = 钉死实锤** → 重启会话。

**环境两条**：

- **共享 daemon 耦合**：若 MCP 配置未设 `CODEGRAPH_NO_DAEMON`，多个客户端共享 daemon。排查期要彻底隔离可加该环境变量，但改全局配置属于破坏性操作，先取得授权。
- **inotify 上限**：Linux 侧多 worktree 并开可能撞 `fs.inotify.max_user_watches`，撞线后部分目录**静默**失去 live watching，索引看着正常但新改动不进。Windows / macOS 不走 inotify，无此坑。

**短期固定动作**：worktree 建完**立刻**建索引；init 完若本会话已查过该路径，**重启会话**再信 MCP。

---

## §12.2 MCP 不可达时：先试 CLI，**这不算降级**

```yaml
MUST §12-2-0: MCP 不可达 ≠ 失去 codegraph 能力
  codegraph CLI 独立于 MCP server, 隐藏的 7 个 MCP 工具全部有 CLI 等价物:
    codegraph explore <query>     # 与 MCP codegraph_explore 同形输出
    codegraph node <symbol|file>  # 单符号源码 + callers, 或按行号读文件
    codegraph query <search>      # 搜符号(MCP 侧叫 search)
    codegraph callers <symbol>    # 谁调用了它
    codegraph callees <symbol>    # 它调用了谁
    codegraph impact <symbol>     # 改它会影响什么
    codegraph files [path]        # 文件结构
    codegraph status [path]       # 索引是否存在/多大 + 归属哪棵树
    codegraph affected <files>    # 仅 CLI: 改这些文件会波及哪些测试
  → 走 CLI 后能力不打折, blast radius / callers / callees 全部拿得到。
  → 写报告时注明 "MCP 不可达, 走 CLI", 不打 codegraph-mcp-downgraded 标记。
  只有 CLI 也不可用时, 才进 §12.3。
```

---

## §12.3 真降级（MCP 与 CLI 均不可用）

```yaml
MUST §12-3-1: 主代理亲自执行, 不委派子代理
  STEP_1_grep:   Grep(pattern="<symbol>", path="<源码目录>")   # path 必带, 限定范围
  STEP_2_read:   Read → chunk 读(指定 offset/limit), 不全量
  STEP_3_manual_impact: 手动判 blast radius
    - upstream (谁调用它):   Grep 上游引用 → 直接 caller
    - downstream (它调用了谁): Grep 下游引用 → 直接 callee
    - 列出 risk: LOW / MEDIUM / HIGH / CRITICAL
  STEP_4_log:    报告与 commit body 必带 codegraph-mcp-downgraded 标记 (见 §12.5)

MUST §12-3-2: 兜底必跑
  - git log --oneline -- <file>          # 变更历史
  - 项目自己的类型检查 / 测试命令 (exit 0, 不可降级)

MUST §12-3-3: 待办清单里必填一条 "codegraph MCP + CLI 均不可达, 走 Grep + Read + manual impact"
```

---

## §12.4 与「主动降级」的区别（关键）

本节只管**环境坏了**。它**不适用于**下面这些情况——后者是违规，不是降级：

| 说法 | 判定 | 正确动作 |
|---|---|---|
| 「MCP 报错」 | ⚠️ 半降级 | **先试 CLI**（§12.2）——能力不打折，不算降级 |
| 「索引缺失 / worktree 没 `.codegraph/`」 | ❌ **不是** | `codegraph init`（§12.1）。索引不随 git 传播，这是常态 |
| 「返回提示有 stale 文件」 | ❌ **不是** | 能力正常，按提示对那几个文件改用 `Read`，其余照常用 |
| 「结果被 `maxFiles=12` 截断了」 | ❌ **不是** | **调高 `maxFiles` 重调** |
| 「这次已经调过了，够了」 | ❌ **不是** | 换方向就重调（MUST-ORIGIN-2） |
| 「调过一次结果看着挺全」 | ❌ **不是** | 补调（ceremonial-call，见 `references/anti-patterns.md` §3 #6） |

**没有一行能直接进 §12.3。** §12.3 只在 MCP **和** CLI 都真的不可用时才启用。其余都是反模式。

---

## §12.5 影响标记

降级发生时，**报告与 commit body 必须带标记**：

```
codegraph-mcp-downgraded
codegraph-impact: <一句话说明这次降级后怎么判的 blast radius>
```

> 这两个标记是为了：① 事后 `git log --grep` 可追溯；② 若将来接入门禁，有现成契约可用。
> 本技能不附带门禁脚本。
