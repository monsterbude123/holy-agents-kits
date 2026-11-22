# 对照实验 —— 任务集、真值与取数协议

> **这份文件是「怎么重测」的清单**：每条臂的起法 / 就绪判据 / 规模判据 / 重试上限 / 逐条调用都在这儿。
> 真值在 [gold.json](gold.json)（机器可数），数据在 [results.json](results.json) + [results.md](results.md)。
> **口径纪律**：表里的数字不许手写 —— 每个数都从原始工具输出算，凭证逐条落在 `results.json` 的 `evidence[]`。
> 机器本地绝对路径在凭证里归一化成 `<repo>`（= 夹具仓根 `skills/idea-backend/fixtures/experiment/repo`）。

## 0. 测床与全局口径

| 项 | 值 |
|---|---|
| 夹具仓根 | `skills/idea-backend/fixtures/experiment/repo`（下称 `<repo>`） |
| 子工程 | `<repo>/py/`（Python，跨臂定量对照的唯一语言）· `<repo>/ts/`（TypeScript，单边腿 + T6 用） |
| 锚点 | `gold.json` 的 `anchors[]`：`py_probe_item` / `py_probe_run` / `py_broken` / `ts_probe_item` / `ts_probe_core` |
| 计数范围 | **只数锚点所属语言的子工程**（Python 锚点只数 `py/`，TS 锚点只数 `ts/`），**不跨语言合并**；TS 侧文本类工具用 `*.ts,*.tsx` 掩码 |
| 两个口径 | **期望文件集合**（`expect_files`）+ **期望整词命中数**（`expect_hits`，**含定义行**）—— 两个口径不许混算 |
| 提问句 | 同一提问句 + 同一锚点 + 同一真值，四条臂各按自己的工具面映射（映射关系照记，不强行对齐） |
| 口径 scope | 每个任务用哪个 gold 口径（**机器可读：`gold.json` 的 `tasks[].scope`**）：`definition`（找定义）/ `references`（找引用）/ `impact`（影响面）/ `diagnostics`（诊断）/ `per_language`（跨语言分列） |
| 轮次 | 每任务 × 每配置 **3 轮取中位**（热身 1 次不计分）；命中数不一致或耗时极差 > 20% ⇒ 标 `flaky`，**不许调和** |
| 归一规则 | 各臂的「命中」口径不同（见 `gold.json` 的 `normalization`）⇒ 换算到 gold 口径再算召回/精度 |

**耗时极差的判据**：`raw_ms` 的 `(max − min) / min > 0.20` ⇒ 该格标 `flaky`。

## 1. 六个任务（同一提问句 + 同一锚点 + 同一可判定真值）

### T1 找定义（**按名**）—— class 锚点 `ProbeItem`

- **提问句**：「类 `ProbeItem` 定义在哪个文件？给出文件路径与声明行。」
- **锚点**：`ProbeItem` @ `py/src/probe_item.py:8`（gold 锚点 `py_probe_item`）
- **判定口径**：命中文件 = `py/src/probe_item.py`；声明行 = 8；文件集合口径与命中口径分别换算（gold 命中数 4 = 定义行 + 3 处引用）

| 臂 | 提问姿势（工具 + 入参） | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | `ide_find_class {"query":"ProbeItem","project_path":"<repo>"}` → 取 `classes[]` 里 `kind=CLASS` 的 `file`/`line` | IDEA 2026.2.5 社区版在跑 + Index MCP + Python CE 在位 | `ide_index_status` 的 `isDumbMode:false && isIndexing:false` 且 `ide_project_status` 的 open project 路径 == `<repo>` | `totalCount ≥ 1` 且含 `kind:"CLASS"` 的条目 | 同查询重跑 2 次仍矛盾 ⇒ 记 flaky + 失败模式，**不许调判据** |
| B BifrostMCP | `get_workspace_symbols {"query":"ProbeItem"}` → 取 `py/src/probe_item.py` 的条目；再 `go_to_definition` 确认 | VS Code 窗口常开 + 工作区 == `<repo>` + 扩展 0.0.14 + **Pylance 在位** | `get_workspace_symbols` 返回的路径必须属于 `<repo>`（否则是静默测错对象）+ Python 锚点文件上 `get_document_symbols` 返符号清单 | 返回符号条数 > 0 | 1 次（确认不是用法错） |
| C agent-lsp | `find_symbol {"query":"ProbeItem"}` → 取位置；再 `go_to_definition {"file_path","line","column"}` | 窗口无关；server spec 必须 `python:pyright-langserver,--stdio` | `start_lsp{"root_dir":"<repo>/py/src","language_id":"python"}` → daemon ready → **预热 + 结果规模双确认** | 符号数 > 0 且与预期量级相符 | 返 0 时按间隔重试（上限 3 次）；仍 0 ⇒ 记「索引未就绪」 |
| D codegraph | `codegraph query ProbeItem -p <repo>` | 已装 1.7.0 + **在 `<repo>` 根 `codegraph init`**（覆盖 py/ + ts/） | `codegraph status -p <repo>` 显示索引就绪 | 结果条数 > 0 | 1 次 |

### T2 找定义（**按位置**）—— function 锚点 `probe_run`

- **提问句**：「`py/src/probe_item.py` 第 23 行第 5 列的符号 `probe_run` 定义在哪？」
- **锚点**：`probe_run` @ `py/src/probe_item.py:23`（gold 锚点 `py_probe_run`）
- **判定口径**：命中文件 = `py/src/probe_item.py`；声明行 = 23（gold 命中数 3 = 定义行 + import + 调用点）

| 臂 | 提问姿势 | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | `ide_find_definition {"file":"py/src/probe_item.py","line":23,"column":5,"language":"Python","project_path":"<repo>"}` | 同 T1 | 同 T1（+ `ide_sync_files` 后再查） | 返回 1 个定义且行号 == 23 | 2 次（同查询重跑） |
| B BifrostMCP | `go_to_definition {"textDocument":{"uri":"file:///<repo>/py/src/probe_item.py"},"position":{"line":22,"character":4}}`（**零基准**） | 同 T1 | 同 T1 | 返回 1 个位置且行 == 22（零基准） | 1 次 |
| C agent-lsp | `go_to_definition {"file_path":"<repo>/py/src/probe_item.py","line":23,"column":5}` | 同 T1 | 同 T1 | 返回 1 个位置且行 == 23（1-based） | 3 次（返 0 按索引未就绪重试） |
| D codegraph | **无位置法** ⇒ 走名称法 `codegraph node probe_run -p <repo>`（**映射关系照记**） | 同 T1 | 同 T1 | 返回源码块且能定位到 `def probe_run` | 1 次 |

### T3 找引用（列全部引用）—— `ProbeItem`

- **提问句**：「符号 `ProbeItem` 在全仓有哪些引用？列出全部引用位置与所在文件。」
- **锚点**：`ProbeItem` @ `py/src/probe_item.py:8`（gold 锚点 `py_probe_item`）
- **判定口径**：期望文件集合 = {`py/src/probe_item.py`, `py/src/probe_consumer.py`}；期望整词命中 = 4（含定义行）⇒ **语义引用数应为 3**（不含定义行）

| 臂 | 提问姿势 | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | `ide_find_references {"file":"py/src/probe_item.py","line":8,"column":7,"language":"Python","project_path":"<repo>"}` | 同 T1 | **`resolvedSymbol.kind` 必须是代码符号**（`directory`/`package`/空 ⇒ 整条作废，记「静默失效」） | `totalCount > 0` 且与 gold 同量级（3） | 同查询重跑 2 次 |
| B BifrostMCP | `find_usages {"textDocument":{"uri":...},"position":{"line":7,"character":6},"context":{"includeDeclaration":true}}`（**零基准**） | 同 T1 | 同 T1 | 命中数 > 0 且与 gold 同量级 | 返 0 重试 1 次（索引未就绪）；仍 0 ⇒ 记「索引未就绪」 |
| C agent-lsp | `find_references {"file_path":"<repo>/py/src/probe_item.py","line":8,"column":7,"include_declaration":true}`（**column 必填**） | 同 T1 | daemon ready + **预热 + 结果规模与预期量级相符**（两条同时成立） | 命中数 > 0 且与 gold 同量级 | 返 0 时按间隔重试（上限 3 次）；仍 0 ⇒ 记「索引未就绪」，**不许下「死代码」结论** |
| D codegraph | `codegraph impact ProbeItem -p <repo> -j`（口径 = **受影响符号**，含 import 边与成员） | 同 T1 | 同 T1 | 受影响符号数 > 0 | 1 次 |

### T4 影响面 / 改名（**dry-run**，只给受影响文件清单）

- **提问句**：「把 `ProbeItem` 改名为 `ProbeItemRenamed` 会影响哪些文件？只给清单，**不要落盘**。」
- **锚点**：`ProbeItem` @ `py/src/probe_item.py:8`（gold 锚点 `py_probe_item`）
- **判定口径**：受影响文件集合 vs gold 文件集合 {`py/src/probe_item.py`, `py/src/probe_consumer.py`}；**本任务不落盘**（真改名属 deferred）

| 臂 | 提问姿势 | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | `ide_refactor_rename {"file":"py/src/probe_item.py","line":8,"column":7,"newName":"ProbeItemRenamed","dryRun":true,"project_path":"<repo>"}` | 同 T1 | 同 T1 | `canApply` 与 `affectedFiles` 齐全 | 1 次 |
| B BifrostMCP | `get_rename_locations` —— **扩展 0.0.14 实测坏**（`Unexpected type`）⇒ 记「能力缺席 + 来源」，**不许反复重试** | 同 T1 | — | — | 1 次（确认不是用法错） |
| C agent-lsp | `rename_symbol {"file_path":"<repo>/py/src/probe_item.py","line":8,"column":7,"new_name":"ProbeItemRenamed","dry_run":true}` | 同 T1 | 同 T1 | 返回受影响文件/编辑预览 | 1 次 |
| D codegraph | `codegraph impact ProbeItem -p <repo> -j`（受影响符号 ⇒ 受影响文件） | 同 T1 | 同 T1 | 受影响文件数 > 0 | 1 次 |

### T5 单文件诊断 —— 故意语法错文件

- **提问句**：「`py/src/probe_broken.py` 有什么问题？给出问题条数与类型。」
- **锚点**：`py/src/probe_broken.py`（gold 锚点 `py_broken`，`def broken(:` @ 行 9）
- **判定口径**：问题条数 **≥ 1** 且类型属**语法类**（条数按引擎各自计数粒度记，**不许跨引擎对齐条数**）；文件必须被 Python 解析器拒绝

| 臂 | 提问姿势 | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | `ide_diagnostics {"file":"py/src/probe_broken.py","project_path":"<repo>"}` | 同 T1 | 同 T1（未打开的文件走 closed_batch，告警可能弱化） | `problemCount ≥ 1` 且消息属语法类 | 1 次 |
| B BifrostMCP | `get_code_actions` —— **扩展 0.0.14 实测坏**（`Illegal argument`）⇒ 记「能力缺席 + 来源」 | 同 T1 | — | — | 1 次 |
| C agent-lsp | `get_diagnostics {"file_path":"<repo>/py/src/probe_broken.py"}` | 同 T1 | 同 T1 | `diagnostics[]` 条数 ≥ 1 且类型属语法类 | 1 次 |
| D codegraph | **无诊断能力**（CLI 无检视子命令）⇒ 记「能力缺席 + 来源」 | 已装 1.7.0 | — | — | 1 次 |

### T6 跨语言统一符号空间 —— 同名符号 `ProbeItem`（py + ts）

- **提问句**：「符号 `ProbeItem` 在这个工作区的 `py/` 与 `ts/` 两个子工程里**分别定义在哪、各自被谁引用**？」
- **锚点**：**两套，按语言分列，不合并成一个数** —— py：`ProbeItem` @ `py/src/probe_item.py:8`（gold `py_probe_item`）；ts：`ProbeItem` @ `ts/src/alpha.ts:2`（gold `ts_probe_item`）
- **判定口径**：py 侧 = 文件集合 2 个 / 命中 4；ts 侧 = 文件集合 4 个 / 命中 9。**判定是「每个语言各自命中自己那套」**

| 臂 | 提问姿势 | 环境前提 | 就绪判据 | 规模判据 | 重试上限 |
|---|---|---|---|---|---|
| A IDEA | py 侧同 T1/T3；**ts 侧无此能力**（社区版装不了 JS/TS 插件 ⇒ `.ts` 无 PSI）⇒ 记「能力缺席 + 来源（结构事实）」 | 同 T1 | 同 T1 | py 侧 > 0 | 1 次 |
| B BifrostMCP | `get_workspace_symbols {"query":"ProbeItem"}` —— **一次查询看两种语言是否同现**（VS Code provider 并集） | 同 T1 + VS Code 内建 TS 支持 | 同 T1 | 返回条目里能看到 py 与 ts 两侧 | 1 次 |
| C agent-lsp | py 侧同 T1/T3；**ts 侧无此能力**（LSP 协议级「one server serves one tool」+ 本腿只起 pyright）⇒ 记「能力缺席 + 来源（结构事实）」 | 同 T1 | 同 T1 | py 侧 > 0 | 1 次 |
| D codegraph | `codegraph query ProbeItem -p <repo>` —— **根级索引**（含 py/ + ts/）看两种语言是否同现 | 同 T1 | 同 T1 | 返回条目里能看到 py 与 ts 两侧 | 1 次 |

## 2. 每条臂的取数协议（起法 / 就绪 / 规模 / 重试上限）

### A · IDEA（IDEA 社区版 2026.2.5 + Index MCP 5.20.7 + Python CE）

- **环境前提**：IDEA 在跑；**受信任工程**含 `<repo>`（`setup-env.sh trust <repo>`，否则 IDEA 静默卡在信任弹窗）；工程 = `<repo>` 绝对路径；Python CE 在位（Rust/TS/JVM 不参与同题对照，见 D-03）。
- **起 / 就绪**：`setup-env.sh check` → `mcp-call.sh list index` 拿真实工具面 → `ide_index_status` 的 `isDumbMode:false && isIndexing:false` → `ide_project_status` 的 open project 路径 == `<repo>`（防 worktree 解析到主检出）。
- **平铺导入能不能解析（就绪判据之一）**：本机实测（2026-11-22）—— IDEA 2026.2.5 把 `<repo>` 当 content root（模块配置里**没有**把 `py/src` 标成 source root，`qualifiedName` 是 `py.src.probe_item.ProbeItem`），**但 `from probe_item import ProbeItem` 仍解析得通**：`ide_find_references` 的结果里带一条 `type:"IMPORT"` 的用法 ⇒ 引用面完整。⇒ 就绪判据按**功能口径**写（引用结果里能出现 IMPORT 用法），不按「目录被标成 source root」写。
- **同步**：改动过的文件先 `ide_sync_files`。
- **结果判据**：`resolvedSymbol.kind` 必须是代码符号（`directory`/`package`/空 ⇒ 整条作废，记「静默失效」）；返回全是 `.md` 路径字符串 ⇒ 作废；引用数与 gold 同量级。
- **已有能力（不得记「能力缺席」）**：L3 `ide_diagnostics` ✓、L5 `ide_refactor_rename{dryRun}` ✓。
- **重试**：同一查询重跑 2 次仍与真值矛盾 ⇒ 记 flaky + 失败模式，**不许调判据**。

### B · BifrostMCP（窗口内）

- **环境前提**：**VS Code 窗口常开** + 工作区 = `<repo>` + 扩展 0.0.14 在位 + **Pylance 在位**（缺 Pylance 时 Python 侧返空 —— 那是「环境没装」，不是「漏引用」）。
- **起 / 就绪**：`install-vscode-mcp.sh --check` 报通道就绪 → `get_workspace_symbols` 返回的路径必须属于 `<repo>`（否则静默测错对象）→ **Python 就绪判据**：Python 锚点文件上 `get_document_symbols` 返符号清单（返空 ⇒ 记「环境未就绪」，不进打分）→ TS 索引预热（首次真实调用可能 23.6s）→ 之后才计时。
- **位置与 uri**：`position.line` **零基准**；uri 必须是 `file:///<小写盘符>/<正斜杠路径>`。
- **已知坏工具（只限本臂）**：`get_code_actions`（`Illegal argument`）、`get_rename_locations`（`Unexpected type`）⇒ **诊断与改名不从这条腿取数**；重试上限 1 次后记「无此能力」。
- **规模判据**：`find_usages` 命中数 > 0 且与 gold 同量级；返 0 ⇒ 重试 1 次，仍 0 记「索引未就绪」。

### C · agent-lsp（窗口外）

- **环境前提**：**窗口无关**；server spec **必须带 `,--stdio`**（`python:pyright-langserver,--stdio`；少了它 broker 拉起 server 即退出并自杀，报 `daemon: broker did not start`）。doctor 走直连路径，**不能替代取数前的双确认**。
- **起 / 就绪**：`start_lsp{root_dir, language_id}` **必须带 `language_id: "python"`**（不带会走「全部语言直连」路径，每次冷起 ⇒ 恒返 0）→ daemon ready → **预热等待** → **结果规模与预期量级相符**。三条同时成立才取数。
- **索引未就绪的两种形态**：① 显式提示 `"workspace is still being indexed by the daemon"` ⇒ 按「索引未就绪」重试；② **静默返 0** ⇒ 同样不许下「死代码」结论。
- **返 0 的处理**：不许下「死代码」结论；按间隔重试（上限 3 次），仍 0 ⇒ 记「索引未就绪」。
- **入参**：`find_references` 要 `file_path` + `line`(1-based) + **`column`(1-based，必填)**。
- **root_dir 钉死**：`<repo>/py/src`（平铺导入要 `py/src` 在 sys.path 上 ⇒ pyright 的 root 就是 `py/src`，与 IDEA 的 source root 口径一致）。

### D · codegraph（IDE 无关）

- **环境前提**：已装 1.7.0；**只允许在夹具目录跑**（`codegraph init` 写 `.codegraph/` ⇒ 由 `skills/idea-backend/fixtures/.gitignore` 挡住）。
- **索引范围钉死**：统一在 **`<repo>` 根**上 `codegraph init`（覆盖 `py/` + `ts/`），**不按子工程分别 init** —— T6 要测统一符号空间，只有根级索引能同时含两种语言。
- **基线不可当 gold**：phase 01 的 8/8 是纯 TS 单工程下测的 ⇒ 只作参照。
- **口径**：受影响符号（含 import 边与成员）⇒ 与 IDEA 的「真代码引用」不同义，gold 的两个口径分开换算，**不许直接相减**。
- **已有能力（不得记「能力缺席」）**：`impact` / `callers` 可用。

## 3. 度量口径（每格的数字从哪来、单位是什么）

| 度量 | 定义 | 单位 | 来源 |
|---|---|---|---|
| `calls` | 本任务实测调用序列里的工具调用总数（含定位调用，不含一次性会话准备） | 次 | 各臂的调用记录 |
| `prereq_steps` | 其中**为定位锚点而做**的调用数（答案调用之前的定位步） | 次 | 同上 |
| `setup_calls` | 一次性会话准备调用数（agent-lsp 的 `start_lsp` 等，跨轮次摊销） | 次 | 同上 |
| `payload_bytes` | 本任务全部调用的**响应体字节之和**（回答该任务的字节成本） | 字节 | 各臂的响应体长度 |
| `raw_ms` | 3 轮里每轮实测序列的端到端耗时 | 毫秒（单次样本） | 计时器 |
| `median_ms` | 3 轮的中位耗时 | 毫秒 | 由 `raw_ms` 算出 |
| `hits_reported` | 该臂**原始口径**的命中数（未归一） | 次 | 原始输出 |
| `hits_normalized` | 按 `gold.json` 的 `normalization` 换算到 gold 口径（**含定义行**）后的命中数；口径不同义时为 `null` | 次 | 原始输出 + 归一规则 |
| `files_reported` | 该臂报告的命中文件集合（相对 `<repo>` 的路径） | 个 | 原始输出 |
| `recall.by_files` | `|files_reported ∩ expect_files| / |expect_files|` | 0-1 | 算 |
| `precision.by_files` | `|files_reported ∩ expect_files| / |files_reported|` | 0-1 | 算 |
| `recall.by_hits` | `min(hits_normalized, expect_hits) / expect_hits` | 0-1 | 算 |
| `precision.by_hits` | `min(hits_normalized, expect_hits) / hits_normalized` | 0-1 | 算 |

- **命中口径不同义时**（codegraph 的「受影响符号」）：`hits_normalized = null`、`recall.by_hits`/`precision.by_hits` = `null`，**只算文件口径**，并在 `source` 里写明「口径不同义」。
- **按任务的 scope 换算**（`gold.json` 的 `tasks[].scope` 钉死，`check-experiment.js` 按它重算并对账）：
  | scope | 文件口径 gold | 命中口径 gold |
  |---|---|---|
  | `definition` | {该锚点的 decl_file} | 1（定义条数） |
  | `references` | 该锚点的 expect_files | 该锚点的 expect_hits（含定义行） |
  | `impact` | 该锚点的 expect_files | **不适用** ⇒ `hits_normalized = null` |
  | `diagnostics` | **不适用** ⇒ `files_reported = null` | **不适用** ⇒ 口径 = 问题条数与类型 |
  | `per_language` | 每个语言各按 `references` 口径（py 一套 / ts 一套） | 同上 |
- **flaky 判据**：`hits_reported` 三轮不一致，**或** 耗时极差到判据 ⇒ 该格 `status = flaky`，**不许调和**（不许取多数、不许改判据）。
  - **耗时极差判据** = `(max(raw_ms) − min(raw_ms)) / median(raw_ms) > 0.20` **且** `max(raw_ms) − min(raw_ms) ≥ 100ms`。
  - ⚠️ **绝对下限 100ms 是口径细化**（原口径见 03-CONTEXT `<protocol>` 通用第 2 条）：毫秒级调用的相对抖动是噪声（10ms vs 13ms = 30%），不设下限时整张表会被毫秒级臂打成 flaky。下限的取值不改变「命中数不一致 ⇒ flaky」那一条。
- **时长口径**：毫秒、**单次样本**，不是均值也不是性能承诺。

## 4. 状态与失败模式枚举（取值只有这些）

- `status`：**完成** / **flaky** / **能力缺席** / **未取** / **环境未就绪**
- `failure_mode`：**无失败** / **工具报错** / **索引未就绪** / **漏引用** / **误报** / **超时** / **静默失效** / **能力缺席** / **残缺图** / **环境未就绪**
- 成功格填「无失败」；环境没就绪填「环境未就绪」；**能力缺席与未取两格免数字但必须带来源**。
- **能力缺席 ≠ 失败**：工具面里没有、或实测报协议级/实现级错误 ⇒ 记「无此能力 + 可核对的来源」，重试上限 1 次，之后不再试。
- **反向也成立**：已实测存在的能力**不得**写成「能力缺席」（IDEA 的 `ide_diagnostics`/`ide_refactor_rename{dryRun}`、codegraph 的 `impact`）。
- **T6 的格子语义**：py 侧与 ts 侧**分列**记在 `metrics.by_lang`；一侧结构性不可用时 `status = 能力缺席`、`source` 写清缺哪一侧与出处，已测到的那一侧的数字照样记（**不隐藏**）。

## 5. `results.json` 的字段（键名在这张票钉死 —— 03-02 的门禁按这套键名回查）

```jsonc
{
  "meta": { "repo": "<repo>", "measured_at": "...", "rounds": 3, "warmup": 1 },
  "cells": [
    {
      "task": "T3",
      "config": "A",                       // A=IDEA / B=BifrostMCP / C=agent-lsp / D=codegraph
      "status": "完成",
      "failure_mode": "无失败",
      "anchor": { "symbol": "ProbeItem", "file": "py/src/probe_item.py", "line": 8 },
      "metrics": {
        "calls": 1,
        "payload_bytes": 1234,
        "prereq_steps": 0,
        "raw_ms": [120.3, 118.0, 121.5],
        "median_ms": 120.3,
        "hits_reported": 3,
        "hits_normalized": 4,
        "files_reported": ["py/src/probe_consumer.py", "py/src/probe_item.py"],
        "setup_calls": 0,
        "by_lang": null                    // 只有 T6 用：{"py":{...},"ts":{...} 或 {"absent":"出处"}}
      },
      "recall": { "by_files": 1.0, "precision_by_files": 1.0, "by_hits": 1.0, "precision_by_hits": 1.0 },
      "evidence": [
        { "round": 1, "tool": "ide_find_references", "args": { }, "at": "2026-11-22T23:10:00.000+08:00",
          "elapsed_ms": 120.3, "payload_bytes": 1234, "raw": "……原始输出片段……" }
      ],
      "source": "results.json#cells[i].evidence（原始输出片段；机器本地绝对路径已归一化为 <repo>）"
    }
  ]
}
```

- `cells[]` 共 **6 任务 × 4 配置 = 24 格**；每格字段齐全（能力缺席/未取格免数字但带 `source`）。
- `evidence[]` 逐条记：轮次、工具名、入参、时间戳、耗时、载荷字节、**原始输出片段**（截断到 4000 字符并标注）。
- **`metrics.by_lang`**（只有 T6 用）：`{"py": {symbol, file, line, hits_reported, hits_normalized, files_reported, recall{...}}, "ts": {...}}`；某一侧结构性不可用时该侧写 `{"absent": "<出处>"}`（此时整格 `status = 能力缺席`）。
- **`results.md` 的表**（24 行，行 = 任务 × 配置）列依次为：任务 / 配置 / 锚点 / 状态 / 失败模式 / 召回与精度（文件口径与命中口径各一对）/ 调用次数 / 载荷字节 / 前置步数 / 单次耗时 / 3 轮中位 / 证据指针 / 来源 —— **逐列与 `results.json` 对账**（不许退化成「表里出现这个数字就算对上」）。
- 表由 `node skills/idea-backend/scripts/check-experiment.js --render` **从 `results.json` 生成**（表里的数字不许手写）；手改表会被门禁判红（`表与凭证不一致`）。

## 6. 怎么重测（B / C 两腿的逐条调用清单）

**B 腿（VS Code 原生 SSE 通道 · 官方 MCP SDK 客户端驱动，驱动脚本不入库）**

| 序 | 调用 | 入参 | 该看的判据 |
|---|---|---|---|
| 0 | `install-vscode-mcp.sh --check` | 工作区 = `<repo>` | 报「通道就绪」 |
| 1 | `get_workspace_symbols` | `{"query":"ProbeItem"}` | 返回路径属于 `<repo>`；T6 看 py/ts 是否同现 |
| 2 | `get_document_symbols` | `{"textDocument":{"uri":"file:///<repo>/py/src/probe_item.py"}}` | 返符号清单（空 ⇒ 环境未就绪） |
| 3 | `go_to_definition` | `{"textDocument":{"uri":...},"position":{"line":22,"character":4}}` | 命中 `probe_run` 定义行（**零基准**） |
| 4 | `find_usages` | `{"textDocument":{"uri":...},"position":{"line":7,"character":6},"context":{"includeDeclaration":true}}` | 命中数与 gold 同量级 |
| 5 | `get_rename_locations` | `{"textDocument":{"uri":...},"position":{"line":7,"character":6}}` | 预期 `Unexpected type`（坏工具）⇒ 记能力缺席 |
| 6 | `get_code_actions` | `{"textDocument":{"uri":...},"position":{"line":7,"character":6}}` | 预期 `Illegal argument`（坏工具）⇒ 记能力缺席 |

**C 腿（agent-lsp stdio · 官方 MCP SDK 客户端驱动，驱动脚本不入库）**

| 序 | 调用 | 入参 | 该看的判据 |
|---|---|---|---|
| 0 | `start_lsp` | `{"root_dir":"<repo>/py/src","language_id":"python"}` | **必须带 `language_id`**；daemon ready |
| 1 | 预热 + 规模双确认 | 先 `find_symbol`，再 `find_references` | 结果规模与预期量级相符才取数；返 0 ⇒ 索引未就绪（**不许下死代码结论**） |
| 2 | `find_symbol` | `{"query":"ProbeItem"}` | 符号数 > 0；取位置供 `go_to_definition` |
| 3 | `go_to_definition` | `{"file_path":"<repo>/py/src/probe_item.py","line":23,"column":5}` | 命中定义行 23（**column 必填**） |
| 4 | `find_references` | `{"file_path":"<repo>/py/src/probe_item.py","line":8,"column":7,"include_declaration":true}` | 命中数与 gold 同量级 |
| 5 | `rename_symbol` | `{"file_path":...,"line":8,"column":7,"new_name":"ProbeItemRenamed","dry_run":true}` | 受影响文件/编辑预览（**dry_run，不落盘**） |
| 6 | `get_diagnostics` | `{"file_path":"<repo>/py/src/probe_broken.py"}` | `diagnostics[]` 条数 ≥ 1 且类型属语法类 |

> **官方 MCP SDK 客户端**：Python MCP SDK（本机 1.26.0）的 `mcp.client.sse.sse_client` / `mcp.client.stdio.stdio_client`；驱动脚本**只在本机临时目录**，不入库 —— 原始输出片段入库（`results.json` 的 `evidence[]`），本文件即「怎么重测」的清单。
