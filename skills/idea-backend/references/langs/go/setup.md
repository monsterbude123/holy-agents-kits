# Go 分册 —— 把 Go 项目接进 IntelliJ IDEA

> **本分册的结论先写**：**社区版 IDEA 接不了 Go。** 不是配置问题，是产品定位 + 平台能力模块的事。
> 通用部分见 [../../capability-matrix.md](../../capability-matrix.md)（档位定义、探测判据、门禁三形态、平替表）。

## 门禁（2026-11-22 实测，非引文推断）

| 证据 | 内容 |
|---|---|
| Marketplace 兼容列表（id 9568） | `["GOLAND","IDEA_PRO","JBCLIENT"]` —— 无 `IDEA`（社区版） |
| 插件自述 | "Please note that the only compatible IDE is IntelliJ IDEA Ultimate." |
| 插件级依赖 | `com.intellij.modules.go-capable` |
| **社区版平台提供的能力模块** | 只有 `java-capable` / `python-core-capable` / `python-in-non-pycharm-ide-capable` → **不提供 `go-capable`** |
| **IDEA 加载日志（权威判据）** | `Plugin 'Go' (org.jetbrains.plugins.go) has dependency on 'com.intellij.modules.go-capable' which is not installed` |
| 实测动作 | 把官方 ZIP 侧载进社区版插件目录 → **插件被拒**，日志逐条给出上面的原因 |

> **顺带排除一个过时结论**：2017 年的老 Go 插件（id 5047，xmlId `ro.redeul.google.go`）until-build 是 `171.*` —— **装不上 build 262**，且它自己就声明缺类型感知补全/导航/重构/inspection。

## 平替（官方路线）

| 选项 | 费用 | 说明 |
|---|---|---|
| **GoLand** | 付费（30 天试用；**无**非商业免费档） | Go 的正主 IDE；自带内置 MCP server → `search_symbol`/`analyze_calls` 有真 Go PSI |
| IntelliJ IDEA Ultimate | 付费（30 天试用） | 装 Go 插件后与 GoLand 同源 |
| 留在社区版 | 免费 | **IDEA 只当编辑器**：语言服务、跳转、inspection 全没有 → 语义能力靠 `go vet` / `golangci-lint` / `go test`（命令行当权威源） |

## 社区版里能做什么（Go 仓）

- **L0/L1 通用能力照常可用**：`ide_find_file` 找 .go 文件、`ide_search_text` 检索文本（不需要语言插件）；
- **L2 及以上不可用**：Index 插件**没有给 Go 注册 SymbolReferenceHandler**（字节码核实：`GoHandlers` 只注册 CallHierarchy + TypeHierarchy）→ 即便在 GoLand 里，Index 插件的 symbol 模式也不支持 Go，Go 的语义能力要走**内置 MCP**；
- Go 仓的**检视权威源 = `go vet` / `golangci-lint` / `go test`**，不是 IDEA。

## 装 Ultimate / GoLand 之后

1. 装 Go 插件（版本要匹配 IDE build）；
2. 确认 `bash scripts/setup-env.sh plugins <IDEA安装根>` 输出 `LANG_PLUGIN go edition-gate=ultimate go-plugin=present`；
3. 用**内置 MCP** 做符号级：`search_symbol`（先 `limit:20`）、`analyze_calls`（`depth:2`）；**不要**用 Index 插件的 `ide_find_references{symbolId}` 赌 Go；
4. 判据：符号级必须看到**真代码符号**（`resolvedSymbol.kind` / 返回里的 `kind` 不是 `directory`/`package`）。

## 本册还没做的部分（诚实标注）

| 缺什么 | 影响 | 补法 |
|---|---|---|
| Go 探测器 `scripts/langs/go/detect.mjs` | 通用分发器对 Go 仓只认 marker（go.mod），不出 `GO_VERSION`/`MODULE` 等事实 | 有 Go 工程在手时补（照 `scripts/langs/java/detect.mjs` 的形状） |
| Go 配置侧清单 / IDE 侧设置清单 | 本册**故意没有** —— Go 仓在 IDE 侧几乎无可清单化的配置（语言服务由插件自动接管） | 真要清单化时按 [../../capability-matrix.md](../../capability-matrix.md) §5 契约补 |
