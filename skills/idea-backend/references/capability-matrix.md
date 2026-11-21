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
| L2 | 对该语言的一个符号做位置法查询（`ide_find_references`） | `resolvedSymbol.kind` 是**代码符号**（不是 `directory`/`package`） | ① server 的 `language` 参数是否放行该语言；② 插件构建版本（`mcp-call.sh list index`） |
| L3 | 故意写一个语法错误的文件，`ide_diagnostics` | `problemCount > 0` | ① 该语言文件是否在项目 source root 内；② VFS 是否同步（`ide_sync_files`）；③ 检视规则集是否启用该语言的 inspection |
| L4 | `mcp-call.sh has index ide_inspect` | 退出码 0 | 插件是不是 monster 分支（`setup-env.sh plugins` 看 `ide_inspect` 在不在） |
| L5 | `ide_refactor_rename` + `dryRun:true` | 返回受影响文件清单 | 是否与 L2 同源（多数实现复用同一套符号解析） |

> **铁律**：L2 的探测必须看 `resolvedSymbol`，不能只看"命中数"。命中 0 条和"解析到了目录符号"是两回事 —— 后者会给你一堆 markdown 路径字符串当引用。

---

## §3 当前各语言档位（实测快照）

| 语言 | edition 门禁 | L0 | L1 | L2 | L3 | L4 | L5 | 分册 |
|---|---|---|---|---|---|---|---|---|
| JVM（Java/Kotlin） | community（捆绑） | ✅ | ✅ | ✅ | ✅ | ⚠️ 需 monster 插件 | ✅ | [langs/java/setup.md](langs/java/setup.md) |
| TS / JavaScript | **ultimate**（社区版装不了 JS/TS 插件栈） | ✅ | ✅ | ⚠️ **静默失效** | ⚠️ **恒空** | ⚠️ | ⚠️ | [langs/ts/runtime.md](langs/ts/runtime.md) |
| Python | **ultimate**（社区版没有 Python 语言插件） | ✅ | ✅ | ⚠️ **静默失效** | 未实测（预期恒空） | 未实测 | 未实测 | [langs/python/setup.md](langs/python/setup.md) |

> Python 那行是**本机实测**（IC 2026.2.5，**没装** Python 插件）：L0 `ide_find_file` 能找到 .py 文件 ✅；L1 `ide_search_text` 命中 5 处真实引用、零假命中 ✅；L2 位置法解析到**目录符号**（`resolvedSymbol.kind = directory`）→ 0 引用 → 与 TS 一样是**静默失效**。L3/L4/L5 需要 Python 插件在位才能测。
>
> **JVM 行的分册现状（2026-11-22）**：配置侧清单已建册（`references/langs/java/checklist.json` 20 条 + `idea-settings.json` 6 条，逐条真跑自证），脚手架模板 `templates/java-project` 在位。JVM 是三门语言里**唯一不受 edition 门禁限制**的（社区版捆绑），也是「审查→修复流水线」唯一成立的场景。
>
> **L2/L3 的上游阻塞**：TS 与 Python 的 L2/L3 失效不是配置问题，而是 Index 插件（5.20.7）的 server 端只放行 Java 符号解析、`ide_diagnostics` 对非 Java 文件恒空。升档要等插件支持，判据见 §2。

### §3.1 门禁是"每个插件一行"（2026-11-20 取自 JetBrains 官方 Marketplace API）

| 插件 | id | 兼容产品里有没有 `IDEA_COMMUNITY` | 结论 |
|---|---|---|---|
| Python（语言插件） | 631 | ❌ 只有 `IDEA_PRO`/`JBCLIENT` | 社区版**没有 Python 语言支持** |
| JavaScript and TypeScript | 22069 | ❌ 只有 `IDEA_PRO`/`PYCHARM_PRO` | 社区版**没有 JS/TS 语言支持** |
| Go Language | 5047 | ✅ | 社区版可装 → 这门语言在社区版能用 |
| Ruff（Python 生态的工具插件） | 20574 | ✅ | 社区版可装工具插件，但装不了语言插件 |

⇒ **同一门语言里，语言插件与工具插件可以落在不同门禁上**；"IDEA 支持某语言"这句话永远要补"支持到哪一档、怎么探出来的"。

- 「⚠️ 需 monster 插件」：上游 Index 插件只有 16 个工具，没有 `ide_inspect` → 审查流水线自动降级到 L3（文件级），见 [ops-memo.md](ops-memo.md) §1-§2。
- **同一门语言在不同机器上可以落在不同档**（插件版本/IDE 版本不同）。这张表是**快照**，不是承诺：动手前用 §2 重新探一遍。

---

## §4 升档动作（按性价比排序）

| 想要 | 动作 | 代价 |
|---|---|---|
| L2/L3 ↑ | 装该语言插件（社区版能装的：Python/Go/Rust…） | 免费；装完**重启 IDEA** 并确认索引就绪 |
| L2 ↑ | 插件支持该语言的符号解析（当前只有 Java 等少数语言） | 等插件版本；判据见 §2 的 L2 行 |
| L4 ↑ | 换 monster 分支的 Index 插件 | 侧载 + 重启 + 跑一遍 `mcp-call.sh list index` 核对工具面 |
| L4 ↑（换 IDE） | 该语言在社区版不存在时 | 换 Ultimate / WebStorm / PyCharm 等对应产品（**不是**配置问题） |
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
4. 运行期能力档位要**实测**，不照抄别的语言。
