---
name: idea-backend
description: 把本机 IDEA 当 agent 的多语言语义后端，分两段用。一段是「把项目接进 IDEA」（按语言分册：TS/JS、JVM、Python…，每册含版本门禁、项目侧清单、IDE 侧设置、模板与逐条真跑自证的 verify）；一段是「用 IDEA 的语义能力干活」（PSI 检索、引用/调用链、inspection 检视含阿里 P3C、审查→修复流水线、IDE 级重构与运行配置）。语言不是前提：装上对应插件就应对应语言，能到哪一档由能力矩阵判定并可探测（references/capability-matrix.md）。含 audit-baseline.sh 一条命令拿全检视基线、inspect-diff.sh 改动集门禁、mcp-call.sh 统一调用出口。机器路径读 config.json（scripts/setup-env.sh 生成）；本机未装或未运行 IDEA 时先按环境门禁询问用户，未经授权不得自行下载安装。触发词：IDEA、idea、IntelliJ、检视、inspection、审查、audit、基线、P3C、阿里巴巴规范、jetbrains、index、mcp、接进 IDEA、IDE 配置、tsconfig、pyproject、ESLint、Ruff、pytest、运行配置。
---

# idea-backend —— 让 IDEA 成为 agent 的多语言语义后端

> **定位**：agent 调度 IDEA 这个开发圣器的**可扩展基座**——运行中的 IDEA（热索引 + inspection 引擎）就是 agent 的语义后端。基座上的新需求走固定扩展模式：**给 MCP 插件加一个工具**，维护仓 `monsterbude123/jetbrains-index-mcp-plugin-monster`（本地副本路径记在 config.json 的 `idea.devRepo`）；不要自研扫描器、不要默认走脱离 IDE 的 headless（低频深度门禁用官方 `inspect.bat`）。
> **能力边界**：IDEA 能力的**统一入口**——检视与 PSI 检索已建成，其余能力（重构、运行配置、模板、VCS、终端）都往这里长，**不另起炉灶**；正文只留调度通则与门禁铁律，细节进 `references/`。
> **语言不是前提**：IDEA 支持多语言，装上对应插件就能用这门语言；**但支持到哪一档要探测**（见能力矩阵）。正文是语言无关的；某门语言的具体做法在它自己的分册里。
> **机器路径一律读 `config.json`** —— 正文与脚本不硬编码任何机器路径，这是 skill 可分发给其他机器 agents 的前提。

## 一、这段技能分两段，先判断用户要哪段

| 段 | 用户在说什么 | 走哪 | 关键动作 |
|---|---|---|---|
| **A · 接进 IDEA** | 「这个仓怎么接进 IDEA」「IDEA 里跑不起来」「配一下 tsconfig/依赖/索引排除」 | 语言分册 | `setup-env.sh` 装/探环境 → `inspect-project.mjs` 判形态 → 分册清单逐条配 + `verify-item.sh` 自证 |
| **B · 调 IDEA 能力** | 「谁在调这个符号」「按规范审一遍」「改完验一遍」「用 IDEA 重构」 | 通用 + 分册 | `mcp-call.sh` 调 MCP → `audit-baseline.sh` / `inspect-diff.sh` → 分簇派发修复 |

**语言分册路由**（每册 = 版本门禁 + 项目侧清单 + IDE 侧设置 + 模板 + 运行期档位）：

| 语言 | 分册 | edition 门禁 | 配置侧清单 | 运行期档位（L0 文件→L5 重构） |
|---|---|---|---|---|
| JVM（Java/Kotlin） | [references/langs/java/setup.md](references/langs/java/setup.md) | community（捆绑） | 27 条 ✅ 全自证 | L0-L3 ✅ · L4 ⚠️需 monster 插件 · L5 ✅ |
| Python | [references/langs/python/setup.md](references/langs/python/setup.md) | **community**（装 "Python Community Edition"，id 7322，**实测**） | 16 条 ✅ 全自证 | **L0-L3 ✅ · L4 ⚠️需 monster 插件 · L5 ✅** → [档位实测](references/langs/python/runtime.md) |
| TS / JavaScript | [references/langs/ts/setup.md](references/langs/ts/setup.md) | **ultimate**（社区版装不了；侧载实测不可用） | 64 条 ✅ 全自证 | L0-L1 ✅ · L2 静默失效 · L3 恒空 → [档位实测](references/langs/ts/runtime.md) |
| Go / Rust | 无分册 | **ultimate**（社区版不提供 `go-capable`/`rust-capable` 能力模块 → 插件硬装不上） | — | L0-L1 ✅ · L2+ 结构性不可用 → [矩阵 §3.1-§3.4](references/capability-matrix.md) |

**平替（社区版顶不住时的官方路线，2026-11 核对官方页面）**：TS/JS → **WebStorm**（非商业免费）· Rust → **RustRover**（非商业免费）· Go → **GoLand**（付费，无免费档）· 全部 → IDEA Ultimate（付费）。
这些 IDE **都自带内置 MCP server** → 换过去后 `search_symbol`/`analyze_calls` 有真 PSI（社区版里这些工具对没有语言插件的语言是**返回空而不是报错**）。

**没有分册的语言**：只走通用能力（文件索引 / 文本检索 / IDE GUI 重构），明确告诉用户"这门语言还没有分册"，并按 [references/capability-matrix.md](references/capability-matrix.md) §5 的契约补一册。

## 二、环境检测与授权门禁（先执行这一节）

按顺序检测，全部通过才可直接用工具（端口以 `config.json` 的 `ports` 为准）；任一失败则**停下来询问用户是否授权补齐环境**（下载约 848MB、走代理、3-5 分钟；流程见 [references/setup-0to1.md](references/setup-0to1.md)），未经授权不得自行下载或安装：

1. **进程**：`tasklist | grep -i idea64` 存在（Linux：`pgrep -f idea`）；**内置 MCP**：`curl -s -m 4 -o /dev/null -w '%{http_code}' http://127.0.0.1:64342/sse` 返回 200；
2. **Index 插件 MCP**：对 `http://127.0.0.1:29170/index-mcp/streamable-http` POST 空 JSON-RPC 返回 4xx（非连接拒绝）即端点存活；**索引就绪**：`ide_index_status` 的 `isDumbMode:false && isIndexing:false`；
3. **索引归属**：`ide_project_status` 里 open project 的路径 = 你要改的那棵树。**worktree 嵌在主检出内**（`<repo>/.worktrees/x`）会解析到主检出 → 静默拿到**另一分支**的索引（`ide_sync_files` 修不了）；不对就停手换检出；
4. **工具面**：`bash scripts/mcp-call.sh has index ide_inspect`。上游插件版**没有** `ide_inspect`（整条审查流水线会走降级路径）；**工具面以 `mcp-call.sh list index` 实测为准，不以文档为准**；
5. **语言插件在位**：`bash scripts/setup-env.sh plugins <IDEA安装根>` —— 逐语言给出「插件在不在 + edition 门禁」。**先看这张表再决定这门语言能不能做**。社区版装不上的语言插件：**JS/TS（22069）、Go（9568）、Rust（22407）**；**Python 可以**（走 "Python Community Edition"，id 7322）。门禁是每个插件一行，判定机制见 [references/capability-matrix.md](references/capability-matrix.md) §3.1。

**新机器首次定位 IDEA（隐私规则，用户裁定：默认禁止全局扫描）**：config 不存在时 → `setup-env.sh roots` 列建议区域 → **先问用户** IDEA 在哪 → 用户确认后 `detect <该区域>` 定向探测 → `init <root>` 生成 config。
**平台支持**：检索/分析/检视在 Windows/Linux 均可用（Linux：启动器 `bin/idea.sh`、headless `bin/inspect.sh`、config 在 `~/.config/JetBrains/IdeaIC<ver>`）；安装细节目前为 Windows 实录，`setup-env.sh` 已双平台兼容。

## 三、运行时配置（config.json）——跨机器通用，首次使用先 setup

本 skill 的机器事实（安装根/exe/edition/端口/日志目录/插件在位情况/各语言工具链）**全部收敛在 `config.json`**（模板见 `config.template.json`），正文不携带任何机器路径：

1. `bash scripts/setup-env.sh check` 通过 → 读 `config.json` 直接走快路径；
2. 不存在（新机器首次使用）→ `detect` 探测已有安装 → **按门禁询问用户**（用已有安装 or 授权新装）→ `init <installRoot> [commonProjectPath]` 生成 config.json → 继续；
3. `config.json` 是**机器本地文件：分发 skill 时不要携带**，目标机器用脚本重新生成。

**IDEA 未运行时的标准动作**（探测 ≤5s，别赌）：未运行 → 按门禁询问授权 → 后台启动（一行 exe 命令，`run_in_background`，**禁止 schtasks**）→ **告知用户"启动中，约 30s 就绪"即可结束该轮**，或最多再等 60s（上限取 `runtime.endpointReadyTimeoutSec`）；**红线**：禁止 ≥3 分钟的阻塞轮询，轮询必须每次迭代输出进度 + 硬上限 ≤60s；判活只看 HTTP 状态码（`curl -o /dev/null -w '%{http_code}'`，非 000 即活），**别对 `tasklist|grep -c` 做整数比较**（grep 无输出时 `[ -gt ]` 会炸 `integer expression expected`）。

## 四、双 server 工具面

| Server | 端点 | 工具 |
| --- | --- | --- |
| `idea`（内置，2026.2.5，25 个） | `http://127.0.0.1:64342/sse`（SSE） | `search_symbol`（项目/依赖/JDK 符号）、`analyze_calls`（调用树）、`read_file`（依赖/Jar/JDK 源码与反编译）、`get_file_problems`/`lint_files`、`build_project`、`apply_patch`、`search_text/regex/file`、`get_symbol_info`、`rename_refactoring`、`get_run_configurations`/`execute_run_configuration`、`execute_terminal_command`、`git_status`/`get_repositories` |
| `idea-index`（Index 插件，**上游版 16 个**） | `http://127.0.0.1:29170/index-mcp/streamable-http`（HTTP） | `ide_find_class`/`ide_find_file`/`ide_find_definition`/`ide_find_references`/`ide_find_implementations`/`ide_find_super_methods`、`ide_call_hierarchy`/`ide_type_hierarchy`、`ide_search_text`、`ide_diagnostics`、`ide_refactor_rename`/`ide_refactor_safe_delete`/`ide_move_file`、`ide_sync_files`、`ide_index_status`、`ide_project_status` |
| `idea-index`（**monster 分支额外 3 个**） | 同上 | `ide_inspect`（按 scope 批检视，`files/uncommitted`=daemon-core 含 P3C + global 出 XML）、`ide_refactor_extract_method`（头less 抽方法）、`ide_create_from_template`（IDEA 文件模板建类型） |

> **工具面以实测为准**：`bash scripts/mcp-call.sh list index` 拿当前 server 真实暴露的工具（判上游版 vs monster 版、判某工具在不在）。**文档写的工具可能不在你的插件版本里**（上游 5.20.7 就没有 `ide_inspect`）——判据与降级口径见 [references/ops-memo.md](references/ops-memo.md) §1-§2。

## 五、使用策略

0. **调用一律走 scripts，禁止手搓 curl/JSON-RPC**（手搓已产生过：花括号拼接错、SSE 解析漏行、路径未转换等多次翻车）：
   - **审查基线（主场景）**：`bash scripts/audit-baseline.sh [projectPath] [batchSize=25] [--whole]` —— 自动门禁 → 分批检视 → 归一化 `file:line | tool | desc` 清单分 MAIN/TEST/NOISE 三段。**手搓 curl 跑 6+ 次检视 = 25 分钟，它 28 秒**
   - **改动后门禁**：`bash scripts/inspect-diff.sh` —— 自动取 `git diff HEAD + untracked` 代码文件集 → 检视 → 问题清单（`--all` 含文档）；任意工具调用：`bash scripts/mcp-call.sh index <tool> '<json-args>' [timeoutSec]`（或 `builtin`），输出即 content[0].text
1. **先验就绪**：`ide_index_status` 通过后再做语义查询；VFS 落后先 `ide_sync_files`。
2. **symbolId 复用**：名字法（`ide_find_class` → symbolId）先定位，拿到 `symbolId` 后续引用/层级调用复用它；位置法（`file` + `line`/`column` 1-based 落符号首字符 + `language`）是兜底 —— **但 `language` 参数的枚举是运行时算的**（= 该插件注册了 SymbolReferenceHandler 且该语言插件被探测到的语言集）：实测 Java/Kotlin/Python 放行、TS 在没有 JS/TS 插件时报错；**Go/Rust 永远不会进枚举**（插件没给它们注册 handler）。见 [references/capability-matrix.md](references/capability-matrix.md) §3.4。
3. **首轮小范围**：`search_symbol` 显式 `limit:20`；`analyze_calls` 显式 `depth:2, maxChildren:20, maxNodes:100`（官方默认 5/50/1000，截断时用 `cursor`/`treePath` 续读，不要一次拉全树）。
4. **检索/分析一律走 IDEA MCP（强规则，用户裁定）**：代码检索、引用查找、影响面分析、代码理解全部用上表工具，**不用 grep/rg**——agent 手搓 grep 实际表现 = 反复调参数半天 + sleep 等待 + 假命中再排除。grep 仅当 IDEA server 不可用且任务不可延迟时兜底，须声明。
   | 意图 | 用什么 | 备注 |
   | --- | --- | --- |
   | 找文本/正则 | `ide_search_text` / `search_text/regex` | file:line:column+上下文一次拿全 |
   | 真代码引用 | `ide_find_references`（symbolId） | 1.6s/95 引用，零假命中（**JVM 口径**；别的语言先查档位） |
   | 全局重命名 | `ide_refactor_rename`（先 `dryRun:true`） | ⚠️ 95+ 引用大符号 dryRun 会挂（台账 K1），先评估规模 |
   | 改签名/抽方法/批量替换 | `ChangeSignatureTool` / `ide_refactor_extract_method` / SSR | 全调用点自动更新 |
   | 调用树/层级/实现 | `analyze_calls` / `ide_call_hierarchy` / `ide_type_hierarchy` / `ide_find_implementations` | 语义关系 |
   | 新建类型文件 | `ide_create_from_template` | package/文件头/格式化自动 |
5. **改名/删除**：先 `dryRun:true` 看冲突预检，用户明确要求才真改；`ide_refactor_safe_delete` 自带 usage 检查。不要用文本替换模拟重构。
6. **检查自检闭环**：改动后跑 `scripts/inspect-diff.sh`（或 `get_file_problems` 文件级）核对无 error，再交项目既定构建通道（本仓构建在 devcontainer：`docker exec -u vscode ai-ocr-std-services_devcontainer-app-1 bash -lc "cd /workspace && mvn -q test"`）。
7. **读依赖/JDK 源码**：内置 `read_file` 支持库路径与反编译，不要手动解 jar。
8. **进程全部交 IDE 托管，agent 不自持后台进程**（用户裁定）：跑应用/服务用 `get_run_configurations` + `execute_run_configuration`（进程进 IDEA Run 面板，IDE 关闭即全部终止）。**一次性命令**用内置 `execute_terminal_command`——⚠️ 它是 **CreateProcess 直调、不是 shell**（PATH 取 IDEA 进程环境）：只做单步小命令；复合命令显式包 `cmd /c`（Windows）或 `bash -lc`；**禁止后台化**（`start /b`/`&` 会挂死整次调用）；构建/测试走项目既定通道。实测口径见 [references/ops-memo.md](references/ops-memo.md) §3。
9. **分工**：查引用/改名/查错/检索分析（要精确）→ 本 skill；已知路径读文件 → 常规文件工具；**理解/梳理全貌 → codegraph，除非仓库声明 IDEA-only**（见下）。

### 仓库姿态：IDEA-only（仓库规则优先于本 skill 默认）

仓库规则声明「代码面唯一权威 = IDEA」时：① 不得再推荐 codegraph；② §5-4 的 grep 兜底条款**不适用**；③ IDEA 做不到时按三段走 —— **先试配置 → 给 skill 开发者报 issue → 该活阻塞等修好**，不许绕道手搓顶替。

### 能力到不了那一档时（通用）

先查 [references/capability-matrix.md](references/capability-matrix.md) 那一门语言的档位与升档动作；**做不到就明说**，别用文本搜索伪装成语义能力（静默给错比报错更贵）。

## 六、审查→修复流水线（检视驱动，要「快」就照这条走）

> 完整方法论、时间预算、反例集、子代理 prompt 模板与**子代理 MCP 授权清单** → **[references/audit-fix-playbook.md](references/audit-fix-playbook.md)**

**一句话**：检视结果是权威输入 → 一条命令拿全基线 → 按**文件边界**分簇 → 一次并发派出 → 编排层统一门禁 → 按簇提交。

**七步（目标 ≤45 min）**：0 门禁（`setup-env.sh check` + `ide_index_status` + **工具面探测**）→ 1 **基线**（`audit-baseline.sh`）→ 2 分簇（一个文件只属一簇、簇内 4~10 文件、测试与其主代码同簇）→ 3 一次派出 N 组（精确 `file:line` 清单 + 豁免 + 共用简报）→ 4 中断恢复（`git status` 盘点 → **只补未落地文件**）→ 5 JOIN 门禁（**一次**构建测试 + **一次**复检，子代理不许跑构建）→ 6 分组提交（一簇一笔、显式文件列表 `git add`，禁 `-A`）。

**六条铁律**（违反必减速，每条都对应一次真实翻车）：
1. 禁手搓 curl —— 用 `scripts/mcp-call.sh`；
2. 基线只跑一次 —— `audit-baseline.sh` 一条命令拿全；
3. `problems` 文本清单**会被截断** —— 以 `xmlDir` 的 XML + `byTool` 计数为准；
4. `scope=whole` **不含 P3C** —— P3C 只能靠 `scope=files` 分批拿；
5. **簇边界 = 文件边界**（否则子代理互相避让 → 整组没落地 → 多开几轮返工）；
6. **精确清单投递** —— 子代理不自己找问题（自己找 = 慢 + 清单不一致）。

**降级路径（没有 `ide_inspect` 时）**：`audit-baseline.sh` / `inspect-diff.sh` 自动改走 `ide_diagnostics` 文件级检视，输出格式不变，但**拿不到 P3C/阿里规范与 global 批处理项**（工具列 = severity）。能力差距见 [references/ops-memo.md](references/ops-memo.md) §2。

**流水线的语言前提**：P3C/global 批处理/`src/main`-`src/test` 分流都是 JVM 侧能力；别的语言请走它分册的检视权威源（`tsc`/`ruff`/`go vet`…），照搬会拿到空清单。

## 七、脚本资产

| 脚本 | 用途 |
|---|---|
| `scripts/setup-env.sh` | 机器事实探测/初始化 `config.json`（`roots`/`detect`/`probe`/`init`/`check`/`plugins`/`install-deps --lang`） |
| `scripts/inspect-project.mjs` | **通用探测器**：按 marker 判语言 → 调该语言分册探测器 → 出事实 → 过滤该语言适用清单条目（`--ids`/`--json`/`--lang`/`--list-langs`） |
| `scripts/mcp-call.sh` | **统一调用出口**：`mcp-call.sh index|builtin <tool> '<json>' [timeoutSec]`；`list <server>` 拿真实工具面；`has <server> <tool>` 判工具在不在 |
| `scripts/inspect-diff.sh` | 改动集门禁：自动取 `git diff HEAD + untracked` 代码文件 → 检视 → 问题清单（无 `ide_inspect` 时自动降级） |
| `scripts/audit-baseline.sh` | **审查基线一条命令**：门禁 → 分批检视 → 归一化清单（MAIN/TEST/NOISE；无 `ide_inspect` 时自动降级） |
| `scripts/audit-parse.js` | 把检视原始输出 + XML 解析成 `file:line | tool | desc` 清单（去重、剔噪、主/测试分流；兼容 `ide_diagnostics` 降级输出） |
| `scripts/verify-item.sh` | **分册清单自证**：`--lang <lang> --all` 逐条真跑 `verify`（被检工程 = 当前工作目录；默认切到分册模板，`--dir <工程>` 可查真实工程） |
| `scripts/verify-quotes.mjs` | **溯源门禁**：每条清单/设置条目的 `quote` 必须能在该分册 `sources.md` 里逐字命中（`--lang <lang>` 可限分册） |
| `scripts/check-registry-entry.sh` | IDE 侧设置条目结构校验（`--lang <lang> <id>`：路径/期望/断言/出处/引文齐全） |
| `scripts/init-project.sh` | 按分册脚手架建新项目（`--lang <lang> [--template <name>]`） |
| `scripts/audit-brief.md` | 子代理共用简报模板（工具用法/硬约束/判断原则/豁免/交付格式）——派发时引用它，别复制粘贴 |
| `scripts/selftest.sh` | 脚本自检（路径桥接 / 工具面探测 / 清单解析）——改完脚本跑一遍 |

## 八、参考

- **语言 × 能力档位矩阵（档位定义 / 探测判据 / 升档动作 / 新增分册契约）** → [references/capability-matrix.md](references/capability-matrix.md)
- **分册内部件**：TS 分册的引文快照 [references/langs/ts/sources.md](references/langs/ts/sources.md)、运行期档位与侧载实验留档 [references/langs/ts/runtime.md](references/langs/ts/runtime.md)、真实仓库回归记录 [references/langs/ts/field-test.md](references/langs/ts/field-test.md)、逐步操作手册 [references/langs/ts/setup-manual.md](references/langs/ts/setup-manual.md)；Python 分册的引文快照 [references/langs/python/sources.md](references/langs/python/sources.md)、运行期档位实测 [references/langs/python/runtime.md](references/langs/python/runtime.md)；JVM 分册的引文快照 [references/langs/java/sources.md](references/langs/java/sources.md)、档位与检视噪声 [references/langs/java/profile.md](references/langs/java/profile.md)；Go/Rust 分册的门禁与平替 [references/langs/go/setup.md](references/langs/go/setup.md) / [references/langs/rust/setup.md](references/langs/rust/setup.md)、档位 [references/langs/go/runtime.md](references/langs/go/runtime.md) / [references/langs/rust/runtime.md](references/langs/rust/runtime.md)、引文底账 [references/langs/go/sources.md](references/langs/go/sources.md) / [references/langs/rust/sources.md](references/langs/rust/sources.md)；分册探测器 [scripts/langs/ts/detect.mjs](scripts/langs/ts/detect.mjs) / [scripts/langs/java/detect.mjs](scripts/langs/java/detect.mjs) / [scripts/langs/python/detect.mjs](scripts/langs/python/detect.mjs) / [scripts/langs/go/detect.mjs](scripts/langs/go/detect.mjs) / [scripts/langs/rust/detect.mjs](scripts/langs/rust/detect.mjs)（通用分发器按语言调用，新增语言照它的形状写）
- **审查→修复流水线（方法论 + 时间预算 + 反例集 + 子代理模板 + MCP 授权清单）** → [references/audit-fix-playbook.md](references/audit-fix-playbook.md)
- **运维备忘（工具面实测、降级能力差距、终端真实语义、路径坑、索引归属）** → [references/ops-memo.md](references/ops-memo.md)
- **IDEA 安装与部署（版本事实、目录、踩坑实录）** → [references/setup-0to1.md](references/setup-0to1.md)
- **质量工具评估（Live Template/时序图/Coverage 判定与替代路径）** → [references/quality-tools-assessment.md](references/quality-tools-assessment.md)；coverage 数据管道：`scripts/jacoco-report.sh`（devcontainer JaCoCo；**前置：项目测试须先绿**）
- **IDEA 基础操作套件盘点（已覆盖/候选/不做的判定与进程托管结论）** → [references/foundation-suite-inventory.md](references/foundation-suite-inventory.md)
- **Inspection 规则与 Profile 配置权威参考（新增/调整 inspect 规则前必读）** → [references/inspection-profiles.md](references/inspection-profiles.md)
- **给 MCP 插件加工具 / 改引擎调用的守则与避坑反例** → [references/ide-inspect-extension.md](references/ide-inspect-extension.md) §0.5-§0.6（动维护仓前必读）
- 社区版 Releases（正主）：https://github.com/JetBrains/intellij-community/releases ｜ 内置 MCP 文档：https://www.jetbrains.com/help/idea/mcp-server.html
- **MCP 插件维护仓（优化提交到这里）**：https://github.com/monsterbude123/jetbrains-index-mcp-plugin-monster ｜ Index 插件上游：https://github.com/hechtcarmel/jetbrains-index-mcp-plugin

> 反馈：本技能来自 [holy-agents-kits](https://github.com/monsterbude123/holy-agents-kits)。发现错误、缺步骤或命令跑不通，直接开 issue：https://github.com/monsterbude123/holy-agents-kits/issues/new
