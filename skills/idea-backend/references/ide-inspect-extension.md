# ide_inspect 扩展点分析（阶段 0 产出）+ v1 实现记录

> 目标：给 agent 一个 in-process 的"按 scope + profile 驱动完整 inspection"的 MCP 工具（= GUI 里 Inspect Code + 选 scope 的 MCP 化）。
> 本文是开发前的源码调研结论。日期：2026-11-17，基于 index 插件 v5.20.6（master）+ IDEA 2026.2.5 (262)。

## 0. v1 实现记录（2026-11-17 已交付，分支 feat/ide-inspect，5.21.0-monster.1）

- **重要架构事实（spike 结论）**：`GlobalInspectionContextImpl` 在 253/262 的**公开 API 面不含 inspection 执行入口**（`doInspections` 是 GUI 异步流，结果锁在 tool-window presentation；`performInspectionsWithProgressAndOutput` 不存在）。外部插件主动驱动完整引擎被平台刻意收紧。
- **v1 实际引擎**：平台公开的 `CodeSmellDetector`（IDE 提交前检查用的 local-inspection 批处理，`findCodeSmells(List<VirtualFile>)`），与 `ide_diagnostics` 的 closed-file batch 同源但**可驱动显式文件集**。
- v1 契约：`ide_inspect { scope: uncommitted|files|whole, files?, min_severity?, max_problems?, project_path }` → `{scope, filesInspected, total, truncated, problems[{file,line,severity,description}]}`
- 实现要点（踩坑实录）：
  - `CodeSmellDetectorImpl`/VCS 调用要求 **EDT 或 progress indicator**——用 `edtAction { ProgressManager.runProcess(Computable{...}, EmptyProgressIndicator()) }`（直接 runProcess 不挂 EDT 仍报错）。
  - `uncommitted` 走 `ChangeListManager.getAllChanges()` + `afterRevision/beforeRevision.file.virtualFile`（注意 IDE 启动后需等 VCS 首次扫描完成）；VCS 未启用时返回 null → 报错引导用 files scope。
  - Kotlin SAM 陷阱：`runProcess { ... }` 会匹配 `Runnable` 重载返回 Unit，必须显式 `Computable { ... }`。
- 已知限制：检查集为 profile 的 local-inspection 批处理子集（P3C 覆盖待验证；无 profile 参数——切换 profile 需在 IDE 设置中改当前 profile）；全局（跨文件）inspection 不在此引擎内，深度全量门禁仍走 headless `inspect.bat`。
- v2 候选方向：`CodeInsightUtil`/`LocalInspectionsPass` 直驱 + profile.getInspectionTools 全量；或向 hechtcarmel 上游提 `ide_inspect` PR。

## 0.5 v2 实现记录（2026-11-17，反射驱动 GUI 同源引擎）+ 引擎真相

> v2 已落地并跑通主链路：`ide_inspect { engine:"full" }` 在运行中的 IDE 进程内反射驱动 GUI Inspect Code 同源引擎，profile "Project Default"（1090 工具、含 112 个 Ali*）真实加载执行，global 工具（unused declaration 等）正常导出 XML。**遗留：local 工具（含 P3C Ali*）结果尚未落账**，根因与出路见下。

### 已验证的实现骨架（InspectTool.kt，分支 feat/ide-inspect）

```
Task.Backgroundable（canBeCancelled=true）→ run(indicator) 内：
  有界重试循环（15 次 × 3s，用户取消则不重试）：
    fresh tempDir + createNewGlobalContext(false)
    setExternalProfile(当前项目 profile)  // 与 headless InspectCommand 对齐
    setCurrentScope(AnalysisScope(project, files) / AnalysisScope(GlobalSearchScope.projectScope))
    反射调用 performInspectionsWithProgressAndExportResults(scope, runGlobal, isOffline, outDir, ArrayList<Any>())
    → exportResultsSmart 聚合 XML（计数/分级/样例）→ JSON 返回
```

### 踩坑三连（均已修复并实测）

1. **data race**：`Task.Backgroundable.run` 本身已在 Task indicator 下，再 `ProgressManager.runProcess(Computable, 同一 indicator)` 触发 `assertNoOtherThreadUnder` —— 去掉嵌套，直跑。
2. **PCE（ProcessCanceledException）**：平台对"写动作抢读锁"用协作式取消掐断后台读过程（用户编辑/VFS 刷新都会触发）。daemon 自己就是靠重试活的 → 引擎调用包有界重试（fresh context+dir 每轮）。实测 attempt=1 一次过。
3. **不可变 List 传引擎**：export 内部 add → `Collections.emptyList()` 抛 UnsupportedOperationException → 传 `ArrayList<Any>()`。

### 引擎真签名（262 反编译证实，此前参数语义搞反过）

```java
performInspectionsWithProgress(scope, boolean runGlobalToolsOnly, boolean isOfflineInspections)
performInspectionsWithProgressAndExportResults(scope, runGlobalToolsOnly, isOfflineInspections, Path outputDir, List results)
launchInspectionsOffline(scope, outputDir, runGlobalToolsOnly, results)  // = perform...AndExportResults(scope, runGlobal, true, ...)
```
- **GUI Inspect Code** 走 `launchInspections → performInspectionsWithProgress(scope, false, false)`；
- **headless inspect.bat** 走 `launchInspectionsOffline → (scope, false, true, dir, results)`；
- `runGlobalToolsOnly=true` 直接跳过 local+globalSimple 工具（runTools L410 `if (!runGlobalToolsOnly && ...)`）—— 我们的正确组合是 `(false, true)`。

### local 工具零导出的根因（反编译闭环）

`exportResultsSmart`（GlobalInspectionContextEx）：global 工具从 presentation 导出 XML；**local 工具只检查 outputDir 里"运行期间已被流式写出"的 XML 是否存在**（`Files.exists(...)`），自己不产出。唯一产出者是 `myProblemConsumer`：
- `setProblemConsumer(consumer)`（public，GlobalInspectionContextEx）→ `getPresentation` 对无自定义 presentation EP 的工具返回 `DelegatedInspectionToolPresentation`；
- 该 presentation 对 `LocalInspectionToolWrapper` 的**每个问题**立即调 `consumer.consume(jdomElement, descriptor, wrapper)` —— Element 是引擎自产的 XML 片段（与正式导出同格式），consumer 负责落盘；
- 我们没装 consumer → local 结果全程无人接 → Ali XML 从未出现。headless inspect.bat 必然有人装了 consumer（待确认在 InspectionsResultUtil 或其包装层），GUI 无 outputDir 走的是 presentation 内存面板路线。

### v3 终局（build33，全部经真源码确证，非猜测）

社区仓浅克隆后拿到的**官方真源码**（此前部分结论来自反编译，此处为准）：

1. **local 工具 XML 的官方写出链**（GlobalInspectionContextEx.java L229 注释 + DefaultInspectionToolResultExporter.addProblemElement L495-501）：
   `perform...AndExportResults` 设 `myOutputDir` → 引擎逐文件 `addProblemElement` 时，凡 `outputPath != null` 且是 `LocalInspectionToolWrapper` → **`writeOutput` 流式写 per-tool XML**（`<problems is_local_tool="true">` 开头）；`exportResultsSmart` 只对 local 工具做 `Files.exists` 检查并补 `</problems>` 尾巴。**官方链不需要 consumer**。
2. **consumer 是双保险而非必需**（且会短路官方链）：`setProblemConsumer` 后 `getPresentation` 返回 `DelegatedInspectionToolPresentation`，其 `addProblemElement` 对 local 包装器直接流式 `consume(jdomElement, descriptor, wrapper)`、**不再走 writeOutput**。两路殊途同归（一个落 XML 文件、一个进内存聚合），当前实现保留 consumer（拿结构化样例）。
3. **两个反射级坑（已修）**：
   - 接口签名是 **`org.jdom.Element`（JDOM 1.x）**，不是 org.jdom2；
   - 262 起 jdom 对插件 classloader 不可见 → 接口与 Element 必须**用平台 classloader 加载**（`Application.classLoader`）。
4. **profile 对齐 headless**：官方离线路径用 `ApplicationInspectionProfileManagerBase.getInstanceBase().loadProfile(xmlPath)` 从文件**全新加载** profile 实例，而非项目内存 profile —— 已对齐（build33）。
5. **AnalysisScope 构造器**（whole scope）：262 声明为 `AnalysisScope(SearchScope, Project)`，反射需按声明类型取构造器。

### P3C 在 262 的实证现状（build35 修正版：根因=批处理管线 local 段，daemon 引擎正常）

对照矩阵（同项目同 profile，UsageTracker.java 185/186 的 AliEqualsAvoidNull 为金标准）：

| 路径 | P3C(Ali*) 产出 |
| --- | --- |
| daemon（GUI Problems 面板，用户截图） | **✓** |
| headless `inspect.bat`（262，独立 JVM） | **✓** |
| **daemon-core 直调**（`InspectionEngine.inspectEx` 逐文件，monster build35） | **✓**（185/186 两条 + 其它 local 检查共 7 项，与 GUI 对齐） |
| GlobalInspectionContext 批处理管线的 local 段（GUI Inspect Code 同款调用） | ✗（global 工具正常） |

**结论修正**：P3C 2.3.0 在 262 完全正常；沉默的只是 GlobalInspectionContext 批处理管线对第三方 local 工具的调度段（与 headless 差异未再深究）。**按范围检视的正解 = daemon 同款直调引擎**，实现见 `InspectTool.runDirectLocalInspect`：
- 工具单：`profile.getAllEnabledInspectionTools(project)` → per-file `Tools.getEnabledTool(psiFile, false)` → 过滤 `LocalInspectionToolWrapper`
- 引擎：反射 `InspectionEngine.inspectEx(9参版)`（read action + progress indicator 内）
- **关键坑（守则 #3 的实证）**：**262 运行时签名 ≠ master 源码**——262 是 9 参（带 `ProgressIndicator`），master 已移除该参。反射谓词必须按运行时 jar 的 javap 写，不能抄社区仓 master 源码
- 其它坑：`HighlightDisplayKey`/`getErrorLevel` 不在插件编译 classpath（analysis-impl）→ 全反射；severity 用 `HighlightDisplayKey.find(shortName)` + `profile.getErrorLevel(key, psi)`

对照矩阵（同项目同 profile，UsageTracker.java 185/186 的 AliEqualsAvoidNull 为金标准）：

补充事实：Marketplace 官方声明 P3C 2.3.0 since=251（2025.1+）无 until，兼容 262；插件加载正常（idea.log：RuleInspectionUtils 成功解析 rulesets）；`ide_diagnostics` 在 daemon 后台分析完成前调用会误报"无 Ali"（P3C 初始化是延迟后台任务，别在 IDE 启动后 1-2 分钟内下结论）。

### 262 类位置表 + 本地反编译基建（不再依赖外网）

| 类 | jar | 社区仓 |
| --- | --- | --- |
| GlobalInspectionContextBase（引擎主流程） | `lib/intellij.platform.analysis.impl.jar` | 有源码（analysis-impl 模块） |
| GlobalInspectionContextImpl（GUI 子类） | `lib/intellij.platform.lang.impl.jar` | 闭源仓库，需反编译 |
| GlobalInspectionContextEx（离线+导出） | `lib/intellij.platform.analysis.impl.jar` | 闭源仓库，需反编译 |
| InspectionApplicationBase（inspect.bat 主类） | `lib/intellij.platform.inspect.jar` | 闭源仓库，需反编译 |

反编译命令（IDE 自带 FernFlower；**decompiler 类版本 69 → 必须用 JDK25 跑**，temurin-24 报 UnsupportedClassVersionError）：
```bash
unzip -o -j <jar> '<entry>*.class' -d <clsdir>   # IDE 运行中 jar 被锁，先拷 jar 或先关 IDE
D:/workplace/jdks/temurin-25-win/bin/java.exe -cp "D:\workplace\idea-2026.2.5\plugins\java-decompiler\lib\java-decompiler.jar" \
  org.jetbrains.java.decompiler.main.decompiler.ConsoleDecompiler -dgs=1 <clsdir> <outdir>
```
网络事实（2026-11-17 实测）：`api.github.com` 走 `127.0.0.1:10808` 代理可用（tag→SHA：`git/refs/tags/idea/2026.2.5` → commit `46153841961a…`；contents API 返回 base64）；`raw.githubusercontent.com` 与 `cdn.jsdelivr.net` 该代理下均不可用。

**源码调研首选路径（本次教训：先查源码再反编译）**：大部分引擎源码社区仓就有（含 `GlobalInspectionContextImpl.java` —— 最初误判为闭源）。sparse 浅克隆：
```bash
git -c http.proxy=http://127.0.0.1:10808 -c https.proxy=http://127.0.0.1:10808 \
  clone --depth 1 --filter=blob:none --sparse https://github.com/JetBrains/intellij-community.git ic-src
cd ic-src && git -c http.lowSpeedLimit=0 -c http.lowSpeedTime=300 sparse-checkout set \
  platform/analysis-impl platform/lang-impl platform/inspect   # 勿拉 plugins/ 整目录，太大
```
注意 clone 的是 master 快照（可能领先 2026.2.5 tag），关键结论需对 tag（`git fetch --depth 1 origin <tag-commit>` 后 checkout）复核；本节结论均已按运行 jar/行为验证。若 `*.lock` 残留（git crash 提示）删 `.git/info/sparse-checkout.lock` 等即可。**引擎关键类实际都在社区仓**：GlobalInspectionContextImpl(lang-impl)、GlobalInspectionContextEx/ToolsImpl/BatchModeDescriptorsUtil/DefaultInspectionToolResultExporter(analysis-impl)、InspectionApplicationBase(platform/inspect)。

## 0.6 MCP 维护仓开发守则（避坑反例 + 固化流程，全为真实踩坑）

> **本节为开发机实录**：命令中的绝对路径（`/d/workplace/...`、代理端口等）是开发机环境示例——跨机器执行时按本机 `config.json`/环境换算，**判断依据与反例清单是通用的**。

### 构建-部署-重启标准循环（每轮 5-8 分钟，改一行也要走全流程）

```bash
# 1) 构建：输出必须落文件再查 REAL_EXIT（管道 tail 会吃掉 exit code，出过"假成功"）
source /d/workplace/_idea-setup/grad-env.sh && ./gradlew buildPlugin > buildN.log 2>&1; echo REAL_EXIT=$?
# 2) 停 IDE：先优雅后强杀（jar 被运行中的 IDE 锁定，不杀无法部署）
taskkill /IM idea64.exe; sleep 8; taskkill /F /IM idea64.exe; sleep 2
# 3) 部署：zip 解包后 cp 覆盖 %APPDATA%\JetBrains\IdeaIC2026.2\plugins\jetbrains-index-mcp-plugin\lib\
# 4) 启动：直接后台跑 <ide>\bin\idea64.exe <项目路径>（schtasks 法已弃用：删除运行中任务会杀进程）
# 5) 等端点：循环内必须 echo 每次进度（无输出的静默长循环会被拒绝），硬上限 60s，endpoint 通常 10-20s 就绪
# 6) 验证：requireSmartMode 先过；启动后 1-2 分钟内别下"XX 不产出"的结论（daemon/插件后台初始化未完成，P3C ruleset 即属此类）
```

### 反例清单（❌ 踩过 → ✅ 正解）

1. ❌ 盲改参数反复试 → ✅ 先对照**官方调用者源码**（`launchInspectionsOffline`/`InspectionApplicationBase` 是引擎参数的权威参照）
2. ❌ 反编译当首选 → ✅ 社区仓其实有源码（`GlobalInspectionContextImpl.java` 曾被误判闭源）；先 `git ls-files` 搜，反编译只是兜底
3. ❌ clone master 当目标版本真相 → master 领先 tag；关键结论按 tag commit 复核或用运行 jar 验证
4. ❌ `Class.forName` 默认 plugin classloader → 262 起 jdom 等平台库对插件不可见；用 `Application.classLoader` 加载平台内接口/类
5. ❌ 想当然 `org.jdom2` → 平台捆绑 **org.jdom（1.x）**；接口签名以 `javap` 输出为准
6. ❌ `getConstructor` 传子类类型 → 反射按**声明类型**精确匹配（如 `SearchScope` vs `GlobalSearchScope`）
7. ❌ Kotlin `runProcess { }` SAM → 会匹配 Runnable 返回 Unit；显式 `Computable { ... }`
8. ❌ `Collections.emptyList()` 传引擎 → 导出内部会 add，抛 UnsupportedOperationException；传 `ArrayList<Any>()`
9. ❌ `Task.Backgroundable.run` 里再 `runProcess(同一 indicator)` → `assertNoOtherThreadUnder` data race；Task.run 已在 indicator 下，直跑
10. ❌ 后台读过程指望一次跑完 → 写动作抢读锁会 PCE 取消；必须有界重试（fresh context+dir 每轮；用户主动 cancel 时不重试）
11. ❌ `performInspectionsWithProgress` + `...AndExportResults` 连调 → export 变体本身执行检视，连调=跑两遍
12. ❌ 此 shell 裸用 `grep`/`tasklist //FI` → grep 是 ugrep 别名（用 `/usr/bin/grep`）；tasklist 是 `/FI` 不是 `//FI`
13. ❌ node 里传 `/d/...` → 解析成 `D:\d\...`；node 一律用 Windows 风格路径
14. ❌ 一次长验证里混多个变量 → 每轮构建只验证一个假设；对照实验先设计好"结果 A 说明什么、结果 B 说明什么"

### 引擎参数与机制速查（262 真源码定案）

- GUI：`performInspectionsWithProgress(scope, false, false)`；headless：`launchInspectionsOffline → (scope, false, true, dir, results)`
- `runGlobalToolsOnly=true` 跳过 local+globalSimple（localTools 判空在 L405）
- local XML 官方写出 = `outputPath!=null` 时 `DefaultInspectionToolResultExporter.writeOutput` 流式写；`exportResultsSmart` 只补 `</problems>` 尾巴
- `setProblemConsumer` → Delegated presentation（短路 writeOutput，local 结果改走 consumer；两路殊途同归）
- per-file 工具单 = `ToolsImpl.getEnabledTool(psiFile, includeDoNotShow)`；`includeDoNotShow = profile.getSingleTool() != null`

## 1. 承载方案对比

| 方案 | 结论 |
| --- | --- |
| fork hechtcarmel/jetbrains-index-mcp-plugin | ✅ 选它。MIT 协议；工具注册规整；**自带 scope 基建**；单插件 Gradle 工程，构建/side-load 简单。**已 fork 为维护仓 `monsterbude123/jetbrains-index-mcp-plugin-monster`**（2026-11-17），本地工作副本 `D:\workplace\_idea-setup\jetbrains-index-mcp-plugin`（origin=维护仓 / upstream=上游 hechtcarmel）。后续所有 ide_inspect 等优化在维护仓开发、构建、side-load；上游发新版时 `git fetch upstream` rebase 工具补丁 |
| 贡献 intellij-community 内置 `plugins/mcpserver` | ❌ 暂不。巨仓贡献周期长；其 `AnalysisToolset.lint_files` 走 `readAction` + 本地检查子集（daemon 级），**不经过 GlobalInspectionContext**——这是它不含 P3C/完整 profile 的根因，改它等于大改官方 |

## 2. 插件架构事实（源码调研）

- 工具 = `AbstractMcpTool` 子类：`name` + `description` + `inputSchema`（`SchemaBuilder` DSL）+ handler（PSI 逻辑包 `suspendingReadAction`）。
- `ToolRegistry.registerBuiltInTools()` 分组注册（universal / language navigation / java refactoring）；新工具加一组即可。
- **惊喜**：已有 scope 基建——`handlers/BuiltInSearchScope.kt` + `BuiltInSearchScopeResolver.kt`、`PathGlobScope.kt`、`ExcludedEntriesConfigurable`、`GeneratedSourcesExcludingScope.kt`。`ide_inspect` 的 scope 解析可以直接复用/扩展（补一个 `uncommitted` 走 VCS API：`ChangesUtil`/`ChangeListManager`）。
- **gap 确认**：`tools/intelligence/DiagnosticsAnalysisService.kt`（741 行）无任何 `InspectionManager`/`GlobalInspectionContext` 调用——现有 `ide_diagnostics` 只是读出 IDE 已跑的 daemon 增量分析（所以要求文件已在编辑器打开）。主动驱动 inspection 引擎的路径完全空白，需要新写。

## 3. ide_inspect 设计草案

```
契约：
  ide_inspect {
    scope: "uncommitted" | "changed" | "files" | "whole"   // uncommitted 走 ChangeListManager
    files?: string[]                                        // scope=files 时必填
    profile?: string                                        // profile 名，默认项目 profile
    min_severity?: "error" | "warning" | "info"
    project_path: string
  }
  → { problems: [{file, line, column, severity, inspection, description}], stats, scopeResolved: n_files }
```

实现要点：
1. 引擎：`InspectionManager.getInstance(project).createTools()` 拿全局 tool wrapper，或 `GlobalInspectionContextImpl(project, ...).performInspectionsWithProgressAndOutput(scope, profile, ...)`（与 GUI Inspect Code 同源，含 P3C 等全部 profile 检查）。
2. profile：`InspectionProfileManager.getInstance().getCurrentProfile()` 或按名从 `InspectionProfileManager` 取；skill 的 rules/profile XML 可在 setup 时导入为项目 profile。
3. scope：复用 `BuiltInSearchScopeResolver`；新增 `uncommitted`（`ChangeListManager.getInstance(project).getUncommittedChanges()` → VirtualFile 集 → `ExcludedEntriesConfigurable` 反向 scope）。
4. 线程：inspection 引擎需要 smart mode（`StartupManager`/`DumbService.waitForSmartMode()`）+ 后台 task（照 `DiagnosticsAnalysisService` 的协程/进度写法），结果经 `ReadAction` 收集 PSI 问题。
5. 输出：复用插件的 JSON 序列化模式（kotlinx serializer，见 `LintFileResult` 结构）。

## 4. 构建与验证

- 构建：仓库自带 `gradlew buildPlugin`（Gradle Kotlin DSL + intellij plugin Gradle plugin），产物 `build/distributions/*.zip`。
- side-load：解压进 `%APPDATA%\JetBrains\IdeaIC2026.2\plugins\` 重启（与现 v5.20.6 同 id 会覆盖——**版本号要 bump**（如 5.21.0-local）避免与 marketplace 版本混淆）。
- 一致性验证：`ide_inspect(scope=whole)` 与 headless `inspect.bat` 结果按 (file,line,inspection) 对齐；`scope=uncommitted` 与 `git status` 文件集对齐。
- 资源验证：无独立 JVM（IDE 进程内完成），对照任务管理器内存增量。

## 5. 风险

- GlobalInspectionContext 的公开 API 在 262 有变化风险（`performInspectionsWithProgressAndOutput` 是否仍为扩展可调用面）——开发首日先写 spike 验证该调用链。
- P3C inspection 是否全为 local（可被此引擎调度）：headless 已证明引擎能跑它们，in-process 同引擎应一致。
- 与上游同步：fork 后本地版本号独立；上游发新版时 rebase 工具补丁（MIT 允许，成本低）。

## 0.7 已知问题台账（后续插件修复轮的候选）

| # | 现象 | 证据 | 首要嫌疑 | 修复方向 |
| --- | --- | --- | --- | --- |
| K1 | ~~rename 大符号挂起~~ **已结案（2026-11-18 诊断反转）**：根因=**过期 symbolId**（IDE 重启后服务端 PSI 映射丢失，同 hash id 的恢复尝试拖 ~10 分钟才报 SYMBOL_ID_EXPIRED）。新鲜 id 下 95+ 引用大符号 dryRun 3.65s 成功。**修复=使用约束**（SKILL.md：重启后必须重新 find_class；SYMBOL_ID_EXPIRED 别重试旧 id）+ 插件层待做：失效 id 快速失败 |
| K2 | 批处理检视管线（GlobalInspectionContext）local 段对第三方 local 工具（P3C）静默缺失 | §0.5 对照矩阵 | 引擎对插件 classloader 的工具实例化/分类 | 已用 daemon-core 直调路线绕过；若要修批量路径，从 ToolsImpl.getEnabledTool 对 P3C wrapper 的解析入手 |
| K3 | ~~无 MCP 停进程工具~~ **已解决（2026-11-18）**：`ide_run_control`（status/stop/stopAll，RunContentManager.getAllDescriptors + ProcessHandler.destroyProcess，全反射）已验证空态；262 注意 ExecutionManager 已无 getRunningDescriptors，用 RunContentManager |
| K4 | extract 系缺口：Inline / Introduce Constant/Field 未暴露 | — | 同 processor 反射模式 | 候选 C1/C2（foundation-suite-inventory.md §3） |
