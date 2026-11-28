# 运维备忘（实测台账）

> 这里放**运行期事实与翻车记录**，正文只留规则。每条都标了实测日期/环境；不同版本的口径以 `tools/list` 实测为准，不以本文为准。

---

## §1 工具面以 `tools/list` 为准（2026-11-20 实测）

```bash
bash scripts/mcp-call.sh list index     # 当前 idea-index server 真实暴露的工具
bash scripts/mcp-call.sh list builtin   # 当前内置 server 真实暴露的工具
bash scripts/mcp-call.sh has index ide_inspect   # 0=有 1=没有 2=探不到 server
```

| Server | 实测工具数 | 内容 |
|---|---|---|
| `idea-index`（上游 5.20.7） | **16** | `ide_find_class` / `ide_find_file` / `ide_find_definition` / `ide_find_references` / `ide_find_implementations` / `ide_find_super_methods` / `ide_call_hierarchy` / `ide_type_hierarchy` / `ide_search_text` / `ide_diagnostics` / `ide_index_status` / `ide_sync_files` / `ide_project_status` / `ide_refactor_rename` / `ide_refactor_safe_delete` / `ide_move_file` |
| `idea-index`（monster 分支额外） | +4 | `ide_inspect` / `ide_refactor_extract_method` / `ide_create_from_template` / `ide_run_control` |
| `idea`（内置 2026.2.5） | **24**（2026-11-27 live） | 含 `search_symbol` / `analyze_calls` / `read_file` / `get_file_problems` / `lint_files` / `build_project` / `apply_patch` / `rename_refactoring` / `execute_terminal_command` / `get_run_configurations` / `execute_run_configuration` / `git_status` 等 |

**怎么判自己装的是哪版**（`config.json` 的 `sideLoadDir` 只记路径，看不出版本）：

```bash
# 插件 jar 名带版本号；monster 分支的版本号带 -monster 后缀
ls "<sideLoadDir>/lib/" | grep -i 'jetbrains-index-mcp-plugin-.*\.jar$'
unzip -p "<sideLoadDir>/lib/jetbrains-index-mcp-plugin-<ver>.jar" META-INF/plugin.xml | grep -E '<version>|<id>'
```

实测（2026-11-20，IDEA IC 2026.2.5）：装的是 **上游 5.20.7**（`com.github.hechtcarmel.jetbrainsindexmcpplugin`）→ **没有 `ide_inspect`** → 审查→修复流水线自动走降级路径（见 §2）。

---

## §2 `ide_inspect` 不可用时的降级口径

`audit-baseline.sh` / `inspect-diff.sh` 现在会**先探测工具面**：

- 有 `ide_inspect` → 原路径（daemon-core 含 P3C + global 批处理 XML）；
- 没有 → 自动改走 **`ide_diagnostics` 文件级检视**，输出格式不变（`file:line | 工具 | 描述`），但：

| 能力 | ide_inspect 路径 | ide_diagnostics 降级路径 |
|---|---|---|
| P3C / 阿里规范 | ✅ | ❌ 拿不到 |
| global 批处理项（unused declaration / DuplicateExpressions / SameParameterValue…） | ✅（XML 全量） | ❌ 拿不到（只有文件级） |
| 编译错误 | ✅ | ✅（`includeBuildErrors:true`，取最近一次构建） |
| 工具名列 | 检视工具名 | **severity**（`ERROR`/`WARNING`/`WEAK_WARNING`） |
| TS/JS 文件 | ⚠️ 依赖插件的 TS 检视 | ❌ **实测恒 0 条**（连语法错误都不报，见 [langs/ts/runtime.md](langs/ts/runtime.md) 实测表） |

⇒ **降级路径是 Java/Kotlin 仓的止血方案**；TS 仓的检视权威源是 `tsc --noEmit` + `eslint`。

---

## §3 `execute_terminal_command` 的真实语义（2026-11-20 实测）

它**不是 IDE 集成终端**，是 **CreateProcess 直调**（不经 shell，PATH 取 **IDEA 进程**的环境，不是 agent shell 的）：

| 写法 | 实测结果 |
|---|---|
| `mvn -v` | `CreateProcess error=2, 系统找不到指定的文件`（IDEA 的 PATH 里没有 mvn） |
| `echo a && echo b` | 输出 `a && echo b`（`&&` 被当成 echo 的普通参数，**没有 shell 解析**） |
| `cmd /c "cd /d X && set FOO=1 && echo hi > f.log 2>&1"` | ✅ 正常执行、文件生成、退出码 0 |
| `cmd /c "... start /b <长任务> > log 2>&1"` | ❌ **挂死到超时**（后台进程继承了输出管道，工具一直等） |

口径：**只做单步小命令**（探针/查询）；复合命令显式包一层 `cmd /c`（Windows）或 `bash -lc`；**禁止后台化**（`start /b` / `&` / `nohup`）；构建与测试走项目既定通道（如 devcontainer）。

---

## §4 路径坑（Windows/MSYS）

| 坑 | 现象 | 解法 |
|---|---|---|
| node 读 MSYS 路径 | `ENOENT: D:\tmp\x`（`/tmp/x` 被解析成 `<当前盘>\tmp\x`） | 传给 node 前 `cygpath -m`（`/tmp/x` → `C:/Users/<u>/AppData/Local/Temp/x`） | <!-- doc-hygiene:allow --> |
| Git Bash 判 `-d "C:/..."` | 恒假 | `cygpath -u` 转成 `/c/...` 再判/拷贝 | <!-- doc-hygiene:allow --> |
| `grep` 是 ugrep | `grep 'pat' /c/path` → 「invalid option」（把路径当选项） | 用 `node -e` / `awk` / 脚本内联列表 |
| `ide_search_text` 的 context 过滤 | `context=code` 可能少命中 | 拿不准就用 `context=all` + 读文件复核 |

> `mcp-call.sh` 已修：SSE 临时文件读给 node 前统一 `cygpath -m`（回归检查见 `scripts/selftest.sh`）。

---

## §5 索引归属（多检出 / worktree）

插件按路径解析目标项目：

- 路径不在任何**已打开**项目内 → 响亮报错 `project_not_found`，并列出 `available_projects`（好现象）；
- 路径是某个已打开项目的**子目录** → 解析到那个项目（正常）；
- ⚠️ **残留洞**：**worktree 嵌在主检出目录内**（如 `<repo>/.worktrees/x`）→ 解析到主检出 → **拿到另一分支的索引且不报错**。

判据（改动前先查）：

```bash
bash scripts/mcp-call.sh index ide_project_status '{}'   # 看 open project 的 path 是否等于你正在改的那棵树
```

`ide_sync_files` 只同步 VFS，**修不了跨检出的索引归属** —— 索引不对就换检出（把目标树在 IDEA 里打开）或停手。

---

## §6 ide_inspect full 引擎（v2+v3，monster 5.21.0-monster.1）

- `scope=files/uncommitted` = **daemon 同款直调引擎**（`InspectionEngine.inspectEx` 逐文件，local 全量含 P3C，实测与 GUI Problems 面板对齐）+ 批处理管线（global 工具如 unused declaration，出 XML）；
- `scope=whole` = 纯批处理管线（只跑 global 工具 → 无 P3C，铁律 4）；
- PCE 有界重试抗写动作抢占（细节与避坑见 [ide-inspect-extension.md](ide-inspect-extension.md) §0.5-§0.6）。

---

## §7 其他已确认事实

- **⚠️ `problems` 文本清单会被截断**（实测 60 文件 `total=403` 只回 68 行）—— 权威清单 = 返回的 `xmlDir` 目录下的 XML 报告 + summary 的 `byTool` 计数；`scope=files` 的每一批都产 `xmlDir`，分批即可拼出全量 global 项，不必额外跑 whole。
- **⚠️ P3C 的 54 条 PMD 规则经 ide_inspect 不可驱动**（实测 2026-11-18）：插件 jar 里只有 11 个直连 `Ali*Inspection` class；profile 里的 `Alibaba*` 条目是 PMD 动态规则，daemon-core 与批处理管线**都不执行**。经 MCP 能跑到的「阿里规范」= 直连 Ali 规则 + IDEA 平台检视；全量 PMD 规则只能在 GUI Analyze 手动跑，或用 p3c-pmd jar 配 PMD CLI（PMD 6.55 解析器对 Java 22+ 语法会碎）。项目 profile 绑定（workspace.xml 的 `PROJECT_PROFILE`）外部编辑需重启 IDEA 才生效。
- **Lombok 误报**（2026-11-22 更正）：此前记的「2026.2.5 不捆绑 Lombok」是**错的** —— Lombok 仍在 IDEA 平台源码树里（`plugins/lombok`，vendor = JetBrains，自 2020.3 起集成），IDEA 2026.2 文档里也从未提到它。大面积 `Cannot resolve symbol 'log'`/getter 不可解析的**真正根因是构建没跑注解处理**（构建脚本没声明 lombok 处理器，或 IDE 没委派构建/没开注解处理）—— 先查这两处，再谈插件。
- 内置 2026 工具普遍要求显式 `projectPath`（单项目打开也要求），漏传会报 "Unable to determine the target project"。
- MCP server 在**项目成功打开后**才启动；项目打不开先查 `idea.log`（`%LOCALAPPDATA%\JetBrains\IdeaIC<ver>\log\`）。
- IDEA 运行中锁定 `<ide>\lib\*.jar`，离线反编译分析需先关 IDE 并拷贝 jar。
- **给 MCP 插件加工具/改引擎调用的守则与避坑反例**（构建-部署-重启循环、反射陷阱清单、引擎参数速查）→ [ide-inspect-extension.md](ide-inspect-extension.md) §0.5-§0.6 —— 动维护仓前必读。
