---
name: idea-backend
description: 通过本机 IDEA 的两个 MCP server（内置 + Index 插件）使用 PSI 语义索引与 inspection 引擎：search_symbol/analyze_calls/read_file（依赖源码/反编译）、find_references/调用与类型层级/diagnostics/安全重命名、ide_inspect 按范围批检视（含阿里 P3C 规范）。含「审查→修复流水线」：一条命令拿全检视基线（audit-baseline.sh）、按文件边界分簇并发修复、统一门禁与分组提交，目标 ≤45min（方法论见 references/audit-fix-playbook.md）。需要真实调用关系（而非文本猜测）、查引用、查实现、安全改名、IDE 级检查、**全仓代码审查/硬编码与重复代码治理/检视结果驱动修复**时使用；已知路径的文件读写用常规文件工具，快速代码探索用 codegraph。机器路径读 config.json（scripts/setup-env.sh 生成）；若检测到本机未安装/未运行 IDEA，先按"环境检测与授权门禁"询问用户，未经授权不得自行下载安装。触发词：idea、IDEA、inspector、inspect、检视、门禁、审查、audit、基线、P3C、阿里巴巴规范、硬编码、重复代码、jetbrains、index、mcp、安装 IDEA、setup。
---

# idea-backend —— 把本机 IDEA 当 agent 的语义后端

> **本 skill 的定位**：研究的是 agent 调度 IDEA 这个开发圣器的**可扩展基座**——IDEA 正在运行的运行时（含内存管理、热索引、inspection 引擎）是 agent 的语义后端。基座之上的新需求，走固定扩展模式：**给 MCP 插件加一个工具**。MCP 插件的**维护仓**：`monsterbude123/jetbrains-index-mcp-plugin-monster`（fork 自 MIT 协议的 hechtcarmel/jetbrains-index-mcp-plugin；本地工作副本路径记录在 config.json 的 `idea.devRepo`，未配置则首次维护时 git clone 维护仓，origin=维护仓、upstream=上游），后续一切优化提交到维护仓并同步安装；扩展点分析见 [references/ide-inspect-extension.md](references/ide-inspect-extension.md)。不要自研扫描器、不要默认走脱离 IDE 的 headless 模式（资源代价大，仅低频深度门禁用官方 `inspect.bat`，见 references §11）。
> **能力边界**：本 skill 是 IDEA 能力的**统一入口**——当前已建成检视（inspection）与 PSI 检索两层，后续 IDEA 的其他能力（重构、运行配置、模板、VCS、终端……）都往这里长，**不另起炉灶**；正文只留调度通则与门禁铁律，每类能力的细节各自进 `references/`，独立到能单独成技能时再拆 `idea-backend-<x>`，主干名不变。
> 检视规则（inspection profile，含 Alibaba Java 规范）是随本 skill 内聚的资产，跨项目复用 = 拷贝本 skill + 按 §环境门禁 setup。

**机器路径一律读 `config.json`（见下"运行时配置"节）——正文与脚本不硬编码任何机器路径，这是 skill 可分发给其他机器 agents 的前提**（翻车案例已沉淀至台账）。

## 环境检测与授权门禁（先执行这一节）

按顺序检测，全部通过才可直接用工具（端口以 `config.json` 的 `ports` 为准，下文 64342/29170 为当前值）；任一失败则**停下来询问用户是否授权补齐环境**（下载约 848MB、全程走代理、需 3-5 分钟；完整流程见 [references/setup-0to1.md](references/setup-0to1.md)），未经授权不得自行下载或安装：

1. **进程**：`tasklist | grep -i idea64` 存在（Linux：`pgrep -f idea`）；**内置 MCP**：`curl -s -m 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:64342/sse` 返回 200；
2. **Index 插件 MCP**：对 `http://127.0.0.1:29170/index-mcp/streamable-http` POST 空 JSON-RPC 返回 4xx（非连接拒绝）即端点存活；**索引就绪**：`ide_index_status` 的 `isDumbMode:false && isIndexing:false`。

仅进程缺失但目录存在 → 询问后按 config 启动；目录不存在 → 询问后按 references §2-§7 全流程补齐。

**新机器首次定位 IDEA（隐私规则，用户裁定：默认禁止全局扫描）**：config 不存在时 → `setup-env.sh roots` 列建议区域 → **先问用户** IDEA 在哪 → 用户确认后 `detect <该区域>` 定向探测 → `init <root>` 生成 config（用户直接给路径则跳过探测）。

**平台支持**：检索/分析/检视与 headless 检视在 **Windows/Linux** 均可用（Linux：启动器 `bin/idea.sh`、headless `bin/inspect.sh`、config 在 `~/.config/JetBrains/IdeaIC<ver>`）。安装/部署流程细节（setup-0to1.md）目前为 Windows 实录——Linux setup 流程同构、命令按平台替换；`setup-env.sh` 已双平台兼容。

## 运行时配置（config.json）——跨机器通用，首次使用先 setup

本 skill 的机器事实（安装根/exe/端口/日志目录）**全部收敛在 `config.json`**（模板见 `config.template.json`），正文不携带任何机器路径：

1. `bash scripts/setup-env.sh check` 通过 → 读 `config.json` 直接走快路径；
2. 不存在（新机器首次使用）→ `bash scripts/setup-env.sh detect` 探测已有安装 → **按门禁询问用户**（用已有安装 or 授权新装，references §2-§7）→ `init <installRoot> [commonProjectPath]` 生成 config.json → 继续；
3. `config.json` 是**机器本地文件：分发 skill 时不要携带**，目标机器用脚本重新生成。

**快路径语义**（读到 config 后）：启动 = 后台跑 `idea.exe`（`run_in_background`，**禁止 schtasks**）；就绪 = `ports.indexMcp` POST initialize 返回非 000，通常 **10-30s**；随后 `ide_index_status` 确认 smart mode；日志在 `idea.logDir\idea.log`。

**IDEA 未运行时的标准动作**（探测 ≤5s，别赌）：
1. 未运行 → 按门禁询问授权 → 后台启动（一行 exe 命令）→ **告知用户"启动中，约 30s 就绪"即可结束该轮**，或最多再等 60s（上限取 `runtime.endpointReadyTimeoutSec`）；
2. **红线**：禁止 ≥3 分钟的阻塞轮询；轮询必须每次迭代输出进度 + 硬上限 ≤60s；
3. 判活只看 HTTP 状态码（`curl -o /dev/null -w '%{http_code}'`，非 000 即活），**别对 `tasklist|grep -c` 做整数比较**（grep 无输出时 `[ -gt ]` 会炸 `integer expression expected`）。

**端口发现**（防止将来漂移，兜底）：内置端口读 `idea.configDir\options\mcpServer.xml` 的 `mcpServerPort`；插件端口默认 29170。

## 版本事实（为什么是 2026.2.5）

社区版新版只发 GitHub Releases（`data.services.jetbrains.com` 的 IIC 记录停更在 2025.3，不能再当版本依据），安装后配置目录为 `IdeaIC<ver>`；下载源、目录前缀、降级装机与踩坑实录见 [references/setup-0to1.md](references/setup-0to1.md)（要装 IDEA 或查版本事实时再读）。

## 双 server 工具面

| Server | 端点 | 关键工具 |
| --- | --- | --- |
| `idea`（内置，2026.2.5，25 个工具） | `http://127.0.0.1:64342/sse`（SSE） | `search_symbol`（项目/依赖/JDK 符号）、`analyze_calls`（INCOMING/OUTGOING 调用树）、`read_file`（依赖/Jar/JDK 源码与反编译）、`get_file_problems`、`lint_files`、`build_project`、`apply_patch`、`search_text/regex/file`、`get_symbol_info`、`rename_refactoring`、`get_run_configurations`/`execute_run_configuration`、`execute_terminal_command`、`git_status`/`get_repositories` |
| `idea-index`（Index 插件，20 个工具，含 monster 扩展） | `http://127.0.0.1:29170/index-mcp/streamable-http`（HTTP） | **`ide_inspect`**（monster：按 scope 批检视，`files/uncommitted`=daemon-core 含 P3C + global 出 XML）、**`ide_refactor_extract_method`**（monster：头less 抽方法——1-based 行列范围 → 自动推导入参/返回值、替换调用点、落盘；范围须同块连续）、**`ide_create_from_template`**（monster：IDEA 文件模板创建 Class/Interface/Enum/Record/AnnotationType/JUnit4TestClass——package/文件头/格式化/落盘自动）、`ide_find_class`/`ide_find_file`、`ide_find_references`、`ide_call_hierarchy`、`ide_type_hierarchy`、`ide_find_implementations`、`ide_find_super_methods`、`ide_diagnostics`、`ide_refactor_rename`/`ide_refactor_safe_delete`/`ide_move_file`、`ide_sync_files`、`ide_index_status` |

## 使用策略

0. **调用一律走 scripts，禁止手搓 curl/JSON-RPC**（手搓已产生过：花括号拼接错、SSE 解析漏行、路径未转换等多次翻车）：
   - **审查基线（主场景）**：`bash scripts/audit-baseline.sh [projectPath] [batchSize=25] [--whole]` —— 自动门禁 → 分批 `ide_inspect`(daemon-core 含 P3C + 每批 XML) → 归一化 `file:line | tool | desc` 清单分 MAIN/TEST/NOISE 三段。**手搓 curl 跑 6+ 次检视 = 25 分钟，它 28 秒**
   - **改动后门禁**：`bash scripts/inspect-diff.sh` —— 自动取 `git diff HEAD + untracked` 代码文件集 → `ide_inspect` → 问题清单（`--all` 含文档）；任意工具调用：`bash scripts/mcp-call.sh index <tool> '<json-args>' [timeoutSec]`（或 `builtin`），输出即 content[0].text
1. **先验就绪**：`ide_index_status` 通过后再做语义查询；VFS 落后先 `ide_sync_files`。
2. **symbolId 复用**：名字法（`ide_find_class` → symbolId，或内置 `search_symbol`）先定位，拿到 `symbolId` 后续引用/层级调用复用它；位置法（`file` + `line`/`column` 1-based 落符号首字符 + `language:"java"`）是兜底。
3. **首轮小范围**：`search_symbol` 显式 `limit:20`；`analyze_calls` 显式 `depth:2, maxChildren:20, maxNodes:100`（官方默认 5/50/1000，截断时用 `cursor`/`treePath` 续读，不要一次拉全树）。
4. **检索/分析一律走 IDEA MCP（强规则，用户裁定）**：代码检索、引用查找、影响面分析、代码理解全部用下表工具，**不用 grep/rg**——agent 手搓 grep 实际表现 = 反复调参数半天 + sleep 等待 + 假命中再排除；IDEA 一次调用拿结构化结论（实测 `ide_find_references` 1.6s/95 引用零假命中）。grep 仅当 IDEA server 不可用且任务不可延迟时兜底，须声明。
   | 意图 | 用什么 | 备注 |
   | --- | --- | --- |
   | 找文本/正则 | `ide_search_text` / `search_text/regex` | file:line:column+上下文一次拿全 |
   | 真代码引用 | `ide_find_references`（symbolId） | 1.6s/95 引用，零假命中 |
   | 全局重命名 | `ide_refactor_rename`（先 `dryRun:true`） | ⚠️ 95+ 引用大符号 dryRun 会挂（台账 K1），先评估规模 |
   | 改签名/抽方法/批量替换 | `ChangeSignatureTool` / `ide_refactor_extract_method` / SSR | 全调用点自动更新 |
   | 调用树/层级/实现 | `analyze_calls` / `ide_call_hierarchy` / `ide_type_hierarchy` / `ide_find_implementations` | 语义关系 |
   | 新建类型文件 | `ide_create_from_template` | package/文件头/格式化自动 |
5. **改名/删除**：先 `dryRun:true` 看冲突预检，用户明确要求才真改；`ide_refactor_safe_delete` 自带 usage 检查。不要用文本替换模拟重构。
6. **检查自检闭环**：改动后跑 `scripts/inspect-diff.sh`（或 `get_file_problems` 文件级）核对无 error，再交 `mvn test`（本仓构建在 devcontainer：`docker exec -u vscode ai-ocr-std-services_devcontainer-app-1 bash -lc "cd /workspace && mvn -q test"`）。
7. **读依赖/JDK 源码**：内置 `read_file` 支持库路径与反编译，不要手动解 jar。
8. **进程全部交 IDE 托管，agent 不自持后台进程**（用户裁定：agent 会忘记关闭自己起的进程）：跑应用/服务用内置 `get_run_configurations` + `execute_run_configuration`（进程进 IDEA Run 面板，可带一次性启动覆盖 `programArguments/workingDirectory/envs`；工具等到超时返回，进程由 IDE 持有——人可在 Run 面板看/停，IDE 关闭即全部终止）；一次性命令用内置 `execute_terminal_command`（IDE 集成终端，输出截 2000 行）。构建/测试例外：本仓构建在 devcontainer 内（见第 6 条），容器生命周期由容器运行时管理。
9. **分工**：理解/梳理全貌 → codegraph；查引用/改名/查错/检索分析（要精确）→ 本 skill；已知路径读文件 → 常规文件工具。

## 审查→修复流水线（IDEA 检视驱动，要「快」就照这条走）

> 完整方法论、时间预算、反例集、子代理 prompt 模板 → **[references/audit-fix-playbook.md](references/audit-fix-playbook.md)**

**一句话**：检视结果是权威输入 → 一条命令拿全基线 → 按**文件边界**分簇 → 一次并发派出 → 编排层统一门禁 → 按簇提交。

**七步（目标 ≤45 min）**：

| 步 | 动作 | 硬上限 |
|---|---|---|
| 0 | 门禁：`setup-env.sh check` + `ide_index_status` | 2 min |
| 1 | **基线**：`audit-baseline.sh <proj> 25` → 归一化清单（MAIN/TEST/NOISE） | 3 min |
| 2 | 分簇：**一个文件只属一簇**、簇=独立可提交、簇内 4~10 文件、测试与其主代码同簇 | 5 min |
| 3 | 一次派出 N 组：prompt 给**精确 `file:line` 清单** + 豁免 + 共用简报 `scripts/audit-brief.md` | 25 min |
| 4 | 中断恢复：`git status` 盘点 → **只补未落地文件**（绝不整体重派） | — |
| 5 | JOIN 门禁：**一次** mvn + **一次** 复检（子代理不许跑 mvn） | 10 min |
| 6 | 分组提交：一簇一笔、显式文件列表 `git add`（禁 `-A`） | 5 min |

**六条铁律**（违反必减速，每条都对应一次真实翻车）：
1. 禁手搓 curl —— 用 `scripts/mcp-call.sh`；
2. 基线只跑一次 —— `audit-baseline.sh` 一条命令拿全；
3. `problems` 文本清单**会被截断** —— 以 `xmlDir` 的 XML + `byTool` 计数为准；
4. `scope=whole` **不含 P3C** —— P3C 只能靠 `scope=files` 分批拿；
5. **簇边界 = 文件边界**（否则子代理互相避让 → 整组没落地 → 多开几轮返工）；
6. **精确清单投递** —— 子代理不自己找问题（自己找 = 慢 + 清单不一致）。

**通用噪音（直接豁免）**：P3C `NonAsciiCharacters`（中文注释项目每条注释报一遍，本仓实测 612 条）、`BusyWait`（看门狗 sleep 是设计意图）、拼写检查对协议词误报、`FieldCanBeLocal`/`UnnecessaryLocalVariable`（纯风格）。
**误报但要保留**（框架反射调用/端口契约/错误码登记项/协议 DTO）：加 `@SuppressWarnings` + 中文理由，**别删**。
**真死码**（零引用、非框架调用、非对外契约）：删前用 `ide_find_references` 确认。


## 运维备忘

- **ide_inspect full 引擎（v2+v3，monster 5.21.0-monster.1）**：`scope=files/uncommitted` = **daemon 同款直调引擎**（`InspectionEngine.inspectEx` 逐文件，local 全量含 P3C，实测与 GUI Problems 面板对齐）+ 批处理管线（global 工具如 unused declaration，出 XML）；`scope=whole` = 纯批处理管线（只跑 global 工具 → 无 P3C，铁律 4）。PCE 有界重试抗写动作抢占。（细节与避坑见 references §0.5-§0.6）
- **⚠️ `problems` 文本清单会被截断（实测 60 文件 total=403 只回 68 行）** —— 权威清单 = 返回的 `xmlDir` 目录下的 XML 报告（批处理管线产出，不截断）+ summary 的 `byTool` 计数；`scope=files` 的**每一批**都产 `xmlDir`，分批即可拼出全量 global 项，不必额外跑 whole。
- **⚠️ P3C 的 54 条 PMD 规则经 ide_inspect 不可驱动（实测 2026-11-18）**：插件 jar 里只有 11 个直连 `Ali*Inspection` class；
  profile 里的 `Alibaba*` 条目是 PMD 动态规则，daemon-core 与批处理管线**都不执行**（对必然违规文件试探零命中，
  `scope=whole` 同样只有 unused.xml）。经 MCP 能跑到的「阿里规范」= 直连 Ali 规则 + IDEA 平台检视；
  全量 PMD 规则只能在 GUI Analyze 手动跑，或用 p3c-pmd jar 配 PMD CLI（PMD 6.55 解析器对 Java 22+ 语法会碎）。
  项目 profile 绑定（workspace.xml 的 `PROJECT_PROFILE`）外部编辑需重启 IDEA 才生效。
- **Lombok 缺口**：2026.2.5 不捆绑 Lombok，缺它会误报 `Cannot resolve symbol 'log'`/getter 不可解析——检查结果大面积此类错误时先装 Lombok 插件（见 references §10）再下结论。
- 内置 2026 工具普遍要求显式 `projectPath`（单项目打开也要求），漏传会报 "Unable to determine the target project"。
- MCP server 在**项目成功打开后**才启动；项目打不开先查 `idea.log`（`%LOCALAPPDATA%\JetBrains\IdeaIC<ver>\log\`）。
- IDEA 运行中锁定 `<ide>\lib\*.jar`，离线反编译分析需先关 IDE 并拷贝 jar。
- **给 MCP 插件加工具/改引擎调用的守则与避坑反例**（构建-部署-重启循环、反射陷阱清单、引擎参数速查）→ [references/ide-inspect-extension.md](references/ide-inspect-extension.md) §0.5-§0.6——动维护仓前必读，别重复踩坑。

## 脚本资产

| 脚本 | 用途 |
|---|---|
| `scripts/setup-env.sh` | 机器事实探测/初始化 `config.json`（`check`/`detect`/`init`） |
| `scripts/mcp-call.sh` | **统一调用出口**：`mcp-call.sh index|builtin <tool> '<json>' [timeoutSec]` |
| `scripts/inspect-diff.sh` | 改动集门禁：自动取 `git diff HEAD + untracked` 代码文件 → `ide_inspect` → 问题清单 |
| `scripts/audit-baseline.sh` | **审查基线一条命令**：门禁 → 分批 `ide_inspect`(含 P3C + 每批 XML) → 归一化清单（MAIN/TEST/NOISE） |
| `scripts/audit-parse.js` | 把 `ide_inspect` 原始输出 + XML 解析成 `file:line | tool | desc` 清单（去重、剔噪、主/测试分流） |
| `scripts/audit-brief.md` | 子代理共用简报模板（工具用法/硬约束/判断原则/豁免/交付格式）——派发时引用它，别复制粘贴 |


## 参考

- **审查→修复流水线（方法论 + 时间预算 + 反例集 + 子代理模板）** → [references/audit-fix-playbook.md](references/audit-fix-playbook.md)
- **质量工具评估（Live Template/时序图/Coverage 判定与替代路径）** → [references/quality-tools-assessment.md](references/quality-tools-assessment.md)；coverage 数据管道：`scripts/jacoco-report.sh`（devcontainer JaCoCo；**前置：项目测试须先绿**）
- **IDEA 基础操作套件盘点（已覆盖/候选/不做的判定与进程托管结论）** → [references/foundation-suite-inventory.md](references/foundation-suite-inventory.md)
- **Inspection 规则与 Profile 配置权威参考（新增/调整 inspect 规则前必读）** → [references/inspection-profiles.md](references/inspection-profiles.md)
- **检视规则包**（项目当前生效的 inspection profile `rules/Project_Default.xml` + 必装插件清单、新项目接入 3 步）→ [rules/README.md](rules/README.md)
- 社区版 Releases（正主）：https://github.com/JetBrains/intellij-community/releases ｜ 内置 MCP 文档：https://www.jetbrains.com/help/idea/mcp-server.html
- **MCP 插件维护仓（优化提交到这里）**：https://github.com/monsterbude123/jetbrains-index-mcp-plugin-monster ｜ Index 插件上游：https://github.com/hechtcarmel/jetbrains-index-mcp-plugin
- 社区技能参考（工具口径与 2026 内置一致）：https://github.com/zz-zhi54/idea-skills

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
