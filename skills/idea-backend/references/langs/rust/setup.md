# Rust 分册 —— 把 Rust 项目接进 IntelliJ IDEA

> **本分册的结论（2026-11-22 实测）**：**社区版 IDEA 能用 Rust**，且 **L0-L3 + L5 全通** —— 但要一层"非官方配置"（见下）。
> 官方路线是 **RustRover（非商业免费）**；社区版这条路是给"手头只有社区版"时的自用方案。
> 通用部分见 [../../capability-matrix.md](../../capability-matrix.md)（档位定义、探测判据、门禁四形态、平替表）。

## 门禁与破解路径（实测链路）

Rust 在社区版要过三道门，逐个解决：

| 门 | 形态 | 现象（IDEA 日志原文） | 解法 |
|---|---|---|---|
| ① 插件级硬依赖 | 形态① | `Plugin 'Rust' (com.jetbrains.rust) has dependency on 'com.intellij.modules.ultimate' which is not installed` | 删掉插件 descriptor 顶层 `<plugin id="com.intellij.modules.ultimate" />` |
| ② 能力模块 | 形态② | `… has dependency on 'com.intellij.modules.rust-capable' which is not installed` | shim 插件声明 `com.intellij.modules.rust-capable` |
| ③ 前置插件 | 形态② | `… has dependency on 'com.intellij.nativeDebug' which is not installed` | 装 **Native Debugging Support**（xmlId `com.intellij.nativeDebug`），它自己又要 `nativeDebug-plugin-capable` → shim 一并声明 |

⇒ 最终 shim 声明两个 capability：

```bash
bash scripts/install-lang-plugin.sh shim \
  com.intellij.modules.rust-capable \
  com.intellij.modules.nativeDebug-plugin-capable
```

**shim 是什么**：一个自带的小插件（`plugins/community-lang-caps/`），descriptor 里用 `<module value="…capable"/>` 声明 capability。
社区版平台的裁剪包（`lib/intellij.idea.community.customization.jar`）只声明了 `java-capable` / `python-core-capable` /
`python-in-non-pycharm-ide-capable` 三个；**shim 就是补上缺的那几个**（不改 IDE 安装目录，只加一个用户插件目录）。

**为什么不声明 Rust 的 capability 就装不上**：capability 模块是 JetBrains 用来表达"这个 edition 可以承载这种语言"的开关，
社区版默认不发这两个。

## 完整配方（照抄即可）

```bash
# 1) 读门禁（插件 descriptor + 社区版 capability 表）
bash scripts/install-lang-plugin.sh gate 22407

# 2) shim（声明两个 capability）
bash scripts/install-lang-plugin.sh shim \
  com.intellij.modules.rust-capable \
  com.intellij.modules.nativeDebug-plugin-capable

# 3) 装插件（版本按 IDE build 选）
bash scripts/install-lang-plugin.sh install 22407
#    Native Debugging Support 按 xmlId 下（Marketplace 的 download 接口吃 xmlId）：
#    https://plugins.jetbrains.com/pluginManager?action=download&id=com.intellij.nativeDebug&build=IU-262.12573.30

# 4) 删插件 descriptor 顶层 ultimate 硬依赖（形态①）—— 改 zip 内的 META-INF/plugin.xml，保留 .orig 备份

# 5) 工程加信任（否则 IDE 卡在看不见的「信任此工程」弹框，见 setup-0to1.md §12）
bash scripts/setup-env.sh trust /abs/path/to/rust/project

# 6) 重启 → 看真实加载结论
bash scripts/install-lang-plugin.sh verify
```

**成功标志**（三条都要有）：

1. `Loaded custom plugins: … Rust (262.12573.30) … Native Debugging Support (262.11879.100)`；
2. 日志里 `Rust plugin detected via plugin ID (com.jetbrains.rust)`；
3. `Problems found loading plugins:` 段**没有** Rust 相关的拒绝。

## 实测档位

见 [runtime.md](runtime.md)：**L0/L1/L2/L3/L5 全通**，L4 需 monster 分支的 Index 插件（与语言无关）。

## 工具链

- **cargo / rustup** 要装且**在 IDEA 进程可见的 PATH 上**（Rust 插件靠它做工程模型与 toolchain 解析）；
  走 `cmd /c start` 起 IDEA 时若 PATH 丢了 `~/.cargo/bin`，用 `export PATH="$HOME/.cargo/bin:$PATH"` 再起；
- `rust-toolchain.toml` 会让插件按钉版解析 toolchain（钉的版本没装 → 插件会去下载）。

## 官方路线（更省事）

**RustRover（非商业免费）** —— 自带 Rust 插件 + 内置 MCP server，TS/JS/Python 也一并能用。
本分册的社区版配方适合"只有社区版、且只想补 Rust"的情况。

## 本册还没做的部分（诚实标注）

| 缺什么 | 影响 | 补法 |
|---|---|---|
| Rust 探测器 `scripts/langs/rust/detect.mjs` | 通用分发器对 Rust 仓只认 marker（Cargo.toml），不出 `CRATE_NAME`/`EDITION` 等事实 | 有 Rust 工程在手时补（照 `scripts/langs/java/detect.mjs` 的形状） |
| Rust 配置侧清单 / IDE 侧设置清单 | 本册**故意没有** —— Rust 仓在 IDE 侧几乎无可清单化的配置 | 真要清单化时按 [../../capability-matrix.md](../../capability-matrix.md) §6 契约补 |
| 真实大型 Rust workspace 的回归 | 实测用的是单 crate 探针工程 + 一个 6-crate workspace 的打开（导入受网络影响较慢） | 有大仓在手时补一轮 |
