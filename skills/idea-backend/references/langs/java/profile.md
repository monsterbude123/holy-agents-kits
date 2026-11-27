# JVM（Java / Kotlin）分册

> **本分册的地位**：JVM 是 IDEA **全版本捆绑**的语言栈（社区版即可用）→ edition 门禁 = `community`，是所有语言里门槛最低的一档。它同时是 `idea-backend` 最早的实战场景（审查→修复流水线在早期 JVM 实战项目上跑出 104 → 0）。
> **本分册还没建配置侧清单**（没有 `checklist.json` / `idea-settings.json`）—— JVM 的"接进 IDEA"多数由 Maven/Gradle + JDK 自动完成；要把 IDE 侧设置也纳入自证清单，照 [../../capability-matrix.md](../../capability-matrix.md) §5 的契约补。

---

## §1 能力档位（2026-11-20 实测）

| 档 | 状态 | 备注 |
|---|---|---|
| L0 文件级 | ✅ | `ide_find_file` |
| L1 文本级 | ✅ | `ide_search_text` |
| **L2 符号级（导航）** | ✅ | Java 是插件符号解析支持最完整的语言：`language:"Java"` + FQN（`com.example.Foo#bar`）或位置法都可用；`ide_find_references` 实测 1.6s / 95 引用零假命中 |
| **L3 检视级（文件）** | ✅ | `ide_diagnostics` / 内置 `get_file_problems`、`lint_files` |
| **L4 检视级（全局）** | ⚠️ 需 monster 分支 | 上游 Index 插件（5.20.x）只有 16 个工具，没有 `ide_inspect` → 流水线自动降级到 L3；降级后拿不到 P3C 与 global 批处理项 |
| **L5 重构级** | ✅ | `ide_refactor_rename`（先 `dryRun:true`）、`ide_refactor_safe_delete`、`ide_move_file` |

---

## §2 必装插件

| 插件 | id | 来源 | 缺了会怎样 |
|---|---|---|---|
| Alibaba Java Coding Guidelines（P3C） | `com.alibaba.p3c.xenoamess` | Marketplace | 检视里没有阿里规范；**且 P3C 的 65 条 `Ali*` 规则只有 11 条能经 MCP 驱动**（其余 54 条是 PMD 动态规则，daemon-core 与批处理管线都不执行）→ 经 MCP 能跑到的"阿里规范"= 直连 Ali 规则 + IDEA 平台检视 |
| Lombok | `Lombok` | **IDEA 捆绑**（平台源码树 `plugins/lombok`，vendor = JetBrains，自 2020.3 起集成） | 插件在位但**构建没跑注解处理**时，仍会大面积误报 `Cannot resolve symbol 'log'` / getter 不可解析 —— 真正的开关是构建侧（声明 lombok 依赖 + 委派构建/开启注解处理），不是装不装插件 |

inspection profile（项目当前生效的那份）在 [rules/Project_Default.xml](rules/Project_Default.xml)，用法与必装插件清单见 [rules/README.md](rules/README.md)。

---

## §3 符号级的正确姿势（Java 专属，但可作其它语言的目标形态）

```bash
# 名字法：先拿 symbolId，后续复用
bash scripts/mcp-call.sh index ide_find_class '{"query":"Service","project_path":"<绝对路径>"}'

# 位置法：file + line/column（1-based，落在符号首字符）+ language:"java"
bash scripts/mcp-call.sh index ide_find_references '{"file":"src/main/java/...","line":42,"column":9,"language":"java","project_path":"<绝对路径>"}'

# FQN 形式：com.example.Service#run
bash scripts/mcp-call.sh index ide_call_hierarchy '{"language":"java","symbol":"com.example.Service#run","direction":"callers","depth":2,"project_path":"<绝对路径>"}'
```

> **凡是返回里带 `resolvedSymbol` 的结果，先确认它解析到了代码符号**（见 [../../capability-matrix.md](../../capability-matrix.md) §2 的 L2 行）——这是所有语言共用的判据。

---

## §4 检视噪音与豁免（每次审查先定）

**通用噪音（直接豁免）**：

- P3C `NonAsciiCharacters` —— 中文注释项目必刷屏（本仓实测 612 条）；
- `BusyWait` —— 看门狗/轮询的 sleep 是设计意图；
- `SpellCheckingInspection` 对协议词/产品词误报（`chatcmpl`/`minioadmin`/`rowcount`/`staleS`/`timeoutS`…）；
- `FieldCanBeLocal` / `UnnecessaryLocalVariable` —— 纯风格，diff 噪音大于收益。

**误报但要保留（不是豁免，是"加抑制 + 中文理由"）**：框架反射调用（`@Bean`/`@Scheduled`/`@PostConstruct`/`@EventListener`/Spring 注入字段）、端口契约方法、错误码注册表的登记项、不可变协议 DTO 的 record 访问器。

**真死码要删**（零引用且非框架调用、非对外契约）：删前用 `ide_find_references` 确认。

---

## §5 审查→修复流水线（JVM 是它的主场）

`ide_inspect` 批检视 → 归一化 `file:line | tool | desc` 清单 → 按**文件边界**分簇 → 并发派发 → JOIN 门禁 → 分组提交。方法论、时间预算、反例集、子代理 prompt 模板与 MCP 授权清单见 [../../audit-fix-playbook.md](../../audit-fix-playbook.md)。

**这套流水线的语言前提**：P3C 规则、global 批处理项（unused declaration / DuplicateExpressions / SameParameterValue…）、`src/main` / `src/test` 分流，都是 JVM 侧能力。别的语言照搬会拿到空清单 —— 那门语言该走它的分册（检视权威源通常是 `tsc`/`ruff`/`go vet` 之类）。

---

## §6 本分册的现状与仍缺的部分（诚实标注）

**已建册（2026-11-22）**：配置侧清单 [checklist.json](checklist.json) **21 条**、IDE 侧设置清单
[idea-settings.json](idea-settings.json) **6 条**，逐条真跑自证（`bash scripts/verify-item.sh --lang java --all`），
引文底账在 [sources.md](sources.md)；探测器 `scripts/langs/java/detect.mjs` 与字节码目标解析器
`scripts/langs/java/declared-release.mjs` 在位并被通用分发器调用；脚手架模板 `templates/java-project`（Maven）
与 `templates/java-gradle`（Gradle）在位；操作正文在 [setup.md](setup.md)。

**已回归（2026-11-22）**：在两个真实工程上跑过一轮（`ai-dev/api-examples/java` 单模块 Maven、
`ai-dev/qData` 多模块 Maven 40 模块），并据此改掉了清单自己的两条误报（多模块的源码目录在模块下不在根上、
`<source>${java.version}</source>` 属性引用形式识别不出）。回归记录见 [setup.md](setup.md) §回归记录。

| 仍缺什么 | 影响 | 补法 |
|---|---|---|
| 运行期档位回归 | §1 的档位是 2026-11-20 的一次快照 | 每半年按 [../../capability-matrix.md](../../capability-matrix.md) §2 重探 |
| Maven / Gradle 的联网构建判据 | 清单刻意不含 `mvn package` 这类需依赖仓库的动作，离线恒红且分不清「配置错」与「网络不通」 | 留给 CI 与本地手动跑；要入册需先解决依赖仓库可达性 |
| Gradle 模板的 wrapper 脚本与 jar | 模板只声明构建器版本事实（gradle-wrapper.properties），不含第三方 jar 与生成的脚本 | 首次用 `gradle wrapper --gradle-version 9.9.2` 生成；模板刻意不内嵌第三方二进制 |
| 更多真实工程回归 | 只在两个工程上回归过；Spring Boot / Gradle 多模块 / Kotlin 混合工程等形态未覆盖 | 每接一个新形态的工程就跑一轮 `--dir <工程>` |
