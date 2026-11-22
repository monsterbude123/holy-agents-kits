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

**耗时口径**：`原始ms` = **单次样本**（不是均值也不是上界）—— 复测同一调用得 1019/1351/1481ms 三个值，**方差远大于表内数字**；冷索引会话里同一调用还可能挂死 >150s。`净ms` = max(0, 原始ms − 基线)，基线 = 3 次 `tools/list` 的中位数（纯协议往返，不触工程：BifrostMCP 6.7ms、agent-lsp 4.9ms）；**首次调用的冷启动单独记**（BifrostMCP 146.7ms、agent-lsp `start_lsp` 71ms；另有一轮**未入凭证**的会话观测：首次真实调用 23.6s —— 那是 VS Code 侧 TS 索引预热，索引热了以后就几十毫秒）。

## 代价与边界

| 项 | 结论（实测） |
|---|---|
| **两条腿的分工** | **BifrostMCP**：要 **VS Code 窗口开着**（服务跑在扩展宿主里，窗口一关端口就没了），能力到 L2（定义/引用/工作区符号）+ L0/L1，**L3 诊断与 L5 改名在 0.0.14 是坏的**；**agent-lsp**：**窗口关着也能跑**，能力到 L2/L3/L5（引用/诊断/影响面） |
| **agent-lsp 的启动参数坑** | server spec 必须带 `,--stdio`（`agent-lsp typescript:typescript-language-server,--stdio`）：少了它 broker 拉起的 server 启动即退出、broker 自杀，报 `daemon: broker did not start within 45s`；**这不是 Windows 缺陷**（daemon 在本机 Windows 上跨会话存活正常，uptime 20 分钟+）。失败现场在 `~/.cache/agent-lsp/spawn-logs/<语言>.log` |
| **`doctor` 报 ok 不等于 daemon 链路可用** | doctor 走**直连**路径且 autodetect 自带 `--stdio` ⇒ 测不出上面那个坑（本轮踩过） |
| **诊断的成本** | agent-lsp 的 `get_diagnostics` 单文件 **25s**（daemon 已 ready 状态）—— 大仓里按文件逐个问诊断会很贵 |
| **影响面的成本** | agent-lsp 的 `blast_radius` **18.9s**（446 符号 / 445 条边）；BifrostMCP 侧**没有**等价工具（L5 不可用） |
| ⚠️ **daemon 报 ready ≠ 结果可用** | tsserver 建 project graph 要 **~60-100s**；这期间 `daemon-status` **已经报 ready**，但 `find_references` **静默返 0**（不报错，实测 uptime 22s→1m18s 全是 0，1m38s 才首次 739），`blast_radius` 同样**静默少报**（新 daemon 上只给 11 符号 / 9 边 vs 凭证里的 446）⇒ **拿 0 条引用或残缺图当真答案前必须双确认**：daemon 已跑够时间 **且**结果的规模与预期量级相符（对大仓，几十个符号的图基本就是残缺）。这是静默错数据，比报错危险 |
| **两条腿的引用数差 1** | 同一锚点同一工程：BifrostMCP 740 条 / agent-lsp 739 条 —— **机制已复核**：agent-lsp 侧 `find_references` 默认 739、带 `include_declaration: true` 是 740（多的那条是定义本身）；BifrostMCP 侧带不带该参数都是 740 |
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
| 工作区符号的噪音比例 | 知道 190 条里有多少是真符号 | 看返回项的 `name` 字段：实测 190 条里 **14 条**是 `# files: …` 聚合项，其余多是「file:line 文本命中」⇒ 噪音高，但**不是**「多数是聚合项」 |
| agent-lsp 的 daemon 是否活着 | `agent-lsp daemon-status` 报 ready **且**图的规模与预期量级相符 | doctor 不算数；**只看 ready 会漏掉残缺图**（实测 ready 时也只给 11 符号） |

## 怎么重测

1. **准备**：VS Code 开着、扩展已装（`code --list-extensions | grep bifrost`）；`npm install -g @blackwell-systems/agent-lsp` + `npm install -g typescript-language-server` + 全局 `typescript@5`（TS 7 没有 `lib/tsserver.js`）。
2. **起通道**：`bash scripts/install-vscode-mcp.sh <工作区路径>`（相对本技能目录；写 `config.json` + 生成工程根 `.mcp.json`）；确认：`bash scripts/install-vscode-mcp.sh --check` 报「通道就绪」。
3. **按凭证里的调用重跑**（凭证里每条都记了 `tool` + `args`，逐条调用即可复现同样的数）：
   - `tools/call get_document_symbols {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"}}`
   - `tools/call get_semantic_tokens {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"}}`
   - `tools/call go_to_definition {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"},"position":{"line":77,"character":0}}`
   - `tools/call find_usages {"textDocument":{"uri":"file:///<project>/src/lib/api-fetch.ts"},"position":{"line":77,"character":0},"context":{"includeDeclaration":true}}`
   - `tools/call get_workspace_symbols {"query":"apiFetch"}`
   - 诊断/改名两档要复核扩展是否修好了：`tools/call get_code_actions {...}`、`tools/call get_rename_locations {...}`（**位置零基准**；uri 必须 `file:///<小写盘符>/…`）
   - agent-lsp 那条腿：`agent-lsp typescript:typescript-language-server,--stdio` 起（MCP stdio；**取数前先 `agent-lsp daemon-status` 报 ready，且图的规模与预期量级相符** —— 索引不全时它会静默少报）→ `tools/call start_lsp {"root_dir":"<project>","language_id":"typescript"}` → `tools/call find_references {"file_path":"<project>/src/lib/api-fetch.ts","line":78,"column":23}` → `tools/call get_diagnostics {"file_path":"<project>/src/lib/api-fetch.ts"}` → `tools/call blast_radius {"changed_files":["<project>/src/lib/api-fetch.ts"]}`（**column 必填**）
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

**边界**：本表只覆盖**本机、本版本、TS**；换语言/换版本/换机器都要重测（步骤见 §4）。本表（档位表）**不做跨后端优劣比较** —— 跨后端选型见下面的 §8（与另一技能同源的决策表副本）。

---

## §8 何时选 VS Code / 何时别选（与另一技能同源的决策表副本）

<!-- selection-table:section:start -->
### 决策表（任务类型 × 语言 → 推荐后端）

> **这张表的读法**：每行给「推荐（主 / 备）· 依据（数字或可逐字核对的事实 + 出处指针）· 证据等级 · 代价与前提 · 何时别选它」。
> **证据等级**四档：`实测`（本 phase 的同题对照实验）· `结构事实`（协议层 / edition 门禁事实，出处可逐字核对）· `既有实测`（phase 01/02 的实测）· `未测`（写明为什么没测、需要什么才能测）。
> **口径提醒**：各后端的「引用」口径不同 —— IDEA = 真代码引用 · agent-lsp / pyright = 引用位置 · BifrostMCP = 扩展侧 provider · codegraph = 受影响符号（含 import 边与成员）⇒ **数字不可直接相减**。
> **同源副本**：本节在两个技能里各存一份（技能 idea-backend 的 references/capability-matrix.md 与技能 vscode-backend 的 references/runtime.md），**逐字相同**；仓内门禁 `scripts/check-selection-table.js` 逐格对账（两份 JSON 块 · 行数 · 每个数字的出处指针 · 禁词）。

| 任务类型 × 语言 | 推荐后端（主 / 备） | 依据（数字或可逐字核对的事实 + 出处） | 证据等级 | 代价与前提 | 何时别选它 |
|---|---|---|---|---|---|
| 文件级 / 文本级定位（L0/L1） × 全部语言 | 主：不构成选型差异 —— 两边都走文件系统 / ripgrep ｜ 备：这一档不进选型 | 两端口径不同义：IDEA 侧 L0 = 按名找源文件、L1 = 带上下文的文本检索（技能 idea-backend 的 references/capability-matrix.md（§1 六个档位））；VS Code 侧 L0 = 文件结构化符号清单（实测 10 个符号）、L1 = token / 高亮（实测 108 个）（技能 vscode-backend 的 references/measurements/typescript.json（records[]）；档位定义见 技能 vscode-backend 的 references/tiers.md（§1 六档定义））⇒ 回答的不是同一个问题，硬凑成同题就是造一个假任务 | 结构事实 | 两档的实现成本都低；VS Code 侧还有 ripgrep 与文件搜索面板兜底 | 想比「谁找得更准」时不要拿这一档当比较项 —— 口径不同义，比出来的差是假的；需要符号身份时直接上 L2 |
| 按名找定义（T1） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | 四个配置在 Python 锚点 ProbeItem 上都答对（文件口径召回 / 精度 1.00/1.00）⇒ 差别在成本与前提，不在能不能答对；T1 三轮中位耗时：C 腿 15ms、B 腿 36.7ms、IDEA 2159.1ms、codegraph 1692.5ms；B 腿与 C 腿都要多一步定位（前置步数 1，IDEA 与 codegraph 是 0）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 | C 腿要先 start_lsp 且必须带 language_id（不带就走「全部语言直连」，每次冷起恒返 0）；B 腿要 VS Code 窗口常开 + Python 侧 Pylance 在位；IDEA 腿要 IDE 在跑且索引就绪（isDumbMode:false 且 isIndexing:false） | 窗口关着也要跑 ⇒ 别选 B 腿（服务跑在扩展宿主里，窗口一关端口就没了）；要找跨语言的同名符号 ⇒ 见「跨语言统一符号空间」那一行 |
| 按位置找定义（T2） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | 四个配置在函数锚点 probe_run 上都答对（文件口径 1.00/1.00）；T2 三轮中位耗时：C 腿 21.4ms、B 腿 50.8ms、IDEA 1614.7ms、codegraph 1609ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 | 位置法要给准位置：C 腿的 find_references 要 file_path + line + column（column 必填、1-based）；B 腿位置零基准、uri 必须是 file:/// 小写盘符 + 正斜杠路径 | 只知道符号名、还不知道位置 ⇒ 走「按名找定义（T1）」那一行，别直接上位置法 |
| 找引用（T3） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | gold = 4 次整词命中 / 2 个文件（技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]））；C 腿命中 4（3 轮中位 15.9ms）、B 腿命中 4（28.7ms）、IDEA 归一后 4（2156ms）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））；codegraph 给的是受影响符号口径，与 gold 的整词命中不同义 ⇒ 只比文件口径（2/2） | 实测 | C 腿取数前要预热 + 结果规模双确认（daemon 报 ready 之后仍可能静默返 0）；B 腿要窗口常开 + Pylance 在位 | 要的是「删了会动谁」的影响面而不是引用清单 ⇒ 走「全局改名与影响面」那一行；codegraph 的受影响符号与 grep 命中数不同义 ⇒ 两把尺子不要相减 |
| 全局改名与影响面（改一个变量 / 方法名，全局一起改） × Python / TypeScript | 主：agent-lsp（C 腿，窗口无关） ｜ 备：IDEA（A 腿，ide_refactor_rename + dryRun） | TS 侧既有实测：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条、agent-lsp 的 find_references 得 739 条（差 1 = include_declaration 口径不同）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；Python 侧 T4 改名干跑四个配置都完成 —— IDEA 1477.5ms、agent-lsp 1008.9ms、BifrostMCP 20ms（本轮 get_rename_locations 可用；phase 02 记的是 Unexpected type ⇒ 可用性随会话波动）、codegraph 1145.3ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 · 既有实测 | tsserver 只对已打开的文件给跨文件编辑 ⇒ 改名前先把引用到的文件 open_document 打开；daemon 报 ready 之后仍可能静默返 0（tsserver 建 project graph 需 60-100s）⇒ 取数前预热 + 结果规模双确认（技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口）））；B 腿的 get_rename_locations 可用性随会话波动 ⇒ 用前先干跑一次自检 | 窗口关着也要跑 ⇒ 别选 B 腿；只要影响面清单不要落盘 ⇒ 先干跑（agent-lsp 的 blast_radius / IDEA 的 ide_refactor_rename dryRun），确认清单再落盘 |
| 找引用（列全部引用） × TypeScript | 主：agent-lsp（窗口无关那条腿） ｜ 备：BifrostMCP（窗口常开那条腿） | VS Code 侧既有实测（单边腿）：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条（原始 1150.8ms）、agent-lsp 的 find_references 得 739 条（原始 460.9ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 这一格在 IDEA 侧无此能力 | 既有实测 · 结构事实 | C 腿要 typescript-language-server + TypeScript 5.x（TS 7 没有 lib/tsserver.js），server spec 必须带 ,--stdio；B 腿要 VS Code 窗口常开；两腿的耗时都是单次样本，复测方差大于表内数字 | 要跟 Python 同题对照时别把这一行的单边腿数字当同题数据；引用数返 0 时先按「索引未就绪」重试，不许下「死代码」结论 |
| 按位置找定义 × TypeScript | 主：BifrostMCP（go_to_definition） ｜ 备：agent-lsp（这条腿的定义检索本轮未测） | VS Code 侧既有实测：BifrostMCP 的 go_to_definition 命中 1（原始 9.1ms / 净 2.3ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 侧无此能力 —— 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 位置法解析到目录符号（resolvedSymbol.kind = directory）⇒ 结果作废 | 既有实测 · 未测 | 位置零基准（扩展实现是零基准，它的 schema 文本写 One-based）；uri 必须是 file:/// 小写盘符 + 正斜杠路径；C 腿的定义检索本轮未测（这条腿只测了引用 / 诊断 / 影响面三档）⇒ 用前先自检 | IDEA 侧查 TS 定义 ⇒ 别试（无 PSI，返回的是目录符号）；要按名字找定义又不想开窗口 ⇒ 先用文本检索拿位置 |
| 影响面 / 改名前的安全清单 × TypeScript | 主：agent-lsp（blast_radius） ｜ 备：codegraph（impact，口径是受影响符号） | VS Code 侧既有实测：agent-lsp 的 blast_radius 一次调用给 446 个符号 / 445 条边（原始 18887.7ms / 净 18882.8ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；daemon 索引不全时静默少报（新起的 daemon 上只给 11 符号 / 9 边） | 既有实测 | 一次调用约 18.9s；大仓里按文件逐个问更贵 ⇒ 先用 blast_radius 拿规模再决定 | 别把 blast_radius 当引用清单（它是 GCF 图的受影响符号，与 grep 命中数不同义）；结果规模与预期量级不符就当残缺图，不当真答案 |
| 符号级检索 / 引用 / 影响面 × JVM（Java / Kotlin） | 主：IDEA（A 腿，PSI 统一符号空间 + 持久化索引） ｜ 备：VS Code 侧未测（需装 Red Hat Java 扩展，本机未装） | IDEA 侧既有实测（单边腿）：ide_find_references 1.6s / 95 条引用零假命中（技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位））；VS Code 侧未测 —— 本机没装 Red Hat Java 扩展，且 IDEA 侧的 Maven 导入在 40 模块工程上卡死 ⇒ JVM 的同题对照没做 | 既有实测 · 未测 | IDEA 侧 JVM 捆绑在社区版里（门槛最低的一档）；VS Code 侧要装 Red Hat Java 扩展 + 一个能导入的 Maven / Gradle 工程 | 要跟 Python / TS 同题对照时别拿 JVM 的单边腿数字当同题数据（语言与口径都不同）；要在窗口外跑 JVM 语义查询 ⇒ 本 phase 没有可用路线 |
| 单文件诊断（这个文件有没有问题） × Python | 主：IDEA（A 腿，ide_diagnostics） ｜ 备：外部 linter（pyright CLI / ruff）—— 不是 MCP 语义后端 | 本 phase 只有 IDEA 真拿到：ide_diagnostics 报 2 条语法错（Formal parameter name expected / ':' expected）；BifrostMCP 的 get_code_actions 报 Illegal argument（能力缺席）；agent-lsp 的 get_diagnostics 返 0 条（索引未就绪 —— 同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错）；codegraph 的 CLI 没有检视子命令（能力缺席）（技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）） | 实测 | IDEA 侧要 IDE 在跑 + 索引就绪；.py 不在 source root 时 ide_diagnostics 走 closed_batch（弱告警 / quick-fix 不可用）；agent-lsp 那格一次 25017.4ms 还没拿到数据 ⇒ 诊断这条腿的成本要单独算 | 要的是「全项目规范审查」而不是单文件 ⇒ 见「全项目规范审查」那一行；BifrostMCP 侧别再试 get_code_actions（扩展 0.0.14 实测坏） |
| 全项目规范审查 / Inspect Code × 全部语言 | 主：IDEA（A 腿，ide_inspect 批量检视 = L4） ｜ 备：VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）—— 协议层没有 scope 级检视 | 结构事实：LSP 的 textDocument/codeAction 请求没有 scope 参数，协议里没有「一次批检视一个范围」这个能力，VS Code 侧 19 个工具面里也没有对应工具（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；实测侧本 phase 的单文件诊断只有 IDEA 真拿到（2 条）⇒ 范围级检视只有 IDEA 侧有协议外能力 | 实测 · 结构事实 | ide_inspect 只在 monster 分支的 Index 插件里 —— 上游 5.20.7 的 16 个工具没有它 ⇒ 没装 monster 分支时流水线降级到 L3 文件级 ide_diagnostics（拿不到 P3C / 阿里规范与 global 批处理项）；换分支要重启 IDEA（技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）） | 要的是「这个文件有没有问题」⇒ ide_diagnostics 就够；VS Code 侧不要指望 MCP 协议层给范围检视 ⇒ 改走外部 linter 并自己汇总 |
| 抽方法 / Extract Method × 全部语言（IDEA 侧限有 PSI 的语言：JVM / Python） | 主：IDEA（A 腿，ide_refactor_extract_method） ｜ 备：VS Code 侧无此能力 —— 实现层 | VS Code 侧实测不通：agent-lsp 的 refactor 工具在 tsserver 侧走 textDocument/codeAction，一个位置 30s 超时，另一个位置直接崩 tsserver（Cannot read properties of undefined (reading 'kind')）⇒ 实现层无此能力（原始记录见本节附录）；IDEA 侧有 ide_refactor_extract_method，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它） | 实测 · 结构事实 | IDEA 侧要 monster 分支 + 重启 IDEA；VS Code 侧没有等价入口（19 个工具面里没有抽方法，协议层对应的能力是 textDocument/codeAction 而它没有 scope 参数） | 只是想改个名 ⇒ 走「全局改名与影响面」那一行（agent-lsp 的 rename_symbol 可用）；要的是批量模式重写 ⇒ 用 ast-grep，别指望抽方法 |
| 跨语言统一符号空间（同名符号在两种语言里各在哪、各被谁引用） × Python + TypeScript | 主：codegraph（IDE 无关，根级索引一次 impact 覆盖两个子工程） ｜ 备：BifrostMCP（VS Code 窗口内，一次 get_workspace_symbols 返回两侧同名符号） | 本 phase T6 实测：codegraph 根级索引一次 impact 同时覆盖 py/ 与 ts/（py 侧 6 个受影响符号 / 2 个文件、ts 侧 11 个 / 4 个文件）；BifrostMCP 一次 get_workspace_symbols 同时返回两侧的 ProbeItem（py 侧命中 4 / 2 文件、ts 侧命中 9 / 4 文件）（技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细））；IDEA 社区版不成立（装不了 JS/TS 插件 ⇒ .ts 无 PSI）；agent-lsp 不成立（LSP 协议级「one server serves one tool」，本腿只起 pyright）（技能 idea-backend 的 references/semantic-backend-options.md（§3 不可替代的三件事）） | 实测 · 结构事实 | codegraph 要先在仓根 codegraph init（会写 .codegraph/ ⇒ 目标仓要先 ignore）；B 腿要 VS Code 窗口常开 | 要的是「统一 FQN 身份 + 持久化跨会话索引」⇒ 协议层没有替代物（只有 IDEA 的 PSI 统一空间有，而它要该语言插件 + 付费版）；agent-lsp 侧别指望跨语言统一符号空间 |
| 代码探索 / 代码地图（这仓是干什么的、怎么走通的） × 全部语言 | 主：codegraph（explore） ｜ 备：无同档替代（LSP 协议层没有代码地图这一档） | 既有实测（phase 01）：codegraph 的 explore 一次调用返回 2095 字符 / 60 行，带 blast radius（谁依赖）与测试覆盖提示（技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）） | 既有实测 | IDE 无关；先 codegraph init（写 .codegraph/）；探索类不入同题任务（真值难判）⇒ 这一行是既有实测等级，不是本 phase 的对照结果 | 要的是精确的引用 / 影响面清单 ⇒ 走 L2 / L5 那几行（codegraph 的口径是受影响符号，与 grep 命中数不同义）；要结构化模式匹配 ⇒ 用 ast-grep |

### 附：VS Code 侧抽方法的实测原始记录（2026-11-22）

- **工具**：agent-lsp 0.24.4 的 `refactor`（走 tsserver 的 `textDocument/codeAction`）；
- **现象一（超时）**：请求挂满 30s 没有返回 ⇒ 记「实现层无此能力」；
- **现象二（崩服务）**：换到另一个位置，tsserver 直接崩，报 `Cannot read properties of undefined (reading 'kind')`；
- **对照**：VS Code 侧 19 个工具面里没有抽方法入口；LSP 协议层对应的能力是 `textDocument/codeAction`，而它没有 scope 参数（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；
- **复现入口**：起法与调用顺序见 技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口））。
- ⚠️ **证据边界**：这一条的原始输出片段**未入库**（本 phase 入库的凭证是 24 格对照实验）⇒ 复现前先按上面的现象自检，别把「超时 / 崩服务」当成稳定契约。

<!-- selection-table:begin -->
```json
{
  "schema": "selection-table/v1",
  "generated_at": "2026-11-22",
  "rows": [
    {
      "key": "l0-l1-file-text",
      "task": "文件级 / 文本级定位（L0/L1）",
      "lang": "全部语言",
      "recommend": "不构成选型差异 —— 两边都走文件系统 / ripgrep",
      "backup": "这一档不进选型",
      "evidence": "两端口径不同义：IDEA 侧 L0 = 按名找源文件、L1 = 带上下文的文本检索（技能 idea-backend 的 references/capability-matrix.md（§1 六个档位））；VS Code 侧 L0 = 文件结构化符号清单（实测 10 个符号）、L1 = token / 高亮（实测 108 个）（技能 vscode-backend 的 references/measurements/typescript.json（records[]）；档位定义见 技能 vscode-backend 的 references/tiers.md（§1 六档定义））⇒ 回答的不是同一个问题，硬凑成同题就是造一个假任务",
      "evidence_levels": [
        "结构事实"
      ],
      "cost": "两档的实现成本都低；VS Code 侧还有 ripgrep 与文件搜索面板兜底",
      "not_when": "想比「谁找得更准」时不要拿这一档当比较项 —— 口径不同义，比出来的差是假的；需要符号身份时直接上 L2",
      "numbers": [
        {
          "value": 10,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "VS Code 侧 L0 文档符号数"
        },
        {
          "value": 108,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "VS Code 侧 L1 语义 token 数"
        },
        {
          "value": 13,
          "pointer": "技能 idea-backend 的 references/langs/ts/runtime.md（§1 实测矩阵）",
          "meaning": "IDEA 侧 TS 文本检索真命中 13/13"
        }
      ]
    },
    {
      "key": "find-def-by-name-python",
      "task": "按名找定义（T1）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "四个配置在 Python 锚点 ProbeItem 上都答对（文件口径召回 / 精度 1.00/1.00）⇒ 差别在成本与前提，不在能不能答对；T1 三轮中位耗时：C 腿 15ms、B 腿 36.7ms、IDEA 2159.1ms、codegraph 1692.5ms；B 腿与 C 腿都要多一步定位（前置步数 1，IDEA 与 codegraph 是 0）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "C 腿要先 start_lsp 且必须带 language_id（不带就走「全部语言直连」，每次冷起恒返 0）；B 腿要 VS Code 窗口常开 + Python 侧 Pylance 在位；IDEA 腿要 IDE 在跑且索引就绪（isDumbMode:false 且 isIndexing:false）",
      "not_when": "窗口关着也要跑 ⇒ 别选 B 腿（服务跑在扩展宿主里，窗口一关端口就没了）；要找跨语言的同名符号 ⇒ 见「跨语言统一符号空间」那一行",
      "numbers": [
        {
          "value": 15,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 36.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 2159.1,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1692.5,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × D 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "find-def-by-position-python",
      "task": "按位置找定义（T2）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "四个配置在函数锚点 probe_run 上都答对（文件口径 1.00/1.00）；T2 三轮中位耗时：C 腿 21.4ms、B 腿 50.8ms、IDEA 1614.7ms、codegraph 1609ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "位置法要给准位置：C 腿的 find_references 要 file_path + line + column（column 必填、1-based）；B 腿位置零基准、uri 必须是 file:/// 小写盘符 + 正斜杠路径",
      "not_when": "只知道符号名、还不知道位置 ⇒ 走「按名找定义（T1）」那一行，别直接上位置法",
      "numbers": [
        {
          "value": 21.4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 50.8,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1614.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1609,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × D 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "find-refs-python",
      "task": "找引用（T3）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "gold = 4 次整词命中 / 2 个文件（技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]））；C 腿命中 4（3 轮中位 15.9ms）、B 腿命中 4（28.7ms）、IDEA 归一后 4（2156ms）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））；codegraph 给的是受影响符号口径，与 gold 的整词命中不同义 ⇒ 只比文件口径（2/2）",
      "evidence_levels": [
        "实测"
      ],
      "cost": "C 腿取数前要预热 + 结果规模双确认（daemon 报 ready 之后仍可能静默返 0）；B 腿要窗口常开 + Pylance 在位",
      "not_when": "要的是「删了会动谁」的影响面而不是引用清单 ⇒ 走「全局改名与影响面」那一行；codegraph 的受影响符号与 grep 命中数不同义 ⇒ 两把尺子不要相减",
      "numbers": [
        {
          "value": 4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]）",
          "meaning": "gold 的整词命中数（expect_hits）"
        },
        {
          "value": 15.9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 28.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 2156,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × A 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "rename-global",
      "task": "全局改名与影响面（改一个变量 / 方法名，全局一起改）",
      "lang": "Python / TypeScript",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "IDEA（A 腿，ide_refactor_rename + dryRun）",
      "evidence": "TS 侧既有实测：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条、agent-lsp 的 find_references 得 739 条（差 1 = include_declaration 口径不同）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；Python 侧 T4 改名干跑四个配置都完成 —— IDEA 1477.5ms、agent-lsp 1008.9ms、BifrostMCP 20ms（本轮 get_rename_locations 可用；phase 02 记的是 Unexpected type ⇒ 可用性随会话波动）、codegraph 1145.3ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测",
        "既有实测"
      ],
      "cost": "tsserver 只对已打开的文件给跨文件编辑 ⇒ 改名前先把引用到的文件 open_document 打开；daemon 报 ready 之后仍可能静默返 0（tsserver 建 project graph 需 60-100s）⇒ 取数前预热 + 结果规模双确认（技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口）））；B 腿的 get_rename_locations 可用性随会话波动 ⇒ 用前先干跑一次自检",
      "not_when": "窗口关着也要跑 ⇒ 别选 B 腿；只要影响面清单不要落盘 ⇒ 先干跑（agent-lsp 的 blast_radius / IDEA 的 ide_refactor_rename dryRun），确认清单再落盘",
      "numbers": [
        {
          "value": 740,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 的引用条数"
        },
        {
          "value": 739,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 的引用条数"
        },
        {
          "value": 1477.5,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1008.9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 20,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1145.3,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × D 的 3 轮中位耗时（ms）"
        },
        {
          "value": 100,
          "pointer": "技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口））",
          "meaning": "tsserver 建 project graph 的等待上限（秒）"
        }
      ]
    },
    {
      "key": "find-refs-ts",
      "task": "找引用（列全部引用）",
      "lang": "TypeScript",
      "recommend": "agent-lsp（窗口无关那条腿）",
      "backup": "BifrostMCP（窗口常开那条腿）",
      "evidence": "VS Code 侧既有实测（单边腿）：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条（原始 1150.8ms）、agent-lsp 的 find_references 得 739 条（原始 460.9ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 这一格在 IDEA 侧无此能力",
      "evidence_levels": [
        "既有实测",
        "结构事实"
      ],
      "cost": "C 腿要 typescript-language-server + TypeScript 5.x（TS 7 没有 lib/tsserver.js），server spec 必须带 ,--stdio；B 腿要 VS Code 窗口常开；两腿的耗时都是单次样本，复测方差大于表内数字",
      "not_when": "要跟 Python 同题对照时别把这一行的单边腿数字当同题数据；引用数返 0 时先按「索引未就绪」重试，不许下「死代码」结论",
      "numbers": [
        {
          "value": 740,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 的引用条数"
        },
        {
          "value": 739,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 的引用条数"
        },
        {
          "value": 1150.8,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 单次调用往返（ms）"
        },
        {
          "value": 460.9,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 单次调用往返（ms）"
        }
      ]
    },
    {
      "key": "find-def-ts",
      "task": "按位置找定义",
      "lang": "TypeScript",
      "recommend": "BifrostMCP（go_to_definition）",
      "backup": "agent-lsp（这条腿的定义检索本轮未测）",
      "evidence": "VS Code 侧既有实测：BifrostMCP 的 go_to_definition 命中 1（原始 9.1ms / 净 2.3ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 侧无此能力 —— 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 位置法解析到目录符号（resolvedSymbol.kind = directory）⇒ 结果作废",
      "evidence_levels": [
        "既有实测",
        "未测"
      ],
      "cost": "位置零基准（扩展实现是零基准，它的 schema 文本写 One-based）；uri 必须是 file:/// 小写盘符 + 正斜杠路径；C 腿的定义检索本轮未测（这条腿只测了引用 / 诊断 / 影响面三档）⇒ 用前先自检",
      "not_when": "IDEA 侧查 TS 定义 ⇒ 别试（无 PSI，返回的是目录符号）；要按名字找定义又不想开窗口 ⇒ 先用文本检索拿位置",
      "numbers": [
        {
          "value": 1,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 go_to_definition 的命中数"
        },
        {
          "value": 9.1,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "go_to_definition 单次调用往返（ms）"
        },
        {
          "value": 2.3,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "go_to_definition 扣基线后的净耗时（ms）"
        }
      ]
    },
    {
      "key": "impact-ts",
      "task": "影响面 / 改名前的安全清单",
      "lang": "TypeScript",
      "recommend": "agent-lsp（blast_radius）",
      "backup": "codegraph（impact，口径是受影响符号）",
      "evidence": "VS Code 侧既有实测：agent-lsp 的 blast_radius 一次调用给 446 个符号 / 445 条边（原始 18887.7ms / 净 18882.8ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；daemon 索引不全时静默少报（新起的 daemon 上只给 11 符号 / 9 边）",
      "evidence_levels": [
        "既有实测"
      ],
      "cost": "一次调用约 18.9s；大仓里按文件逐个问更贵 ⇒ 先用 blast_radius 拿规模再决定",
      "not_when": "别把 blast_radius 当引用清单（它是 GCF 图的受影响符号，与 grep 命中数不同义）；结果规模与预期量级不符就当残缺图，不当真答案",
      "numbers": [
        {
          "value": 446,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 的受影响符号数"
        },
        {
          "value": 445,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 的边数"
        },
        {
          "value": 18887.7,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 单次调用往返（ms）"
        },
        {
          "value": 18882.8,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 扣基线后的净耗时（ms）"
        },
        {
          "value": 11,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "索引不全时静默少报的符号数"
        }
      ]
    },
    {
      "key": "symbol-jvm",
      "task": "符号级检索 / 引用 / 影响面",
      "lang": "JVM（Java / Kotlin）",
      "recommend": "IDEA（A 腿，PSI 统一符号空间 + 持久化索引）",
      "backup": "VS Code 侧未测（需装 Red Hat Java 扩展，本机未装）",
      "evidence": "IDEA 侧既有实测（单边腿）：ide_find_references 1.6s / 95 条引用零假命中（技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位））；VS Code 侧未测 —— 本机没装 Red Hat Java 扩展，且 IDEA 侧的 Maven 导入在 40 模块工程上卡死 ⇒ JVM 的同题对照没做",
      "evidence_levels": [
        "既有实测",
        "未测"
      ],
      "cost": "IDEA 侧 JVM 捆绑在社区版里（门槛最低的一档）；VS Code 侧要装 Red Hat Java 扩展 + 一个能导入的 Maven / Gradle 工程",
      "not_when": "要跟 Python / TS 同题对照时别拿 JVM 的单边腿数字当同题数据（语言与口径都不同）；要在窗口外跑 JVM 语义查询 ⇒ 本 phase 没有可用路线",
      "numbers": [
        {
          "value": 1.6,
          "pointer": "技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位）",
          "meaning": "ide_find_references 的实测耗时（秒）"
        },
        {
          "value": 95,
          "pointer": "技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位）",
          "meaning": "ide_find_references 的引用条数（零假命中）"
        }
      ]
    },
    {
      "key": "diagnostics-file",
      "task": "单文件诊断（这个文件有没有问题）",
      "lang": "Python",
      "recommend": "IDEA（A 腿，ide_diagnostics）",
      "backup": "外部 linter（pyright CLI / ruff）—— 不是 MCP 语义后端",
      "evidence": "本 phase 只有 IDEA 真拿到：ide_diagnostics 报 2 条语法错（Formal parameter name expected / ':' expected）；BifrostMCP 的 get_code_actions 报 Illegal argument（能力缺席）；agent-lsp 的 get_diagnostics 返 0 条（索引未就绪 —— 同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错）；codegraph 的 CLI 没有检视子命令（能力缺席）（技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "IDEA 侧要 IDE 在跑 + 索引就绪；.py 不在 source root 时 ide_diagnostics 走 closed_batch（弱告警 / quick-fix 不可用）；agent-lsp 那格一次 25017.4ms 还没拿到数据 ⇒ 诊断这条腿的成本要单独算",
      "not_when": "要的是「全项目规范审查」而不是单文件 ⇒ 见「全项目规范审查」那一行；BifrostMCP 侧别再试 get_code_actions（扩展 0.0.14 实测坏）",
      "numbers": [
        {
          "value": 2,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "IDEA 报出的语法错条数"
        },
        {
          "value": 7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "同一 pyright CLI 对同一文件报的语法错条数"
        },
        {
          "value": 25017.4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T5 × C 那格的单次耗时（ms）"
        }
      ]
    },
    {
      "key": "inspect-project",
      "task": "全项目规范审查 / Inspect Code",
      "lang": "全部语言",
      "recommend": "IDEA（A 腿，ide_inspect 批量检视 = L4）",
      "backup": "VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）—— 协议层没有 scope 级检视",
      "evidence": "结构事实：LSP 的 textDocument/codeAction 请求没有 scope 参数，协议里没有「一次批检视一个范围」这个能力，VS Code 侧 19 个工具面里也没有对应工具（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；实测侧本 phase 的单文件诊断只有 IDEA 真拿到（2 条）⇒ 范围级检视只有 IDEA 侧有协议外能力",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "ide_inspect 只在 monster 分支的 Index 插件里 —— 上游 5.20.7 的 16 个工具没有它 ⇒ 没装 monster 分支时流水线降级到 L3 文件级 ide_diagnostics（拿不到 P3C / 阿里规范与 global 批处理项）；换分支要重启 IDEA（技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准））",
      "not_when": "要的是「这个文件有没有问题」⇒ ide_diagnostics 就够；VS Code 侧不要指望 MCP 协议层给范围检视 ⇒ 改走外部 linter 并自己汇总",
      "numbers": [
        {
          "value": 19,
          "pointer": "技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单）",
          "meaning": "VS Code 侧的工具个数（工具面里没有范围检视）"
        },
        {
          "value": 16,
          "pointer": "技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）",
          "meaning": "上游 Index 插件 5.20.7 的工具数（没有 ide_inspect）"
        },
        {
          "value": 2,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "本 phase IDEA 单文件诊断拿到的条数"
        }
      ]
    },
    {
      "key": "extract-method",
      "task": "抽方法 / Extract Method",
      "lang": "全部语言（IDEA 侧限有 PSI 的语言：JVM / Python）",
      "recommend": "IDEA（A 腿，ide_refactor_extract_method）",
      "backup": "VS Code 侧无此能力 —— 实现层",
      "evidence": "VS Code 侧实测不通：agent-lsp 的 refactor 工具在 tsserver 侧走 textDocument/codeAction，一个位置 30s 超时，另一个位置直接崩 tsserver（Cannot read properties of undefined (reading 'kind')）⇒ 实现层无此能力（原始记录见本节附录）；IDEA 侧有 ide_refactor_extract_method，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它）",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "IDEA 侧要 monster 分支 + 重启 IDEA；VS Code 侧没有等价入口（19 个工具面里没有抽方法，协议层对应的能力是 textDocument/codeAction 而它没有 scope 参数）",
      "not_when": "只是想改个名 ⇒ 走「全局改名与影响面」那一行（agent-lsp 的 rename_symbol 可用）；要的是批量模式重写 ⇒ 用 ast-grep，别指望抽方法",
      "numbers": [
        {
          "value": 30,
          "pointer": "技能 vscode-backend 的 references/runtime.md（§附：VS Code 侧抽方法的实测原始记录）",
          "meaning": "textDocument/codeAction 的超时秒数"
        },
        {
          "value": 16,
          "pointer": "技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）",
          "meaning": "上游 Index 插件 5.20.7 的工具数（没有 ide_refactor_extract_method）"
        },
        {
          "value": 19,
          "pointer": "技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单）",
          "meaning": "VS Code 侧的工具个数（没有抽方法入口）"
        }
      ]
    },
    {
      "key": "cross-lang-symbol",
      "task": "跨语言统一符号空间（同名符号在两种语言里各在哪、各被谁引用）",
      "lang": "Python + TypeScript",
      "recommend": "codegraph（IDE 无关，根级索引一次 impact 覆盖两个子工程）",
      "backup": "BifrostMCP（VS Code 窗口内，一次 get_workspace_symbols 返回两侧同名符号）",
      "evidence": "本 phase T6 实测：codegraph 根级索引一次 impact 同时覆盖 py/ 与 ts/（py 侧 6 个受影响符号 / 2 个文件、ts 侧 11 个 / 4 个文件）；BifrostMCP 一次 get_workspace_symbols 同时返回两侧的 ProbeItem（py 侧命中 4 / 2 文件、ts 侧命中 9 / 4 文件）（技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细））；IDEA 社区版不成立（装不了 JS/TS 插件 ⇒ .ts 无 PSI）；agent-lsp 不成立（LSP 协议级「one server serves one tool」，本腿只起 pyright）（技能 idea-backend 的 references/semantic-backend-options.md（§3 不可替代的三件事））",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "codegraph 要先在仓根 codegraph init（会写 .codegraph/ ⇒ 目标仓要先 ignore）；B 腿要 VS Code 窗口常开",
      "not_when": "要的是「统一 FQN 身份 + 持久化跨会话索引」⇒ 协议层没有替代物（只有 IDEA 的 PSI 统一空间有，而它要该语言插件 + 付费版）；agent-lsp 侧别指望跨语言统一符号空间",
      "numbers": [
        {
          "value": 6,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "codegraph 侧 py 的受影响符号数"
        },
        {
          "value": 11,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "codegraph 侧 ts 的受影响符号数"
        },
        {
          "value": 4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "BifrostMCP 侧 py 的命中数"
        },
        {
          "value": 9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "BifrostMCP 侧 ts 的命中数"
        }
      ]
    },
    {
      "key": "explore-codebase",
      "task": "代码探索 / 代码地图（这仓是干什么的、怎么走通的）",
      "lang": "全部语言",
      "recommend": "codegraph（explore）",
      "backup": "无同档替代（LSP 协议层没有代码地图这一档）",
      "evidence": "既有实测（phase 01）：codegraph 的 explore 一次调用返回 2095 字符 / 60 行，带 blast radius（谁依赖）与测试覆盖提示（技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测））",
      "evidence_levels": [
        "既有实测"
      ],
      "cost": "IDE 无关；先 codegraph init（写 .codegraph/）；探索类不入同题任务（真值难判）⇒ 这一行是既有实测等级，不是本 phase 的对照结果",
      "not_when": "要的是精确的引用 / 影响面清单 ⇒ 走 L2 / L5 那几行（codegraph 的口径是受影响符号，与 grep 命中数不同义）；要结构化模式匹配 ⇒ 用 ast-grep",
      "numbers": [
        {
          "value": 2095,
          "pointer": "技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）",
          "meaning": "codegraph explore 一次调用的返回字符数"
        },
        {
          "value": 60,
          "pointer": "技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）",
          "meaning": "codegraph explore 一次调用返回的行数"
        }
      ]
    }
  ]
}
```
<!-- selection-table:end -->
<!-- selection-table:section:end -->
