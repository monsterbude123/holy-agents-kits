# Rust 分册 —— 运行期能力档位（实测）

> 通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)。

| 档 | 社区版 IDEA | RustRover / Ultimate（装了 Rust 插件） | 依据 |
|---|---|---|---|
| L0 文件级 | ✅ | ✅ | `ide_find_file` 与语言插件无关 |
| L1 文本级 | ✅ | ✅ | `ide_search_text` 与语言插件无关 |
| L2 符号级 | ❌ 无 Rust 插件 | ⚠️ **只能走内置 MCP** | Index 插件未给 Rust 注册 SymbolReferenceHandler（`RustHandlers` 只注册 CallHierarchy + Implementations + TypeHierarchy，字节码核实）→ `language` 枚举**永远没有 Rust** |
| L3 检视级（文件） | ❌ | ✅（Rust 插件自带 inspection / rustfmt 接入） | 社区版无 Rust 插件 → 无 Rust inspection |
| L4 检视级（全局） | ❌ | ⚠️ 需 monster 分支的 Index 插件 | 与语言无关，是 Index 插件形态问题 |
| L5 重构级 | ❌ | ✅（Rust 插件自带重构） | 同 L3 |

**结论**：Rust 的语义能力**只能靠内置 MCP**（`search_symbol` / `analyze_calls`，语言无关、走 IDE 自己的 PSI），
且必须有一个装了 Rust 插件的 IDE（RustRover / IDEA Ultimate）。

**已知缺陷（JetBrains 侧）**：内置 MCP 的 `reformat_file` 对 Rust 会用 IDE 内置格式化器而不是 RustRover 的 rustfmt
（YouTrack `IJPL-261755`）→ 重排 Rust 代码别信 `reformat_file`，走 `cargo fmt`。

**复查方式**：见 [../../capability-matrix.md](../../capability-matrix.md) §2（每档一条可执行判据）。
