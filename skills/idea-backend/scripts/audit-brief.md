# 审查修复组共用简报（模板）

> 用法：编排层派发子代理时，在 prompt 里写「先读 <skill>/scripts/audit-brief.md」，
> 再补上「你的组（文件清单）+ 精确检视清单 + 本组特有的判断原则/豁免」。
> 简报只放**所有组通用**的东西，组特有信息一律写在 prompt 里（别把 prompt 内容复制进简报，简报是共用的）。

---

## 一、你的任务是什么

按 IDEA inspection 引擎的真实检视结果，修复你那一组文件里的问题。
**检视结果是权威输入**：清单里有的逐条修，清单外的不许自行扩范围（发现了写进报告「待确认」）。

不新增功能、不改对外契约、不做与清单无关的重构。

---

## 二、必用工具：IDEA 原生 MCP（已挂载，直接调用）

本机 IDEA 在跑、索引就绪（编排层已验过 `isDumbMode:false`）。

| 用途 | 工具 | 调用要点 |
|---|---|---|
| 查引用（改签名前必做） | `mcp__idea-index__ide_find_references` | `{"project_path":"<绝对路径>","language":"Java","symbol":"com.x.Y#m"}` 或 `{"file":"...","line":N,"column":M}`；含测试文件（`scope` 默认 project_files 就够）。⚠️ **Java 口径**：TS/Next 仓位置法会解析到**目录符号**（静默给错，不报错）→ 改用 `ide_search_text`（`wholeWord:true`+`context:"code"`）并人工核对 |
| 调用链 | `mcp__idea-index__ide_call_hierarchy` | `{"project_path":"...","language":"Java","symbol":"com.x.Y","direction":"callers","depth":2}` |
| 查实现 | `mcp__idea-index__ide_find_implementations` | `{"project_path":"...","language":"Java","symbol":"com.x.Interface"}` |
| 找类 | `mcp__idea-index__ide_find_class` | `{"project_path":"...","query":"Name"}` |
| VFS 同步（改完必做） | `mcp__idea-index__ide_sync_files` | `{"project_path":"...","paths":["src/..."]}`（省略 paths 则整项目） |
| 无编译错误确认 | `mcp__idea-index__ide_diagnostics` | `{"project_path":"...","files":["src/..."],"includeBuildErrors":true,"severity":"errors"}` |
| 读依赖/JDK 源码 | `mcp__idea__read_file` | 支持库路径与 jar 反编译，**核实 API 语义时用它，不要猜** |
| 语义检索 | `mcp__idea__search_symbol` / `mcp__idea__search_text` | 需要 include_external 查依赖符号 |

**兜底**（原生工具不可用或参数校验失败时）：
```bash
bash <skill>/scripts/mcp-call.sh index <tool> '<json-args>'
```
输出即 `content[0].text`。**不要手搓 curl/JSON-RPC**（花括号拼接、路径转换、ANSI 转义都踩过）。

**Windows/MSYS 坑**（跑 bash 脚本时）：
- 传给 node 的路径先 `cygpath -m`（`/tmp/x` → `C:/.../x`，否则 node 报 `ENOENT: D:\tmp\x`）；
- Git Bash 判目录用 `cygpath -u "C:/..."` → `/c/...`；
- `grep` 是 ugrep，`grep 'pat' /c/path` 会把路径当选项 → 用 `node -e` 或 `awk`。

---

## 三、硬约束（违反 = 返工）

1. **不跑 mvn / 不跑 gradle**：编排层在汇合点统一跑一次。并发跑会踩同一个 `target/`。
2. **不碰 git**：不 commit、不 stash、不 checkout、不改 git 配置、不建分支。提交由编排层按组统一执行。
3. **只改你 prompt 里列的文件**。改到组外文件 = 越权 = 与其他组冲突。
   确实需要组外配合 → 写进报告「需要 XXX 文件配合」，**不要自己动手**。
4. **行为保持**：不改对外行为、响应形状、错误码、进度语义、留痕字段、脱敏规则、上游协议参数。
   只做等价重构/收口/标注。
5. **注释中文**，与邻近代码风格一致；设计模式处 Javadoc 标注模式名与理由（依仓库 AGENTS.md）。

### ⚠️ 改签名必须同步所有调用点（含测试）
改方法名 / 参数列表 / 返回值类型 / record 分量后，**必须**用 `ide_find_references` 找到**全部**调用点，
包括 `src/test/` 下所有测试文件。
> 实战翻车：主代码把私有方法 `main()` 改名 `mainCli()`，测试用反射
> `getDeclaredMethod("main")` 没同步 → `mvn test` 报 `NoSuchMethodError`，整轮返工。
> 改私有方法也要 `grep` 测试里的**字符串反射**。

### ⚠️ 对外契约字节不变
若改了协议 DTO / record 分量：
- 用 `@JsonProperty` 访问器给固定值 + `@JsonPropertyOrder` 固定键序（record 去掉恒定分量的标准写法）；
- **实测**序列化字节与改前一致（可用一次性小程序跑在容器/本地，输出到 /tmp，别碰 target/）；
- JSON 字段名、字段顺序、字段值任一变化 = 契约破坏。

---

## 四、判断原则（该改 vs 该豁免）

| 检视项类型 | 处置 |
|---|---|
| 硬编码字面量 / 假参数（参数恒为同值） | 查引用确认所有调用点同值 → 去参 + 提具名常量；调用点有多值 → 保留参数、显式传常量 |
| 重复表达式 / 可抽方法 | 收敛为单一实现；**行为逐位不变** |
| 恒定返回值（所有实现返回同值） | 先查返回值**是否真被使用**：无人用 → 改 void；有契约（如 rowcount 语义）→ **保留签名** + `@SuppressWarnings` + 中文 Javadoc 澄清 |
| 未用声明 | 框架反射调用（`@Bean`/`@Scheduled`/`@PostConstruct`/`@EventListener`/Spring 注入）/ 端口契约 / 对外契约（错误码登记项、协议 DTO）→ **保留 + 抑制 + 理由**；真零引用且非契约 → 删（删前 `ide_find_references` 确认） |
| 资源未关闭（AutoCloseableResource） | **先判生命周期**：长生命周期共享对象（连接池/客户端单例）加 try-with-resources 会**关掉共享实例** → 不加，抑制 + 理由；用完即弃 → 加 |
| 弃用 API | 换成官方新 API；**先读 jar 源码核实语义**（`mcp__idea__read_file`），不要凭印象换 |
| 拼写检查 | 协议词/产品词误报 → 豁免；真 typo（模板占位符如 `#ref`、拼错的标识符）→ 修 |

**通用噪音（直接豁免，不用管）**：
- P3C `NonAsciiCharacters`（中文注释项目必刷屏）
- `BusyWait`（看门狗/轮询的 sleep 是设计意图）
- `SpellCheckingInspection` 对协议词/产品词的误报（`chatcmpl`/`minioadmin`/`rowcount`/`staleS`/`timeoutS`/`flow`/`job`…）
- `FieldCanBeLocal` / `UnnecessaryLocalVariable`（纯风格，diff 噪音 > 收益）

**处置不确定时**：保留现状 + 加中文注释说明理由 + 写进报告。**宁可不改，不要盲改。**

---

## 五、验证方式（只做这两件，别多做）

1. 改完 → `mcp__idea-index__ide_sync_files`（paths = 你改过的文件）
2. → `mcp__idea-index__ide_diagnostics`（files = 你改过的文件 + 你同步改过的测试文件,
   `includeBuildErrors=true`, `severity="errors"`）→ 必须 `buildErrors: []`

编排层会统一跑检视复检（有 `ide_inspect` 时用 `ide_inspect`，插件版本没暴露该工具时降级 `ide_diagnostics`）+ 项目构建测试，你**不需要**自己复检（避免重复劳动）。

---

## 六、交付格式（只写报告，不写额外文件）

逐条：

```
<file>:<line> | <工具> | <改法> | <结果(已修 / 已修并说明 / 保留+理由 / 删除)>
```

末尾：

```
本组改动文件：<相对仓库根的路径列表>
本组待确认：<清单外发现但未处理的项，及为什么没动>
```

**判断依据必须写清**（尤其「保留 + 抑制」类：调用方是谁 / 为何保留 / 谁在用返回值）。
