# 能力面实测 —— 档位表与代价边界

> **数从哪来**：现成工具实测，原始输出入库在 `references/measurements/typescript.json`（可逐格复核）；本表里每个数字都能在那儿对上。
> **测床**：真实工程 `ai-short-studio-monster-2`（TS）；锚点 `apiFetch`（`src/lib/api-fetch.ts:78`）。
> **测的时候**：2026-11-22，VS Code 1.147.0 + BifrostMCP 0.0.14（窗口开着）+ agent-lsp 0.24.4。

## 档位表

| 档@路线 | 手段 | 语言 | 命中数 | 原始ms | 净ms | 判据 |
|---|---|---|---|---|---|---|
| L0@bifrost-mcp | get_document_symbols | typescript | 10 | 9.6 | 2.8 | 文档符号清单：10 个符号（变量/函数/类型） |
| L1@bifrost-mcp | get_semantic_tokens | typescript | 108 | 9.7 | 3 | 语义 token：108 个（参数/标识符/关键字着色） |
| L2-def@bifrost-mcp | go_to_definition | typescript | 1 | 9.1 | 2.3 | 按位置跳定义：命中 apiFetch 的定义（0-based 77-82） |
| L2-ref@bifrost-mcp | find_usages | typescript | 740 | 1150.8 | 1144.1 | 全仓引用：740 处（TS/TSX 混排，含定义） |
| L2-ws@bifrost-mcp | get_workspace_symbols | typescript | 190 | 642.2 | 635.4 | 工作区符号：190 条 —— **噪音高**（多数是「# files: …」这类聚合项，真 TS 符号只占少数） |
| L2-ref@agent-lsp | find_references | typescript | 739 | 460.9 | 456.1 | 全仓引用：739 条（与上一行同一锚点同一工程，差 1 = includeDeclaration 口径不同） |
| L3@agent-lsp | get_diagnostics | typescript | 0 | 25011.4 | 25006.5 | 单文件诊断：**0 条**（该文件没有 tsserver 语义错误）—— 但**耗时 25s**，是本轮最贵的一次调用 |
| L5@agent-lsp | blast_radius | typescript | 446 | 18887.7 | 18882.8 | 改名/删除前的影响面：**446 个符号 / 445 条边**（GCF 图）—— 给影响面，不落盘 |
| L3@bifrost-mcp | get_code_actions | typescript | — | — | — | 无此能力 —— 实现层：实测 get_code_actions 报 Illegal argument（内部 vscode.executeCodeActionProvider 收到 undefined 的 rangeOrSelection），扩展 0.0.14 |
| L4@lsp | （协议层） | 全部 | — | — | — | 无此能力 —— 协议层：LSP 的 textDocument/codeAction 请求没有 scope 参数，协议里没有「一次批检视一个范围」这个能力；VS Code 侧 19 个工具里也没有对应工具 |
| L5@bifrost-mcp | get_rename_locations | typescript | — | — | — | 无此能力 —— 实现层：实测 get_rename_locations 报 Unexpected type，扩展 0.0.14 |
| L0@agent-lsp | （未测） | typescript | — | — | — | 未测：这条腿本轮只测了引用/诊断/影响面三档，文件级与文本级没测 |
| L2-def@agent-lsp | （未测） | typescript | — | — | — | 未测：同上（agent-lsp 的定义检索工具本轮没单独跑） |
| L0@codegraph | （未测） | 多语言 | — | — | — | 未测：codegraph 已装（本机 1.7.0），本轮没测它的档位 |

**表怎么读**：
- **实测行**：第 4/5/6 列是实测数（命中数 / 单次调用往返 / 扣掉基线后的净耗时），逐格对得上 `references/measurements/typescript.json`；
- **缺口行**：三列都是 `—`，第 7 列写「无此能力」+ 可逐字核对的来源；
- **未测行**：三列都是 `—`，第 7 列写「未测」+ 原因。

**耗时口径**：`原始ms` = 单次 MCP 调用往返（含协议往返）；`净ms` = max(0, 原始ms − 基线)，基线 = 3 次 `tools/list` 的中位数（纯协议往返，不触工程：BifrostMCP 6.7ms、agent-lsp 4.9ms）；**首次调用的冷启动单独记**（BifrostMCP 146.7ms、agent-lsp `start_lsp` 71ms；另有一轮会话冷启动 23.6s —— 那是 VS Code 侧 TS 索引预热，索引热了以后就几十毫秒）。

## 代价与边界

| 项 | 结论（实测） |
|---|---|
| **两条腿的分工** | **BifrostMCP**：要 **VS Code 窗口开着**（服务跑在扩展宿主里，窗口一关端口就没了），能力到 L2（定义/引用/工作区符号）+ L0/L1，**L3 诊断与 L5 改名在 0.0.14 是坏的**；**agent-lsp**：**窗口关着也能跑**，能力到 L2/L3/L5（引用/诊断/影响面） |
| **agent-lsp 的启动参数坑** | server spec 必须带 `,--stdio`（`agent-lsp typescript:typescript-language-server,--stdio`）：少了它 broker 拉起的 server 启动即退出、broker 自杀，报 `daemon: broker did not start within 45s`；**这不是 Windows 缺陷**（daemon 在本机 Windows 上跨会话存活正常，uptime 20 分钟+）。失败现场在 `~/.cache/agent-lsp/spawn-logs/<语言>.log` |
| **`doctor` 报 ok 不等于 daemon 链路可用** | doctor 走**直连**路径且 autodetect 自带 `--stdio` ⇒ 测不出上面那个坑（本轮踩过） |
| **诊断的成本** | agent-lsp 的 `get_diagnostics` 单文件 **25s**（daemon 已 ready 状态）—— 大仓里按文件逐个问诊断会很贵 |
| **影响面的成本** | agent-lsp 的 `blast_radius` **18.9s**（446 符号 / 445 条边）；BifrostMCP 侧**没有**等价工具（L5 不可用） |
| **两条腿的引用数差 1** | 同一锚点同一工程：BifrostMCP 740 条 / agent-lsp 739 条 —— `includeDeclaration` 口径不同，不是谁对谁错 |
| **VS Code 侧诊断从哪来** | 只有 `get_code_actions` 里，而该工具实测坏了 ⇒ **这一轮 VS Code 侧拿不到诊断** |
| **VS Code 的 TS 跑什么协议** | 跑 **tsserver 自有协议**，不跑 LSP ⇒ 跨语言引用在 TS 上结构性不可能 |
| **两个协议级缺口** | ① **跨语言统一符号空间**：LSP 规范原文 "The protocol currently assumes that one server serves one tool."；② **全项目批检视**：`textDocument/codeAction` 无 scope 参数，协议层没有这个能力 |
| **许可** | BifrostMCP 是 **AGPL-3.0**（自用无碍；分发要当心）；agent-lsp / codegraph 是 MIT |
| **扩展的活跃度** | BifrostMCP 的**实质功能代码停在 2025-12-15**（仓库最近 push 2026-03-27，无 Release）⇒ 上游不会修 L3/L5 那两个坏工具 |

## 人工项

（测什么 / 期望什么 / 怎么算过）

| 测什么 | 期望 | 怎么算过 |
|---|---|---|
| 关掉 VS Code 窗口后端口还在不在 | 应消失（服务跑在扩展宿主里） | `netstat -ano \| grep :8008` 无 LISTENING |
| 只开窗口不加载工作区 | 服务仍起，但符号工具没有项目可查 | `tools/list` 可用、`get_workspace_symbols` 返回空 |
| 窗口常开但工作区换成了别的仓 | 测的就变成别的仓（**静默测错对象**） | 查 `get_workspace_symbols` 的结果路径是否属于目标仓 |
| `find_usages` 命中的位置基准 | 传零基准的行号才落在符号上 | 传 1-based 的 78 会落到下一行；传零基准的 77 命中 apiFetch 定义 |
| 工作区符号的噪音比例 | 知道 190 条里有多少是真符号 | 看返回项的 `name` 字段：多数是 `# files: …` 聚合项 |
| agent-lsp 的 daemon 是否活着 | `agent-lsp daemon-status` 报 ready | 报 ready 才算链路可用（doctor 不算数） |

## 怎么重测

1. **准备**：VS Code 开着、扩展已装（`code --list-extensions | grep bifrost`）；`npm install -g @blackwell-systems/agent-lsp` + `npm install -g typescript-language-server` + 全局 `typescript@5`（TS 7 没有 `lib/tsserver.js`）。
2. **起通道**：`bash skills/vscode-backend/scripts/install-vscode-mcp.sh <工作区路径>`（写 `config.json` + 生成工程根 `.mcp.json`）；确认：`bash skills/vscode-backend/scripts/install-vscode-mcp.sh --check` 报「通道就绪」。
3. **按凭证里的调用重跑**（凭证里每条都记了 `tool` + `args`，逐条调用即可复现同样的数）：
   - `tools/call get_document_symbols {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"}}`
   - `tools/call get_semantic_tokens {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"}}`
   - `tools/call go_to_definition {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"},"position":{"line":77,"character":0}}`
   - `tools/call find_usages {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"},"position":{"line":77,"character":0},"context":{"includeDeclaration":true}}`
   - `tools/call get_workspace_symbols {"query":"apiFetch"}`
   - 诊断/改名两档要复核扩展是否修好了：`tools/call get_code_actions {...}`、`tools/call get_rename_locations {...}`（**位置零基准**；uri 必须 `file:///<小写盘符>/…`）
   - agent-lsp 那条腿：`agent-lsp typescript:typescript-language-server,--stdio` 起（MCP stdio）→ `tools/call start_lsp {"root_dir":"<project>","language_id":"typescript"}` → `tools/call find_references {"file_path":"<project>/src/lib/api-fetch.ts","line":78,"column":23}` → `tools/call get_diagnostics {"file_path":"<project>/src/lib/api-fetch.ts"}` → `tools/call blast_radius {"changed_files":["<project>/src/lib/api-fetch.ts"]}`（**column 必填**）
4. **换版本/换语言后**：改 `references/measurements/<语言>.json`，再按同一口径重测并更新本表 —— **表里的数字不许手写**（门禁逐格对账）。

## 口径与证据边界

| 结论 | 证据等级 | 出处 |
|---|---|---|
| L0-L5 的命中数与耗时（两条腿） | **本仓实测**（2026-11-22） | `references/measurements/typescript.json`（原始输出片段 + 调用参数 + 口径定义） |
| L3/L5 在 BifrostMCP 上不可用 | **本仓实测**（错误原文） | 实测 `get_code_actions` → `Illegal argument`；`get_rename_locations` → `Unexpected type` |
| agent-lsp 必须带 `,--stdio` | **本仓实测**（错误原文 + 源码路径） | `~/.cache/agent-lsp/spawn-logs/typescript.log` 的 `required option '--stdio' not specified`；broker 按逗号拆参数后没传该参数 |
| L4 协议层缺失 | **协议原文** | LSP 规范：`textDocument/codeAction` 无 scope 参数；VS Code 侧 19 工具面实测无对应工具 |
| VS Code 的 TS 不跑 LSP、workspace/symbol 是 provider 并集 | **上游源码/文档** | `extensions/typescript-language-features/src/typescriptServiceClient.ts`；`src/vs/workbench/contrib/search/common/search.ts` |
| agent-lsp 的能力面（66 工具 / 23 skill / blast_radius / phase enforcement） | **二手（上游 README）** | <https://github.com/blackwell-systems/agent-lsp> |
| 扩展的许可与活跃度 | **二手（仓库元数据）** | GitHub API（2026-11-22） |

**边界**：本表只覆盖**本机、本版本、TS**；换语言/换版本/换机器都要重测（步骤见 §4）。本表**不做跨后端优劣比较**（那是「选型」的事，属另一阶段）。
