---
name: vscode-backend
description: 把 VS Code 与语言服务器当 agent 的语义后端，两条腿并行用。一条是「窗口开着时用 VS Code 自己的能力」——BifrostMCP 扩展的原生 MCP 通道（工程根 .mcp.json 指向，符号级 6 个工具）；另一条是「窗口关着也能查」——agent-lsp 直跑 LSP（引用/诊断/影响面，窗口无关）。装什么、怎么配、怎么调、能力到哪一档（实测数字，不是印象）、代价在哪（要开窗口/诊断 25 秒/扩展版本坏了哪两个工具），都写在本技能里。触发词：VS Code、vscode、符号、引用、 usages、find_references、诊断、diagnostics、改名、rename、影响面、blast_radius、LSP、agent-lsp、BifrostMCP、MCP 通道、.mcp.json、语言服务器、tsserver、档位、能力矩阵。
---

# vscode-backend —— 让 VS Code / 语言服务器成为 agent 的语义后端

> **定位**：agent 的语义后端**不只有一种**。本技能给出两条**互不依赖**的腿：一条借用 **VS Code 自己的**能力（要窗口开着），一条**不依赖窗口**（直跑语言服务器）。选哪条看任务与代价，见 `references/runtime.md`。
> **纪律**：**能力面以实测数字为准**（引用命中数 / 耗时 / 判据），表里每个数字都能在 `references/measurements/` 里对账；**没有的能力写清「无此能力 + 可核对的来源」**，不写印象。
> **机器事实只有一处**：端点、端口写在机器本地的 `config.json`（不入库、不分发），`.mcp.json` 由它生成 —— **别手抄 url**。

## 一、三条腿（各装什么、怎么调）

| 腿 | 干什么 | 装 | 怎么调 | 代价 |
|---|---|---|---|---|
| **① VS Code 自己的能力** | 定义 / 引用 / 工作区符号 / 文档符号 / 语义 token | `code --install-extension ConnorHallman.bifrost-mcp`；`bash [scripts/install-vscode-mcp.sh](scripts/install-vscode-mcp.sh) <工作区路径>` | 工程根 `.mcp.json` 指 `type:"sse"` ⇒ 宿主自带 MCP 客户端直接用 | **窗口必须常开**；诊断与改名两个工具在 0.0.14 实测是坏的 |
| **② 窗口外的语义后端** | 引用 / 单文件诊断 / 改名删除前的影响面 | `npm install -g @blackwell-systems/agent-lsp` + `npm install -g typescript-language-server` + 全局 `typescript@5` | `.mcp.json` 指 `{"command":"agent-lsp","args":["typescript:typescript-language-server,--stdio"]}` ⇒ MCP stdio | **server spec 必须带 `,--stdio`**（少了它 broker 自杀，报 `daemon: broker did not start`）；诊断单文件 25s、影响面 19s |
| **③ 跨语言代码图** | 跨语言符号图 / 影响面 | `npm install -g @colbymchenry/codegraph` | MCP 工具查符号与影响面 | 本技能**未测**它的档位 |

> 腿 ② 的 `--stdio` 与「doctor 报 ok 不等于 daemon 链路可用」的坑，写在 `references/setup.md` 的 agent-lsp 段 —— **照抄命令前先读那一段**。

## 二、能做什么 / 不能做什么（事实陈述）

**能**（TS 实测，见 `references/runtime.md` 的档位表）：

- 找定义、找全仓引用、列工作区符号、列文档符号、拿语义 token（腿 ①）；
- 找引用、拿单文件诊断、算改名/删除前的影响面（腿 ②，窗口无关）；
- 档位口径（L0-L5）逐档可查，**每一格都有实测数字或可核对的缺口来源**。

**不能**（写清楚比含糊强）：

- **VS Code 侧没有独立诊断入口**：诊断只挂在 `get_code_actions` 里，而该工具在 0.0.14 实测报错 ⇒ 诊断走腿 ②；
- **VS Code 侧没有改名工具**：`get_rename_locations` 实测报错 ⇒ 改名/影响面走腿 ②；
- **影响面会静默少报**：agent-lsp 的 `blast_radius` 在 daemon 索引不全时返回残缺图且**不给提示**（实测 ready 时也只给 11 符号）⇒ 用它当影响面前，先 `daemon-status` 报 ready **且**图的规模与预期量级相符；
- **全项目批检视是协议级缺口**：LSP 的 `textDocument/codeAction` 没有 scope 参数，协议里没有「一次批检视一个范围」这个能力；
- **跨语言统一符号空间没有**：LSP 规范原文 "The protocol currently assumes that one server serves one tool."；
- **VS Code 的 TS 跑 tsserver 自有协议，不跑 LSP** ⇒ 跨语言引用在 TS 上结构性不可能。

## 三、怎么用（调用顺序与硬规矩）

1. **先判腿**：要 VS Code 自己的视角（工作区符号、文档符号、语义 token）→ 腿 ①；要语义检索与影响面（尤其窗口关着）→ 腿 ②；要跨语言 → 腿 ③。
2. **腿 ① 的调用顺序**：`initialize` → `notifications/initialized` → `tools/list` / `tools/call`（宿主 MCP 客户端自动做；排障时的协议事实见 `references/setup.md` §4）。
3. **腿 ② 的调用顺序**：先 `start_lsp{root_dir, language_id}`，再调其它工具（没起就调会返回 `LSP client not initialized`）；`find_references` 要 `file_path` + `line`(1-based) + **`column`(1-based，必填)**。
4. **位置与 uri**：腿 ① 的 `position.line` 是**零基准**（扩展自己的 schema 文本写 One-based，与实现不符 —— 以实现为准）；uri 必须是 `file:///<小写盘符>/<正斜杠路径>`。
5. **只读优先**：分析类任务只调只读工具（`find_usages` / `find_references` / `get_diagnostics` / `blast_radius`）；写操作走工具自带的预览（腿 ② 的 `preview_edit` / `safe_apply_edit` 只在 `net_delta==0` 时落盘）。
6. **换机器/换版本要重测**：档位表里的数字是 2026-11-22 本机的实测，换语言/换版本按 `references/runtime.md` 的「怎么重测」重跑并更新凭证 —— **不要凭印象改表**。

## 四、事实与档位在哪

| 要查什么 | 去哪 |
|---|---|
| 现成方案清单（社区/官方有什么、许可、活跃度、为什么复用哪条） | `references/reuse-survey.md` |
| 装扩展、起服务、端点、工具面、协议事实、agent-lsp 的坑 | `references/setup.md` |
| 档位表（实测数字）、代价与边界、人工项、怎么重测、证据边界 | `references/runtime.md` |
| 档位口径（L0-L5 判据）与机器可读缺口清单 | `references/tiers.md` |
| 实测凭证（原始输出 + 调用参数 + 耗时口径） | `references/measurements/typescript.json` |

## 五、边界

- 本技能**只描述这条线能做什么**；「哪个后端更适合哪类任务」是**另一阶段**的选型结论，不在这里下。
- 表里的数字只覆盖**本机、本版本、TS**；别的语言/别的机器要重测。
- 装扩展、装语言服务器都要用户点头 —— **未经授权不自行下载安装**。

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
