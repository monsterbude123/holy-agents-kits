# 来源快照（Sources）—— Go 分册

> 本文件是 Go 分册结论的**溯源底账**：引文必须逐字取自源站，**不许凭记忆写**。
> 抓取时间：2026-11-22。Marketplace 数据取自 JetBrains 官方 API。

---

## [G1] Go 语言插件 —— JetBrains 官方 Marketplace 条目
- URL: https://plugins.jetbrains.com/api/plugins/9568
- 兼容列表 URL: https://plugins.jetbrains.com/api/plugins/9568/compatible-products
- 用于条目：[setup.md](setup.md) 的门禁段、[runtime.md](runtime.md)

> This plugin extends IntelliJ IDEA with Go-specific coding assistance and tool integrations,
and has everything you could find in GoLand. Please note that the only compatible IDE is
IntelliJ IDEA Ultimate.

（`id` = 9568，`name` = "Go"，`xmlId` = `org.jetbrains.plugins.go`）

> ["GOLAND","IDEA_PRO","JBCLIENT"]

---

## [G2] 社区版平台提供的能力模块 —— IDEA 安装内的裁剪包（本机实测取证）
- 来源：`<IDEA安装根>/lib/intellij.idea.community.customization.jar` 的 `META-INF/IdeaPlugin.xml`
- 用于条目：[setup.md](setup.md) 的门禁段（"社区版不提供 go-capable"）

> <module value="com.intellij.modules.java-capable" />

> <module value="com.intellij.modules.python-core-capable" />

> <module value="com.intellij.modules.python-in-non-pycharm-ide-capable" />

（同一张表里**没有** `go-capable` / `rust-capable` —— 这就是 Go/Rust 插件在社区版装不上的根因。）

---

## [G3] IDEA 加载日志（权威判据，本机实测原文）
- 来源：`<IDEA日志目录>/idea.log` 的 `Problems found loading plugins:` 段
- 用于条目：[setup.md](setup.md) 的门禁段

> Plugin 'Go' (org.jetbrains.plugins.go) has dependency on 'com.intellij.modules.go-capable' which is not installed

（把官方 Go 插件 ZIP 侧载进社区版后 IDEA 自己给出的拒绝理由。）
