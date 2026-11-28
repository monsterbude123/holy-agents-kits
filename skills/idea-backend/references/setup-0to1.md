# IDEA MCP 环境从 0 到 1 构建（按需引用）

> SKILL.md 只放日常使用策略；本文是完整的搭建/修复流程。全部步骤在本机（Windows 10 + Git Bash）实测通过。

## 0. 版本与产品线事实（先读，避免装错）⚠️ 2026 起发布渠道变更

- **社区版新版只发 GitHub Releases**：`https://github.com/JetBrains/intellij-community/releases`，tag 形如 `idea/2026.2.5`，资产 `idea-2026.2.5.win.zip`（≈848MB）。本机当前安装即 2026.2.5（build 262.12573.28，2026-11-13 发布）。
- **`data.services.jetbrains.com` 的 IIC 记录停更在 2025.3**（2025-12-08），该 API **不能**再作为社区版版本依据——JetBrains 换了发布渠道，老接口没同步。2026.x 在这个 API 里只出现在 IIU 记录下，不代表社区版停更。
- 安装后 config/system 目录：2025.3 为 `IntelliJIdea2025.3`，**2026.2 免费版为 `IdeaIC2026.2`**——以启动后实际生成的目录为准，预写配置前先确认目录名（写错目录=全部配置白写）。
- 统一产物：同一安装器在无 Ultimate 订阅时自动禁用付费插件集（日志 `Disabled plugins: JetBrains Ultimate`），免费功能集即社区能力。

## 1. 前置依赖

| 依赖 | 用途 | 本机现状 |
| --- | --- | --- |
| Git Bash + curl | 下载/探测 | 有 |
| node | JSON 解析（宿主机无 python） | v24 |
| 本地代理 `http://127.0.0.1:10808` | JetBrains/GitHub 域名直连不通，**所有外网 curl 必须带 `-x http://127.0.0.1:10808`** | 系统代理（注册表 ProxyServer） |
| devcontainer（可选） | 提取与容器一致的 JDK | 示例容器 `<project>_devcontainer-app-1`（Temurin 25.0.5+8，路径 `/usr/local/sdkman/candidates/java/current`；容器名以 `docker ps` 实测为准） |
| JDK 20+（javap 用，可选） | 反编译排查 | 装好后即自持 |

注意：从 Linux 容器 `docker cp` 出来的 JDK 是 **Linux 版**（ELF 二进制），Windows 宿主机跑不了；索引虽可经 jrt-fs 跨平台读，但稳妥做法是另下 Windows 版（Adoptium API：`https://api.adoptium.net/v3/binary/latest/25/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk`）。

## 2. 下载

```bash
# 最新社区版 zip 链接（版本会变，先查 API 再拼 URL）
curl -s -x http://127.0.0.1:10808 "https://data.services.jetbrains.com/products/releases?code=IIC&latest=true&type=release"
# 下载（1.4GB，走代理约 3MB/s；-C - 支持断点续传）
curl -sL -x http://127.0.0.1:10808 --retry 3 -C - \
  -o "D:\workplace\_idea-setup\download\idea-<ver>.win.zip" \
  "https://download.jetbrains.com/idea/idea-<ver>.win.zip"
```

## 3. 解压与 JDK

```bash
# zip 无顶层目录（条目以 bin/ 开头），必须解进专用目录
mkdir -p "/d/workplace/idea-<ver>"
/c/Windows/System32/tar.exe -xf "D:\workplace\_idea-setup\download\idea-<ver>.win.zip" -C "D:\workplace\idea-<ver>"
# Windows JDK 解压后放到固定位置（Git Bash 的 tar 不能 chdir 到 /d/... 风格路径，-C 要用 Windows 路径）
```

JDK 放 `<workspace>\jdks\temurin-25-win`，`bin/java -version` 验证。**JDK 版本与容器一致**可让 IDE 分析与 `mvn test` 行为对齐。

## 4. 预写配置（跳过首启弹窗 + 免 GUI 配 SDK）

配置目录：`%APPDATA%\JetBrains\IntelliJIdea<ver>\options\`（2025.3 起社区版也用 `IntelliJIdea` 前缀；拿不准就 `IdeaIC<ver>` 同内容双写）。

**jdk.table.xml** —— ⚠️ 最大的坑：新序列化器要求 `<jdk version="2">`（整数格式版本），旧格式（`version="Java 25"`）报 `Too old version is not supported`，**全局模型加载失败 → 项目打不开**：

```xml
<application>
  <component name="ProjectJdkTable">
    <jdk version="2">
      <name value="temurin-25" />
      <type value="JavaSDK" />
      <version value="openjdk version &quot;25.0.5&quot;" />
      <homePath value="<JDK安装根>" />
      <roots>
        <classPath>
          <root type="composite">
            <root url="jrt://<JDK安装根>!/lib" type="simple" />
          </root>
        </classPath>
        <sourcePath>
          <root type="composite" />
        </sourcePath>
      </roots>
      <additional />
    </jdk>
  </component>
</application>
```

（格式依据：`javap -c` 反汇编 `app.jar` 里 `JpsSdkEntitySerializer.loadSdkEntity`，ELEMENT_VERSION 属性必须等于字面量 "2"。）

**consentOptions.xml**（跳过用户协议弹窗）：

```xml
<application>
  <component name="ConsentOptions">
    <option name="acceptedVersion" value="2.6" />
  </component>
</application>
```

**trustedProjects.xml**（跳过信任弹窗）：

```xml
<application>
  <component name="TrustedProjects">
    <option name="TRUSTED_PROJECT_PATHS">
      <map>
        <entry key="<项目根>" value="true" />
      </map>
    </option>
  </component>
</application>
```

**mcpServer.xml**（启用内置 MCP Server + 固定端口；字段名从插件 jar `com/intellij/mcpserver/settings/McpServerSettings.class` 反查）：

```xml
<application>
  <component name="McpServerSettings">
    <option name="enableMcpServer" value="true" />
    <option name="mcpServerPort" value="64342" />
  </component>
</application>
```

项目侧 `.idea/misc.xml`：`project-jdk-name="temurin-25"`（该目录已 gitignore，随意改）。

## 5. 启动（现行标准：后台任务直跑 exe；schtasks 法已弃用）

**现行姿势（2026-11-17 起验证多轮）**：Bash 工具用 `run_in_background: true` 直接跑 exe——后台任务跨轮持续存活，进程不会被回收：

```bash
/d/workplace/idea-2026.2.5/bin/idea64.exe "D:\\workplace\\code\\<project>" > <某日志> 2>&1   # run_in_background=true
```

就绪等待（**硬上限 60s、每次迭代输出进度**；一般 10-30s 内 29170 就返回 200）：
```bash
for i in 1 2 3 4 5 6; do sleep 10; code=$(curl -s -m 4 -o /dev/null -w '%{http_code}' -X POST \
  http://127.0.0.1:29170/index-mcp/streamable-http -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"z","version":"1"}}}');
  echo "t=$((i*10))s code=$code"; [ "$code" = "200" ] && break; done
```
判活只看 HTTP 状态码（非 000 即活）。**别对 `tasklist | grep -c` 做整数比较**——grep 无输出时变量为空，`[ -gt ]` 报 `integer expression expected`（真实翻车案例）。

历史背景（为什么有过 schtasks 法）：早期 `cmd //c start` 启动的 GUI 进程随会话结束被 job object 回收才绕道计划任务；schtasks 本身还有"删除运行中任务会连带杀进程"的坑（disable 不杀）。现在 run_in_background 直跑最简，schtasks 方案作废。

优雅关闭（`taskkill /IM idea64.exe` 不带 /F）可能被模态弹窗卡住；确认强杀用 `powershell Stop-Process -Id <pid> -Force`（`cmd //c "taskkill /F /T /PID"` 的引号透传在 Git Bash 里有坑）。

## 6. 内置 MCP Server 验证

服务在**项目成功打开后**才启动（postStartupActivity 监听 project open），项目加载失败时它永远不会起——先看 `idea.log` 有无项目加载错误。

```bash
# 1) 日志确认插件加载：grep "MCP Server" idea.log 的 Loaded bundled plugins 行
# 2) 端口确认：netstat -ano | grep LISTENING | grep <idea_pid>  → 63342(内置web) + 64342(MCP)
# 3) SSE 握手（SSE 传输：POST 回 endpoint 事件给的 /message?sessionId=...）
curl -sN -m 5 http://127.0.0.1:64342/sse          # 先收 endpoint 事件
curl -X POST "http://127.0.0.1:64342/message?sessionId=..." -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}'
curl -X POST ... -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'   # 结果从 SSE 流读
```

预期：`IntelliJ IDEA MCP Server 2025.3` + 20 个工具。

## 7. Index 插件（IDE Index MCP Server，第三方，Marketplace id=29174）

- 下载（用 XML id 而非数字 id；`build=` 填 IDE build 号）：
  `https://plugins.jetbrains.com/pluginManager?action=download&id=com.github.hechtcarmel.jetbrainsindexmcpplugin&build=IU-253.28294.334`
- ⚠️ **装到用户插件目录** `%APPDATA%\JetBrains\IntelliJIdea<ver>\plugins\`（解压出顶层目录 `jetbrains-index-mcp-plugin/`）。丢进安装目录的 `plugins\` 实测不加载。
- 自动随项目打开，IDEA 默认端口 **29170**，端点 `/index-mcp/streamable-http`（streamable HTTP；GET 返回 405 属正常）。
- 验证：POST initialize → notifications/initialized → tools/list（Accept 头带 `application/json, text/event-stream`），预期 16 个 `ide_*` 工具。
- ⚠️ **已知缺陷（本机实测，v5.20.6）**：按名字查（`ide_find_class` 连 JDK `String`、qualifiedName 方式）一律返回空；**位置法（file+line+column）完全正常**且返回可复用 symbolId。绕过：grep 定位 → 位置法调用。待插件升级重测。
- 其 `ide_diagnostics` 的深度分析要求文件已打开（可用内置 `open_file_in_editor` 配合）。

## 7.5 语言插件（把某门语言接进 IDEA）—— 2026-11-22 实测增补

**先判门禁再装**：社区版能不能装某门语言，查 [capability-matrix.md](capability-matrix.md) §3.1/§3.2（**别照抄 Marketplace 的 compatible-products**——那是声明，IDEA 的加载日志才是事实）。

| 语言 | 社区版 | 装什么 |
|---|---|---|
| Python | ✅ **能** | Marketplace **"Python Community Edition"**（id **7322**，xmlId `PythonCore`）—— 社区版在 Marketplace 里能正常安装 |
| Java/Kotlin | ✅ 捆绑 | 无需装 |
| TS/JS、Go、Rust | ❌ | 侧载**实测不可用**（见 [langs/ts/runtime.md](langs/ts/runtime.md) §6.2 与 Go/Rust 分册）→ 平替 WebStorm / RustRover / GoLand |

**装语言插件的通用动作**：

1. **版本必须对上 IDE build**：查 `<IDEA安装根>/product-info.json` 的 `buildNumber`（本机 `IC-262.12573.28`）→ 到
   `https://plugins.jetbrains.com/api/plugins/<id>/updates?size=40` 找 `compatibleVersions` 里含该 build 段的版本，
   下载用 `https://plugins.jetbrains.com/plugin/download?updateId=<id>`；
2. **Marketplace 里能搜到的，优先走 Marketplace 安装**（自动处理证书与更新）；只有 Marketplace 不给社区版时才考虑侧载 ZIP；
3. **侧载 ZIP 的落点**：`%APPDATA%\JetBrains\IdeaIC<ver>\plugins\<插件目录名>\`（**用户插件目录**，不是安装目录 —— 丢进安装目录实测不加载），ZIP 顶层目录名保持原样；
4. **装完必须重启 IDEA**，然后看日志确认：
   `grep "Loaded custom plugins" idea.log` 里出现该插件；
   Index 插件侧还要看 `grep "plugin detected via plugin ID" idea.log` —— **这一行才是"语言被认出来"的真凭据**；
5. 门禁类失败会在这两处露头（社区版装 JS/TS 的真实原文）：
   `Plugin 'JavaScript and TypeScript' (JavaScript) has dependency on 'intellij.platform.webide' which is not installed` /
   `Plugin 'Go' (org.jetbrains.plugins.go) has dependency on 'com.intellij.modules.go-capable' which is not installed`

## 7.6 两个必踩的坑（2026-11-22 实测，都是"看起来像卡死"）

### 坑 1：打开未信任工程 → IDE 静默卡死（没有任何窗口）

- **现象**：`idea64.exe <工程路径>` 之后 IDEA **不弹主窗口**、进程占 CPU、`tasklist` 看得到进程但没有窗口标题；
  日志停在 `PlatformProjectOpenProcessor - Opening (sync) <工程>` 之后不再前进；MCP 端口不监听。
- **真因**（`jstack <pid>` 实锤）：`TrustedProjectsStartupDialog.showAndGet` 卡在 `ProjectManagerImpl.openProjectAsyncImpl` ——
  「信任此工程」对话框在主窗口建起来之前就弹了，**没人应答** → 死等。
- **解法**：先把工程加进受信任列表，再打开。

```bash
bash scripts/setup-env.sh trust /abs/path/to/project     # 写 <configDir>/options/trusted-paths.xml
```

（写进去的 key 用 **Windows 反斜杠路径**；已存在不重复加。）

### 坑 2：某个语言插件"装上了但把索引层拖垮"

- **现象**：装完某个语言插件后，**所有**基于索引的查询都返回
  `TOOL_ERROR: com/intellij/ultimate/UltimateVerifier`（或别的缺类）—— 连和这门语言无关的文件都查不到；
  `ide_find_file` / `ide_search_text` / `ide_find_class` 全空。
- **真因**：插件在运行期缺付费平台的专有类（`intellij.platform.commercial.verifier` / `intellij.platform.webide` 等）。
- **解法**：**把插件彻底卸掉**（移出 `%APPDATA%\JetBrains\IdeaIC<ver>\plugins\`），别留着拖累整个 IDE；
  判据用 `bash scripts/install-lang-plugin.sh verify`（它会读 idea.log 的门禁段 + 缺类）。

### 附：在社区版里补一门语言（shim 配方）

社区版平台裁剪包只声明了 3 个 capability（`java-capable` / `python-core-capable` / `python-in-non-pycharm-ide-capable`），
所以 Go/Rust 这类插件会因缺 capability 被拒。**一个自带 shim 插件就能补上**（不改 IDE 安装目录）：

```bash
bash scripts/install-lang-plugin.sh shim com.intellij.modules.rust-capable                                           com.intellij.modules.nativeDebug-plugin-capable
```

完整配方与实测见 [capability-matrix.md](capability-matrix.md) §3.1/§5。

## 8. ZCode 接入

项目根 `.mcp.json`（ZCode 支持 `type:"sse"` 与 `type:"http"`）：

```json
{
  "mcpServers": {
    "idea":       { "type": "sse",  "url": "http://127.0.0.1:64342/sse",                    "timeoutMs": 60000 },
    "idea-index": { "type": "http", "url": "http://127.0.0.1:29170/index-mcp/streamable-http", "timeoutMs": 120000 }
  }
}
```

- 新 MCP server 在**会话启动时**加载：改完 `.mcp.json` 需重启会话，首次可能弹信任确认。
- 加本地排除时注意追加换行：`printf '.mcp.json\n' >> .git/info/exclude`（`echo` 无换行会把两行拼成一行，实测踩过）。

## 9. 排障速查

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| `Too old version is not supported`，项目打不开 | jdk.table.xml 旧格式 | 改 `<jdk version="2">` |
| MCP server 永远不启动 | 项目加载失败（服务随项目打开才起） | 先修项目加载，再查 MCP |
| 探测某 jar 报不存在/空 | IDEA 运行中锁定 jar，读取静默失败 | 关 IDE 后拷贝再分析 |
| 启动后进程消失 | job object 回收（`cmd //c start` 法） | 用 §5 现行标准：Bash `run_in_background` 直跑 exe |
| 优雅关闭卡住 | 模态弹窗 | `Stop-Process -Force` |
| `unzip` 大 jar 列表为空 | 同锁文件问题 | bsdtar + 先拷贝 |

## 10. 2025.3 → 2026.2 升级差异（实测）

- **下载源换 GitHub Releases**（848MB），下载 URL 形如 `https://github.com/JetBrains/intellij-community/releases/download/idea%2F2026.2.5/idea-2026.2.5.win.zip`；走代理约 3MB/s。
- **配置目录名 `IdeaIC2026.2`**（见 §0）；四件套（consentOptions / trustedProjects / jdk.table.xml / mcpServer.xml）可从旧目录照搬：`jdk.table.xml` 的 `version="2"` 在 262 仍有效（项目正常打开验证）；`DEFAULT_MCP_PORT` 仍为 **64342**（javap 262 的 `McpServerSettings` 确认），字段名不变。
- **262 的 lib 布局大改**：`lib/app.jar` 不存在，平台类拆进 `lib/` 下 381 个 jar（如 `lib.jar`/`app-backend.jar`/`fleet.*.jar`）——反编译排查时别按 253 的路径找。
- **内置 MCP 工具面 20→25**：新增 `search_symbol`、`analyze_calls`、`read_file`（依赖/JDK 源码与反编译）、`lint_files`、`build_project`、`apply_patch`，搜索类更名 `search_text/search_regex/search_file`。2025.3 的 20 工具清单已过时。
- **Index 插件（29170）在 262 上"名字索引"缺陷消失**：`ide_find_class`/qualifiedName 查询正常（253 + v5.20.6(253) 上一律返回空，当时只能位置法兜底）。升级后重测，勿照搬历史结论。
- Index 插件下载 `build=` 参数填当前 IDE build（如 `IU-262.12573.28`），插件 zip 解压进用户插件目录 `%APPDATA%\JetBrains\IdeaIC<ver>\plugins\`。
- **Lombok 误报的根因不是插件（2026-11-22 更正）**：此前记的「2026.2.5 不捆绑 Lombok」是**错的** —— Lombok 仍在 IDEA 平台源码树里（`plugins/lombok`，vendor = JetBrains，自 2020.3 起集成），2026.2 官方文档也从未提到它。`get_file_problems`/`ide_diagnostics` 对 Lombok 代码系统性误报（`Cannot resolve symbol 'log'`、`Cannot resolve method 'getXxx()'`）的**真正根因是构建没跑注解处理**：① 构建脚本没声明 lombok 处理器（Maven 的 `annotationProcessorPaths` / Gradle 的 `annotationProcessor` 依赖），或 ② IDE 没委派构建给 Maven/Gradle、也没手动开注解处理。处置顺序：先查这两处（见 `references/langs/java/checklist.json` 的 `annotation-processing-enabled` 与 `idea-settings.json` 的 `idea-lombok-annotation-processing`），再考虑 marketplace 侧载（id=6317，XML id 拼写是 `Lombook Plugin`）。
- 新版首次启动会全量重建索引（253 的索引缓存不通用），大项目需等待。

## 11. 全量 inspection 门禁（headless inspect.bat，官方路径）

**原则：全量门禁用 IDEA 自己的 `inspect.bat`（官方无 GUI 入口，基于索引引擎、输出结构化 XML）；MCP 只做改动文件的增量检查。不要自研批量扫描客户端去重实现 inspection。**

```cmd
:: run-inspect.cmd（与 GUI 互斥，跑之前必须先关 IDE；全部路径无空格时可省引号）
call D:\workplace\idea-<ver>\bin\inspect.bat <项目路径> <项目路径>\.idea\inspectionProfiles\Project_Default.xml <输出目录>
echo RC=%ERRORLEVEL%
```

实测要点（2026.2.5）：
- **静默失败**：从 bash 直接 `cmd //c "<长引号命令>"` 会被 Git Bash→cmd 引号透传吞掉（横幅即退）。把命令写进 .cmd 包装文件再 `cmd //c <文件路径>` 执行；或 PowerShell `Start-Process -Wait -PassThru` 拿 ExitCode。
- 输出：**每个 inspection 类一个 XML**（`<problem>` 含 file/line/problem_class@severity/description），结束时统一落盘；跑完 `RC=0`。
- 冷缓存全量比 GUI 增量慢且数字更大（本仓 headless 3,353 项 vs GUI 增量 1,561 项），属正常。
- profile 传 profile **文件路径**（`Project_Default.xml`），不要传目录。
- 聚合分析：node 遍历 XML 按 `problem_class@severity` 统计即可，无需额外依赖。
