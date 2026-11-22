# Rust 分册 —— 运行期能力档位（实测）

> 通用档位定义与探测判据见 [../../capability-matrix.md](../../capability-matrix.md)。
> 实测环境（2026-11-22）：Windows 11、IDEA **IC 2026.2.5 社区版** + **Rust 插件 262.12573.30**（侧载，descriptor 去 ultimate 依赖）
> + **Native Debugging Support 262.11879.100** + 本地 capability shim + Index 插件 **5.20.7**。
> 被测工程：一个零依赖的单 crate 探针工程（`Cargo.toml` + `src/lib.rs`，含 struct / 两个 pub fn / 一个 #[cfg(test)]）。

## §0 结论

**社区版 IDEA 的 Rust = L0-L3 + L5 全通**（L4 与语言无关，需 monster 分支的 Index 插件）。

## §1 实测矩阵

| 档 | 结果 | 证据（实测输出要点） |
|---|---|---|
| **L0** 文件级 | ✅ | `ide_find_file {"query":"main.go"}` 同理命中 `.rs` |
| **L1** 文本级 | ✅ | `ide_search_text` 命中声明行并带 `context` |
| **L2** 符号级 | ✅ **通过金标准** | 位置法 `ide_find_references`（`file`+`line`+`column`+`language:"Rust"`）→ `resolvedSymbol = {"kind":"function","name":"probe_helper","language":"Rust"}` + 1 条真引用（`astPath:["main_probe"]`） |
| **L3** 检视级（文件） | ✅ | 故意写 `pub fn broken(:` → `ide_diagnostics` 报 3 条真 Rust 错误（`<fn parameter> or <self parameter> expected, got ':'` 等） |
| **L4** 检视级（全局） | ⚠️ 需 monster 插件 | 上游 Index 插件无 `ide_inspect` |
| **L5** 重构级 | ✅ | `ide_refactor_rename --dryRun` → `canApply:true`、`target.kind="function"`、`affectedFiles:["src/lib.rs"]`、`usageCount:1` |
| 调用层级 | ✅ | `ide_call_hierarchy` → callers 链 `main_probe → probe_helper`（Rust 有 CallHierarchyHandler） |

## §2 重要澄清：`language` 枚举里**没有** Rust，但位置法照样能用

- Index 插件的 `language` 参数枚举实测 = `["Java","Python"]` —— Rust **不在里面**（插件字节码核实：`RustHandlers` 只注册
  CallHierarchy / Implementations / TypeHierarchy，**没有** SymbolReferenceHandler）；
- 但**位置法**（file+line+column）不走这个枚举，它直接解析 PSI → **只要 Rust 文件有 PSI，位置法就能用**；
- ⇒ 判断一门语言能不能做 L2，**看"文件有没有 PSI"，不看枚举**（详见 [../../capability-matrix.md](../../capability-matrix.md) §2.1）。
- 影响：`ide_find_references` 的 **symbol/qualifiedName 路由**对 Rust 不可用（枚举不放行），**位置法可用** —— 这条要写进 agent 的调用姿势。

## §3 复查方式

```bash
bash scripts/install-lang-plugin.sh verify     # 加载结论 + 门禁拒绝段 + 语言探测
bash scripts/mcp-call.sh index ide_find_references \
  '{"file":"src/lib.rs","line":9,"column":8,"language":"Rust","project_path":"<绝对路径>"}'
```
