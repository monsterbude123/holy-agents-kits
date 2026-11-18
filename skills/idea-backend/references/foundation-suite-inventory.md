# IDEA 基础操作套件盘点（MCP 暴露评估）

> 目标：让 agent 灵活驱使 IDEA 干活——把 IDEA 里"行业已沉淀的最便利 + 已兜底"的基础能力盘出来，
> 判定哪些已暴露、值得新增、不值得做。日期：2026-11-18，IDEA 2026.2.5（内置 40 工具 + index 插件 20 工具为现状基线）。
> 用户裁定约束：**检索/分析一律走 IDEA MCP 不用 grep**；**进程全部交 IDE 托管**（agent 会忘关）。

## 1. 已覆盖（45 个工具按 IDEA 能力分组，别重复造）

| IDEA 能力域 | 已暴露工具（内置=idea / monster=index） |
| --- | --- |
| 语义检索 | `search_symbol`、`search_text/regex/file`、`ide_search_text`、`ide_find_class/file` |
| 引用/层级分析 | `ide_find_references/implementations/super_methods`、`ide_call_hierarchy`、`ide_type_hierarchy`、`analyze_calls` |
| 检视/诊断 | `ide_inspect`（daemon-core 含 P3C + global XML）、`get_file_problems`、`ide_diagnostics`、`lint_files`、`build_project` |
| 重构 | `ide_refactor_rename/safe_delete/move`、`rename_refactoring`、ChangeSignature、`ide_refactor_extract_method`、SSR(StructuralSearchReplace)、EditMember/InsertMember/ReplaceMember、`ide_move_file`、ReformatCode、OptimizeImports、Java→Kotlin |
| 文件 | `ide_create_from_template`、`create_new_file`、`apply_patch`、`read_file`（依赖/JDK 反编译）、`ide_sync_files` |
| 进程托管 | `get_run_configurations` + `execute_run_configuration`（见 §2）、`execute_terminal_command` |
| 环境 | `get_project_modules/dependencies`、`git_status/get_repositories`、`ide_index_status/project_status` |

## 2. 进程托管（用户论点 3 的正解）

- **`execute_run_configuration`**（源码：plugins/mcp-server/mcpserver.toolsets/ExecutionToolset.kt，262 内置）：
  按配置名或代码位置（filePath+line 临时配置）启动 → **进程在 IDEA Run 面板**，工具最多等到 timeout 返回；
  支持一次性启动覆盖（`programArguments`/`workingDirectory`/`envs`，能力位 `supportsDynamicLaunchOverrides`）。
- **`execute_terminal_command`**：IDE 集成终端内执行，输出截 2000 行，超时通知。
- **兜底逻辑链**：agent 超时返回 ≠ 进程死了——进程归 IDE 所有：人在 Run 面板可见可停（红按钮），IDE 关闭全部终止。
  agent **永不自持 nohup/& 后台进程**（本 skill 会话内禁止）；devcontainer 构建/测试例外（容器运行时管生命周期）。
- 已知缺口：无 MCP `stop` 工具（停 Run 面板进程要人点红按钮）→ 台账 K3 候选。

## 3. 候选（值得做，进插件修复轮排队）

| 候选 | IDEA 对应能力 | 价值 | 成本 |
| --- | --- | --- | --- |
| C1 `ide_refactor_inline` | Inline Method/Variable（Extract 对偶，重构闭环收尾） | 中 | 低——同 processor 反射模式（InlineMethodHandler/InlineProcessor 链） |
| C2 `ide_introduce_constant/field` | Extract 系剩余形态（常量/字段提取） | 中 | 低——同上 |
| ~~C3~~ ✅ `ide_run_control`（status/stop/stopAll）已实现（262：RunContentManager.getAllDescriptors + destroyProcess 全反射） |
| ~~C4~~ ✅ rename 无需修复——K1 结案为 symbolId 生命周期约束（见台账） |

## 4. 评估后不做（避免过度工程）

| 能力 | 理由 |
| --- | --- |
| Generate（getter/setter/equals/constructor） | 项目用 Lombok；agent 直写更强 |
| Surround With（try/catch 包裹） | agent 直写即可，无引擎增益 |
| Debugger/Evaluate Expression | 有状态交互复杂，测试场景用 JUnit 更稳 |
| Pull/Push Members Up/Down | 类层次移动低频，EditMember+Move 可覆盖 |
| VCS commit/diff/log | agent 原生 git + 用户 git guardrails 已兜底 |
| Run with Coverage | 已判定 JaCoCo（quality-tools-assessment.md） |
| Recent Files/Bookmarks/TODO | 纯 UI 状态，无 agent 价值 |
