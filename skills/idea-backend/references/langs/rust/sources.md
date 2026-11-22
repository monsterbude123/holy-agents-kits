# 来源快照（Sources）—— Rust 分册

> 本文件是 Rust 分册结论的**溯源底账**：引文必须逐字取自源站，**不许凭记忆写**。
> 抓取时间：2026-11-22。Marketplace 数据取自 JetBrains 官方 API。

---

## [R1] Rust 语言插件 —— JetBrains 官方 Marketplace 条目
- URL: https://plugins.jetbrains.com/api/plugins/22407
- 兼容列表 URL: https://plugins.jetbrains.com/api/plugins/22407/compatible-products
- 用于条目：[setup.md](setup.md) 的门禁段、[runtime.md](runtime.md)

> This plugin adds the power of RustRover,
    a dedicated JetBrains IDE for Rust developers, to IntelliJ IDEA, CLion, and PyCharm.

（`id` = 22407，`name` = "Rust"，`xmlId` = `com.jetbrains.rust`）

> Starting with version 2026.2, the Rust plugin requires the Native Debugging Support (plugin id: com.intellij.nativeDebug) to be installed.

> ["CLION","IDEA_PRO","JBCLIENT","PYCHARM_PRO","RUST"]

---

## [R2] 社区版平台提供的能力模块 —— IDEA 安装内的裁剪包（本机实测取证）
- 来源：`<IDEA安装根>/lib/intellij.idea.community.customization.jar` 的 `META-INF/IdeaPlugin.xml`
- 用于条目：[setup.md](setup.md) 的门禁段（"社区版不提供 rust-capable"）

> <module value="com.intellij.modules.java-capable" />

> <module value="com.intellij.modules.python-core-capable" />

> <module value="com.intellij.modules.python-in-non-pycharm-ide-capable" />

（同一张表里**没有** `go-capable` / `rust-capable` —— 这就是 Go/Rust 插件在社区版装不上的根因。）

---

## [R3] IDEA 加载日志（权威判据，本机实测原文）
- 来源：`<IDEA日志目录>/idea.log` 的 `Problems found loading plugins:` 段
- 用于条目：[setup.md](setup.md) 的门禁段

> Plugin 'Rust' (com.jetbrains.rust) has dependency on 'com.intellij.modules.rust-capable' which is not installed

（把官方 Rust 插件 ZIP 侧载进社区版后 IDEA 自己给出的拒绝理由。
注：在这之前它先拒过一次 `com.intellij.modules.ultimate` —— 那是插件**顶层** `<dependencies>` 里的硬依赖。）
