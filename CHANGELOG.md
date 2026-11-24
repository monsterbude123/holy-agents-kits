# Changelog

本文件是本仓库的**首版**发布说明 —— 只从 0.8.0 起记。

> ⚠️ **口径**：0.8.0 是 npm 上的第一个带本文件的版本。**已装 0.7.0 的用户看不到本期之前的增量**（0.7.0 及更早没有本文件）—— 这里不假装有历史，往后每版往下追加。

## 0.10.0

> **这一版做两件事**：① **全仓 harness 门禁闭环** —— `npm run check` 一条命令机械判定全仓 skill 与规则文件是否合规（issue 自带 文件:行）、提交前自动拦截不合规改动、判定标准只剩一份 `scripts/gates/standards.json`；② **新技能 `vibe-coding-standards` 首次入库**，同时把多个技能的内容修到过门禁。

### 新增

- **统一门禁 `scripts/gates/`** —— `npm run check` 输出一份结构化 JSON 报告（stdout）：3 个检查器（skill 结构 / 规则文件行数 / 交叉引用）各自的退出码、每条问题带**文件:行**、通过清单；任一 error 整体退出码非 0。报告走 stdout 不落仓库。
- **判定标准单一来源 `scripts/gates/standards.json`** —— AGENTS.md / Rule / SKILL.md / Subagent 按组件分档（200/120/150/200，references 300），三个检查器从同一份配置读阈值；改一个数字三处同步。SKILL.md 行数口径统一为**正文、不含 frontmatter**。
- **提交前拦截** —— `core.hooksPath` 指向 `scripts/gates`，pre-commit 调 `npm run check`：不合规的改动提交不进去（不引入 husky / lint-staged 等任何新依赖）。`scripts/gates/install-hooks.mjs --restore` 可按留证恢复原 hook 配置。
- **回滚锚点登记 `scripts/gates/ROLLBACK.md`** —— phase 内每个被改路径都有写下来的改造前锚点（commit / ref / 删除三型）与恢复命令。
- **新技能 `vibe-coding-standards`** —— Vibe Coding 核心组件（AGENTS.md / Rules / Skills / Subagents）的编写原则：地图内联防迷路、规范指针防上下文击穿、5 Pillar context engineering。
- **skill-creator-v2 增强** —— 校验 issue 自带 `file`/`line`（指向真正的问题位置）；引用存在性只认 markdown 链接（代码块里的模板路径不再误报）；`evals/` 新增 3 条机判回归用例与 `run-evals.mjs` 执行入口。

### 变更

- **死引用检查器升级** —— 能抓 markdown 链接形式的坏路径（原先只扫反引号 token，链接里的死链全漏）；样本集从 2 个文件扩到 78 个（`skills/*/SKILL.md` 与 `skills/*/references/*.md`）；git rev range（如 `origin/main..HEAD`）与运行时路径不再误判。
- **多个技能内容合规化** —— `vibe-coding-standards` 21 处旧体积口径换成标准真值、正文瘦身（160→141 行）、5 处死链接改纯文本；`session-distiller` 正文 341→144 行（内容搬进 references 不删）；`website-helper-skill` 正文 157→149 行 + 死链改真；`idea-backend` 一处死链改指现存文件。
- **npm 包新增两个技能** —— `session-distiller`（会话蒸馏器）与 `website-helper-skill`（子域名发布）首次进入发布包。

### 已知限制

- **`~/.agents/skills/` 里的旧副本不会自动更新** —— 重装覆盖：`npx holy-agents-kits@latest install <skill> --force`。
- **Windows 下 pre-commit 每次提交多花约 3 秒**（死引用检查器全量扫描 78 个文件）。

## 0.9.0

> **这一版做两件事**：① 把 0.8.0 里两条**被复测推翻的结论**改回来 —— 「VS Code 侧无抽方法」「诊断这条路 VS Code 侧没有腿」是**把一条腿的失败当成了能力不存在**；② **把三样 IDEA 级能力真正接通**（抽方法 / 全项目检视 / 全局改名落盘）。0.8.0 已发布不可重发，修正与新能力一起走本版。

### 新增（三样 IDEA 级能力，VS Code 侧全通）

- **全项目问题清单（= Inspect Code 等价）** —— 复用现成的 **vsc-lsp-mcp**（VS Code 扩展 `CJL.lsp-mcp`，MIT）：`execute_lsp{operation:"workspace_diagnostics"}` 底层就是 `vscode.languages.getDiagnostics()` 的无参重载（**Problems 面板的数据源**）⇒ 实测对坏文件返 **7 条** error（source=Pylance），与同版本 pyright CLI 的 7 条一致。
- **全局改名并落盘** —— 同一个扩展的 `prepare_rename` → `rename_preview` → `rename_apply`（VS Code 原生 rename provider，`applyEdit` + `save`）⇒ 实测改一个方法名 **4 个文件 / 8 处**全部落盘，`savedToDisk: true`。
- **抽方法并落盘（TS/JS）** —— 仓内新脚本 `skills/vscode-backend/scripts/lsp-refactor.mjs`：TS 的「Extract to function」是 **command 型** code action（`_typescript.applyRefactoring`，不带 edit）⇒ 凡是「只收 edit 型动作」的 MCP（BifrostMCP / vsc-lsp-mcp / agent-lsp）都给不了它，只能直连；脚本用**微软官方 `vscode-jsonrpc`**（不自造协议栈）⇒ 实测一次返 **4 个** action，执行后**落盘成功**（语句抽成新函数、原处换成调用）。
- **新增依赖**：`vscode-jsonrpc`（MIT、零依赖）—— 只给上面那个脚本用。

### 变更

- **选型决策表三行改口径**（`skills/vscode-backend/references/runtime.md` §8 与 `skills/idea-backend/references/capability-matrix.md` §7 **逐字同源**，两份都改了）：
  - **抽方法 / Extract Method** —— 原文写「VS Code 侧无此能力（实现层）」，**错**：该结论来自 agent-lsp `refactor` 工具的一次失败（一个位置 30s 超时、另一个位置直接崩 tsserver）。**2026-11-23 直连 `typescript-language-server` 的 `textDocument/codeAction`(kind=refactor) 实测返 4 个抽方法 action**（`refactor.extract.function` ×2 / `refactor.extract.constant` / `refactor.move.newFile`），每个 action 自带 `_typescript.applyRefactoring` 命令可落盘 ⇒ **VS Code 侧有抽方法，缺的是腿的封装、不是能力**；本机 Python 侧（pyright）不声明 refactor ⇒ 实测 0 个（VS Code + Pylance 有，未在本机实测）。推荐主备也据此调整：TS 走 VS Code 侧直连，JVM / Python 走 IDEA。
  - **全项目规范审查 / Inspect Code** —— 原文写「协议层没有 scope 级检视」，**归因不准**：inspection + scope + 批量修复这套语义 LSP **从未定义**（结论不变），但诊断侧的工作区级请求 `workspace/diagnostic`（LSP 3.17）**协议层存在、实现缺席**（实测 TS 腿 `-32601`、Python 腿超时）⇒ 是「协议有、实现缺席」，不是「协议没有」；VS Code 的 Problems 面板是**客户端聚合** push 诊断的结果，agent 走 MCP 拿不到。
  - **单文件诊断** —— 原文写「VS Code 侧诊断这条路没有腿」，**只对 TS 腿成立**：**Python 腿直连 pyright 的 LSP 3.17 `textDocument/diagnostic` 实测坏文件返 7 条、与同版本 pyright CLI 同数** ⇒ agent-lsp 的 `get_diagnostics` 恒 0 是**那条封装坏了**。TS 腿仍拿不到诊断（两条 MCP 腿 + 直连都不通）⇒ 走 `tsc --noEmit`。
- **新增两条实测凭证 + 四行档位**（`references/measurements/typescript.json`、`references/tiers.md`）：实测 `L5-extract@typescript-ls`（4 个 action）、`L3-pull@pyright`（7 条）；缺口 `L5-extract@pyright`、`L3-pull@typescript-ls`。
- **`vscode-backend` 的 SKILL.md / `setup.md` / `reuse-survey.md` 同步改口径**，并新增 **§6.6「抽方法与诊断怎么走（直连 LSP 那条路，不经 MCP）」** 与 SKILL 里的**第④条腿**（直连语言服务器）。
- **BifrostMCP `get_code_actions` 报 `Illegal argument` 的根因定位**：扩展把 `position` 缺省成 `undefined` 传给 `vscode.executeCodeActionProvider`，而它的 `rangeOrSelection` 参数**必填** ⇒ **补上 position 就能拿到动作列表**（但扩展不返回 edit，落盘仍要直连路）。

### 已知限制

- **Python 侧的抽方法仍然没有腿** —— 本机 pyright 腿实测 0 个（不声明 refactor）；VS Code + Pylance 有 Extract method，但它是 command 型、只活在编辑器里 ⇒ agent 侧要抽方法只能回 IDEA（`ide_refactor_extract_method`）。Pylance 那条路**未在本机实测**。
- **TS 腿的单文件诊断仍然没有路** —— 直连 `typescript-language-server` 既不实现 pull 诊断（`-32601`）也不推 `publishDiagnostics` ⇒ 只能走 `tsc --noEmit` / ESLint（**工作区级清单**走 vsc-lsp-mcp 的 `workspace_diagnostics` 是通的）。
- **工作区级清单只含 VS Code 已分析过的文件** —— 干净仓首次可能为空 ⇒ 先打开文件或等后台分析。
- **vsc-lsp-mcp 的 `code_actions` 在 TS 上会 ENOENT**（VS Code 的 TS 扩展列 refactor 时去 stat「同名符号.ts」）⇒ 抽方法别走它（它的 `workspace_diagnostics` 与 rename 三段式不受影响）。
- **抽方法落盘的四个硬规矩**（写进 `references/setup.md` §6.6）：选区要盖住整条语句并越过结尾一列；工程根取最近的 `tsconfig.json` 祖先目录；客户端必须接住 `workspace/applyEdit` 与 `_typescript.rename` 两个反向请求；CRLF 文件会被插入 LF 行（内容对但变混合换行）⇒ 仓库统一 LF。

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
