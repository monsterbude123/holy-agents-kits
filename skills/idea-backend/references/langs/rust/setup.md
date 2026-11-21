# Rust 分册 —— 把 Rust 项目接进 IntelliJ IDEA

> **本分册的结论先写**：**社区版 IDEA 接不了 Rust，而且这是四门语言里门禁最硬的一门。**
> 通用部分见 [../../capability-matrix.md](../../capability-matrix.md)（档位定义、探测判据、门禁三形态、平替表）。

## 门禁（2026-11-22 实测，非引文推断）

| 证据 | 内容 |
|---|---|
| Marketplace 兼容列表（id 22407） | `["CLION","IDEA_PRO","JBCLIENT","PYCHARM_PRO","RUST"]` —— 无 `IDEA`（社区版） |
| 插件级硬依赖 | 顶层 `<dependencies>` 里直接写 `<plugin id="com.intellij.modules.ultimate" />` → **形态①（插件级硬依赖）** |
| 第二道门 | 摘掉上面那个之后，下一道是 `com.intellij.modules.rust-capable` → **形态②（能力模块）**，社区版平台裁剪包不提供 |
| 额外前置 | 插件自述：2026.2 起还需要先装 `Native Debugging Support`（插件 id `com.intellij.nativeDebug`） |
| **IDEA 加载日志（权威判据）** | `Plugin 'Rust' (com.jetbrains.rust) has dependency on 'com.intellij.modules.rust-capable' which is not installed` |

> **顺带排除一个过时结论**：已弃用的 Rust 插件（id 8182，xmlId `org.rust.lang`）until-build 是 `233.*` —— **装不上 build 262**。

## 平替（官方路线）

| 选项 | 费用 | 说明 |
|---|---|---|
| **RustRover** | **非商业免费**（学习/自用/开源/爱好；商业用途要付费订阅） | Rust 的正主 IDE；自带内置 MCP server → `search_symbol`/`analyze_calls` 有真 Rust PSI |
| IntelliJ IDEA Ultimate | 付费（30 天试用） | 装 Rust 插件后与 RustRover 同源 |
| 留在社区版 | 免费 | **IDEA 只当编辑器**：无语言服务 → 语义能力靠 `cargo clippy` / `cargo check` / `cargo test`（命令行当权威源） |

## 社区版里能做什么（Rust 仓）

- **L0/L1 通用能力照常可用**：`ide_find_file` 找 .rs 文件、`ide_search_text` 检索文本；
- **L2 及以上不可用**：Index 插件**没有给 Rust 注册 SymbolReferenceHandler**（字节码核实：`RustHandlers` 只注册 CallHierarchy + Implementations + TypeHierarchy）→ `language` 枚举**永远没有 Rust**，Rust 的语义能力要走**内置 MCP**；
- Rust 仓的**检视权威源 = `cargo clippy` / `cargo check` / `cargo test`**，不是 IDEA。

## 装 RustRover / Ultimate 之后

1. 装 Rust 插件（版本要匹配 IDE build）+ `Native Debugging Support`；
2. 确认 `bash scripts/setup-env.sh plugins <IDEA安装根>` 输出 `LANG_PLUGIN rust edition-gate=ultimate intellij-rust=present`；
3. 用**内置 MCP** 做符号级：`search_symbol`（先 `limit:20`）、`analyze_calls`（`depth:2`）；不要赌 Index 插件的 symbol 模式支持 Rust；
4. 判据：符号级必须看到**真代码符号**（`kind` 不是 `directory`/`package`）。

## 本册还没做的部分（诚实标注）

| 缺什么 | 影响 | 补法 |
|---|---|---|
| Rust 探测器 `scripts/langs/rust/detect.mjs` | 通用分发器对 Rust 仓只认 marker（Cargo.toml），不出 `CRATE_NAME`/`EDITION` 等事实 | 有 Rust 工程在手时补（照 `scripts/langs/java/detect.mjs` 的形状） |
| Rust 配置侧清单 / IDE 侧设置清单 | 本册**故意没有** —— Rust 仓在 IDE 侧几乎无可清单化的配置 | 真要清单化时按 [../../capability-matrix.md](../../capability-matrix.md) §5 契约补 |
