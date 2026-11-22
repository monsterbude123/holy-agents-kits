# TS / JavaScript 分册 —— 运行期能力档位（agent 调 IDEA 的实测口径）

> **怎么读这份文档**：IDEA 的运行期能力**按语言分档**，档位由「IDE 版本 + 装了哪些插件 + 当前插件构建」三者共同决定 —— 同一门语言在不同机器上可以落在不同档。通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)；本文是 **TS/JS 那一档在 2026-11-20 这台机器上的实测值**。
> 实测环境：Windows 11 26200、IDEA IC 2026.2.5、Index 插件 **5.20.7（上游版）**、Next.js 15 + TS 5.x 仓（20 万行级，`tsconfig paths: {"@/*": ["./src/*"]}`）。

---

## §0 TS/JS 当前落在哪一档

| 能力档 | 状态 | 一句话 |
|---|---|---|
| 文件索引 / 按名找文件 | ✅ 可用 | `ide_find_file` 能列出 .ts/.tsx |
| 文本检索 | ✅ 可用 | `ide_search_text` + `wholeWord` + `context=code` → 13/13 真命中 |
| 符号级（定义/引用/调用链） | ⚠️ **静默失效** | 位置法解析到**目录符号** —— 根因是**本机没装 JS/TS 插件 → .ts 文件没有 PSI**（不是 `language` 枚举不放行，见 §6.1） |
| 文件级检视 | ⚠️ **恒空** | `ide_diagnostics` 对 TS 文件连语法错误都不报 |
| 语义重构 | ⚠️ 不可靠 | 改名/抽方法内部同样走位置法 |

⇒ **在当前插件构建下，TS/JS 的运行期可靠面 = 文本级 + 文件级索引**；语义级与检视级要等**语言插件在位**（见 §6）。

> ⚠️ **不要把"社区版装不了 JS/TS 插件"当成终点** —— 2026-11-22 实测：侧载官方 JS/TS 插件进社区版**确实能加载**（见 §6.2），
> 但运行期缺 33 个专有类 → 每次开文件都抛 → **工程实际不可用**。平替是 **WebStorm**（非商业免费），矩阵见 [../../capability-matrix.md](../../capability-matrix.md) §3.3。
>
> 💡 **对照实测（Rust）**：装了 Rust 插件后，尽管 `language` 枚举里**没有** Rust（插件没注册 SymbolReferenceHandler），
> **位置法照样能用**（`resolvedSymbol.kind = "function"`）。→ 判定 L2 的口径是「**文件有没有 PSI**」，不是「枚举放不放行」。

---

## §1 实测矩阵：符号级能力失效，而且不报错

| 路线 | 实测结果 | 判据 |
|---|---|---|
| 位置法 `file+line+column` → `ide_find_references` / `ide_find_definition` | **解析到外层目录符号**（`resolvedSymbol.kind = "directory"`，如 `src/lib/home`），代码命中 **0** 条 | `resolvedSymbol.kind == directory\|package` ⇒ **结果作废** |
| 位置法 + 不加路径过滤 | 返回几百条 **markdown 里的路径字符串**（假命中，`.planning/*.md` 里写 `src/app/[locale]/...` 全算引用） | 同上 |
| `language:"TypeScript"` + `symbol` | server 直接拒：`Unsupported language for symbol references: TypeScript ... Currently supported languages: Java` | — |
| `symbol` 不带 `language` | server 拒：`Missing required parameter: language` | — |
| `ide_find_class` 查 TS 导出函数 | 0 命中（它是 class/interface/enum 检索） | — |
| `ide_find_file` 查 `.ts/.tsx` | ✅ 正常（TS 文件在索引里，能按文件名找） | — |
| `ide_search_text`（`wholeWord:true` + `context:"code"`） | ✅ 13/13 全是真命中（声明 + 4 处 import + 8 处调用），**零假命中** | — |
| `ide_diagnostics`（TS 文件，故意写语法错误） | ⚠️ **恒 0 条**（连缺右括号的语法错误都不报） | — |

**为什么**：插件 jar 内自带的文档（`skill/ide-index-mcp/references/tools-reference.md`）声称 TS 支持 `modulePath#exportName` 语法 —— **文档与 5.20.7 编译产物不一致**，server 端只放行 Java。**文档不是判据，`tools/list` 才是**（`bash scripts/mcp-call.sh list index`）。

---

## §2 静默失效判据（每次拿到引用面都要查）

1. **`resolvedSymbol.kind` 不是代码符号**（是 `directory` / `package` / 空）⇒ 位置法没解析到符号 ⇒ **整条结果作废**，别拿它当"零引用"下结论。
2. **返回的引用全是 `.md` / 文档里的路径字符串** ⇒ 同上（这是目录符号的"引用"）。
3. `ide_diagnostics` 在 TS 文件上恒 `problemCount: 0`（连语法错误都没有）⇒ **别把它当"文件干净"**，TS 的问题源是 `tsc` / `eslint`。

> 通用口径（适用于任何语言）：**先看工具返回里"解析到了什么"，再看它报了什么。** 静默给错比报错更贵。

---

## §3 TS 仓的正确做法

### 3.1 引用面 = 文本检索 + 人工归并

```bash
bash scripts/mcp-call.sh index ide_search_text \
  '{"query":"<符号名>","wholeWord":true,"context":"code","paths":["src/**"],"project_path":"<绝对路径>"}'
```

返回的命中分三类，**同一符号的两面**，归并后才是"影响面"：

| 命中形态 | 含义 | 改名/删除时 |
|---|---|---|
| `export function foo` / `export const foo` | 声明 | 改这里 |
| `import { foo } from '...'` | 引用（别名 import 也算） | 必改（type-only import 也算） |
| `foo(...)` / `<Foo />` / `foo.bar` | 调用点 / JSX 组件引用 / 成员访问 | 必改 |

### 3.2 三个必踩的坑

- **文件掩码**：`*.ts` **不匹配** `.tsx`（IntelliJ 掩码语义）。要覆盖前端就写 `*.ts,*.tsx` 或留空 —— 只写 `*.ts` 会静默漏掉全部组件文件。
- **路径别名**：tsconfig 的 `@/*` 在文本检索里体现为 **import 字面量**，别名本身不是符号。要找文件按路径走 `ide_find_file`；要找引用走符号名文本检索。
- **JSX**：`<Foo />` 是组件引用，文本命中算；但 `ide_find_references` 在 TS 仓不认（§1）。

### 3.3 改名 / 删符号

`ide_refactor_rename` 在 TS 仓**不可靠**（内部同样走位置法 → 解析到目录）。两条路：

1. **IDE GUI 重命名**（Refactor → Rename，IDEA 的 TS 重命名有真实 TS 支持）——由人在 IDE 里做，agent 负责给清单；
2. **文本检索 + 人工核对**：列出全部命中 → 逐个改 → 改完 `ide_sync_files` + `tsc --noEmit` + `eslint` 验证。

> 删符号前必须确认零引用 —— TS 仓的"零引用"只能靠**文本检索 + 人工排除**得出，不能靠 `ide_find_references`。

---

## §4 能用 / 不能用（TS 仓速查）

| 能力 | 状态 | 用什么替代 |
|---|---|---|
| 文件索引 / 按名找文件 | ✅ | `ide_find_file` |
| 文本检索（声明/调用/import/JSX） | ✅ | `ide_search_text`（`wholeWord:true` + `context:"code"`） |
| VFS 同步（外部改动的文件让 IDE 看见） | ✅ | `ide_sync_files` |
| 打开文件 / 读文件 | ✅ | `ide_open_file`（插件，默认关闭）/ 常规文件工具 |
| 符号定义 / 引用 / 调用链 | ⚠️ 静默失效 | 文本检索 + 人工归并 |
| 类型层级 / 实现查找 | ⚠️ 静默失效 | 文本检索 |
| 文件级检视（lint / 类型错误） | ⚠️ 恒空 | `tsc --noEmit` + `eslint`（见本分册 setup.md 的清单） |
| 语义改名 / 安全删除 | ⚠️ 不可靠 | IDE GUI 重命名 / 文本检索 + 人工核对 |

---

## §5 检视权威源（TS 仓）

- **TS 仓的 lint / 类型权威 = `tsc --noEmit` + `eslint`**（配置与门禁见本分册 [setup.md](setup.md) 与 [checklist.json](checklist.json)），不是 IDEA。
- IDEA 侧在 TS 仓只承担：文件索引、文本检索、打开文件、VFS 同步、（谨慎的）重构。
- `idea-backend` 的"审查→修复流水线"（`ide_inspect` 检视 → 分簇 → 并发修）**以 JVM 仓为前提**：P3C/阿里规范、global 批处理项（unused declaration 等）都是 Java 侧能力；TS 仓照搬会拿到空清单。

---

## §6 升档路径（插件补上 TS 符号解析后）

- 复查方式一：`bash scripts/mcp-call.sh list index` —— 看工具面有没有变化；
- 复查方式二：对一个 TS 符号做一次位置法查询，看 `resolvedSymbol.kind` 是否变成代码符号（不再是 `directory`）；
- 复查方式三：`language:"TypeScript"` + `symbol:"src/xxx#exportName"` 是否不再被拒；
- 三条都过了 → 本文档 §1 的"失效"结论作废，TS 仓可回到"符号级 + 检视级"路线，届时把 §0 的档位表更新即可。

### §6.1 `language` 参数的枚举是**运行时算的**（2026-11-22 实测更正）

此前记的「server 端只放行 Java 符号解析」**说窄了**。真实机制（实测 + 插件字节码核实）：

- `language` 枚举 = **注册了 SymbolReferenceHandler、且对应语言插件被探测到**的语言集合，**不是写死的**；
- 实测证据：装上 **Python Community Edition** → 日志 `Registered SymbolReferenceHandler for Python` → 枚举多出 `Python`；
- 有 SymbolReferenceHandler 的语言：Java、Kotlin（走 Java 那个）、JavaScript、TypeScript、Python、PHP；
  **没有的**：Go、Rust、Scala、Markdown —— 这几门**装什么插件都不会进枚举**（`GoHandlers` 只注册 CallHierarchy+TypeHierarchy，`RustHandlers` 只多一个 Implementations）；
- ⇒ 「枚举里没有这门语言」有两种成因，要分开判：**① 语言插件没装**（可解）vs **② 插件没有这门的 handler**（只影响 **symbol 路由**，位置法照样能用）。

> **2026-11-22 的关键更正（本分册此前的归因是错的）**：TS 位置法失效的根因是**「本机没装 JS/TS 插件 → .ts 文件没有 PSI → 位置法落到目录符号」**，
> **不是**「`language` 枚举只放行 Java」。证据：同一天实测 Rust —— 枚举里同样没有 Rust（插件没注册 SymbolReferenceHandler），
> 但**位置法返回真代码符号**（`kind = "function"`）。
> ⇒ **判定 L2 的正确口径**：看「该语言的文件有没有 PSI」，不看枚举；枚举只决定 **symbol/qualifiedName 路由**能不能用。

### §6.2 侧载 JS/TS 插件进社区版：能加载，但**不可用**（2026-11-22 实测全过程）

结论先写：**这条路走不通，不要再重复这个实验。** 过程与证据留档，供别人判断：

| 步骤 | 事实 |
|---|---|
| 取插件 | Marketplace id 22069 的 `updateId=1219647`，版本 **262.12573.28**（与本机 IDE build 精确一致）→ `https://plugins.jetbrains.com/plugin/download?updateId=1219647` |
| 装哪 | 解压到 `%APPDATA%\JetBrains\IdeaIC<ver>\plugins\javascript-plugin\`（**用户插件目录**，不是安装目录） |
| 装完能不能加载 | **不能**：`idea.log` → `Plugin 'JavaScript and TypeScript' (JavaScript) has dependency on 'intellij.platform.webide' which is not installed` → `intellij.javascript.analysis.impl` → `testing` → `backend` → 整个插件被排除 |
| 门禁是什么 | **不是** `com.intellij.modules.ultimate`（插件顶层 `<depends>` 为 **0**；ultimate 只出现在 2 个 content module 里：`intellij.javascript.duplicatesDetection` 与 `intellij.javascript.ultimate`，属"按模块跳过"）。挡住的是**平台模块** `intellij.platform.webide`（社区版平台里没有） |
| 摘掉它之后 | **插件真的加载了**：`Loaded custom plugins: JavaScript and TypeScript (262.12573.28)`；Index 插件打出 `JavaScript plugin detected via plugin ID (JavaScript)` + `Registered SymbolReferenceHandler for JavaScript/TypeScript`；JS 索引也建起来了（`js.custom.single.entry.index` / `TypeScriptConfigIndexData` / `js.package.index`） |
| 但为什么还是不能用 | 运行期缺 **`com.intellij.webcore.*` 共 33 个类**（`ScriptingLibraryMappings` / `ScriptingLibraryManager` / `ScriptingLibraryModel` / `ScriptingLibraryTable` / `PackageManagementService` / `ui/*` …），它们只在 IDEA Ultimate / WebStorm 里（`intellij.platform.webide` 模块，**不在开源 intellij-community**）。缺类在 `SingleRootFileViewProvider` / `CodeInsightContextManagerImpl` / `FileManagerImpl.isExcludedOrIgnored` 上抛 → **每次开文件/走索引都炸** → 现象是：VFS 正常（`list_directory_tree` 有内容），但**所有基于索引的检索全返回空**（`ide_find_file`/`ide_search_text`/`ide_search_regex` 全 0 命中），工程看着像空的 |
| 收尾 | 已把插件目录移出（备份留在本机 `.auto`），IDEA 恢复健康 |

⇒ **判据沉淀**：某门语言在社区版能不能用，看它**运行时**会不会碰到付费平台模块的类 —— descriptor 里看不出来（那 33 个类藏在 content module 的字节码常量池里），
只有真装真跑才会暴露。**平替 = WebStorm**（非商业免费，自带内置 MCP server → TS 有真 PSI）。
