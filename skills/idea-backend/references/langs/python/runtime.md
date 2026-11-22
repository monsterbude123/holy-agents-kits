# Python 分册 —— 运行期能力档位（实测）

> **怎么读这份文档**：通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)；本文是 **Python 那一档的实测值**。
> 实测环境（2026-11-22）：Windows 11、IDEA **IC 2026.2.5（社区版）** + **Python Community Edition 262.12573.28**（Marketplace id 7322）+ Index 插件 **5.20.7**。
> 被测工程：`ai-short-studio-monster-2`（含若干 `.py` 脚本）。

---

## §0 一句话结论

**Python 是社区版 IDEA 里唯一"官方支持 + 全档位可用"的非 JVM 语言** —— 装 **Python Community Edition**（id 7322）后，
L0/L1/L2/L3/L5 **全部可用**，L4 仍需 monster 分支的 Index 插件。

> ⚠️ 此前本技能记的「社区版没有 Python 语言插件」**是错的**，已在 2026-11-22 更正：Python 有**两个**市场条目 ——
> 完整版 id **631**（只发到 `IDEA_PRO`）与 **Python Community Edition id 7322**（xmlId `PythonCore`，**社区版可装**）。
> 判据见 [../../capability-matrix.md](../../capability-matrix.md) §3.1。

---

## §1 装什么（版本必须对上）

| 项 | 值 | 说明 |
|---|---|---|
| Marketplace id | **7322** | 名字是 "Python Community Edition"，**不是** "Python" |
| xmlId | **`PythonCore`** | Index 插件的探测器按这个 id 认（`PluginDetectors.python.pluginIds = ["Pythonid","PythonCore"]`） |
| 版本 | **262.12573.28**（本机 IDE build 262.12573.28 对应版） | build 段要对得上，否则装不上 |
| 社区版为什么装得上 | 平台裁剪包 `lib/intellij.idea.community.customization.jar` 的 `META-INF/IdeaPlugin.xml` 里声明了 `com.intellij.modules.python-core-capable` | 插件级硬依赖这个能力模块，社区版恰好提供 |

装法：Marketplace 正常安装即可（社区版在 Marketplace 里能搜到并安装这个插件）；装完**重启 IDEA**。

---

## §2 实测矩阵（L0 → L5）

| 档 | 实测结果 | 判据（证据） |
|---|---|---|
| **L0** 文件级 | ✅ | `ide_find_file {"query":"zz_l3_probe"}` → 命中 `tmp/zz_l3_probe.py`（新建文件需先 `ide_sync_files` 再查） |
| **L1** 文本级 | ✅ | `ide_search_text {"query":"zz_probe_target","filePattern":"*.py","context":"code"}` → 命中声明行，带 `context` |
| **L2** 符号级 | ✅ **通过金标准** | 位置法 `ide_find_references`（`file`+`line`+`column`+`language:"Python"`）→ `resolvedSymbol = {"kind":"function","name":"tree"}` + **4 条真实引用**（`kind` 是代码符号，不是 `directory`/`package`） |
| **L3** 检视级（文件） | ✅ | 故意写语法错（`def zz_probe_broken(:`）→ `ide_diagnostics` 报 `problemCount: 2`（"Formal parameter name expected" / "':' expected"） |
| **L4** 检视级（全局） | ⚠️ 需 monster 插件 | 上游 Index 插件 5.20.7 没有 `ide_inspect` → 流水线降级到 L3 |
| **L5** 重构级 | ✅ | `ide_refactor_rename {"dryRun":true}` → `canApply:true` + `affectedFiles` 清单 + 目标 `kind:"function"`、`qualifiedName` 可用 |

**附带效果**：装上后 Index 插件日志出现
`PluginDetector - Python plugin detected via plugin ID (PythonCore)` 与
`Registered SymbolReferenceHandler for Python` → `language` 枚举**多出 `Python`**
（枚举是运行时算的，见 [../../capability-matrix.md](../../capability-matrix.md) §3.4）。

---

## §3 静默失效判据（Python 侧）

通用判据（`resolvedSymbol.kind` 不是代码符号 ⇒ 结果作废）对 Python 同样适用，额外两条：

1. **`ide_find_class` 只查 class/interface/enum** —— 查 Python **函数**用 `ide_find_class` 会返回 0 命中（不报错），要查函数用位置法或文本检索；
2. **`.py` 文件不在 source root 里也能被索引**（脚本目录常见），但 `ide_diagnostics` 对未打开的文件走 `closed_batch` 模式，**弱告警/quick-fix 不可用**（返回里 `analysisMessage` 会写明）。

---

## §4 与其它语言的关系（别照搬 Java 的口径）

- Python 的**类型权威是 mypy**，不是 IDEA —— 见 [setup.md](setup.md) 的工具链段；
- **P3C / global 批处理项 / `src/main`-`src/test` 分流都是 JVM 侧能力**，"审查→修复流水线"照搬到 Python 仓会拿到空清单；
- Python 仓的检视权威源 = `ruff` + `mypy` + `pytest`（清单见 [checklist.json](checklist.json)）。

---

## §5 复查方式（换机器/换版本后重跑）

```bash
# ① 插件在不在 + 版本对不对
bash scripts/setup-env.sh plugins <IDEA安装根>

# ② Index 插件认不认这门语言（看日志）
grep -E "Python plugin detected|SymbolReferenceHandler for Python" "$LOCALAPPDATA/JetBrains/IdeaIC2026.2/log/idea.log"

# ③ L2 金标准：位置法查一个 Python 符号，看 resolvedSymbol.kind
bash scripts/mcp-call.sh index ide_find_references \
  '{"file":"<相对路径>.py","line":<行>,"column":<列>,"language":"Python","project_path":"<绝对路径>"}'

# ④ L3：故意写个语法错文件，ide_diagnostics 的 problemCount 应 > 0
```

> 复查前先确认 **索引就绪**（`ide_index_status` 的 `isDumbMode:false && isIndexing:false`）与 **VFS 同步**（新建文件先 `ide_sync_files`）。
