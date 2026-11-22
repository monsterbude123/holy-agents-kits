# Go 分册 —— 运行期能力档位（实测）

> 通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)。
> 实测环境（2026-11-22）：Windows 11、IDEA **IC 2026.2.5 社区版** + Go 插件 262.11879.100（侧载，去 ultimate + 缺平台模块依赖）+ capability shim。

## §0 结论

**社区版 IDEA 的 Go = 装不上**（插件内含显式授权校验，形态④）。
把 Go 插件硬塞进去的后果是**索引层整体崩**（所有索引查询返回 `TOOL_ERROR: com/intellij/ultimate/UltimateVerifier`），
所以实测结束时**已把 Go 插件彻底卸掉**。

| 档 | 社区版 IDEA | GoLand / Ultimate（装了 Go 插件） | 依据 |
|---|---|---|---|
| L0 文件级 | ✅ | ✅ | `ide_find_file` 与语言插件无关 |
| L1 文本级 | ✅ | ✅ | `ide_search_text` 与语言插件无关 |
| L2 符号级 | ❌ 无 Go 插件（且插件装上也过不了授权校验） | ⚠️ **位置法可用 / symbol 路由不可用** | Index 插件未给 Go 注册 SymbolReferenceHandler（`GoHandlers` 只注册 CallHierarchy + TypeHierarchy）→ `language` 枚举**永远没有 Go**（枚举实测 = `["Java","Python"]`）；位置法取决于"文件有没有 PSI"（有 Go 插件就有） |
| L3 检视级（文件） | ❌ | ✅（Go 插件自带 inspection） | 社区版无 Go 插件 → 无 Go inspection |
| L4 检视级（全局） | ❌ | ⚠️ 需 monster 分支的 Index 插件 | 与语言无关 |
| L5 重构级 | ❌ | ✅（Go 插件自带重构） | 同 L3 |

**复查方式**：见 [../../capability-matrix.md](../../capability-matrix.md) §2（每档一条可执行判据）；
先用 `scripts/install-lang-plugin.sh gate 9568` 判门禁，再 `verify` 看真实加载结论。
