# Go 分册 —— 把 Go 项目接进 IntelliJ IDEA

> **本分册的结论（2026-11-22 实测）**：**社区版 IDEA 接不了 Go** —— 不是配置问题，是插件里的**显式授权校验**（形态④）。
> 官方路线是 **GoLand**（付费，**没有**非商业免费档）。
> 通用部分见 [../../capability-matrix.md](../../capability-matrix.md)（档位定义、探测判据、门禁四形态、平替表）。

## 门禁链路（实测逐步推进 —— 前三道都能解，第四道到此为止）

| # | 形态 | 现象（IDEA 日志原文） | 能解吗 |
|---|---|---|---|
| 1 | ② capability | `Plugin 'Go' (org.jetbrains.plugins.go) has dependency on 'com.intellij.modules.go-capable' which is not installed` | ✅ shim 声明 `com.intellij.modules.go-capable` |
| 2 | ③ 平台模块 | `… has dependency on 'intellij.platform.duplicatesDetector' which is not installed` | ✅ 删掉该模块依赖（同类缺失还有 `intellij.platform.commercial.verifier` / `intellij.platform.webide.impl` / `intellij.platform.graph*` / `intellij.database*` / `intellij.clouds.docker` / `intellij.profiler.*` / `intellij.platform.ide.nonModalWelcomeScreen`） |
| 3 | ③ 专有类 | 删完后插件**能加载**（日志出现 `Go (262.11879.100)`，Index 插件也认到 `Go plugin detected via plugin ID (org.jetbrains.plugins.go)`） | ✅ |
| 4 | **④ 显式授权校验** | `NoClassDefFoundError: com/intellij/ultimate/UltimateVerifier`，栈：`com.intellij.ultimate.PluginVerifier.verifyUltimatePlugin` ← `com.goide.sdk.GoSdkService.<init>` | ❌ **不做** |

**第 4 步是分界线**：`PluginVerifier.verifyUltimatePlugin()` 内部是 `UltimateVerifier.verify(BigInteger)` ——
用 **RSA 公钥做签名校验**（JetBrains 的付费订阅验证），`GoSdkService` 构造时主动调它，验不过就拒跑。
这不是"意外依赖了付费平台的类"，而是**插件有意的付费门禁**。绕过它等于绕过许可校验 —— 本技能不做、也不建议做。

**后果（必须知道）**：Go 插件一旦装上但没通过第 4 步，**IDE 的索引层会整体崩** ——
所有基于索引的查询（`ide_find_file` / `ide_search_text` / `ide_find_class`）都返回
`TOOL_ERROR: com/intellij/ultimate/UltimateVerifier`，连不涉及 Go 的文件也查不到。
⇒ **装不上就彻底卸掉**（把插件目录移出 `%APPDATA%\JetBrains\IdeaIC<ver>\plugins\`），别留在那儿拖累整个 IDE。

## 官方路线

| 选项 | 费用 | 说明 |
|---|---|---|
| **GoLand** | 付费（30 天试用；**没有**非商业免费档 —— 与 WebStorm / RustRover 不同） | Go 的正主 IDE；自带内置 MCP server → `search_symbol`/`analyze_calls` 有真 Go PSI |
| IntelliJ IDEA Ultimate | 付费（30 天试用） | 装 Go 插件后与 GoLand 同源 |
| 留在社区版 | 免费 | **IDEA 只当编辑器**：无语言服务 → 语义能力靠 `go vet` / `golangci-lint` / `go test`（命令行当权威源） |

## 社区版里能做什么（Go 仓）

- **L0/L1 通用能力照常可用**：`ide_find_file` 找 .go 文件、`ide_search_text` 检索文本（不需要语言插件）；
- **L2 及以上不可用**：Index 插件没有给 Go 注册 SymbolReferenceHandler（字节码核实：`GoHandlers` 只注册 CallHierarchy + TypeHierarchy）
  → **symbol/qualifiedName 路由对 Go 永远不可用**；位置法能不能用取决于"文件有没有 PSI"（Go 插件装不上 → 没有 PSI → 位置法也无效）；
- Go 仓的**检视权威源 = `go vet` / `golangci-lint` / `go test`**，不是 IDEA。

## 实测过的探测命令

```bash
# 读门禁（插件 descriptor + 社区版 capability 表）
bash scripts/install-lang-plugin.sh gate 9568
# 判"会不会在运行期崩"：装上后查 idea.log 有没有 com.intellij.ultimate.* 的缺类
bash scripts/install-lang-plugin.sh verify
```

## 本册还没做的部分（诚实标注）

| 缺什么 | 影响 | 补法 |
|---|---|---|
| Go 探测器 `scripts/langs/go/detect.mjs` | 通用分发器对 Go 仓只认 marker（go.mod），不出 `MODULE_NAME`/`GO_VERSION` 等事实 | 有 Go 工程在手时补（照 `scripts/langs/java/detect.mjs` 的形状） |
| Go 配置侧清单 / IDE 侧设置清单 | 本册**故意没有** —— Go 仓在 IDE 侧几乎无可清单化的配置 | 真要清单化时按 [../../capability-matrix.md](../../capability-matrix.md) §6 契约补 |
| GoLand 里的 Go 档位实测 | 本册只测了社区版侧载的失败路径，没测 GoLand 内侧的档位 | 有 GoLand 许可时按 [runtime.md](runtime.md) 的判据补测 |
