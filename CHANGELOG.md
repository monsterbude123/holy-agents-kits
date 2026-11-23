# Changelog

本文件是本仓库的**首版**发布说明 —— 只从 0.8.0 起记。

> ⚠️ **口径**：0.8.0 是 npm 上的第一个带本文件的版本。**已装 0.7.0 的用户看不到本期之前的增量**（0.7.0 及更早没有本文件）—— 这里不假装有历史，往后每版往下追加。

## 0.8.1

> **这一版只做一件事**：把 0.8.0 里两条**被复测推翻的结论**改回来 —— 上一版的「VS Code 侧无抽方法」「诊断这条路 VS Code 侧没有腿」是**把一条腿的失败当成了能力不存在**。0.8.0 已发布不可重发，修正走本版。

### 变更

- **选型决策表三行改口径**（`skills/vscode-backend/references/runtime.md` §8 与 `skills/idea-backend/references/capability-matrix.md` §7 **逐字同源**，两份都改了）：
  - **抽方法 / Extract Method** —— 原文写「VS Code 侧无此能力（实现层）」，**错**：该结论来自 agent-lsp `refactor` 工具的一次失败（一个位置 30s 超时、另一个位置直接崩 tsserver）。**2026-11-23 直连 `typescript-language-server` 的 `textDocument/codeAction`(kind=refactor) 实测返 4 个抽方法 action**（`refactor.extract.function` ×2 / `refactor.extract.constant` / `refactor.move.newFile`），每个 action 自带 `_typescript.applyRefactoring` 命令可落盘 ⇒ **VS Code 侧有抽方法，缺的是腿的封装、不是能力**；本机 Python 侧（pyright）不声明 refactor ⇒ 实测 0 个（VS Code + Pylance 有，未在本机实测）。推荐主备也据此调整：TS 走 VS Code 侧直连，JVM / Python 走 IDEA。
  - **全项目规范审查 / Inspect Code** —— 原文写「协议层没有 scope 级检视」，**归因不准**：inspection + scope + 批量修复这套语义 LSP **从未定义**（结论不变），但诊断侧的工作区级请求 `workspace/diagnostic`（LSP 3.17）**协议层存在、实现缺席**（实测 TS 腿 `-32601`、Python 腿超时）⇒ 是「协议有、实现缺席」，不是「协议没有」；VS Code 的 Problems 面板是**客户端聚合** push 诊断的结果，agent 走 MCP 拿不到。
  - **单文件诊断** —— 原文写「VS Code 侧诊断这条路没有腿」，**只对 TS 腿成立**：**Python 腿直连 pyright 的 LSP 3.17 `textDocument/diagnostic` 实测坏文件返 7 条、与同版本 pyright CLI 同数** ⇒ agent-lsp 的 `get_diagnostics` 恒 0 是**那条封装坏了**。TS 腿仍拿不到诊断（两条 MCP 腿 + 直连都不通）⇒ 走 `tsc --noEmit`。
- **新增两条实测凭证 + 四行档位**（`references/measurements/typescript.json`、`references/tiers.md`）：实测 `L5-extract@typescript-ls`（4 个 action）、`L3-pull@pyright`（7 条）；缺口 `L5-extract@pyright`、`L3-pull@typescript-ls`。
- **`vscode-backend` 的 SKILL.md / `setup.md` / `reuse-survey.md` 同步改口径**，并新增 **§6.6「抽方法与诊断怎么走（直连 LSP 那条路，不经 MCP）」** 与 SKILL 里的**第④条腿**（直连语言服务器）。
- **BifrostMCP `get_code_actions` 报 `Illegal argument` 的根因定位**：扩展把 `position` 缺省成 `undefined` 传给 `vscode.executeCodeActionProvider`，而它的 `rangeOrSelection` 参数**必填** ⇒ **补上 position 就能拿到动作列表**（但扩展不返回 edit，落盘仍要直连路）。

### 已知限制

- **抽方法只验到「拿到 action」** —— 落盘那步（`workspace/executeCommand` 调 `_typescript.applyRefactoring`）本轮**没有实测**。
- **Python 侧的抽方法只在 VS Code + Pylance 下存在**（本机 pyright 腿实测 0 个），Pylance 那条路**未在本机实测**。
- **TS 腿的诊断仍然没有路** —— 直连 `typescript-language-server` 既不实现 pull 诊断（`-32601`）也不推 `publishDiagnostics` ⇒ 只能走 `tsc --noEmit` / ESLint。

## 0.8.0

### 新增

- **`vscode-backend`（新技能）** —— 把 VS Code 与语言服务器当 agent 的语义后端，两条腿并行用：
  - **窗口开着时**借 VS Code 自己的能力（BifrostMCP 扩展的原生 MCP 通道：定义 / 引用 / 工作区符号 / 文档符号 / 语义 token）；
  - **窗口关着也能查**（agent-lsp 直跑语言服务器：引用 / 单文件诊断 / 改名删除前的影响面）；
  - 另加**跨语言代码图**（codegraph）作第三条腿。
  - 能力按 **L0-L5 档位逐格实测**，每个数字都能回查到凭证；没有的能力写清「无此能力 + 可核对的来源」。
- **`idea-backend` 新增跨后端选型决策表**（`references/capability-matrix.md` §7，**14 行**）—— 任务类型 × 语言 → 推荐后端 / 依据 / 证据等级 / 代价与前提 / 何时别选它。同一份表在 `vscode-backend` 的 `references/runtime.md` §8 有一份**逐字同源**的副本（两个技能各自独立分发，各带一份）。
- **`idea-backend` 新增实测数据表**（`skills/idea-backend/fixtures/experiment/results.md`）—— **24 格**对照实验（6 个任务 × 4 种配置的逐格数据：召回 / 精度 / 耗时 / 载荷字节 / 失败模式）。

### 变更

- **旧的选型表与比例阈值作废** —— `idea-backend/references/semantic-backend-options.md` 的 §4 旧选型表与 §5 比例阈值（完成率 ≥95%、recall ≥0.9 等）**已作废**，由上面的跨后端选型决策表接管。作废标记在文件里就写着，别再照旧表选型。

### 实测不可用的能力（这一期**别按想象用**）

| 能力 | 实测结论 |
|---|---|
| **VS Code 侧抽方法（Extract Method）** | **不通**。agent-lsp 的 `refactor` 在 tsserver 侧走 `textDocument/codeAction`：一个位置 **30s 超时**，另一个位置直接**崩 tsserver**（`Cannot read properties of undefined (reading 'kind')`）⇒ VS Code 侧无此能力。IDEA 侧有 `ide_refactor_extract_method`，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它）。 |
| **全项目规范审查（Inspect Code）** | **只有 IDEA 有**（`ide_inspect` 按 scope 批检视 = L4，同样需 monster 分支）。这是**协议层缺口**：LSP 的 `textDocument/codeAction` 没有 scope 参数，VS Code 侧 **19 个工具面**里也没有对应工具 ⇒ VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）自己汇总。 |
| **BifrostMCP 的 `get_code_actions`** | **坏的**（扩展 0.0.14 实测报 `Illegal argument`）⇒ VS Code 侧的诊断入口取不到东西。 |
| **agent-lsp 的 `get_diagnostics`（TS 腿）** | **恒返 0 条**（静默失效）。实测：daemon 预热 **130s** 后仍返 0 条，先 `open_document` 也一样；同会话 `list_symbols` 能解析该文件 ⇒ 排除「索引未就绪」；而**同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错** ⇒ **0 条 ≠ 文件干净**。单文件诊断耗时约 **25s**（一次 25011.4ms）。 |

⇒ 结论：**单文件诊断这条路，VS Code 侧本轮没有能用的腿** —— 只剩 IDEA 腿与外部 linter（pyright CLI / ruff）。

### 已知限制（读文档前先知道）

- **两处 reference 较长** —— `skills/vscode-backend/references/runtime.md`（约 620 行）与 `skills/idea-backend/references/capability-matrix.md`（约 730 行）：**决策表在各文件的 §8 / §7（第 90 行上下）**，读完表即可停；其后的数百行是**机器可读块**（JSON），供仓内对账门禁逐格核对用的。拆成独立 json 归后续（要改门禁契约 + 重验）。
- **改名只验到干跑** —— 全局改名的实测全程 `dry_run`（预览覆盖 247 文件 / 740 处），**落盘**的端到端没做过。
- **只覆盖 Python 与 TypeScript 的同题对照** —— JVM / Rust 侧是单边腿既有实测，本期没做同题对照。

### 怎么用（三条腿各自装什么）

| 腿 | 装什么 | 怎么调 | 代价 |
|---|---|---|---|
| **① VS Code 自己的能力**（BifrostMCP） | `code --install-extension ConnorHallman.bifrost-mcp`；再 `bash skills/vscode-backend/scripts/install-vscode-mcp.sh <工作区路径>` | 工程根 `.mcp.json` 指 `type:"sse"` ⇒ 宿主自带 MCP 客户端直接用 | **窗口必须常开**；诊断与改名两个工具在 0.0.14 实测是坏的 |
| **② 窗口外的语义后端**（agent-lsp） | `npm install -g @blackwell-systems/agent-lsp` + `npm install -g typescript-language-server` + 全局 `typescript@5` | `.mcp.json` 指 `{"command":"agent-lsp","args":["typescript:typescript-language-server,--stdio"]}` ⇒ MCP stdio | **server spec 必须带 `,--stdio`**（少了它 broker 自杀，报 `daemon: broker did not start`，而 `agent-lsp doctor` 报 ok 测不出这个坑）；诊断单文件 25s、影响面 19s |
| **③ 跨语言代码图**（codegraph） | `npm install -g @colbymchenry/codegraph` | MCP 工具查符号与影响面 | 本技能**未测**它的档位 |

装技能本身：

```bash
npx holy-agents-kits install vscode-backend   # VS Code / 语言服务器那条线
npx holy-agents-kits install idea-backend     # IDEA 那条线
```

两条线**互不依赖** —— 按上表的选型决策表挑后端即可（IDEA 侧的工具面以 `bash scripts/mcp-call.sh list index` 实测为准，不以文档为准）。
