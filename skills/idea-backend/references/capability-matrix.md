# 语言 × 能力档位矩阵（通用）

> **一句话**：IDEA 的运行期能力**按语言分档**。档位由三件事共同决定 —— **IDE 版本/插件栈**（能不能装）、**插件构建**（装的这版支持到哪）、**语言本身**（该语言的检视器/重构后端有没有）。所以"IDEA 支持某语言"这句话永远要补一句"支持到哪一档、怎么探出来的"。
> **本表是判据的 SSOT**：档位定义 + 探测方法 + 各语言实测值。某门语言的细节在它自己的分册里。

---

## §1 六个档位（低 → 高）

| 档 | 名称 | 含义 | 达不到时的后果 |
|---|---|---|---|
| **L0** | 文件级 | 能按名字找到源文件（`ide_find_file`） | 连"这个文件在哪"都要靠 grep |
| **L1** | 文本级 | 带上下文的文本检索（`ide_search_text` + `context=code`） | 引用面只能靠肉眼数出现次数 |
| **L2** | 符号级（导航） | 定义/引用/调用链解析到**真代码符号** | 影响面分析不可信（最危险：静默给错） |
| **L3** | 检视级（文件） | 对该语言的文件能报出真实问题 | "改完没编译错误"这道门禁失效 |
| **L4** | 检视级（全局） | 能跑范围批检视（本地规则集 + 全局批处理项 + XML 清单） | 全仓审查流水线拿不到基线 |
| **L5** | 重构级 | 安全改名/抽取能给出受影响文件清单 | 只能用文本替换模拟重构（禁止） |

---

## §2 怎么探（每档一条可执行判据）

| 档 | 探测动作 | 达标的样子 | 不达标时**必须**检查的项 |
|---|---|---|---|
| L0 | `ide_find_file` 查一个该语言的源文件 | 返回该文件 | 插件在不在：`bash scripts/setup-env.sh plugins <root>` |
| L1 | `ide_search_text` 查一个符号名，`wholeWord:true` + `context:code` | 命中声明 + 调用点，且无假命中 | 掩码要覆盖扩展名（`*.ts` 不匹配 `.tsx`） |
| L2 | 对该语言的一个符号做位置法查询（`ide_find_references`） | `resolvedSymbol.kind` 是**代码符号**（不是 `directory`/`package`） | ① 该语言有没有装上语言插件（见 §3.1 门禁形态）；② Index 插件有没有给这语言注册 SymbolReferenceHandler（见 §3.4） |
| L3 | 故意写一个语法错误的文件，`ide_diagnostics` | `problemCount > 0` | ① 该语言文件是否在项目 source root 内；② VFS 是否同步（`ide_sync_files`）；③ 检视规则集是否启用该语言的 inspection |
| L4 | `mcp-call.sh has index ide_inspect` | 退出码 0 | 插件是不是 monster 分支（`setup-env.sh plugins` 看 `ide_inspect` 在不在） |
| L5 | `ide_refactor_rename` + `dryRun:true` | 返回受影响文件清单 | 是否与 L2 同源（多数实现复用同一套符号解析） |

> **铁律**：L2 的探测必须看 `resolvedSymbol`，不能只看"命中数"。命中 0 条和"解析到了目录符号"是两回事 —— 后者会给你一堆 markdown 路径字符串当引用。

---

## §3 当前各语言档位（实测快照 2026-11-22，IC 2026.2.5 + Index 插件 5.20.7）

| 语言 | edition 门禁 | L0 | L1 | L2 | L3 | L4 | L5 | 分册 |
|---|---|---|---|---|---|---|---|---|
| JVM（Java/Kotlin） | **community**（捆绑） | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/java/setup.md](langs/java/setup.md) |
| Python | **community**（官方 "Python Community Edition" 可装，**2026-11-22 实测 L0-L5 全通**） | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/python/setup.md](langs/python/setup.md) |
| TS / JavaScript | **ultimate**（社区版装不了；侧载能加载但运行期缺 33 个专有类 → 不可用） | ✅ | ✅ | ⚠️ **静默失效** | ⚠️ **恒空** | ⚠️ | ⚠️ | [langs/ts/runtime.md](langs/ts/runtime.md) |
| Go | **ultimate**（社区版不提供 `go-capable` 能力模块 → 插件硬装不上） | ✅ | ✅ | ⚠️ **结构性不可用**（见 §3.4） | ⚠️ | ⚠️ | ⚠️ | 无分册 |
| Rust | **ultimate**（插件级硬依赖 `com.intellij.modules.ultimate` + `rust-capable` 不提供） | ✅ | ✅ | ⚠️ **结构性不可用**（见 §3.4） | ⚠️ | ⚠️ | ⚠️ | 无分册 |

> **L0/L1 与语言插件无关**：文件索引与文本检索走 IDE 的通用索引，任何语言的文件都能查 —— 这也是"社区版没有某语言插件时也不是什么都做不了"的原因。**L2 往上才吃语言插件**。
>
> **L4 一律 ⚠️**：上游 Index 插件（5.20.7）没有 `ide_inspect` → 流水线自动降级到 L3；换 monster 分支可拿回全局批检视。
>
> **Python 那行是 2026-11-22 的新实测**（此前记的"社区版没有 Python"是**错的**）：装上 Marketplace 的 **Python Community Edition**（id 7322，xmlId `PythonCore`）后 —— ① 插件加载成功；② Index 插件日志打出 `Python plugin detected via plugin ID (PythonCore)` 与 `Registered SymbolReferenceHandler for Python`；③ L2 实测 `resolvedSymbol.kind = "function"` 且 4 处真实引用；④ L3 实测报出 2 条真语法错；⑤ L5 `ide_refactor_rename --dryRun` 返回 `canApply:true` + 受影响文件清单。明细见 [langs/python/runtime.md](langs/python/runtime.md)。

### §3.1 edition 门禁的**三种形态**（实测判定法）

「社区版支不支持某语言」不是一句话，是**插件 descriptor + 平台能力模块**两处组合出来的。实测到三种形态：

| 形态 | 判据 | 实例（2026-11-22 实测） | 能不能绕 |
|---|---|---|---|
| ① **插件级硬依赖** | descriptor 顶层 `<dependencies>` 里有 `<plugin id="com.intellij.modules.ultimate" />` | Rust（id 22407） | 摘掉后插件能加载，但立刻撞上形态 ② |
| ② **能力模块（capability）** | 插件依赖 `<plugin id="com.intellij.modules.go-capable" />` 这类 `-capable` 模块，而社区版平台不提供它 | Go（id 9568）、Rust（id 22407） | 社区版**装不上**（IDEA 加载器直接拒），且该模块由平台裁剪包声明 → 不是插件能补的 |
| ③ **平台模块** | 插件依赖某个社区版平台不提供的平台模块（如 `intellij.platform.webide`） | JS/TS（id 22069） | 摘掉后插件**能加载**（TS 处理器真的注册上了），但运行期缺 33 个 `com.intellij.webcore.*` 专有类 → 每次开文件都抛 → **工程实际不可用** |

**判定法（三条命令，不靠记忆、不靠 README）**

```bash
# ① 社区版平台到底提供哪些 capability 模块（只有 -capable 那些是"语言准入"开关）
unzip -p <IDEA>/lib/intellij.idea.community.customization.jar META-INF/IdeaPlugin.xml | grep 'module value'

# ② 插件 descriptor 的顶层硬依赖（把插件 zip 里 */lib/*.jar 的 META-INF/plugin.xml 读出来）
#    顶层 <dependencies> 里出现 com.intellij.modules.ultimate 或 *-capable ⇒ 硬门禁

# ③ IDEA 自己怎么说 —— 权威判据（本节所有结论都由它给出）
#    idea.log 搜 "Problems found loading plugins:"，它逐条列出哪个插件缺哪个模块
```

**IDEA 社区版提供的 capability 模块全表（IC 2026.2.5 实测，只有 3 个）**：

```
com.intellij.modules.java-capable
com.intellij.modules.python-core-capable
com.intellij.modules.python-in-non-pycharm-ide-capable
```

⇒ **Python 能进社区版**（社区版自己声明了 `python-core-capable`）；
⇒ **Go/Rust 进不了**（社区版不声明 `go-capable` / `rust-capable`）—— 这是**产品定位**（Go 归 GoLand、Rust 归 RustRover），不是配置问题。

### §3.2 逐插件门禁（Marketplace API + descriptor + 加载日志三方交叉）

| 插件 | id | xmlId | 社区版能装？ | 依据 |
|---|---|---|---|---|
| **Python Community Edition** | **7322** | `PythonCore` | ✅ **能**（**实测**） | 兼容列表含 `IDEA`；插件级依赖的 `python-core-capable` 社区版提供；实测加载成功且 L0-L5 全通 |
| Python（完整版） | 631 | `Pythonid` | ❌ | 兼容列表只有 `IDEA_PRO` / `JBCLIENT` |
| JavaScript and TypeScript | 22069 | `JavaScript` | ❌ | 兼容列表只有 `IDEA_PRO` / `PYCHARM_PRO`；侧载可加载但运行期缺 33 个专有类（§3.1 形态③） |
| Go | 9568 | `org.jetbrains.plugins.go` | ❌ | 依赖 `com.intellij.modules.go-capable`，社区版不提供 |
| Go（2017 遗留插件） | 5047 | `ro.redeul.google.go` | ❌ | until-build `171.*`（2017），装不上 build 262 |
| Rust | 22407 | `com.jetbrains.rust` | ❌ | 插件级硬依赖 `com.intellij.modules.ultimate` + `rust-capable` 不提供；另需 `com.intellij.nativeDebug` |
| Rust（已弃用） | 8182 | `org.rust.lang` | ❌ | 已被 RustRover 取代，until-build `233.*` |
| Ruff（Python 工具插件，非语言插件） | 20574 | — | ✅ | 兼容列表含 `IDEA` |
| LSP4IJ（LSP 客户端） | 23257 | `com.redhat.devtools.lsp4ij` | ✅ | 兼容列表含 `IDEA`；给**编辑器级**智能（补全/诊断/改名/调用层级），**不喂 IDE 符号索引** → 两个 MCP 的语义工具都不受益 |

⇒ **同一门语言里，语言插件与工具插件可以落在不同门禁上**；"IDEA 支持某语言"这句话永远要补"支持到哪一档、怎么探出来的"。

### §3.3 平替表（"这门语言该用哪个 IDE"）

| 语言 | 社区版 IDEA 行不行 | 平替 | 费用（2026-11 核对官方页面） |
|---|---|---|---|
| Java / Kotlin | ✅ 全档位 | — | — |
| Python | ✅ **官方社区版插件**（7322） | — | — |
| TS / JavaScript | ❌ | **WebStorm** | **非商业免费**（学习/自用/开源/爱好；商业用途要付费订阅） |
| Rust | ❌ | **RustRover** | **非商业免费** |
| Go | ❌ | **GoLand** | 付费（30 天试用；**没有**非商业免费档） |
| 全部语言 | ❌ | IntelliJ IDEA Ultimate | 付费（30 天试用；**没有**非商业免费档） |

**为什么平替比硬凑有效**：这些 JetBrains IDE **都自带内置 MCP server**（2025.2 起，IDEA/WebStorm/GoLand/RustRover 一家）→ 换过去之后 `search_symbol` / `analyze_calls` / `get_file_problems` 有**真 PSI** 可用；而在社区版里，这些工具对没有语言插件的语言**返回空而不是报错**（静默给错，见 §2 铁律）。
⚠️ 换 IDE ≠ 换插件：语言插件、检视规则集、运行配置、项目模型都要在新 IDE 里重做一遍。

### §3.4 Index 插件的 `language` 枚举是**运行时算的**（不是写死的）

`ide_find_references` 等工具的 `language` 参数枚举 = **该插件注册了 SymbolReferenceHandler、且对应语言插件被探测到**的语言集合。实测证据：

- 装上 Python CE → 日志 `Registered SymbolReferenceHandler for Python` → 枚举多出 `Python`；
- 侧载 JS/TS 成功那一次 → 日志 `Registered SymbolReferenceHandler for JavaScript` + `TypeScript` → 枚举多出两门。

⇒ **枚举里没有某语言 = 该语言没有 SymbolReferenceHandler**，与"插件装没装"是两件事：

| 有 SymbolReferenceHandler | 没有（无论装什么插件都不会进枚举） |
|---|---|
| Java、Kotlin（走 Java 那个 handler）、JavaScript、TypeScript、Python、PHP | **Go、Rust**、Scala、Markdown |

（Go/Rust 的 handler 注册项经插件 jar 字节码核实：`GoHandlers` 只注册 CallHierarchy + TypeHierarchy；`RustHandlers` 只多一个 Implementations。）

⇒ **Go/Rust 的语义能力只能走内置 MCP**（`search_symbol` / `analyze_calls`，语言无关、走 IDE 自己的 PSI），且需要在装了对应语言插件的 IDE 里（GoLand / RustRover / Ultimate）。

---

## §4 升档动作（按性价比排序）

| 想要 | 动作 | 代价 |
|---|---|---|
| **Python ↑ 到 L2-L5** | 装 **Python Community Edition**（Marketplace id **7322**，xmlId `PythonCore`），**版本必须匹配 IDE build**（本机 262.12573.28 对应 `262.12573.28`） | 免费；**重启 IDEA** 后确认索引就绪 |
| TS/JS ↑ | 换 **WebStorm**（非商业免费）。侧载 JS/TS 插件进社区版**实测不可用**（§3.1 形态③） | 换 IDE + 重做项目配置 |
| Rust ↑ | 换 **RustRover**（非商业免费） | 换 IDE |
| Go ↑ | 换 **GoLand** 或 IDEA Ultimate（**无免费档**） | 付费 |
| L2 ↑（插件侧） | 等 Index 插件给该语言加 SymbolReferenceHandler（Go/Rust 排在这个队列外，见 §3.4） | 等插件版本 |
| L3 ↑ | 该语言插件在位 + 该语言文件在 source root 内 + 检视规则集启用该语言 inspection | 免费 |
| L4 ↑ | 换 monster 分支的 Index 插件 | 侧载 + 重启 + 跑一遍 `mcp-call.sh list index` 核对工具面 |
| 任意档 ↑ | 工具面核对 | `bash scripts/setup-env.sh plugins <root>` + `bash scripts/mcp-call.sh list index` |

---

## §5 新增一门语言分册要交的东西（契约）

```
references/langs/<lang>/
  profile.json        # 标记文件 / 插件目录 / edition 门禁 / 探测器路径 / 清单文件名
  checklist.json      # 配置侧清单条目（可选）：id/title/category/action/verify/source/quote/applies_to
  idea-settings.json  # IDE 侧设置条目（可选）：id/title/path/expected/assertion/source/quote/edition
  sources.md          # 引文快照（source + quote 必须能在这里逐字命中）
  setup.md            # 这门语言的"接进 IDEA"正文
  runtime.md          # 这门语言的运行期能力档位实测值（§3 表格的那一行的展开）
scripts/langs/<lang>/detect.mjs   # 探测器：吐 key=value 事实 + CONDITIONS（供清单按条件过滤）
templates/<lang>-*/                # 可选：脚手架模板
```

**纪律**（沿用 TS 分册那套）：

1. `verify` 必须**在本机真跑**，退出 0 才算这一条成立；
2. `source` + `quote` 必须能在 `sources.md` 里逐字命中 —— **引文不许凭记忆写**；
3. 清单条目要能被**真实项目回归**（TS 分册那次回归改掉了 6 条自己的误报）；
4. 运行期能力档位要**实测**，不照抄别的语言；
5. **edition 门禁必须按 §3.1 的三条命令取证**，不照抄 Marketplace 的 `compatible-products` 列表（那是 JetBrains 的**声明**，实测的加载日志才是**事实** —— 例如 Python 631 的声明是 IDEA_PRO，但社区版另有 7322 这条官方路）。
