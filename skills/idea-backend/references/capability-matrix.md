# 语言 × 能力档位矩阵（通用）

> **一句话**：IDEA 的运行期能力**按语言分档**。档位由三件事共同决定 —— **IDE 版本/插件栈**（能不能装）、**插件构建**（装的这版支持到哪）、**语言本身**（该语言的检视器/重构后端有没有）。所以"IDEA 支持某语言"这句话永远要补一句"支持到哪一档、怎么探出来的"。
> **本表是判据的 SSOT**：档位定义 + 探测方法 + 各语言实测值。某门语言的细节在它自己的分册里。
> **实测快照**：2026-11-22，IDEA **IC 2026.2.5（社区版）** + Index 插件 **5.20.7** + 本地 capability shim。

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
| L2 | 对该语言的一个符号做位置法查询（`ide_find_references`） | `resolvedSymbol.kind` 是**代码符号**（不是 `directory`/`package`） | ① **该语言的文件有没有 PSI**（= 语言插件在不在 + 能不能打开文件）；② 插件有没有在运行期崩（查 idea.log 的 `NoClassDefFoundError`） |
| L3 | 故意写一个语法错误的文件，`ide_diagnostics` | `problemCount > 0` | ① 该语言文件是否在项目 source root 内；② VFS 是否同步（`ide_sync_files`）；③ 该语言的 inspection 是否启用 |
| L4 | `mcp-call.sh has index ide_inspect` | 退出码 0 | 插件是不是 monster 分支（`setup-env.sh plugins` 看 `ide_inspect` 在不在） |
| L5 | `ide_refactor_rename` + `dryRun:true` | 返回受影响文件清单 | 是否与 L2 同源（多数实现复用同一套符号解析） |

> **铁律**：L2 的探测必须看 `resolvedSymbol`，不能只看"命中数"。命中 0 条和"解析到了目录符号"是两回事 —— 后者会给你一堆 markdown 路径字符串当引用。

### §2.1 `language` 参数的枚举**只管 symbol 路由**（2026-11-22 实测更正）

- `ide_find_references` / `ide_find_definition` 的 `language` 枚举 = **注册了 SymbolReferenceHandler 的语言**（本机实测枚举 = `["Java","Python"]`）；
- 但**位置法**（`file` + `line` + `column`）**不走这个枚举**，它直接解析 PSI → **只要该语言的文件有 PSI，位置法就能用**；
- ⇒ **「符号级失效」的正确诊断不是"枚举里没这门语言"，而是"这门语言的文件没有 PSI"**：
  - 没装语言插件 → 文件被当纯文本 → 位置法解析到**目录符号**（`resolvedSymbol.kind = directory`）→ 静默失效；
  - 装了语言插件但插件在运行期崩（缺专有类）→ 所有基于索引的查询**全返回空**（连 `find_file` 都空）；
  - 装了且正常 → 位置法给出真代码符号（Rust 实测 `kind = "function"`）。
- ⇒ **Rust 的实测结论**：它**没有** SymbolReferenceHandler（插件字节码核实：`RustHandlers` 只注册 CallHierarchy/Implementations/TypeHierarchy），
  但位置法照样工作 —— 所以「有没有 SymbolReferenceHandler」决定的是 **symbol/qualifiedName 路由**能不能用，不是 L2 的全部。

---

## §3 当前各语言档位（实测快照 2026-11-22，IC 2026.2.5 社区版 + Index 插件 5.20.7）

| 语言 | 社区版可用性 | L0 | L1 | L2 | L3 | L4 | L5 | 分册 |
|---|---|---|---|---|---|---|---|---|
| JVM（Java/Kotlin） | ✅ 捆绑 | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/java/setup.md](langs/java/setup.md) |
| Python | ✅ **官方插件**（Python Community Edition，id 7322） | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/python/setup.md](langs/python/setup.md) |
| Rust | ✅ **实测可用**（capability shim + Native Debugging Support，见 §3.1/§3.5） | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/rust/setup.md](langs/rust/setup.md) |
| Go | ❌ **插件里有显式授权校验**（见 §3.1 形态④） | ✅ | ✅ | ⚠️ 装上插件也**全空** | ⚠️ | ⚠️ | ⚠️ | [langs/go/setup.md](langs/go/setup.md) |
| TS / JavaScript | ❌ 依赖付费平台模块的 33 个专有类 | ✅ | ✅ | ⚠️ **静默失效** | ⚠️ **恒空** | ⚠️ | ⚠️ | [langs/ts/runtime.md](langs/ts/runtime.md) |

> **L0/L1 与语言插件无关**：文件索引与文本检索走 IDE 的通用索引 —— 任何语言的文件都能查。这也是"没有某语言插件时也不是什么都做不了"的原因。
> **L4 一律 ⚠️**：上游 Index 插件（5.20.7）没有 `ide_inspect` → 流水线自动降级到 L3；换 monster 分支可拿回全局批检视。

### §3.1 edition 门禁的**四种形态**（实测判定法）

「社区版支不支持某语言」不是一句话，是**插件 descriptor + 平台能力模块 + 平台专有类 + 授权校验**四处的组合。实测到四种：

| 形态 | 判据 | 实例（2026-11-22 实测） | 能不能绕 | 怎么绕的 |
|---|---|---|---|---|
| ① **插件级硬依赖** | descriptor 顶层 `<dependencies>` 里有 `<plugin id="com.intellij.modules.ultimate" />` | Rust（22407）、Go（9568） | ✅ 能（删掉那行） | 改插件 zip 里的 `META-INF/plugin.xml` |
| ② **能力模块（capability）** | 插件依赖 `<plugin id="com.intellij.modules.go-capable" />` 这类 `-capable` 模块，而社区版平台不提供 | Go（9568）、Rust（22407）、Native Debugging Support | ✅ 能（**声明同名 capability**） | 一个自带 shim 插件 + `<module value="…"/>`（见 §3.5） |
| ③ **平台模块 / 专有类** | 插件依赖社区版平台没有的平台模块（`intellij.platform.webide` / `intellij.platform.commercial.verifier` / `intellij.platform.duplicatesDetector` …） | TS/JS（22069）、Go（9568） | ⚠️ 删依赖能让插件**加载**，但运行期缺专有类 → **工程不可用** | TS/JS 缺 33 个类（实测 `com.intellij.webcore.*`）→ 不可用；Go 缺 1 个（`com.intellij.ultimate.UltimateVerifier`）→ 走到形态④ |
| ④ **显式授权校验** | 插件代码里主动调校验器，验不过就拒跑 | **Go**：`com.intellij.ultimate.PluginVerifier.verifyUltimatePlugin()` ← `GoSdkService.<init>`；底层是 `UltimateVerifier.verify(BigInteger)`（**RSA 公钥签名校验**） | ❌ **不做**（这是有意的付费门禁，不是配置问题） | — |

> **③ 与 ④ 的区别很重要**：③ 是「意外依赖了付费平台的类」（删掉依赖后插件能跑，只是功能残缺），
> ④ 是「插件主动校验授权并拒绝运行」——**绕过它等于绕过许可校验，本技能不做、也不建议做**。
>
> **实测链（Go，逐步推进）**：`go-capable`（形态②）→ `intellij.platform.duplicatesDetector`（形态③）→ 删掉后 → `com.intellij.ultimate.UltimateVerifier`（形态④）→ **到此为止**。

**判定法（四条命令，不靠记忆、不靠 README）**

```bash
# ① 社区版平台到底提供哪些 capability 模块（只有 -capable 那些是"语言准入"开关）
unzip -p <IDEA安装根>/lib/intellij.idea.community.customization.jar META-INF/IdeaPlugin.xml | grep 'module value'

# ② 插件 descriptor 的顶层硬依赖（把插件 zip 里 */lib/*.jar 的 META-INF/plugin.xml 读出来）
#    顶层 <dependencies> 里出现 com.intellij.modules.ultimate 或 *-capable ⇒ 硬门禁

# ③ IDEA 自己怎么说 —— 权威判据（本节所有结论都由它给出）
#    idea.log 搜 "Problems found loading plugins:"，它逐条列出哪个插件缺哪个模块
#    （技能脚本：bash scripts/install-lang-plugin.sh verify）

# ④ 插件会不会在运行期自己校验授权 —— 加载后查 idea.log 有没有 NoClassDefFoundError
#    栈里出现 com.intellij.ultimate.* ⇒ 形态④
```

### §3.2 逐插件门禁（Marketplace API + descriptor + 加载日志三方交叉）

| 插件 | id | xmlId | 社区版能装？ | 依据 |
|---|---|---|---|---|
| **Python Community Edition** | **7322** | `PythonCore` | ✅ **能**（**实测**） | 兼容列表含 `IDEA`；插件级依赖的 `python-core-capable` 社区版提供；实测加载成功且 L0-L5 全通 |
| Python（完整版） | 631 | `Pythonid` | ❌ | 兼容列表只有 `IDEA_PRO` / `JBCLIENT` |
| **Rust** | **22407** | `com.jetbrains.rust` | ⚠️ **实测可用**（要 shim + Native Debugging Support，见 §3.5） | 插件级硬依赖 `ultimate`（形态①）+ `rust-capable`（形态②）；两者都能解 |
| **Native Debugging Support** | — | `com.intellij.nativeDebug` | ⚠️ 同上（Rust 2026.2 起的前置依赖） | 依赖 `nativeDebug-plugin-capable`（形态②） |
| Go | 9568 | `org.jetbrains.plugins.go` | ❌ | 形态①②③ 都能解，但最后撞**形态④ 授权校验** |
| Go（2017 遗留插件） | 5047 | `ro.redeul.google.go` | ❌ | until-build `171.*`（2017），装不上 build 262 |
| JavaScript and TypeScript | 22069 | `JavaScript` | ❌ | 依赖 `intellij.platform.webide`（形态③）；删掉后缺 33 个 `com.intellij.webcore.*` 专有类 → 工程不可用 |
| Rust（已弃用） | 8182 | `org.rust.lang` | ❌ | 已被 RustRover 取代，until-build `233.*` |
| Ruff（Python 工具插件，非语言插件） | 20574 | — | ✅ | 兼容列表含 `IDEA` |
| LSP4IJ（LSP 客户端） | 23257 | `com.redhat.devtools.lsp4ij` | ✅ | 兼容列表含 `IDEA`；给**编辑器级**智能（补全/诊断/改名/调用层级），**不喂 IDE 符号索引** → 两个 MCP 的语义工具都不受益 |

⇒ **同一门语言里，语言插件与工具插件可以落在不同门禁上**；"IDEA 支持某语言"这句话永远要补"支持到哪一档、怎么探出来的"。

### §3.3 平替表（"这门语言该用哪个 IDE"）

| 语言 | 社区版 IDEA | 平替 | 费用（2026-11 核对官方页面） |
|---|---|---|---|
| Java / Kotlin | ✅ 全档位 | — | — |
| Python | ✅ 官方社区版插件 | — | — |
| Rust | ✅ **实测可用**（§3.5 配方） | 官方路线 **RustRover** | **非商业免费** |
| TS / JavaScript | ❌ | **WebStorm** | **非商业免费**（学习/自用/开源/爱好；商业用途要付费订阅） |
| Go | ❌（授权校验） | **GoLand** | 付费（30 天试用；**没有**非商业免费档） |
| 全部语言 | ❌ | IntelliJ IDEA Ultimate | 付费（30 天试用；**没有**非商业免费档） |

**为什么平替比硬凑有效**：这些 JetBrains IDE **都自带内置 MCP server**（2025.2 起，IDEA/WebStorm/GoLand/RustRover 一家）→ 换过去之后 `search_symbol` / `analyze_calls` / `get_file_problems` 有**真 PSI** 可用；而在社区版里，这些工具对没有语言插件的语言**返回空而不是报错**（静默给错，见 §2 铁律）。

### §3.4 Index 插件的 `language` 枚举是**运行时算的**（不是写死的）

枚举 = **注册了 SymbolReferenceHandler、且对应语言插件被探测到**的语言集合。实测证据：

- 装上 Python CE → 日志 `Registered SymbolReferenceHandler for Python` → 枚举多出 `Python`；
- 装上 Rust → 日志 `Rust plugin detected via plugin ID (com.jetbrains.rust)` → 但**没有** SymbolReferenceHandler → 枚举里**没有 Rust**（枚举实测 = `["Java","Python"]`）；
- ⇒ 「枚举里没有某语言」有两种成因：**① 插件没装**（可解）/ **② 插件没给这门语言注册 handler**（不可解，但**位置法照样能用**，见 §2.1）。

---

## §4 升档动作（按性价比排序）

| 想要 | 动作 | 代价 |
|---|---|---|
| **Python ↑ 到 L2-L5** | 装 **Python Community Edition**（Marketplace id **7322**，xmlId `PythonCore`），**版本必须匹配 IDE build** | 免费；**重启 IDEA** 后确认索引就绪 |
| **Rust ↑ 到 L2-L5** | 按 §3.5 的配方：shim 声明 `rust-capable` + `nativeDebug-plugin-capable` → 装 Rust 插件 + Native Debugging Support → 删插件 descriptor 里的 `ultimate` 硬依赖 → 重启 | 免费；**非官方配置**，IDEA 升级可能失效 |
| TS/JS ↑ | 换 **WebStorm**（非商业免费）。侧载 JS/TS 插件进社区版**实测不可用**（形态③，缺 33 个专有类） | 换 IDE + 重做项目配置 |
| Go ↑ | 换 **GoLand** 或 IDEA Ultimate。**社区版不可用**：插件有授权校验（形态④） | 付费 |
| L2 ↑（插件侧） | 等 Index 插件给该语言加 SymbolReferenceHandler（那只影响 **symbol 路由**） | 等插件版本 |
| L3 ↑ | 该语言插件在位 + 文件在 source root 内 + inspection 启用 | 免费 |
| L4 ↑ | 换 monster 分支的 Index 插件 | 侧载 + 重启 + `mcp-call.sh list index` 核对工具面 |
| 任意档 ↑ | 工具面核对 | `bash scripts/setup-env.sh plugins <root>` + `bash scripts/mcp-call.sh list index` |

---

## §5 在社区版里让一门语言可用的**完整配方**（以 Rust 为样板，2026-11-22 全程实测）

```bash
# 1) 问门禁：读插件 descriptor 的硬依赖 + 社区版平台提供哪些 capability
bash scripts/install-lang-plugin.sh gate 22407

# 2) 造 shim：声明社区版平台不提供的 capability 模块（自带插件，不改 IDE 安装目录）
bash scripts/install-lang-plugin.sh shim \
  com.intellij.modules.rust-capable \
  com.intellij.modules.nativeDebug-plugin-capable

# 3) 装插件（按 IDE build 选 marketplace 版本 → 解到用户插件目录）
bash scripts/install-lang-plugin.sh install 22407
bash scripts/install-lang-plugin.sh install com.intellij.nativeDebug   # 或 pluginManager?action=download&id=<xmlId>

# 4) 删掉插件 descriptor 里的插件级 ultimate 硬依赖（形态①）
#    —— 需要改 zip 里的 META-INF/plugin.xml，保留 .orig 备份

# 5) 把要打开的工程加进「受信任工程」列表（否则 IDE 会卡在看不见的信任弹框上）
bash scripts/setup-env.sh trust /abs/path/to/project

# 6) 重启 IDEA，看真实结论
bash scripts/install-lang-plugin.sh verify
```

⚠️ **非官方配置**：JetBrains 不支持这种组合；IDE 升级后 shim 可能失效；**形态④（授权校验）不在此列 —— 不做**。

---

## §6 新增一门语言分册要交的东西（契约）

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
5. **edition 门禁必须按 §3.1 的判定法取证**，不照抄 Marketplace 的 `compatible-products`（那是 JetBrains 的**声明**，实测的加载日志才是**事实** —— 例如 Python 631 的声明是 IDEA_PRO，但社区版另有 7322 这条官方路）。

---

## §7 跨后端选型（决策表 SSOT）

<!-- selection-table:section:start -->
### 决策表（任务类型 × 语言 → 推荐后端）

> **这张表的读法**：每行给「推荐（主 / 备）· 依据（数字或可逐字核对的事实 + 出处指针）· 证据等级 · 代价与前提 · 何时别选它」。
> **证据等级**四档：`实测`（本 phase 的同题对照实验）· `结构事实`（协议层 / edition 门禁事实，出处可逐字核对）· `既有实测`（phase 01/02 的实测）· `未测`（写明为什么没测、需要什么才能测）。
> **口径提醒**：各后端的「引用」口径不同 —— IDEA = 真代码引用 · agent-lsp / pyright = 引用位置 · BifrostMCP = 扩展侧 provider · codegraph = 受影响符号（含 import 边与成员）⇒ **数字不可直接相减**。
> **同源副本**：本节在两个技能里各存一份（技能 idea-backend 的 references/capability-matrix.md 与技能 vscode-backend 的 references/runtime.md），**逐字相同**；仓内门禁 `scripts/check-selection-table.js` 逐格对账（两份 JSON 块 · 行数 · 每个数字的出处指针 · 禁词）。

| 任务类型 × 语言 | 推荐后端（主 / 备） | 依据（数字或可逐字核对的事实 + 出处） | 证据等级 | 代价与前提 | 何时别选它 |
|---|---|---|---|---|---|
| 文件级 / 文本级定位（L0/L1） × 全部语言 | 主：不构成选型差异 —— 两边都走文件系统 / ripgrep ｜ 备：这一档不进选型 | 两端口径不同义：IDEA 侧 L0 = 按名找源文件、L1 = 带上下文的文本检索（技能 idea-backend 的 references/capability-matrix.md（§1 六个档位））；VS Code 侧 L0 = 文件结构化符号清单（实测 10 个符号）、L1 = token / 高亮（实测 108 个）（技能 vscode-backend 的 references/measurements/typescript.json（records[]）；档位定义见 技能 vscode-backend 的 references/tiers.md（§1 六档定义））⇒ 回答的不是同一个问题，硬凑成同题就是造一个假任务 | 结构事实 | 两档的实现成本都低；VS Code 侧还有 ripgrep 与文件搜索面板兜底 | 想比「谁找得更准」时不要拿这一档当比较项 —— 口径不同义，比出来的差是假的；需要符号身份时直接上 L2 |
| 按名找定义（T1） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | 四个配置在 Python 锚点 ProbeItem 上都答对（文件口径召回 / 精度 1.00/1.00）⇒ 差别在成本与前提，不在能不能答对；T1 三轮中位耗时：C 腿 15ms、B 腿 36.7ms、IDEA 2159.1ms、codegraph 1692.5ms；B 腿与 C 腿都要多一步定位（前置步数 1，IDEA 与 codegraph 是 0）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 | C 腿要先 start_lsp 且必须带 language_id（不带就走「全部语言直连」，每次冷起恒返 0）；B 腿要 VS Code 窗口常开 + Python 侧 Pylance 在位；IDEA 腿要 IDE 在跑且索引就绪（isDumbMode:false 且 isIndexing:false） | 窗口关着也要跑 ⇒ 别选 B 腿（服务跑在扩展宿主里，窗口一关端口就没了）；要找跨语言的同名符号 ⇒ 见「跨语言统一符号空间」那一行 |
| 按位置找定义（T2） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | 四个配置在函数锚点 probe_run 上都答对（文件口径 1.00/1.00）；T2 三轮中位耗时：C 腿 21.4ms、B 腿 50.8ms、IDEA 1614.7ms、codegraph 1609ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 | 位置法要给准位置：C 腿的 find_references 要 file_path + line + column（column 必填、1-based）；B 腿位置零基准、uri 必须是 file:/// 小写盘符 + 正斜杠路径 | 只知道符号名、还不知道位置 ⇒ 走「按名找定义（T1）」那一行，别直接上位置法 |
| 找引用（T3） × Python | 主：agent-lsp（C 腿，窗口无关） ｜ 备：BifrostMCP（B 腿，窗口常开） | gold = 4 次整词命中 / 2 个文件（技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]））；C 腿命中 4（3 轮中位 15.9ms）、B 腿命中 4（28.7ms）、IDEA 归一后 4（2156ms）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））；codegraph 给的是受影响符号口径，与 gold 的整词命中不同义 ⇒ 只比文件口径（2/2） | 实测 | C 腿取数前要预热 + 结果规模双确认（daemon 报 ready 之后仍可能静默返 0）；B 腿要窗口常开 + Pylance 在位 | 要的是「删了会动谁」的影响面而不是引用清单 ⇒ 走「全局改名与影响面」那一行；codegraph 的受影响符号与 grep 命中数不同义 ⇒ 两把尺子不要相减 |
| 全局改名与影响面（改一个变量 / 方法名，全局一起改） × Python / TypeScript | 主：agent-lsp（C 腿，窗口无关） ｜ 备：IDEA（A 腿，ide_refactor_rename + dryRun） | TS 侧既有实测：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条、agent-lsp 的 find_references 得 739 条（差 1 = include_declaration 口径不同）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；Python 侧 T4 改名干跑四个配置都完成 —— IDEA 1477.5ms、agent-lsp 1008.9ms、BifrostMCP 20ms（本轮 get_rename_locations 可用；phase 02 记的是 Unexpected type ⇒ 可用性随会话波动）、codegraph 1145.3ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]）） | 实测 · 既有实测 | **改名范围由 project graph 决定**（实测 2026-11-23：daemon 索引就绪后 `rename_symbol{dry_run}` 预览覆盖 **247 文件 / 740 处**；冷 daemon 时只给 1 处 —— 那是索引没就绪的假象，**不是**「只改已打开的文件」⇒ 先等 `find_references` 返回非 0，再用 dry_run 看 preview）；**「先 open_document 再改名」这一步实测对改名范围无影响 ✓**（打开全部 247 个文件后预览逐字节不变 ✓ —— 冷 daemon 只给 1 处是索引没就绪的假象 ✓）；daemon 报 ready 之后仍可能静默返 0（tsserver 建 project graph 需 60-100s）⇒ 取数前预热 + 结果规模双确认（技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口）））；B 腿的 get_rename_locations 可用性随会话波动 ⇒ 用前先干跑一次自检 | 窗口关着也要跑 ⇒ 别选 B 腿；只要影响面清单不要落盘 ⇒ 先干跑（agent-lsp 的 blast_radius / IDEA 的 ide_refactor_rename dryRun），确认清单再落盘 |
| 找引用（列全部引用） × TypeScript | 主：agent-lsp（窗口无关那条腿） ｜ 备：BifrostMCP（窗口常开那条腿） | VS Code 侧既有实测（单边腿）：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条（原始 1150.8ms）、agent-lsp 的 find_references 得 739 条（原始 460.9ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 这一格在 IDEA 侧无此能力 | 既有实测 · 结构事实 | C 腿要 typescript-language-server + TypeScript 5.x（TS 7 没有 lib/tsserver.js），server spec 必须带 ,--stdio；B 腿要 VS Code 窗口常开；两腿的耗时都是单次样本，复测方差大于表内数字 | 要跟 Python 同题对照时别把这一行的单边腿数字当同题数据；引用数返 0 时先按「索引未就绪」重试，不许下「死代码」结论 |
| 按位置找定义 × TypeScript | 主：BifrostMCP（go_to_definition） ｜ 备：agent-lsp（这条腿的定义检索本轮未测） | VS Code 侧既有实测：BifrostMCP 的 go_to_definition 命中 1（原始 9.1ms / 净 2.3ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 侧无此能力 —— 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 位置法解析到目录符号（resolvedSymbol.kind = directory）⇒ 结果作废 | 既有实测 · 未测 | 位置零基准（扩展实现是零基准，它的 schema 文本写 One-based）；uri 必须是 file:/// 小写盘符 + 正斜杠路径；C 腿的定义检索本轮未测（这条腿只测了引用 / 诊断 / 影响面三档）⇒ 用前先自检 | IDEA 侧查 TS 定义 ⇒ 别试（无 PSI，返回的是目录符号）；要按名字找定义又不想开窗口 ⇒ 先用文本检索拿位置 |
| 影响面 / 改名前的安全清单 × TypeScript | 主：agent-lsp（blast_radius） ｜ 备：codegraph（impact，口径是受影响符号） | VS Code 侧既有实测：agent-lsp 的 blast_radius 一次调用给 446 个符号 / 445 条边（原始 18887.7ms / 净 18882.8ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；daemon 索引不全时静默少报（新起的 daemon 上只给 11 符号 / 9 边） | 既有实测 | 一次调用约 18.9s；大仓里按文件逐个问更贵 ⇒ 先用 blast_radius 拿规模再决定 | 别把 blast_radius 当引用清单（它是 GCF 图的受影响符号，与 grep 命中数不同义）；结果规模与预期量级不符就当残缺图，不当真答案 |
| 符号级检索 / 引用 / 影响面 × JVM（Java / Kotlin） | 主：IDEA（A 腿，PSI 统一符号空间 + 持久化索引） ｜ 备：VS Code 侧未测（需装 Red Hat Java 扩展，本机未装） | IDEA 侧既有实测（单边腿）：ide_find_references 1.6s / 95 条引用零假命中（技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位））；VS Code 侧未测 —— 本机没装 Red Hat Java 扩展，且 IDEA 侧的 Maven 导入在 40 模块工程上卡死 ⇒ JVM 的同题对照没做 | 既有实测 · 未测 | IDEA 侧 JVM 捆绑在社区版里（门槛最低的一档）；VS Code 侧要装 Red Hat Java 扩展 + 一个能导入的 Maven / Gradle 工程 | 要跟 Python / TS 同题对照时别拿 JVM 的单边腿数字当同题数据（语言与口径都不同）；要在窗口外跑 JVM 语义查询 ⇒ 本 phase 没有可用路线 |
| 单文件诊断（这个文件有没有问题） × Python | 主：IDEA（A 腿，ide_diagnostics） ｜ 备：外部 linter（pyright CLI / ruff）—— 不是 MCP 语义后端 | 本 phase 只有 IDEA 真拿到：ide_diagnostics 报 2 条语法错（Formal parameter name expected / ':' expected）；BifrostMCP 的 get_code_actions 报 Illegal argument（能力缺席）；agent-lsp 的 get_diagnostics 恒返 0 条（2026-11-23 复测：daemon 预热 130s + 先 open_document 仍 0 条，同会话 list_symbols 能解析该文件 ⇒ 排除「索引未就绪」；同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错 ⇒ 0 条 ≠ 文件干净）；codegraph 的 CLI 没有检视子命令（能力缺席）（技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）） | 实测 | IDEA 侧要 IDE 在跑 + 索引就绪；.py 不在 source root 时 ide_diagnostics 走 closed_batch（弱告警 / quick-fix 不可用）；agent-lsp 那格一次 25017.4ms 还没拿到数据（复测每次约 25s 且恒返 0 条）⇒ 这条腿不能当诊断路线 | 要的是「全项目规范审查」而不是单文件 ⇒ 见「全项目规范审查」那一行；BifrostMCP 侧别再试 get_code_actions（扩展 0.0.14 实测坏）；agent-lsp 侧也别指望 get_diagnostics（实测恒返 0 条 —— 0 条 ≠ 文件干净） |
| 全项目规范审查 / Inspect Code × 全部语言 | 主：IDEA（A 腿，ide_inspect 批量检视 = L4） ｜ 备：VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）—— 协议层没有 scope 级检视 | 结构事实：LSP 的 textDocument/codeAction 请求没有 scope 参数，协议里没有「一次批检视一个范围」这个能力，VS Code 侧 19 个工具面里也没有对应工具（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；实测侧本 phase 的单文件诊断只有 IDEA 真拿到（2 条）⇒ 范围级检视只有 IDEA 侧有协议外能力 | 实测 · 结构事实 | ide_inspect 只在 monster 分支的 Index 插件里 —— 上游 5.20.7 的 16 个工具没有它 ⇒ 没装 monster 分支时流水线降级到 L3 文件级 ide_diagnostics（拿不到 P3C / 阿里规范与 global 批处理项）；换分支要重启 IDEA（技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）） | 要的是「这个文件有没有问题」⇒ ide_diagnostics 就够；VS Code 侧不要指望 MCP 协议层给范围检视 ⇒ 改走外部 linter 并自己汇总 |
| 抽方法 / Extract Method × 全部语言（IDEA 侧限有 PSI 的语言：JVM / Python） | 主：IDEA（A 腿，ide_refactor_extract_method） ｜ 备：VS Code 侧无此能力 —— 实现层 | VS Code 侧实测不通：agent-lsp 的 refactor 工具在 tsserver 侧走 textDocument/codeAction，一个位置 30s 超时，另一个位置直接崩 tsserver（Cannot read properties of undefined (reading 'kind')）⇒ 实现层无此能力（原始记录见 技能 vscode-backend 的 references/runtime.md（§8 附：VS Code 侧抽方法的实测原始记录（2026-11-22）））；IDEA 侧有 ide_refactor_extract_method，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它） | 实测 · 结构事实 | IDEA 侧要 monster 分支 + 重启 IDEA；VS Code 侧没有等价入口（19 个工具面里没有抽方法，协议层对应的能力是 textDocument/codeAction 而它没有 scope 参数） | 只是想改个名 ⇒ 走「全局改名与影响面」那一行（agent-lsp 的 rename_symbol 可用）；要的是批量模式重写 ⇒ 用 ast-grep，别指望抽方法 |
| 跨语言统一符号空间（同名符号在两种语言里各在哪、各被谁引用） × Python + TypeScript | 主：codegraph（IDE 无关，根级索引一次 impact 覆盖两个子工程） ｜ 备：BifrostMCP（VS Code 窗口内，一次 get_workspace_symbols 返回两侧同名符号） | 本 phase T6 实测：codegraph 根级索引一次 impact 同时覆盖 py/ 与 ts/（py 侧 6 个受影响符号 / 2 个文件、ts 侧 11 个 / 4 个文件）；BifrostMCP 一次 get_workspace_symbols 同时返回两侧的 ProbeItem（py 侧命中 4 / 2 文件、ts 侧命中 9 / 4 文件）（技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细））；IDEA 社区版不成立（装不了 JS/TS 插件 ⇒ .ts 无 PSI）；agent-lsp 不成立（LSP 协议级「one server serves one tool」，本腿只起 pyright）（技能 idea-backend 的 references/semantic-backend-options.md（§3 不可替代的三件事）） | 实测 · 结构事实 | codegraph 要先在仓根 codegraph init（会写 .codegraph/ ⇒ 目标仓要先 ignore）；B 腿要 VS Code 窗口常开 | 要的是「统一 FQN 身份 + 持久化跨会话索引」⇒ 协议层没有替代物（只有 IDEA 的 PSI 统一空间有，而它要该语言插件 + 付费版）；agent-lsp 侧别指望跨语言统一符号空间 |
| 代码探索 / 代码地图（这仓是干什么的、怎么走通的） × 全部语言 | 主：codegraph（explore） ｜ 备：无同档替代（LSP 协议层没有代码地图这一档） | 既有实测（phase 01）：codegraph 的 explore 一次调用返回 2095 字符 / 60 行，带 blast radius（谁依赖）与测试覆盖提示（技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）） | 既有实测 | IDE 无关；先 codegraph init（写 .codegraph/）；探索类不入同题任务（真值难判）⇒ 这一行是既有实测等级，不是本 phase 的对照结果 | 要的是精确的引用 / 影响面清单 ⇒ 走 L2 / L5 那几行（codegraph 的口径是受影响符号，与 grep 命中数不同义）；要结构化模式匹配 ⇒ 用 ast-grep |

### 附：VS Code 侧抽方法的实测原始记录（2026-11-22）

- **工具**：agent-lsp 0.24.4 的 `refactor`（走 tsserver 的 `textDocument/codeAction`）；
- **现象一（超时）**：请求挂满 30s 没有返回 ⇒ 记「实现层无此能力」；
- **现象二（崩服务）**：换到另一个位置，tsserver 直接崩，报 `Cannot read properties of undefined (reading 'kind')`；
- **对照**：VS Code 侧 19 个工具面里没有抽方法入口；LSP 协议层对应的能力是 `textDocument/codeAction`，而它没有 scope 参数（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；
- **复现入口**：起法与调用顺序见 技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口））。
- ⚠️ **证据边界**：这一条的原始输出片段**未入库**（本 phase 入库的凭证是 24 格对照实验）⇒ 复现前先按上面的现象自检，别把「超时 / 崩服务」当成稳定契约。

<!-- selection-table:begin -->
```json
{
  "schema": "selection-table/v1",
  "generated_at": "2026-11-22",
  "rows": [
    {
      "key": "l0-l1-file-text",
      "task": "文件级 / 文本级定位（L0/L1）",
      "lang": "全部语言",
      "recommend": "不构成选型差异 —— 两边都走文件系统 / ripgrep",
      "backup": "这一档不进选型",
      "evidence": "两端口径不同义：IDEA 侧 L0 = 按名找源文件、L1 = 带上下文的文本检索（技能 idea-backend 的 references/capability-matrix.md（§1 六个档位））；VS Code 侧 L0 = 文件结构化符号清单（实测 10 个符号）、L1 = token / 高亮（实测 108 个）（技能 vscode-backend 的 references/measurements/typescript.json（records[]）；档位定义见 技能 vscode-backend 的 references/tiers.md（§1 六档定义））⇒ 回答的不是同一个问题，硬凑成同题就是造一个假任务",
      "evidence_levels": [
        "结构事实"
      ],
      "cost": "两档的实现成本都低；VS Code 侧还有 ripgrep 与文件搜索面板兜底",
      "not_when": "想比「谁找得更准」时不要拿这一档当比较项 —— 口径不同义，比出来的差是假的；需要符号身份时直接上 L2",
      "numbers": [
        {
          "value": 10,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "VS Code 侧 L0 文档符号数"
        },
        {
          "value": 108,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "VS Code 侧 L1 语义 token 数"
        },
        {
          "value": 13,
          "pointer": "技能 idea-backend 的 references/langs/ts/runtime.md（§1 实测矩阵）",
          "meaning": "IDEA 侧 TS 文本检索真命中 13/13"
        }
      ]
    },
    {
      "key": "find-def-by-name-python",
      "task": "按名找定义（T1）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "四个配置在 Python 锚点 ProbeItem 上都答对（文件口径召回 / 精度 1.00/1.00）⇒ 差别在成本与前提，不在能不能答对；T1 三轮中位耗时：C 腿 15ms、B 腿 36.7ms、IDEA 2159.1ms、codegraph 1692.5ms；B 腿与 C 腿都要多一步定位（前置步数 1，IDEA 与 codegraph 是 0）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "C 腿要先 start_lsp 且必须带 language_id（不带就走「全部语言直连」，每次冷起恒返 0）；B 腿要 VS Code 窗口常开 + Python 侧 Pylance 在位；IDEA 腿要 IDE 在跑且索引就绪（isDumbMode:false 且 isIndexing:false）",
      "not_when": "窗口关着也要跑 ⇒ 别选 B 腿（服务跑在扩展宿主里，窗口一关端口就没了）；要找跨语言的同名符号 ⇒ 见「跨语言统一符号空间」那一行",
      "numbers": [
        {
          "value": 15,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 36.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 2159.1,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1692.5,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T1 × D 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "find-def-by-position-python",
      "task": "按位置找定义（T2）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "四个配置在函数锚点 probe_run 上都答对（文件口径 1.00/1.00）；T2 三轮中位耗时：C 腿 21.4ms、B 腿 50.8ms、IDEA 1614.7ms、codegraph 1609ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "位置法要给准位置：C 腿的 find_references 要 file_path + line + column（column 必填、1-based）；B 腿位置零基准、uri 必须是 file:/// 小写盘符 + 正斜杠路径",
      "not_when": "只知道符号名、还不知道位置 ⇒ 走「按名找定义（T1）」那一行，别直接上位置法",
      "numbers": [
        {
          "value": 21.4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 50.8,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1614.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1609,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T2 × D 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "find-refs-python",
      "task": "找引用（T3）",
      "lang": "Python",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "BifrostMCP（B 腿，窗口常开）",
      "evidence": "gold = 4 次整词命中 / 2 个文件（技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]））；C 腿命中 4（3 轮中位 15.9ms）、B 腿命中 4（28.7ms）、IDEA 归一后 4（2156ms）（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））；codegraph 给的是受影响符号口径，与 gold 的整词命中不同义 ⇒ 只比文件口径（2/2）",
      "evidence_levels": [
        "实测"
      ],
      "cost": "C 腿取数前要预热 + 结果规模双确认（daemon 报 ready 之后仍可能静默返 0）；B 腿要窗口常开 + Pylance 在位",
      "not_when": "要的是「删了会动谁」的影响面而不是引用清单 ⇒ 走「全局改名与影响面」那一行；codegraph 的受影响符号与 grep 命中数不同义 ⇒ 两把尺子不要相减",
      "numbers": [
        {
          "value": 4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/gold.json（anchors[]）",
          "meaning": "gold 的整词命中数（expect_hits）"
        },
        {
          "value": 15.9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 28.7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 2156,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T3 × A 的 3 轮中位耗时（ms）"
        }
      ]
    },
    {
      "key": "rename-global",
      "task": "全局改名与影响面（改一个变量 / 方法名，全局一起改）",
      "lang": "Python / TypeScript",
      "recommend": "agent-lsp（C 腿，窗口无关）",
      "backup": "IDEA（A 腿，ide_refactor_rename + dryRun）",
      "evidence": "TS 侧既有实测：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条、agent-lsp 的 find_references 得 739 条（差 1 = include_declaration 口径不同）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；Python 侧 T4 改名干跑四个配置都完成 —— IDEA 1477.5ms、agent-lsp 1008.9ms、BifrostMCP 20ms（本轮 get_rename_locations 可用；phase 02 记的是 Unexpected type ⇒ 可用性随会话波动）、codegraph 1145.3ms（技能 idea-backend 的 fixtures/experiment/results.json（cells[]））",
      "evidence_levels": [
        "实测",
        "既有实测"
      ],
      "cost": "**改名范围由 project graph 决定**（实测 2026-11-23：daemon 索引就绪后 `rename_symbol{dry_run}` 预览覆盖 **247 文件 / 740 处**；冷 daemon 时只给 1 处 —— 那是索引没就绪的假象，**不是**「只改已打开的文件」⇒ 先等 `find_references` 返回非 0，再用 dry_run 看 preview）；**「先 open_document 再改名」这一步实测对改名范围无影响 ✓**（打开全部 247 个文件后预览逐字节不变 ✓ —— 冷 daemon 只给 1 处是索引没就绪的假象 ✓）；daemon 报 ready 之后仍可能静默返 0（tsserver 建 project graph 需 60-100s）⇒ 取数前预热 + 结果规模双确认（技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口）））；B 腿的 get_rename_locations 可用性随会话波动 ⇒ 用前先干跑一次自检",
      "not_when": "窗口关着也要跑 ⇒ 别选 B 腿；只要影响面清单不要落盘 ⇒ 先干跑（agent-lsp 的 blast_radius / IDEA 的 ide_refactor_rename dryRun），确认清单再落盘",
      "numbers": [
        {
          "value": 247,
            "value": 740,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 的引用条数"
        },
        {
          "value": 739,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 的引用条数"
        },
        {
          "value": 1477.5,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × A 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1008.9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × C 的 3 轮中位耗时（ms）"
        },
        {
          "value": 20,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × B 的 3 轮中位耗时（ms）"
        },
        {
          "value": 1145.3,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T4 × D 的 3 轮中位耗时（ms）"
        },
        {
          "value": 100,
          "pointer": "技能 vscode-backend 的 references/setup.md（§6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口））",
          "meaning": "tsserver 建 project graph 的等待上限（秒）"
        }
      ]
    },
    {
      "key": "find-refs-ts",
      "task": "找引用（列全部引用）",
      "lang": "TypeScript",
      "recommend": "agent-lsp（窗口无关那条腿）",
      "backup": "BifrostMCP（窗口常开那条腿）",
      "evidence": "VS Code 侧既有实测（单边腿）：同一锚点同一工程，BifrostMCP 的 find_usages 得 740 条（原始 1150.8ms）、agent-lsp 的 find_references 得 739 条（原始 460.9ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 这一格在 IDEA 侧无此能力",
      "evidence_levels": [
        "既有实测",
        "结构事实"
      ],
      "cost": "C 腿要 typescript-language-server + TypeScript 5.x（TS 7 没有 lib/tsserver.js），server spec 必须带 ,--stdio；B 腿要 VS Code 窗口常开；两腿的耗时都是单次样本，复测方差大于表内数字",
      "not_when": "要跟 Python 同题对照时别把这一行的单边腿数字当同题数据；引用数返 0 时先按「索引未就绪」重试，不许下「死代码」结论",
      "numbers": [
        {
          "value": 740,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 的引用条数"
        },
        {
          "value": 739,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 的引用条数"
        },
        {
          "value": 1150.8,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 BifrostMCP 单次调用往返（ms）"
        },
        {
          "value": 460.9,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 agent-lsp 单次调用往返（ms）"
        }
      ]
    },
    {
      "key": "find-def-ts",
      "task": "按位置找定义",
      "lang": "TypeScript",
      "recommend": "BifrostMCP（go_to_definition）",
      "backup": "agent-lsp（这条腿的定义检索本轮未测）",
      "evidence": "VS Code 侧既有实测：BifrostMCP 的 go_to_definition 命中 1（原始 9.1ms / 净 2.3ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；IDEA 侧无此能力 —— 社区版装不了 JS/TS 插件 ⇒ .ts 无 PSI ⇒ 位置法解析到目录符号（resolvedSymbol.kind = directory）⇒ 结果作废",
      "evidence_levels": [
        "既有实测",
        "未测"
      ],
      "cost": "位置零基准（扩展实现是零基准，它的 schema 文本写 One-based）；uri 必须是 file:/// 小写盘符 + 正斜杠路径；C 腿的定义检索本轮未测（这条腿只测了引用 / 诊断 / 影响面三档）⇒ 用前先自检",
      "not_when": "IDEA 侧查 TS 定义 ⇒ 别试（无 PSI，返回的是目录符号）；要按名字找定义又不想开窗口 ⇒ 先用文本检索拿位置",
      "numbers": [
        {
          "value": 1,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "TS 侧 go_to_definition 的命中数"
        },
        {
          "value": 9.1,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "go_to_definition 单次调用往返（ms）"
        },
        {
          "value": 2.3,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "go_to_definition 扣基线后的净耗时（ms）"
        }
      ]
    },
    {
      "key": "impact-ts",
      "task": "影响面 / 改名前的安全清单",
      "lang": "TypeScript",
      "recommend": "agent-lsp（blast_radius）",
      "backup": "codegraph（impact，口径是受影响符号）",
      "evidence": "VS Code 侧既有实测：agent-lsp 的 blast_radius 一次调用给 446 个符号 / 445 条边（原始 18887.7ms / 净 18882.8ms）（技能 vscode-backend 的 references/measurements/typescript.json（records[]））；daemon 索引不全时静默少报（新起的 daemon 上只给 11 符号 / 9 边）",
      "evidence_levels": [
        "既有实测"
      ],
      "cost": "一次调用约 18.9s；大仓里按文件逐个问更贵 ⇒ 先用 blast_radius 拿规模再决定",
      "not_when": "别把 blast_radius 当引用清单（它是 GCF 图的受影响符号，与 grep 命中数不同义）；结果规模与预期量级不符就当残缺图，不当真答案",
      "numbers": [
        {
          "value": 446,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 的受影响符号数"
        },
        {
          "value": 445,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 的边数"
        },
        {
          "value": 18887.7,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 单次调用往返（ms）"
        },
        {
          "value": 18882.8,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "blast_radius 扣基线后的净耗时（ms）"
        },
        {
          "value": 11,
          "pointer": "技能 vscode-backend 的 references/measurements/typescript.json（records[]）",
          "meaning": "索引不全时静默少报的符号数"
        }
      ]
    },
    {
      "key": "symbol-jvm",
      "task": "符号级检索 / 引用 / 影响面",
      "lang": "JVM（Java / Kotlin）",
      "recommend": "IDEA（A 腿，PSI 统一符号空间 + 持久化索引）",
      "backup": "VS Code 侧未测（需装 Red Hat Java 扩展，本机未装）",
      "evidence": "IDEA 侧既有实测（单边腿）：ide_find_references 1.6s / 95 条引用零假命中（技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位））；VS Code 侧未测 —— 本机没装 Red Hat Java 扩展，且 IDEA 侧的 Maven 导入在 40 模块工程上卡死 ⇒ JVM 的同题对照没做",
      "evidence_levels": [
        "既有实测",
        "未测"
      ],
      "cost": "IDEA 侧 JVM 捆绑在社区版里（门槛最低的一档）；VS Code 侧要装 Red Hat Java 扩展 + 一个能导入的 Maven / Gradle 工程",
      "not_when": "要跟 Python / TS 同题对照时别拿 JVM 的单边腿数字当同题数据（语言与口径都不同）；要在窗口外跑 JVM 语义查询 ⇒ 本 phase 没有可用路线",
      "numbers": [
        {
          "value": 1.6,
          "pointer": "技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位）",
          "meaning": "ide_find_references 的实测耗时（秒）"
        },
        {
          "value": 95,
          "pointer": "技能 idea-backend 的 references/langs/java/profile.md（§1 能力档位）",
          "meaning": "ide_find_references 的引用条数（零假命中）"
        }
      ]
    },
    {
      "key": "diagnostics-file",
      "task": "单文件诊断（这个文件有没有问题）",
      "lang": "Python",
      "recommend": "IDEA（A 腿，ide_diagnostics）",
      "backup": "外部 linter（pyright CLI / ruff）—— 不是 MCP 语义后端",
      "evidence": "本 phase 只有 IDEA 真拿到：ide_diagnostics 报 2 条语法错（Formal parameter name expected / ':' expected）；BifrostMCP 的 get_code_actions 报 Illegal argument（能力缺席）；agent-lsp 的 get_diagnostics 恒返 0 条（2026-11-23 复测：daemon 预热 130s + 先 open_document 仍 0 条，同会话 list_symbols 能解析该文件 ⇒ 排除「索引未就绪」；同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错 ⇒ 0 条 ≠ 文件干净）；codegraph 的 CLI 没有检视子命令（能力缺席）（技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细））",
      "evidence_levels": [
        "实测"
      ],
      "cost": "IDEA 侧要 IDE 在跑 + 索引就绪；.py 不在 source root 时 ide_diagnostics 走 closed_batch（弱告警 / quick-fix 不可用）；agent-lsp 那格一次 25017.4ms 还没拿到数据（复测每次约 25s 且恒返 0 条）⇒ 这条腿不能当诊断路线",
      "not_when": "要的是「全项目规范审查」而不是单文件 ⇒ 见「全项目规范审查」那一行；BifrostMCP 侧别再试 get_code_actions（扩展 0.0.14 实测坏）；agent-lsp 侧也别指望 get_diagnostics（实测恒返 0 条 —— 0 条 ≠ 文件干净）",
      "numbers": [
        {
          "value": 2,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "IDEA 报出的语法错条数"
        },
        {
          "value": 7,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "同一 pyright CLI 对同一文件报的语法错条数"
        },
        {
          "value": 25017.4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.json（cells[]）",
          "meaning": "T5 × C 那格的单次耗时（ms）"
        }
      ]
    },
    {
      "key": "inspect-project",
      "task": "全项目规范审查 / Inspect Code",
      "lang": "全部语言",
      "recommend": "IDEA（A 腿，ide_inspect 批量检视 = L4）",
      "backup": "VS Code 侧只能靠外部 linter（ruff / eslint / tsc 逐文件跑）—— 协议层没有 scope 级检视",
      "evidence": "结构事实：LSP 的 textDocument/codeAction 请求没有 scope 参数，协议里没有「一次批检视一个范围」这个能力，VS Code 侧 19 个工具面里也没有对应工具（技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单））；实测侧本 phase 的单文件诊断只有 IDEA 真拿到（2 条）⇒ 范围级检视只有 IDEA 侧有协议外能力",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "ide_inspect 只在 monster 分支的 Index 插件里 —— 上游 5.20.7 的 16 个工具没有它 ⇒ 没装 monster 分支时流水线降级到 L3 文件级 ide_diagnostics（拿不到 P3C / 阿里规范与 global 批处理项）；换分支要重启 IDEA（技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准））",
      "not_when": "要的是「这个文件有没有问题」⇒ ide_diagnostics 就够；VS Code 侧不要指望 MCP 协议层给范围检视 ⇒ 改走外部 linter 并自己汇总",
      "numbers": [
        {
          "value": 19,
          "pointer": "技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单）",
          "meaning": "VS Code 侧的工具个数（工具面里没有范围检视）"
        },
        {
          "value": 16,
          "pointer": "技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）",
          "meaning": "上游 Index 插件 5.20.7 的工具数（没有 ide_inspect）"
        },
        {
          "value": 2,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T5 · 单文件诊断明细）",
          "meaning": "本 phase IDEA 单文件诊断拿到的条数"
        }
      ]
    },
    {
      "key": "extract-method",
      "task": "抽方法 / Extract Method",
      "lang": "全部语言（IDEA 侧限有 PSI 的语言：JVM / Python）",
      "recommend": "IDEA（A 腿，ide_refactor_extract_method）",
      "backup": "VS Code 侧无此能力 —— 实现层",
      "evidence": "VS Code 侧实测不通：agent-lsp 的 refactor 工具在 tsserver 侧走 textDocument/codeAction，一个位置 30s 超时，另一个位置直接崩 tsserver（Cannot read properties of undefined (reading 'kind')）⇒ 实现层无此能力（原始记录见 技能 vscode-backend 的 references/runtime.md（§8 附：VS Code 侧抽方法的实测原始记录（2026-11-22）））；IDEA 侧有 ide_refactor_extract_method，但它只在 monster 分支的 Index 插件里（上游 5.20.7 的 16 个工具没有它）",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "IDEA 侧要 monster 分支 + 重启 IDEA；VS Code 侧没有等价入口（19 个工具面里没有抽方法，协议层对应的能力是 textDocument/codeAction 而它没有 scope 参数）",
      "not_when": "只是想改个名 ⇒ 走「全局改名与影响面」那一行（agent-lsp 的 rename_symbol 可用）；要的是批量模式重写 ⇒ 用 ast-grep，别指望抽方法",
      "numbers": [
        {
          "value": 30,
          "pointer": "技能 vscode-backend 的 references/runtime.md（§附：VS Code 侧抽方法的实测原始记录）",
          "meaning": "textDocument/codeAction 的超时秒数"
        },
        {
          "value": 16,
          "pointer": "技能 idea-backend 的 references/ops-memo.md（§1 工具面以 tools/list 为准）",
          "meaning": "上游 Index 插件 5.20.7 的工具数（没有 ide_refactor_extract_method）"
        },
        {
          "value": 19,
          "pointer": "技能 vscode-backend 的 references/tiers.md（§2 机器可读缺口清单）",
          "meaning": "VS Code 侧的工具个数（没有抽方法入口）"
        }
      ]
    },
    {
      "key": "cross-lang-symbol",
      "task": "跨语言统一符号空间（同名符号在两种语言里各在哪、各被谁引用）",
      "lang": "Python + TypeScript",
      "recommend": "codegraph（IDE 无关，根级索引一次 impact 覆盖两个子工程）",
      "backup": "BifrostMCP（VS Code 窗口内，一次 get_workspace_symbols 返回两侧同名符号）",
      "evidence": "本 phase T6 实测：codegraph 根级索引一次 impact 同时覆盖 py/ 与 ts/（py 侧 6 个受影响符号 / 2 个文件、ts 侧 11 个 / 4 个文件）；BifrostMCP 一次 get_workspace_symbols 同时返回两侧的 ProbeItem（py 侧命中 4 / 2 文件、ts 侧命中 9 / 4 文件）（技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细））；IDEA 社区版不成立（装不了 JS/TS 插件 ⇒ .ts 无 PSI）；agent-lsp 不成立（LSP 协议级「one server serves one tool」，本腿只起 pyright）（技能 idea-backend 的 references/semantic-backend-options.md（§3 不可替代的三件事））",
      "evidence_levels": [
        "实测",
        "结构事实"
      ],
      "cost": "codegraph 要先在仓根 codegraph init（会写 .codegraph/ ⇒ 目标仓要先 ignore）；B 腿要 VS Code 窗口常开",
      "not_when": "要的是「统一 FQN 身份 + 持久化跨会话索引」⇒ 协议层没有替代物（只有 IDEA 的 PSI 统一空间有，而它要该语言插件 + 付费版）；agent-lsp 侧别指望跨语言统一符号空间",
      "numbers": [
        {
          "value": 6,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "codegraph 侧 py 的受影响符号数"
        },
        {
          "value": 11,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "codegraph 侧 ts 的受影响符号数"
        },
        {
          "value": 4,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "BifrostMCP 侧 py 的命中数"
        },
        {
          "value": 9,
          "pointer": "技能 idea-backend 的 fixtures/experiment/results.md（§T6 · 分语言明细）",
          "meaning": "BifrostMCP 侧 ts 的命中数"
        }
      ]
    },
    {
      "key": "explore-codebase",
      "task": "代码探索 / 代码地图（这仓是干什么的、怎么走通的）",
      "lang": "全部语言",
      "recommend": "codegraph（explore）",
      "backup": "无同档替代（LSP 协议层没有代码地图这一档）",
      "evidence": "既有实测（phase 01）：codegraph 的 explore 一次调用返回 2095 字符 / 60 行，带 blast radius（谁依赖）与测试覆盖提示（技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测））",
      "evidence_levels": [
        "既有实测"
      ],
      "cost": "IDE 无关；先 codegraph init（写 .codegraph/）；探索类不入同题任务（真值难判）⇒ 这一行是既有实测等级，不是本 phase 的对照结果",
      "not_when": "要的是精确的引用 / 影响面清单 ⇒ 走 L2 / L5 那几行（codegraph 的口径是受影响符号，与 grep 命中数不同义）；要结构化模式匹配 ⇒ 用 ast-grep",
      "numbers": [
        {
          "value": 2095,
          "pointer": "技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）",
          "meaning": "codegraph explore 一次调用的返回字符数"
        },
        {
          "value": 60,
          "pointer": "技能 idea-backend 的 references/semantic-backend-options.md（§1 本机实测）",
          "meaning": "codegraph explore 一次调用返回的行数"
        }
      ]
    }
  ]
}
```
<!-- selection-table:end -->
<!-- selection-table:section:end -->
