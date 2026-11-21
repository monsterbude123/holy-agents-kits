# Go 分册 —— 运行期能力档位（实测）

> 通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)。

| 档 | 社区版 IDEA | GoLand / Ultimate（装了 Go 插件） | 依据 |
|---|---|---|---|
| L0 文件级 | ✅ | ✅ | `ide_find_file` 与语言插件无关 |
| L1 文本级 | ✅ | ✅ | `ide_search_text` 与语言插件无关 |
| L2 符号级 | ❌ 无 Go 插件 | ⚠️ **只能走内置 MCP** | Index 插件未给 Go 注册 SymbolReferenceHandler（`GoHandlers` 只注册 CallHierarchy + TypeHierarchy，字节码核实）→ `language` 枚举**永远没有 Go** |
| L3 检视级（文件） | ❌ | ✅（Go 插件自带 inspection） | 社区版无 Go 插件 → 无 Go inspection |
| L4 检视级（全局） | ❌ | ⚠️ 需 monster 分支的 Index 插件 | 与语言无关，是 Index 插件形态问题 |
| L5 重构级 | ❌ | ✅（Go 插件自带重构） | 同 L3 |

**结论**：Go 的语义能力**只能靠内置 MCP**（`search_symbol` / `analyze_calls`，语言无关、走 IDE 自己的 PSI），
且必须有一个装了 Go 插件的 IDE（GoLand / IDEA Ultimate）。

**复查方式**：见 [../../capability-matrix.md](../../capability-matrix.md) §2（每档一条可执行判据）。
