# VS Code 侧 MCP 通道 —— 安装与实测手册

> 本文件是 **2026-11-22 在本机实测**的记录：装哪个扩展、服务怎么起、端点是什么、工具面有哪些、哪些坑会咬人。
> 机器本地事实（端点端口等）写在**本技能目录下的 `config.json`**（**不入库、不分发**，`.gitignore` 的 `skills/*/config.json` 覆盖）。

## 0. 机器可读事实块（脚本与门禁读这一块，别只读散文）

```json
{
  "extension": "connorhallman.bifrost-mcp",
  "version": "0.0.14",
  "requires_vscode": "^1.93.0",
  "default_port_measured": 8008,
  "transport": "sse",
  "sse_url_pattern": "http://127.0.0.1:<port>/sse",
  "message_url_pattern": "http://127.0.0.1:<port>/message",
  "window_required": true,
  "auto_start": true,
  "start_commands": [
    "bifrost-mcp.startServer",
    "bifrost-mcp.startServerOnPort",
    "bifrost-mcp.stopServer",
    "bifrost-mcp.openDebugPanel"
  ],
  "tool_count": 19,
  "symbol_tools": [
    "find_usages",
    "go_to_definition",
    "get_workspace_symbols",
    "get_document_symbols",
    "get_rename_locations",
    "get_type_definition"
  ],
  "diagnostics_tool": "get_code_actions",
  "diagnostics_tool_availability": "实测 2026-11-22（扩展 0.0.14）：get_code_actions 报 Illegal argument —— **工具面规则达标 ≠ 工具在本机可用**；诊断的替代路线见 runtime.md 的决策表「单文件诊断」一行 —— **注意：agent-lsp 那条腿的 get_diagnostics 也不通**（实测 2026-11-23：daemon 预热 130s + 先 open_document，get_diagnostics 仍返 0 条，而同一 pyright 1.1.414 的 CLI 对同一文件报 7 条语法错 ⇒ 0 条 ≠ 文件干净）⇒ 本机单文件诊断只剩 IDEA 腿与外部 linter（pyright CLI / ruff）",
  "symbol_tools_availability": "实测 2026-11-22（扩展 0.0.14）：6 个符号级工具里 5 个可用；**get_rename_locations 的可用性随会话波动** —— phase 02 实测报 Unexpected type，phase 03 复测**可用**（返回改名编辑清单、影响文件 2 个，与 gold 一致）⇒ 用前先自检：跑一次 dry-run，看返回的是不是编辑清单，不是就换 agent-lsp 那条腿",
  "diagnostics_limitation": "没有独立的 problems/diagnostics 工具；诊断只能从 get_code_actions 返回的 codeAction.diagnostics 里拿",
  "position_convention": "position.line 零基准、position.character 零基准；扩展自己的 schema 文本写的是 One-based line number —— 与实现不符，以实现为准",
  "position_line_base": "zero",
  "uri_form": "file:///<drive-letter-lowercase>/<path-with-forward-slashes>",
  "endpoint_source": "端口来自工作区的 bifrost.config.json（缺省 8008）；**活的端点值只写在机器本地的 config.json**，本块只记默认值与实测事实",
  "measured_at": "2026-11-22"
}
```

## 1. 装扩展

```bash
code --install-extension ConnorHallman.bifrost-mcp     # v0.0.14
code --list-extensions | grep bifrost
```

⚠️ **别手工下 vsix**（市场条目与 `plugin/download` 路径不是一回事；扩展包本身是 `marketplace.visualstudio.com/_apis/public/gallery/publishers/<pub>/vsextensions/<name>/latest/vspackage`，返回的字节流是 **gzip**，要 `gunzip` 才是 zip）。

## 2. 起服务

- **自动起**：扩展的 `activationEvents` 是 `onStartupFinished`，activate 时**自己**起服务 —— 实测装完 + 打开工作区，端口 8008 直接 LISTENING，**不需要点任何命令**；
- **手动起/停**（命令面板）：`Bifrost MCP: Start Server` / `Start Server on Port` / `Stop Server` / `Open Debug Panel`；
- **端口来自工作区**：扩展读工作区根的 `bifrost.config.json`（`{"projectName","description","path","port"}`），没有就用默认 `{port: 8008, path: ""}`；
  ⇒ **端点 = `http://127.0.0.1:<port>/sse` + `/message`**，`path` 非空时前缀会带上。

## 3. 窗口依赖（人工项）

| 测什么 | 期望 | 怎么算过 |
|---|---|---|
| 关掉 VS Code 窗口后端口还在不在 | 应消失（服务跑在扩展宿主里） | `netstat -ano \| grep :8008` 无 LISTENING |
| 只开窗口不加载工作区 | 服务仍起，但符号工具没有项目可查 | `tools/list` 可用、`get_workspace_symbols` 返回空 |
| 窗口常开但工作区换成了别的仓 | 测的就变成别的仓（**静默测错对象**） | 查 `get_workspace_symbols` 的结果路径是否属于目标仓 |

⇒ **窗口必须常开**（这是这条路线与 IDEA 那条最大的运维差别：IDEA 的 MCP 端口可以独立于窗口存在，扩展宿主里的服务不行）。

## 4. 协议事实（排障用；日常调用不需要手写这一层）

通道是标准 MCP SSE 两步握手：

1. `GET /sse` → 服务推 `event: endpoint` + `data: /message?sessionId=<id>`；
2. `POST /message?sessionId=<id>` 发 `initialize` → 响应从 **SSE 流**上回来（不是 POST 的返回体）；
3. `POST` 同一地址发 `notifications/initialized`；
4. 之后 `tools/list` / `tools/call` 同理。

**日常不需要手写这些**：`.mcp.json` 指过来之后，宿主自带的 MCP 客户端会做握手（见 §7）。

**各工具的入参形状（实测自扩展包内的 inputSchema）**：

| 工具 | 入参 | 备注 |
|---|---|---|
| `get_workspace_symbols` | `{query}` | 只收 query 一个参数 |
| `get_document_symbols` | `{textDocument:{uri}}` | uri 必须是 `file:///...` |
| `find_usages` | `{textDocument:{uri}, position:{line,character}, context:{includeDeclaration}}` | **line 零基准** |
| `go_to_definition` | `{textDocument:{uri}, position:{line,character}}` | |
| `get_rename_locations` | `{textDocument:{uri}, position:{line,character}}` | 只读（真改用 `rename`） |
| `get_code_actions` | `{textDocument:{uri}, position:{line,character}}` | 诊断在这里面 |

⚠️ **两个必踩的坑**：

1. **位置基准不一致**：扩展自己的 schema 文本写 `position.line` 是 “One-based line number”，**实现是零基准**。
   实测：传 216（当作 1-based）→ 落到第 217 行的 `Date.now()`，返回的是 **Date 的引用**；传 215 → 正好命中 `getImageCacheStats`。
   ⇒ **位置一律按零基准给**（行、列都是）。
2. **uri 必须是 `file:///d:/...` 这种三斜杠形式**；只给 `filePath` 或裸路径会报 `Unable to read file '\'`。

## 5. 工具面（19 个）

```
find_usages          go_to_definition      find_implementations   get_hover_info
get_document_symbols get_completions        get_signature_help     get_rename_locations
rename               get_code_actions       get_semantic_tokens    get_call_hierarchy
get_type_hierarchy   get_code_lens         get_selection_range    get_type_definition
get_declaration      get_document_highlights get_workspace_symbols
```

- **符号级 6 个**：`find_usages` / `go_to_definition` / `get_workspace_symbols` / `get_document_symbols` / `get_rename_locations` / `get_type_definition`（判定规则：命中 ≥4 算符号级成立）；
- **诊断级**：`get_code_actions`（**没有独立的 diagnostics/problems 工具** —— 这是 VS Code 侧与 IDEA 侧 `get_file_problems` 的关键差距）。
- ⚠️ **实测可用性（2026-11-22，扩展 0.0.14）**：上面 19 个工具里，符号级 6 个有 5 个可用（`get_rename_locations` 报 `Unexpected type`）、诊断级那 1 个不可用（`get_code_actions` 报 `Illegal argument`）⇒ **这一轮 VS Code 侧拿不到诊断、也不能改名**；替代路线见 `references/runtime.md`。

## 6. 已知限制（实测，别踩）

| 限制 | 说明 |
|---|---|
| **诊断没有独立工具** | 只有 `get_code_actions`；要拿「这个文件有哪些问题」得自己找位置逐个问 |
| **VS Code 的 TS 支持不跑 LSP** | 它跑 **tsserver 自有协议** ⇒ 跨语言引用在 TS 上结构性不可能 |
| **`get_code_actions` 报 `Illegal argument` 的根因（已定位）** | 扩展把 `position` 缺省成 `undefined` 传给 `vscode.executeCodeActionProvider`，而它的 **`rangeOrSelection` 参数必填** ⇒ **补上 position 就能拿到动作列表**（但扩展只返回 title / kind / isPreferred / diagnostics，**没有 edit** ⇒ 落盘要走 §6.6 的直连路） |
| **全工程符号检索默认 project-scoped** | `typescript.workspaceSymbols.scope` 默认只搜当前 tsconfig 项目；跨 package 要开 `allOpenProjects`，且结果上限 256 条 |
| **扩展型 MCP server 要求宿主进程活着** | VS Code 窗口关了，服务就没了 |
| **目标工作区会被扩展读** | 扩展读工作区根的 `bifrost.config.json`；实测**没有**被写出 `.vscode/` 或 `bifrost.config.json`（但探针仍须只调只读工具） |

## 6.5 窗口外那条腿：agent-lsp（不依赖 VS Code 窗口）

「VS Code 开着时用它的能力」是上一节；**语义后端的本来需求是「窗口关着也能查」** —— 那条腿用现成的 **agent-lsp**（MIT、活跃、直跑 LSP、66 工具 / 23 个 skill），本机已装 0.24.4。

| 动作 | 命令 / 事实 |
|---|---|
| 装 | `npm install -g @blackwell-systems/agent-lsp`（也有 `winget` / `pip` / `go install` 四种装法） |
| 起（当 MCP server） | `agent-lsp typescript:typescript-language-server,--stdio`（stdio）—— **逗号后的 `,--stdio` 不能少**，见下方「本机已知坑」；或 `agent-lsp --http --port 8080`（HTTP+SSE） |
| 挂进会话 | `.mcp.json` 里加 `{"agent-lsp": {"type": "stdio", "command": "agent-lsp", "args": ["typescript:typescript-language-server,--stdio"]}}` |
| 前置依赖（TS） | `typescript-language-server` + **TypeScript 5.x**（TS 7 是原生 Go 版，没有 `lib/tsserver.js`，会报 `Could not find a valid TypeScript installation`） |
| 工具面（实测 66 个） | `find_references{file_path, line(1-based), language_id?}`、`get_diagnostics{file_path?, group_by?}`、`open_document{file_path, language_id?}`（**取诊断 / 悬停 / 补全前先把文件在 server 里打开** —— 工具自己的描述就是这么写的）、`blast_radius{changed_files:[绝对路径], include_transitive?, scope?}`、`preview_edit` / `safe_apply_edit`（只在 `net_delta==0` 时落盘）、`rename_symbol` … |
| **调用顺序** | 先 `start_lsp{root_dir, language_id}`，再调其它工具（没起就调会返回 `LSP client not initialized; call start_lsp first`） |
| **本机已知坑（实测踩过）** | **server spec 必须带 `,--stdio`**：`agent-lsp typescript:typescript-language-server`（少了它）会挂在 `daemon: broker did not start within 30s`（默认 30s，可用 `AGENT_LSP_BROKER_TIMEOUT_MS` 覆盖）—— 根因**不是** Windows 的 daemon 缺陷，而是 broker 按逗号拆参数后没给 server 传 `--stdio`，`typescript-language-server` 启动即退出（`error: required option '--stdio' not specified`），broker 初始化失败自杀并**清空 daemon 目录**（所以别去 `~/.agent-lsp/` 找现场）。正确写法 `agent-lsp typescript:typescript-language-server,--stdio` ⇒ 实测 `start_lsp` 成功、`find_references` 出 739 条引用 |
| **失败现场在哪看** | `~/.cache/agent-lsp/spawn-logs/<语言>.log`（**不是** `~/.agent-lsp/`，那里只有 cache/ 与 audit.jsonl）—— 上面那句 `--stdio` 的原文就在里面；daemon 的状态文件在 `~/.cache/agent-lsp/daemons/<hash>/{daemon.json,daemon.pid,daemon.sock}` |
| **`doctor` 报 ok ≠ daemon 链路可用** | doctor 走**直连**路径（不经过 broker），且 autodetect 模式自带 `--stdio` ⇒ doctor 测不出这个坑（踩过）。实测对照：`doctor`（autodetect）报 ok；`doctor "typescript:typescript-language-server"` 报 `required option '--stdio' not specified`；`doctor "typescript:typescript-language-server,--stdio"` 报 ok |
| **`find_references` 的入参** | `file_path` + `line`（1-based）+ **`column`（1-based，必填）** —— 只给 line 会报 `column: missing required argument "column"`；`apiFetch` 在 line=78 / column=23 |
| **改名/重构怎么做（达到 IDEA 那种全局效果）** | ① **先等 daemon 索引就绪**：`find_references` 返回**非 0** 才算就绪（daemon 报 ready **不够** ✓ —— 冷 daemon 会静默返 0 ✓）；② `rename_symbol{dry_run:true}` 看 `preview.files/locations` —— **就绪后实测覆盖整个 project（247 文件 / 740 处 ✓）**；③ 确认无误再去掉 dry_run 落盘 ✓。⚠️ **实测更正**：改名范围由 **project graph** 决定，**不是**「只有已打开的文件会改」✗ —— 冷 daemon 时预览只给 1 处，那只是索引没就绪的假象 ✓；`open_document` 对**范围**无影响 ✓（但把文件真正读进内存前，server 看不到它的未保存内容 ✓）。配套：`safe_delete_symbol`（零引用才删 ✓）、`replace_symbol_body`（改函数体 ✓）、`refactor`（抽方法等重构 ✓ —— 但 tsserver 侧实测 30s 超时 ✗） |
| **引用数的口径** | `find_references` 默认 **739** 条；带 `include_declaration: true` 是 **740** 条（多的是定义本身）—— 这就是两条腿 740/739 的差 1 的来源 |
| **`start_lsp` 必须带 `language_id`** | 不带就走「全部语言直连」路径（每次新起一个冷 tsserver ⇒ 恒返 0 条）；带 `language_id: "typescript"` 才进 daemon 复用路径 |
| ⚠️ **daemon 报 ready ≠ 引用已可用** | tsserver 建 project graph 要 **~60-100s**；这期间 `daemon-status` **已经报 ready**，但 `find_references` **静默返回 0 条**（不报错）—— 实测 uptime 22s→1m18s 全是 0，1m38s 才首次返回 739。⇒ **引用数返 0 时先确认 daemon 已跑够 ~60s 再下「死代码」判断**（工具自己也提示 "This may be dead code, or the language server could not resolve references"） |
| ⚠️ **`get_diagnostics` 恒返 0 条** | 实测 2026-11-23（agent-lsp 0.24.4 + pyright 1.1.414）：daemon 预热 **130s**（远超上面那条的 60-100s 窗口）后 `get_diagnostics` **仍返 0 条**；**先 `open_document` 把该文件在 server 里打开也一样返 0**（`open_document` 确实回了 "Document opened"）。同一次会话里 `list_symbols` 能解析出该文件的符号（⇒ daemon 是活的），而**同一 pyright 的 CLI 对同一文件报 7 条语法错**。⇒ **0 条 ≠ 文件干净**（工具自己也写明 "this does not confirm the file is clean"）—— 诊断别指望这条腿，走法见 runtime.md 决策表「单文件诊断」一行 |

## 6.6 抽方法 / 全项目检视 / 全局改名 怎么走（实测 2026-11-23）

> **为什么有这一节**：phase 02 的两条结论「VS Code 侧无抽方法」「诊断这条路 VS Code 侧没有腿」在 **2026-11-23 被复测推翻** —— 那两次失败的是 **agent-lsp 的 `refactor` / `get_diagnostics` 封装**（超时 / 崩 tsserver / 恒返 0 条），**不是服务器能力**。这一节写三样能力各自该走哪条现成的路。

### （1）全项目问题清单（= Inspect Code 等价）→ vsc-lsp-mcp

**装**（VS Code 扩展，MIT）：

```bash
code --install-extension CJL.lsp-mcp
```

**挂进会话**（`.mcp.json`）：

```json
{ "mcpServers": { "lsp-mcp": { "type": "http", "url": "http://127.0.0.1:9527/mcp" } } }
```

**调用**（工具只有一个 `execute_lsp`，能力在 `operation` 枚举里）：

```json
{ "operation": "workspace_diagnostics", "uri": "<工作区根的绝对路径>" }
```

**实测**：坏文件 `probe_broken.py` 返 **7 条** error（`source: Pylance`），与同版本 pyright CLI 的 7 条一致 ⇒ **工作区级清单可达**（底层是 `vscode.languages.getDiagnostics()` 的**无参重载** = Problems 面板的数据源）。

⚠️ **清单只含 VS Code 已分析过的文件** —— 干净仓首次可能是空的 ⇒ 先打开文件或等后台分析。
⚠️ **TS 上它的 `code_actions` 会报 ENOENT**（VS Code 的 TS 扩展在列 refactor 时去 stat「同名符号.ts」）⇒ **抽方法别走它**；`workspace_diagnostics` 与 rename 三段式不受影响。

### （2）全局改名（落盘）→ vsc-lsp-mcp 的 rename 三段式

```json
{ "operation": "prepare_rename",  "uri": "<文件>", "line": 8, "character": 17 }
{ "operation": "rename_preview",  "uri": "<文件>", "line": 8, "character": 17, "newName": "probeCoreV2" }
{ "operation": "rename_apply",    "uri": "<文件>", "renameId": "<上一步给的 id>" }
```

**实测**：改一个方法名 `probeCore` → `probeCoreV2`，预览给 **4 个文件 / 8 处编辑**，apply 返回 **`savedToDisk: true`**，磁盘上 4 个文件（定义 / 类内调用 / import / 测试文件）全部改写 ✓。

⚠️ 位置是 **1-based**（编辑器显示的行号）；`uri` 用原生绝对路径或 `file:///` URI；`rename_apply` **必须带 `uri`**（schema 必填，只带 renameId 会被参数校验拒掉）。

### （3）抽方法（落盘）→ 直连 LSP（仓内脚本）

TS 的「Extract to function」是 **command 型** code action（`_typescript.applyRefactoring`，**不带 edit**）⇒ 凡是「只收 edit 型动作」的 MCP 都给不了它：

- **BifrostMCP** 的 `get_code_actions` 返回映射里没有 `action.edit` / `action.command`（只剩标题）；
- **vsc-lsp-mcp** 的 `code_actions` 过滤掉无 edit 的动作；
- **agent-lsp** 的 `refactor` 只列带 edit 的重构（实测只给得出 “Move to a new file”）。

⇒ 走仓内脚本（客户端用**微软官方** `vscode-jsonrpc`，不自造协议栈）：

```bash
# 先看这个位置有哪些重构
node skills/vscode-backend/scripts/lsp-refactor.mjs --file <绝对路径> --line 6 --col 3 --list
# 再执行并落盘
node skills/vscode-backend/scripts/lsp-refactor.mjs --file <绝对路径> --line 6 --col 3 --apply "Extract to function in module scope"
```

**实测**：一次返 **4 个** action（`refactor.extract.function` ×2 / `refactor.extract.constant` / `refactor.move.newFile`）；执行后**落盘成功**（语句被抽成新函数、原处换成调用，退出码 0）。

**四个硬规矩（都踩过）**：

1. **选区要盖住整条语句并越过语句结尾一列** —— 少一列就只剩 “Move to a new file”（脚本默认按「整行 + 1 列」选）；
2. **工程根取最近的 `tsconfig.json` 祖先目录** —— 取成文件所在目录 ⇒ tsserver 不认工程，重构动作只剩 move.newFile（脚本已自动向上找）；
3. **客户端必须接住服务器的反向请求** —— `workspace/applyEdit`（落盘）与 `_typescript.rename`（applyRefactoring 之后服务器要客户端改名）：不接就报 `Unhandled method` 或一直超时；
4. **CRLF 文件会被插入 LF 行**（内容对，但变成混合换行）⇒ 仓库统一 LF（`.gitattributes`: `text=auto eol=lf`）。

### （4）单文件诊断（Python）

直连 pyright 的 LSP 3.17 `textDocument/diagnostic`（pull 诊断）⇒ 坏文件返 **7 条**，与 pyright CLI 同数 ⇒ **Python 腿的诊断是通的**（agent-lsp 的 `get_diagnostics` 恒 0 是那条封装坏了）。TS 腿的 pull 诊断不存在（`typescript-language-server` 不实现、也不推 `publishDiagnostics`）⇒ TS 的诊断走 `tsc --noEmit`。

## 7. 把这条通道挂进 agent 会话（`.mcp.json`）

通道起来之后，让 agent 会话用上它 —— **`.mcp.json` 由 `scripts/install-vscode-mcp.sh` 按 `config.json` 生成**（端点事实只有一处来源：**别手抄 url** —— 下面这段是**结构说明**，url 一栏是占位符；真文件由脚本写）：

```json
{
  "mcpServers": {
    "vscode": { "type": "sse", "url": "<config.json 里的 vscode.url>", "timeoutMs": 60000 }
  }
}
```

- **新 MCP server 在会话启动时加载** —— 改完 `.mcp.json` 要重启会话，首次可能弹信任确认；
- `.mcp.json` 属于机器本地：脚本把它加进 `.git/info/exclude`（不动仓内 `.gitignore`）；
- **端点事实不随分发**：机器本地的 `config.json`（含实际端口）不入库、不进 npm 包 ⇒ 目标机器要先跑一次 `scripts/install-vscode-mcp.sh` 生成它；
- 端口被改过（工作区的 `bifrost.config.json` 写了 `port`）时，**重跑一次 install 脚本**即可（它按新端口重写 config.json 与 .mcp.json）。

## 7.1 怎么复核通道与工具面（REQ-1 / REQ-2 的验收路径）

装完之后，**不需要手写协议**就能复核两件事：**通道能不能列工具并调工具**（REQ-2）、**工具面达不达标**（REQ-1）：

1. 在会话里（或任意 MCP 客户端里）对 `vscode` 这个 server 列一次工具；
2. 对照 §0 事实块判定：**符号级工具 ≥4 个**（判定锚 = `symbol_tools` 那 6 个里的命中数 ≥4，且诊断工具必须正是 `get_code_actions`）；
3. 端点是否通：`bash scripts/install-vscode-mcp.sh --check`（HTTP 存活探测，不发 MCP 协议）。

> 为什么不是脚本自己发 `tools/list`：手写的 SSE + JSON-RPC 客户端已退役（见 `reuse-survey.md` §2 的 `why_drop`）—— 协议层交给宿主原生 MCP 客户端，脚本只留「装 + 起 + 配 + 探测存活」这段缺口。

## 8. 排障

| 现象 | 查什么 |
|---|---|
| 端口 8008 没监听 | VS Code 窗口开着没？扩展装好没？`code --list-extensions \| grep bifrost` |
| SSE 连上但收不到响应 | 握手顺序：必须先 `initialize` → `notifications/initialized` → 再发调用；`initialize` 的响应走 SSE 流不在 POST 返回体 |
| `Unable to read file '\'` | uri 形状错了（要 `file:///...`）或位置没落在符号上 |
| 查出来是别的符号 | **位置基准**：line 是零基准（schema 文本骗人） |
| 符号查不到 | 该仓是否装了对应语言扩展；VS Code 的 TS 索引是否就绪 |
| agent-lsp 报 `LSP client not initialized` | 先调 `start_lsp{root_dir, language_id}` |
| agent-lsp 报 `broker did not start` | Windows 上的 daemon 层问题（§6.5 末行）；`agent-lsp doctor` 能过说明 server 本身没问题 |
