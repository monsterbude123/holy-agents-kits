# 语义后端选型：IDEA vs VS Code/LSP/代码图 —— 结论与实验设计

> **本文回答**：「agent 的语义后端除了 IDEA 还有没有平替？VS Code 的索引功底有没有 IDEA 强？」
> **写给**：要做选型决策的人。**数据来源**：① 本机实测（2026-11-22，标注「实测」）；② 官方文档/仓库/issue（标注出处）。
> **相关**：本技能的能力档位口径在 [capability-matrix.md](capability-matrix.md)；IDE 侧怎么用见各语言分册。

---

## §0 结论（先看这三条）

1. **问题要拆对**：「VS Code 的索引功底」这个问法不成立 —— **VS Code 自己没有任何符号索引**。
   它的 `workspace/symbol` 只是把各语言扩展注册的 provider 结果**并集 + 去重**（源码：`src/vs/workbench/contrib/search/common/search.ts` 的 `getWorkspaceSymbols`）。
   真正的「索引/语义」在**语言服务器**里：tsserver / rust-analyzer / gopls / jdtls / pyright。
   ⇒ **真正的比较对象是「IDEA 的 PSI + inspection 栈」 vs 「各语言 LSP 引擎 + 一个 MCP 桥」**，不是「IDE A vs IDE B」。
2. **不能整体平替，但可以按任务分家**：单语言符号检索/引用/改名 → LSP 够用（实测 tsserver 引用召回 **8/8 精确**）；
   **跨语言统一符号空间**、**全项目规范审查（inspection profile + 批检视 scope + 跨文件修复）**、**持久化可复用索引** —— 这三样在 **LSP 协议层就不存在**（§3），换 IDE 也换不掉。
3. **本机已具备做这件事的条件**：VS Code 1.147（自带 tsserver + 内置 MCP 客户端）、全局 `codegraph` 1.7.0、node 22。
   ⇒ **不用等新 IDE**，今天就能做 §5 的对比实验。

---

## §1 本机实测：同一批任务，多个引擎（2026-11-22）

测床：[fixtures/probe-ts](../fixtures/probe-ts)（4 个文件、跨文件引用，零依赖，真值见 [fixtures/README.md](../fixtures/README.md)）
+ `qData`（1517 个 Java 文件、40 模块，真实仓）。

| 引擎 | 是什么 | 跨文件引用召回 | 全工程符号检索 | 语义改名 | 诊断 | 索引成本 |
|---|---|---|---|---|---|---|
| **tsserver**（VS Code 自带 TS 引擎） | VS Code 的 TS 支持真正走的引擎（`navto`/`references`/`rename`/`geterr`） | **8/8 精确**（4 个文件全中，含 import 与调用点） | ✅ `navto` 命中 2，**热 3ms / 冷 17ms** | ✅ `canRename:true` + triggerSpan | ✅ `geterr` 通道可用 | 无持久索引，靠 tsconfig 现建 program |
| **codegraph**（本机全局 1.7.0） | IDE 无关的静态符号图（tree-sitter 系），30+ 语言 | ✅ `impact` **8/8**（含 import 边与成员）；`callers` 7 | ✅ | ✅（renameLocations） | — | qData：**2224 文件 / 60280 节点 / 100412 边 / 40 秒**；`PageResult`（grep 729 处 / 293 文件）→ **746 affected symbols** |
| **IDEA + Index MCP**（社区版） | PSI + 持久化索引 + inspection 引擎 | ✅ Rust/Python 实测 **L2/L3/L5 全通**（`resolvedSymbol.kind="function"`）；**TS 在社区版装不上 → 0** | ✅ | ✅ `canApply:true` + affectedFiles | ✅ 能报真语法错 | 持久化、跨会话、可增量 |

**结论**：**单语言维度上，tsserver 与 codegraph 的引用召回都达到了「精确」水平**（8/8，与 grep 的人工真值一致），并不比 IDEA 弱。
真正的差别不在「找得到找不到」，在 §3 的三件事。

**codegraph 的一个加分项**（IDEA/Index MCP 没有）：`explore` 一次调用返回
「**Blast radius（谁依赖 + 测试覆盖提示）** → 带行号的逐字源码」——实测 2095 字符 / 60 行，
并会标 `tests: src/alpha.test.ts` / `no tests found within 3 caller hops`（改代码前先告诉你有没有测试兜着）。

**可复用的测量工具（本技能新增）**：

```bash
# 同题对比台：同一符号跑多个引擎，出可比表
bash scripts/backend-compare.sh <工程目录> --symbol <符号名> [--file <相对路径>] [--line N] \
                                [--tsserver <tsserver.js>]
# tsserver 单测（VS Code 自带的引擎）
node scripts/tsserver-probe.js <工程目录> --symbol NAME --file src/x.ts --line 8 \
                                --tsserver "<VSCode>/resources/app/extensions/node_modules/typescript/lib/_tsserver.js"
```

⚠️ 各引擎的「引用」口径不同（IDEA = 真代码引用；codegraph = 受影响符号，含 import 边与成员；tsserver = 引用位置），
**数字不可直接相减**；要比就按同一口径重算。IDEA 侧的判据仍是 `resolvedSymbol.kind` 是否为代码符号。

---

## §2 VS Code 侧到底有什么（官方出处）

| 事实 | 出处 |
|---|---|
| VS Code **内置 MCP 支持** 1.102 GA；1.103 支持最新规范（2025-06-18）；1.147 默认启用 "Skills over MCP" | code.visualstudio.com/updates/v1_102 · v1_103 · v1_147 |
| VS Code 只是 MCP **客户端**；「把自身 IDE 能力对外暴露」**只有社区扩展**，官方 release notes 里的 `test/mcp` 是内部实验 | code.visualstudio.com/updates/v1_104 |
| VS Code 的 TS 支持**不跑 LSP**，跑 tsserver 自有协议（`execute('navto'/'references'/'rename')`） | github.com/microsoft/vscode `extensions/typescript-language-features/src/languageFeatures/workspaceSymbols.ts` |
| TS 的 `workspace/symbol` 默认 **project-scoped**（tsconfig 边界），需显式开 `typescript.workspaceSymbols.scope=allOpenProjects` 才跨 project；结果上限 256 | 同上（`searchAllOpenProjects` / `maxResultCount: 256`） |
| VS Code 内置扩展覆盖：TS/JS（内置）、JSON/CSS/HTML、C#、C++、Java（jdtls）、Go（gopls）需另装；**Python 需 Pylance/pyright** | 各扩展的 marketplace 页 |
| **Cursor 的"代码库索引"叙事已转向 grep/Explore**（不存 embedding 索引） | cursor.com/docs/context/codebase-indexing |

**社区 MCP server 现状（2026-11-22 GitHub API 快照）**：

| 类别 | 代表 | ★ / 最近 push | 备注 |
|---|---|---|---|
| VS Code 扩展宿主型 | `juehang/vscode-mcp-server` | 396 / **2026-01-07**（⚠️ 11 个月无提交） | 工具：`search_symbols_code` / `get_symbol_definition_code` / `get_diagnostics_code` / `rename_file_code` … |
| VS Code 扩展宿主型 | `BifrostMCP` | 225 / 2026-10-20 | 明确暴露 **Find Usages / Rename** |
| 直接跑 LSP | `oraios/serena` | **31589** / 2026-11-19 | 双后端：LSP（40+ 语言）/ 付费 JetBrains 插件 |
| 直接跑 LSP | `isaacphi/mcp-language-server` | 1622 / 2026-03-01 | definition / references / rename / diagnostics |
| 结构化检索 | `ast-grep/ast-grep-mcp` | 500 / 2026-11-21 | 只有模式匹配，**无符号身份/引用解析** |
| 代码图 | `colbymchenry/codegraph`（本机已装） | 78344 / 2026-11-20 | 预索引符号图，IDE 无关 |
| ⚠️ 已废弃 | `JetBrains/mcp-jetbrains` | — | 仓库自述："no longer maintained，核心功能已并入 2025.2+ 的所有 IntelliJ IDE" |

**⚠️ 没有任何公开的「agent + VS Code+MCP」 vs 「agent + IDEA+MCP」对比基准**：
Serena 官方自评用的是 **JetBrains 后端**，并明说 "The evaluation can easily be repeated with the LSP-based backend"（= 还没做）。
⇒ **§5 的实验必须自己跑。**

---

## §3 不可替代的三件事（协议级缺失，不是实现质量问题）

| # | IDEA 有 | LSP 3.17 规范里的对应物 | 缺口 |
|---|---|---|---|
| 1 | **跨语言统一符号空间 + 统一 FQN 身份**（一次调用命中 Java/Kotlin/XML/JSON 统一空间） | 规范原文："The protocol currently assumes that **one server serves one tool**. There is currently no support in the protocol to share one server between different tools." | **替代物：没有**。只能 agent 自己多次调用 + 自建符号映射表 = 自研一套索引 |
| 2 | **inspection profile + 全项目批检视 scope + 跨文件修复的 quick fix**（`globalInspection` 扩展点；`lint_files`/`get_file_problems` 走 IntelliJ inspections；**Inspection KTS** 让 agent 自己写规则跑全项目） | 规范只有 `Diagnostic.severity` 枚举；`textDocument/codeAction` 只挂单文件；**无 scope 参数**（`workspace/symbol` 只有 `query`，`textDocument/references` 只有 `includeDeclaration`） | 替代物：**Qodana**（JetBrains 自家 CI）或 **ast-grep + 自写规则**（工程量大） |
| 3 | **持久化、跨会话、跨机复用的结构化索引**（stub tree 落盘、shared indexes 跨机复用、增量重建） | 规范完全不谈索引持久化 | 替代物：各 server 自己的实现（如 gopls 的 filecache），**但不是 agent 可查询的 API** |

**同一个厂商的横向能力表**（Serena 自己做 LSP 后端 vs JetBrains 插件的对比 —— 立场有利益相关，但表本身是最硬的横向证据）：

| Capability | Language Servers | JetBrains Plugin |
|---|---|---|
| find symbol / symbol overview / find referencing symbols | yes | yes |
| **search in project dependencies** | **--** | yes |
| **type hierarchy** | **--** | yes |
| find implementations | 有限（视语言 server） | yes |
| rename | yes（仅符号） | yes（符号/文件/目录） |
| **move / inline / propagate deletions** | **--** | yes |
| replace symbol body / insert after / safe delete | yes | yes |

**可替代的部分（VS Code 侧有等效物）**：单语言符号检索/引用 → 对应语言 LSP；诊断 → LSP `publishDiagnostics` + 语言 linter（eslint/gopls/clippy/ruff）；文本/文件检索 → ripgrep（VS Code 内置就是 rg）；结构化检索 → ast-grep（已有官方 MCP）；跨语言影响面 → codegraph（IDE 无关，30+ 语言统一）。

---

## §4 落地建议（按任务分家，而不是按 IDE 分家）

| 任务 | 建议用 | 为什么 |
|---|---|---|
| 全项目规范审查 / 阿里 P3C / 批检视基线 | **IDEA**（inspection 引擎 + Inspection KTS） | §3 第 2 条：协议级无对应物 |
| JVM 的符号级检索/影响面 | **IDEA**（PSI 统一空间 + 持久化索引） | 同上；且实测 1.6s / 95 引用零假命中 |
| TS/JS 的符号级检索/改名/诊断 | **tsserver（VS Code 自带）或直接跑 LSP** | 实测召回 8/8 精确；不需要等 IDE 授权门禁 |
| Rust 的符号级 | **rust-analyzer** 或 IDEA（社区版已实测可用，见 [langs/rust/runtime.md](langs/rust/runtime.md)） | 两条都通 |
| 跨语言影响面 / 代码地图 | **codegraph**（IDE 无关，30+ 语言） | 实测 1517 文件仓 40 秒索引；一次调用给 blast radius + 测试覆盖提示 |
| 结构化模式搜索/重写 | **ast-grep**（有官方 MCP） | 语法级，跨语言规则；不解析类型 |
| 「这仓是干什么的 / 怎么走通的」 | **codegraph**（探索/发现层） | 实测一次调用 2095 字符给到符号源码+调用路径 |

**关键认知**：**不要按 IDE 选，按「任务类型 × 语言」选**。同一个 agent 会话里，
IDEA（MCP 工具）+ codegraph（探索/影响面）+ LSP（单语言精查）可以并存 —— 它们解决的是不同问题。

---

## §5 对比实验设计（可执行 · 先定判定规则再跑）

**目标**：回答「把语义后端从 IDEA 换成 VS Code+X，任务完成率/成本/耗时变多少」。

**最小规模（半天版，先拿方向性结论）**：1 个多语言 monorepo × 6 个任务 × 2 个方案（A=IDEA，MCP；B=VS Code/LSP 路线）。

**任务集**（每类 1~2 个，判定口径写死）：

| 类别 | 任务 | 判定口径 |
|---|---|---|
| T1 找定义 | 给符号名定位声明（含跨模块 1 个） | 文件+行正确 |
| T2 找引用/影响面 | 列出全部引用 | 与人工标注 gold set 比 precision/recall |
| T3 跨文件重构 | 改符号名保持编译通过 / 移动文件修 import | 编译通过 ∧ 残留引用 = 0 |
| T4 规范审查 | 全项目跑一类既有规则 | recall vs 真值 + 误报数 |
| T5 跨语言 | 找一个「A 语言引用 B 语言符号」的引用 | **能否召回**（预期 VS Code 侧为 0 → 实证 §3 第 1 条） |

**度量**：① 任务完成率（主指标）② T2 的 precision/recall ③ 工具调用次数 ④ token/任务 ⑤ 端到端耗时（**含索引预热**）⑥ 失败模式分类（**单列「索引未就绪/Dumb Mode」**——这是 IDEA 方案最容易被低估或高估的变量）。

**控制**：同一 agent / 同一模型 / 只换工具面；每任务跑 3 次（先热身 1 次不计分）；记录 agent 是否「先 grep 再符号检索」。

**判定规则（事前写死）**：
- T1+T2 完成率 ≥95% 且 precision/recall ≥0.95 → 「VS Code 侧够用（单语言维度）」；
- T4 recall ≥0.9 → 「批检视可替代」；**<0.7 → 结论即「IDEA 的 inspection 引擎不可替代」**；
- T2 的 token/任务 > IDEA 的 2× → 「迁移不划算」；
- T5 跨语言用例在 VS Code 侧完成率为 0 → 实证 §3 第 1 条。

**本技能已备好的测量台**：`scripts/backend-compare.sh`（同题多引擎对照）+ `scripts/tsserver-probe.js`（VS Code 引擎单测）。
先用它把「同一符号、同一工程、各引擎多少命中/多少毫秒」量出来，再决定要不要做完整实验。

---

## §6 附：本机现状（2026-11-22）

| 项 | 状态 |
|---|---|
| IDEA | IC 2026.2.5 社区版 + Index MCP 5.20.7 + Python CE + Rust + capability shim（见 [capability-matrix.md](capability-matrix.md)） |
| VS Code | **1.147.0**（自带 tsserver `_tsserver.js` + 96 个扩展 + 内置 MCP 客户端） |
| codegraph | 全局 **1.7.0**（`@monsterbude/codegraph`），30+ 语言，预索引符号图 |
| node / npm | 22.14.0 / 10.9.2 |
| 其他已装 AI IDE | Antigravity / Antigravity IDE / CodeBuddy CN / Trae CN / TRAE SOLO CN / MiniMax Code / Codex++（本轮未展开调研） |

⚠️ **注意**：`codegraph init` 会在目标仓写 `.codegraph/` 目录 —— **先确认该仓是否 gitignore 了它**，
否则会污染用户仓库（本轮实测 qData 未 ignore，已清理）。
