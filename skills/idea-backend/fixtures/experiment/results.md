| 任务 | 配置 | 锚点 | 状态 | 失败模式 | 召回与精度 | 调用次数 | 载荷字节 | 前置步数 | 单次耗时 | 3 轮中位 | 证据指针 | 来源 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T1 | A | ProbeItem @ py/src/probe_item.py:8 | flaky | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 549 | 0 | 2159.1ms | 2159.1ms | cells[0].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段）；本格标 flaky（耗时极差超判据） |
| T1 | B | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 2 | 719 | 1 | 30.2ms | 36.7ms | cells[1].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T1 | C | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 2 | 433 | 1 | 13.6ms | 15.0ms | cells[2].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T1 | D | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 82 | 0 | 1522.7ms | 1692.5ms | cells[3].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T2 | A | probe_run @ py/src/probe_item.py:23 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 315 | 0 | 1591.2ms | 1614.7ms | cells[4].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T2 | B | probe_run @ py/src/probe_item.py:23 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 245 | 0 | 56.9ms | 50.8ms | cells[5].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T2 | C | probe_run @ py/src/probe_item.py:23 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 262 | 0 | 35.0ms | 21.4ms | cells[6].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T2 | D | probe_run @ py/src/probe_item.py:23 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 572 | 0 | 1792.3ms | 1609.0ms | cells[7].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T3 | A | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 849 | 0 | 2156.0ms | 2156.0ms | cells[8].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T3 | B | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 953 | 0 | 30.4ms | 28.7ms | cells[9].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T3 | C | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 1 | 595 | 0 | 15.9ms | 15.9ms | cells[10].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T3 | D | ProbeItem @ py/src/probe_item.py:8 | flaky | 无失败 | 文件 1.00/1.00 · 命中 —/— | 1 | 5393 | 0 | 1726.6ms | 1452.3ms | cells[11].evidence | codegraph 的口径是**受影响符号**（含 import 边与成员）⇒ 与 gold 的「整词命中数」不同义，命中口径记 null，只比文件口径；本格标 flaky（耗时极差超判据） |
| T4 | A | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 —/— | 1 | 576 | 0 | 1547.7ms | 1477.5ms | cells[12].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T4 | B | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 —/— | 1 | 650 | 0 | 17.7ms | 20.0ms | cells[13].evidence | 本机实测：BifrostMCP 0.0.14 的 get_rename_locations 本轮**可用**（返回改名编辑清单、影响文件 2 个）—— 与 phase 02 记的「Unexpected type」矛盾（见 skills/vscode-backend/references/setup.md §0 事实块）；该工具的可用性随会话状态波动 ⇒ 按本轮实测记「完成」，不记「能力缺席」 |
| T4 | C | ProbeItem @ py/src/probe_item.py:8 | flaky | 无失败 | 文件 1.00/1.00 · 命中 —/— | 1 | 1116 | 0 | 805.9ms | 1008.9ms | cells[14].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段）；本格标 flaky（耗时极差超判据） |
| T4 | D | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 —/— | 1 | 5393 | 0 | 1059.1ms | 1145.3ms | cells[15].evidence | codegraph 的口径是**受影响符号**（含 import 边与成员）⇒ 命中口径不适用（记 null），只比文件口径 |
| T5 | A | broken @ py/src/probe_broken.py:9 | 完成 | 无失败 | 文件 —/— · 命中 —/— | 1 | 853 | 0 | 2069.1ms | 2069.1ms | cells[16].evidence | 本机实测记录（本记录的 calls[] 里有逐条原始输出片段） |
| T5 | B | broken @ py/src/probe_broken.py:9 | 能力缺席 | 能力缺席 | 文件 —/— · 命中 —/— | 1 | 23 | 0 | 9.5ms | 9.1ms | cells[17].evidence | 能力缺席 —— 实测 BifrostMCP 0.0.14 的 get_code_actions 报 Illegal argument（与 phase 02 记录一致，见 skills/vscode-backend/references/setup.md §0 事实块） |
| T5 | C | broken @ py/src/probe_broken.py:9 | 未取 | 索引未就绪 | 文件 —/— · 命中 —/— | 1 | 267 | 0 | 25017.4ms | 25017.4ms | cells[18].evidence | agent-lsp 的 get_diagnostics 返 0 条；工具自己写明「the server has not published any for this document; this does not confirm the file is clean」—— 同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错 ⇒ 空结果按「索引未就绪」记（protocol：C 臂返 0 不许下结论） |
| T5 | D | broken @ py/src/probe_broken.py:9 | 能力缺席 | 能力缺席 | 文件 —/— · 命中 —/— | 0 | 0 | 0 | 0.0ms | 0.0ms | cells[19].evidence | 能力缺席 —— codegraph 1.7.0 的 CLI 没有检视/诊断子命令（命令表见 `codegraph --help`） |
| T6 | A | ProbeItem @ py/src/probe_item.py:8 | 能力缺席 | 能力缺席 | 文件 1.00/1.00 · 命中 1.00/1.00 | 2 | 1398 | 1 | 3682.8ms | 3434.7ms | cells[20].evidence | 能力缺席 —— IDEA 社区版 2026.2.5 装不了 JS/TS 插件 ⇒ .ts 无 PSI（结构事实，见 skills/idea-backend/references/langs/ts/runtime.md） |
| T6 | B | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 1.00/1.00 | 3 | 3670 | 1 | 44.0ms | 44.0ms | cells[21].evidence | 一次 get_workspace_symbols 同时返回 py 与 ts 两侧的 ProbeItem（VS Code provider 并集）⇒ 跨语言统一符号空间在 VS Code 窗口内成立 |
| T6 | C | ProbeItem @ py/src/probe_item.py:8 | 能力缺席 | 能力缺席 | 文件 1.00/1.00 · 命中 1.00/1.00 | 2 | 768 | 1 | 77.9ms | 85.5ms | cells[22].evidence | 能力缺席 —— LSP 协议级『one server serves one tool』且本腿只起 pyright ⇒ 没有 TS 侧符号空间（结构事实，见 skills/idea-backend/references/semantic-backend-options.md） |
| T6 | D | ProbeItem @ py/src/probe_item.py:8 | 完成 | 无失败 | 文件 1.00/1.00 · 命中 —/— | 3 | 17324 | 1 | 4237.3ms | 4325.2ms | cells[23].evidence | 根级索引（<repo> 一次 codegraph init）⇒ 一次 impact 同时覆盖 py/ 与 ts/ 两个子工程 —— 跨语言统一符号空间在 codegraph 上成立 |

## T6 · 分语言明细（按语言分列，不合并成一个数）

| 任务 | 配置 | 语言 | 锚点 | 状态 | 命中 | 命中文件 | 召回·文件 | 精度·文件 | 召回·命中 | 精度·命中 | 备注 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T6 | A | py | ProbeItem @ py/src/probe_item.py:8 | 能力缺席 | 3 | 2 | 1.00 | 1.00 | 1.00 | 1.00 | 命中口径归一后 4 次 |
| T6 | A | ts | — | 能力缺席 | — | — | — | — | — | — | 能力缺席 —— IDEA 社区版 2026.2.5 装不了 JS/TS 插件 ⇒ .ts 无 PSI（结构事实，见 skills/idea-backend/references/langs/ts/runtime.md） |
| T6 | B | py | ProbeItem @ py/src/probe_item.py:8 | 完成 | 4 | 2 | 1.00 | 1.00 | 1.00 | 1.00 | 命中口径归一后 4 次 |
| T6 | B | ts | ProbeItem @ ts/src/alpha.ts:2 | 完成 | 9 | 4 | 1.00 | 1.00 | 1.00 | 1.00 | 命中口径归一后 9 次 |
| T6 | C | py | ProbeItem @ py/src/probe_item.py:8 | 能力缺席 | 4 | 2 | 1.00 | 1.00 | 1.00 | 1.00 | 命中口径归一后 4 次 |
| T6 | C | ts | — | 能力缺席 | — | — | — | — | — | — | 能力缺席 —— LSP 协议级『one server serves one tool』且本腿只起 pyright ⇒ 没有 TS 侧符号空间（结构事实，见 skills/idea-backend/references/semantic-backend-options.md） |
| T6 | D | py | ProbeItem @ py/src/probe_item.py:8 | 完成 | 6 | 2 | 1.00 | 1.00 | — | — | 命中口径不适用（口径不同义） |
| T6 | D | ts | ProbeItem @ ts/src/alpha.ts:2 | 完成 | 11 | 4 | 1.00 | 1.00 | — | — | 命中口径不适用（口径不同义） |

## T5 · 单文件诊断明细（问题条数与类型；判定口径 = 条数 ≥ 1 且类型属语法类）

| 任务 | 配置 | 状态 | 失败模式 | 问题条数 | 问题类型 / 备注 | 证据指针 |
|---|---|---|---|---|---|---|
| T5 | A | 完成 | 无失败 | 2 | Formal parameter name expected / ':' expected | cells[16].evidence |
| T5 | B | 能力缺席 | 能力缺席 | — | — | cells[17].evidence |
| T5 | C | 未取 | 索引未就绪 | 0 | agent-lsp 的 get_diagnostics 返 0 条：工具自己写明『the server has not published any for this document; this does not confirm the file is clean』—— 同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错 ⇒ 空结果是未就绪，不是真干净 | cells[18].evidence |
| T5 | D | 能力缺席 | 能力缺席 | — | 该臂的工具面里没有这个任务的能力 | cells[19].evidence |
