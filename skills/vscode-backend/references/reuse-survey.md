# 现成方案清单 —— 把 VS Code / 语言服务器当 agent 语义后端

> **本文是「先查再用」的落点**：动手写任何东西之前，先把社区与平台**已经有的**列清楚，再决定复用哪条、缺什么才自建。
> 数据快照 **2026-11-22**（star / 最近 push 为 GitHub API 当日值；「本机」一列是当天的实测）。每条都有出处；查不到的就明写「查不到」。
> 本技能自带这份清单（另一技能 idea-backend 的选型文档里有同源表）是**独立分发**的需要：本技能要能被单独装上、单独用，引用别人仓里的文件会缺件。重叠部分只保留本技能用得到的行。
> 档位口径（L0-L5）在本技能的 `tiers.md` 里各存一份，口径与另一技能同源（**只写技能名，不写仓内路径**）。

## §0 结论（5 条）

1. **没有官方路径**。`microsoft/vscode-mcp` 这个仓库**不存在**（404）；VS Code 至今**没有任何官方 API** 把自身的符号/诊断能力暴露给外部 MCP 客户端。官方唯一的「服务端」姿态是 `lm.startMcpGateway()` —— 它是**代理**已注册的 MCP server，不暴露 IDE 能力，且仍在 proposed API。⇒ **「VS Code 当语义后端」这件事只有社区实现，没有官方背书**。
2. **1.104 那条「用 MCP 驱动本机 VS Code」的实验已经死了**：2026-10-21 被 `microsoft/vscode@6ba33e0c` 整个删除（"remove obsolete automation MCP server"），始终是内部实验、从未 GA。替代物是 VS Code 仓自己的 `.github/skills/`。
3. **窗口内（VS Code 开着时）**：**BifrostMCP**（本机已装、已实测）就是最省事的路径 —— 19 个工具、符号级 6 个；代价是**窗口必须常开**、诊断没有独立工具、扩展是 AGPL-3.0 且功能代码停在 2025-12-15。
4. **窗口外（语义后端的本来需求）**：**agent-lsp**（`blackwell-systems/agent-lsp`，MIT，今天还在提交）是正解 —— 不依赖任何 IDE 窗口，直跑 LSP，**66 工具 / 23 个 skill / 持久 warm daemon**，自带 `blast_radius`、`preview_edit` / `safe_apply_edit`、**运行期阻断违规调用**。⚠️ **本机实测的关键坑**：server spec 必须带 `,--stdio`（`agent-lsp typescript:typescript-language-server,--stdio`）—— 少了它 `typescript-language-server` 启动即退出、broker 自杀，报 `daemon: broker did not start`；而 `agent-lsp doctor` 走直连路径，**报 ok 也测不出这个坑**。
5. **跨语言那一腿**：**codegraph**（本机已装 1.7.0）—— 跨语言符号图 / 影响面，与语言服务器那条腿互补。

---

## §1 现成方案清单

### §1.1 窗口内：VS Code 扩展宿主型 MCP server（**需要 VS Code 开着**）

| 方案 | 能暴露什么能力 | 是否需要 IDE 在跑 | 传输形态 | 最近 push | 许可可否复用 | 本机是否已装 |
|---|---|---|---|---|---|---|
| **BifrostMCP** | 19 工具；符号级 6（`find_usages` `go_to_definition` `get_workspace_symbols` `get_document_symbols` `get_rename_locations` `get_type_definition`）；诊断仅 `get_code_actions` | 是（扩展宿主） | SSE `:8008/sse` + `/message` | 2026-03-27（**实质功能代码停在 2025-12-15**；无 GitHub Release） | **AGPL-3.0**（可装可用，注意传染性） | ✅ 已装 0.0.14，通道已实测通 |
| juehang/vscode-mcp-server | `search_symbols_code` `get_symbol_definition_code` `get_diagnostics_code` `rename_file_code` 等 | 是 | streamable HTTP `:3000/mcp`（客户端需 `npx mcp-remote@next` 套壳） | 2026-01-07 | MIT | ⬜ 未装 |
| tjx666/vscode-mcp | `get-diagnostics` `get-references` `get-symbol-lsp-info` + rename | 是 | stdio | 2026-08-06 | Anti-996 | ⬜ 未装 |
| acomagu/vscode-as-mcp-server | 命令执行 / 终端 / 调试 / 编辑；**无符号级工具** | 是 | stdio | 2025-10-18 | **无 license**（不可复用） | ⬜ 未装 |
| MCPxHub（`@bugstan/mcpxhub`） | 自动发现并代理多个 IDE 实例上的 MCP | 是 | stdio→HTTP | 2026-11-12 | Apache-2.0 | ⬜ 未装 |

### §1.2 窗口外：直跑语言服务器 / 自建索引（**窗口可关**）

| 方案 | 能暴露什么能力 | 是否需要 IDE 在跑 | 传输形态 | 最近 push | 许可可否复用 | 本机是否已装 |
|---|---|---|---|---|---|---|
| **agent-lsp** | **66 工具 / 33 语言 / 23 个 skill**；`blast_radius`（一次调用替代 20+ 次 LSP 往返）、`preview_edit` / `simulate_chain` / `safe_apply_edit`（只在 `net_delta==0` 时落盘）、**phase enforcement**（运行期阻断违规调用）；持久 warm daemon，Python/TS 冷启动 ~10s | 否 | MCP（stdio 或 `--http`） | **2026-11-22（当天）** | **MIT** | ✅ 已装 0.24.4（⚠️ server spec 必须带 `,--stdio`，见 §0.4） |
| serena | LSP 后端 40+ 语言；自带 **LSP vs JetBrains 能力差异表**（可作横向对照） | 否 | MCP（stdio / HTTP） | 2026-11-19 | SolidLSP=**MIT** + 应用=GPL-3.0 | ⬜ 未装 |
| mcp-language-server | definition / references / rename / diagnostics | 否 | MCP（stdio / HTTP） | 2026-03-01（⚠️ 停更 8.5 月） | BSD-3 | ⚠️ 实测 **Windows 上不可用**：`references` 拼路径时得到 `/d:/workspace/...`（前导斜杠）读不到文件；`hover`/`definition` 可用 |
| codegraph | 跨语言符号图 / 影响面 | 否 | MCP（stdio） | 2026-11-20 | MIT | ✅ 已装 1.7.0 |
| ast-grep-mcp | 结构化模式匹配 | 否 | MCP（stdio） | 2026-11-21 | MIT | ⬜ 未装（`ast-grep` 本体也没装） |
| microsoft/DebugMCP | 调试（断点/单步/变量） | 是（VS Code） | MCP + 独立 CLI | 2026-11 | **MIT** | ⬜ 未装 |
| LSP4IJ | 在 IntelliJ 内跑任意语言服务器（把 LSP 接到 IDE 的 PSI 上） | 是（要 IDEA 在跑） | LSP → IDE 内部桥接 | 2026-11（活跃） | EPL-2.0 | ⬜ 未装 |
| mcpls | 通用 MCP→LSP 桥 | 否 | MCP（stdio） | 2026-11-18 | Apache-2.0 | ⬜ 未装 |
| jonrad/lsp-mcp、Tritlo/lsp-mcp | LSP 桥 | 否 | MCP（stdio） | 2025-03 / 2025-07（均已停更，被 agent-lsp 取代） | MIT | ⬜ 未装 |

### §1.3 可复用的「编排方法论」（**我们能力档位那套的现成参照**）

- **agent-lsp 的 `skills/`（23 个）**：`lsp-impact` `lsp-refactor` `lsp-rename` `lsp-safe-edit` `lsp-simulate` `lsp-dead-code` `lsp-verify` `lsp-explore` `lsp-local-symbols` … —— 它把「正确顺序」编进了 skill，并且在**运行期强制**（不是只写文档）。
- **microsoft/DebugMCP 的 `debug-live` skill** —— 微软官方的同层模板：一个 MCP server 包装一项 VS Code 能力 + 一个 agent skill + 一个**不依赖 VS Code** 的独立 CLI（`npm i -g debugmcp`），并自动装到 `~/.agents/skills/`。⇒ **我们技能该长的形状有官方先例可抄**。
- **`anthropics/skills`（198640★）里没有任何 IDE 语义后端相关的 skill** —— 只有 `mcp-builder`、`skill-creator` 这类通用件。

---

## §2 复用决策

（机器可读块。**这个块是唯一的决策 json**（含 `primary_path` 字段）——脚本与门禁靠它定位；`keep_scripts` 决定仓里留哪些脚本，`measured_by` 决定档位表的数从哪来。）

```json
{
  "primary_path": "分三条腿：①『VS Code 开着时用它的能力』→ BifrostMCP + 工程根 .mcp.json 的原生 SSE 通道（装：code --install-extension connorhallman.bifrost-mcp；配：install 脚本按 config.json 生成 .mcp.json；调：会话里直接用 MCP 工具）；②『不依赖窗口的语义后端』→ agent-lsp（装：npm install -g @blackwell-systems/agent-lsp + typescript-language-server + 全局 typescript@5；配：.mcp.json 指 stdio，args 写 typescript:typescript-language-server,--stdio（--stdio 不能少）；调：MCP，工具按 start_lsp → find_references/get_diagnostics/blast_radius 的顺序用）；③『跨语言代码图』→ codegraph（装：npm install -g @colbymchenry/codegraph；调：MCP 工具查符号与影响面）。",
  "keep_scripts": ["install-vscode-mcp.sh"],
  "drop_scripts": ["vscode-mcp-call.sh", "probe-capability.sh"],
  "measured_by": "现成工具优先，两条腿都实测过：BifrostMCP 的 find_usages / get_workspace_symbols / get_document_symbols / get_semantic_tokens / go_to_definition（VS Code 侧特有能力），agent-lsp 的 find_references / get_diagnostics / blast_radius（窗口外的语义检索与影响面）。实测原始输出入库作凭证（references/measurements/typescript.json），档位表里每个数字都对得上凭证；跑不通的档写「未测 + 原因」，不编数。装法与入参形状见 setup.md（BifrostMCP 事实块 + agent-lsp 段，含 --stdio 那个坑）。",
  "why_drop": "vscode-mcp-call.sh 是手写的 SSE + JSON-RPC 客户端 —— 平台原生 MCP 通道（.mcp.json + 宿主自带客户端）已经覆盖它的全部用途，而且更快更稳（它每次调用都要重开一次 SSE 会话）；probe-capability.sh 是手写的档位探针 —— agent-lsp 已提供 blast_radius 与现成的 skill 编排，它那套「档位 + 判据 + 顺序强制」也正是 agent-lsp 的 skills/ 在做的事。自建时只写缺口那部分：仓里只留 install-vscode-mcp.sh（装扩展 + 起窗口 + 写端点配置 + 生成 .mcp.json）。"
}
```

**为什么 `.mcp.json` 由脚本生成**：端点事实（端口/url）只有一处来源 —— 机器本地的 `config.json`；`.mcp.json` 是它的**生成物**（由 install 脚本写，并加进 `.git/info/exclude`）。手抄 url 会让两处事实源漂移。

---

## §3 「已有、不要自己写」 / 「确实缺，才自建」

### ✅ 已有，不要自己写

| 能力 | 直接用 | 依据 |
|---|---|---|
| VS Code 开着时的符号/定义/引用/改名 | **BifrostMCP**（已装已实测） | §1.1 |
| 不依赖窗口的符号/引用/诊断/影响面/安全编辑 | **agent-lsp**（66 工具 + 23 skill + phase enforcement） | §1.2 |
| 跨语言符号图 / 影响面 | **codegraph**（本机已装 1.7.0） | §1.2 |
| 结构化模式搜索/重写 | **ast-grep-mcp** | §1.2 |
| 调试 | **microsoft/DebugMCP**（官方 MIT + 独立 CLI + skill） | §1.2 |
| 多 IDE 实例发现与代理 | MCPxHub | §1.1 |
| 「档位判据 + 正确顺序 + 运行期强制」的方法论 | agent-lsp 的 `skills/` 与 phase enforcement | §1.3 |
| MCP server 开发脚手架 | `anthropics/skills` 的 `mcp-builder` | §1.3 |
| **MCP 客户端层** | **Python MCP SDK 的 `Client`**（MIT，2.3.0，本机已装）—— 一次握手、循环批量调用、`structured_content` 直接单行 JSON；legacy SSE 用 `mcp.client.sse.sse_client` | §1.3 / 本机实测 |
| **LSP 客户端层** | SolidLSP（MIT，serena 的 `src/solidlsp`，可单独抠出来用）或 mcp-language-server（BSD-3） | §1.2 |
| **stdio↔远程传输桥** | `supergateway`（双向：stdio→SSE/WS/Streamable-HTTP）；`mcp-remote`（只解决「客户端只支持 stdio」） | §1.2 |
| 我们技能该长的形状 | microsoft/DebugMCP 的三件套（MCP server + skill + 独立 CLI） | §1.3 |
| **能力档位的官方口径** | serena README 的 LSP vs JetBrains Plugin 三张表 | §1.2 |
| **评测方法论 + prompt 原文** | serena `docs/04-evaluation/010_methodology.md` + `020_prompts/010_evaluation-prompt.md`（5 类任务 + call counts / payload / prereq 三元组） | §1.2 |
| **跨语言量化锚点** | codegraph 的「Measured cross-file coverage」（21 语言 + 12 框架） | §1.2 |
| **冒烟回归集** | mcp-language-server `integrationtests/{workspaces,snapshots}/`（go/rust/python/typescript 各一套 golden 输出） | §1.2 |
| **持久化索引协议** | **SCIP**（Apache-2.0，rust-analyzer 等原生产出）—— 要跨会话/跨机复用索引就用 SCIP 格式，别自研 schema | §1.2 |
| **抽方法 / 重构 action（TS）** | **VS Code 内置的 `typescript-language-features` 扩展**（注册 CodeActionProvider → tsserver `getApplicableRefactors`）+ **`typescript-language-server`** 把同一能力包成 LSP `textDocument/codeAction`（kind=`refactor.extract.function`）—— 两者是同源能力 | 本机实测（2026-11-23） |
| **单文件 pull 诊断（Python）** | **pyright 的 LSP 3.17 `textDocument/diagnostic`**（本机实测坏文件 7 条、与 CLI 同数）—— 不必经 agent-lsp 那层封装 | 本机实测（2026-11-23） |

### ❌ 确实缺，需要自建（或明确接受缺口）

1. **官方路径缺失**：没有任何官方 API 把 VS Code 自身语义暴露成 MCP（只有 gateway 代理，且是 proposed API）⇒ 只能靠社区实现，**无官方背书/稳定性承诺**。这是「VS Code 当后端」最大的选型风险。
2. **跨语言统一符号空间 + 统一 FQN 身份**：LSP 规范原文 "The protocol currently assumes that **one server serves one tool**." agent-lsp 用「一个进程路由多语言 server」绕开，但仍**没有统一 FQN** ⇒ 要跨语言得在 agent 侧自建符号映射表。
3. **全项目规范审查**（inspection profile + scope + 跨文件 quick fix）：LSP **从未定义**这套语义（`textDocument/codeAction` 只有 uri+range+context.only，**无 scope 参数**）—— 但**归因要分清（2026-11-23 更正）**：诊断侧的**工作区级请求 `workspace/diagnostic`（LSP 3.17）在协议层存在**（语义正是「服务器算全工作区诊断」），缺的是**实现** —— 实测 TS 腿 `-32601`、Python 腿超时；VS Code 的工作区级问题清单是**客户端聚合 push 诊断**的结果（Problems 面板），agent 走 MCP 拿不到 ⇒ 只能外部 linter 自己汇总。
4. **诊断的独立入口**：BifrostMCP **没有** problems 工具（诊断混在 `get_code_actions` 的 `codeAction.diagnostics` 里）⇒ 要「一次调用列出本文件全部问题」，用 **agent-lsp 的 `get_diagnostics`** 更直接。
5. **公开 benchmark**：**查不到**任何公开的「agent + VS Code MCP vs agent + IDEA MCP」对比数据。serena 官方自评用的是 JetBrains 后端，并明说 LSP 后端版「can easily be repeated」（= 还没做）⇒ 对照实验必须自跑。

---

## §4 出处

- VS Code 官方 MCP 边界：<https://code.visualstudio.com/docs/copilot/customization/mcp-servers>；`lm.startMcpGateway()` 在 `src/vscode-dts/vscode.proposed.mcpServerDefinitions.d.ts`；issue #288777。
- 1.104 实验被删：`microsoft/vscode@6ba33e0c`（2026-10-21，"remove obsolete automation MCP server (#343306)"）；宣布原文 <https://code.visualstudio.com/updates/v1_104>。
- VS Code 无符号索引：`src/vs/workbench/contrib/search/common/search.ts` 的 `getWorkspaceSymbols()`（provider 并集去重）。
- VS Code 的 TS 跑 tsserver 自有协议：`extensions/typescript-language-features/src/typescriptServiceClient.ts`。
- IntelliJ 的 TS 双轨（内部引擎 / 可切 tsserver）：<https://www.jetbrains.com/help/idea/typescript-support.html>。
- agent-lsp：<https://github.com/blackwell-systems/agent-lsp>（README 的 66 tools / 23 skills / blast_radius / safe_apply_edit / phase enforcement）；Windows daemon 的 12 个历史缺陷与修复：issue #5（2026-05-22 关闭）。
- serena 能力表与评测方法：<https://github.com/oraios/serena>（`docs/04-evaluation`）。
- microsoft/DebugMCP：<https://github.com/microsoft/DebugMCP>。
- SCIP 索引协议：<https://github.com/sourcegraph/scip>。
- MCP Python SDK（客户端层）：<https://github.com/modelcontextprotocol/python-sdk>。
- ast-grep MCP：<https://github.com/ast-grep/ast-grep-mcp>。
- LSP4IJ（在 IntelliJ 内跑任意语言服务器）：<https://github.com/eclipse-lsp4ij/lsp4ij>（EPL-2.0）。
- codegraph：<https://github.com/colbymchenry/codegraph>。
- 汇总清单：`punkpeye/awesome-mcp-servers`（5450 行，Coding Agents 节 line 885 / Developer Tools 节 line 1520）。
- 抽方法（TS）：VS Code 内置扩展 <https://github.com/microsoft/vscode/blob/main/extensions/typescript-language-features/src/languageFeatures/refactor.ts>（`TypeScriptRefactorProvider` → tsserver `getApplicableRefactors` / `getEditsForRefactor`）；`typescript-language-server` 的 codeAction 包装 <https://github.com/typescript-language-server/typescript-language-server/blob/master/src/lsp-server.ts>（`context.only` 含 refactor 时调 `getRefactors`）与 <https://github.com/typescript-language-server/typescript-language-server/blob/master/src/refactor.ts>（kind 映射 + `_typescript.applyRefactoring`）；LSP 3.17 的 codeActionKind 原文（`refactor.extract` 的例子就写着 "Extract method / Extract function"）<https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#codeActionKind>；Pylance 的 Extract method / Extract variable <https://github.com/microsoft/pylance-release/blob/main/FAQ.md>。
- 范围级诊断：`workspace/diagnostic`（LSP 3.17 pull 诊断）原文 <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#workspace_diagnostic>；VS Code 客户端实现 <https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/diagnostic.ts>；Problems 面板的**客户端跨 uri 聚合** <https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/markers/browser/markersView.ts>。
- BifrostMCP 的 `get_code_actions` 报 `Illegal argument` 的根因：VS Code 内置命令 `vscode.executeCodeActionProvider` 的 `rangeOrSelection` **必填** <https://github.com/microsoft/vscode/blob/main/src/vs/workbench/api/common/extHostApiCommands.ts>。
