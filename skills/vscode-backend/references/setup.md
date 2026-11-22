# VS Code 侧 MCP 通道 —— 安装与实测手册

> 本文件是 **2026-11-22 在本机实测**的记录：装哪个扩展、服务怎么起、端点是什么、工具面有哪些、哪些坑会咬人。
> 机器本地事实（端点端口等）写在 `skills/vscode-backend/config.json`（**不入库、不分发**，`.gitignore` 的 `skills/*/config.json` 覆盖）。

## 0. 机器可读事实块（脚本与门禁读这一块，别只读散文）

```json
{
  "extension": "connorhallman.bifrost-mcp",
  "version": "0.0.14",
  "requires_vscode": "^1.93.0",
  "port": 8008,
  "transport": "sse",
  "sse_url": "http://127.0.0.1:8008/sse",
  "message_url": "http://127.0.0.1:8008/message",
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
  "diagnostics_limitation": "没有独立的 problems/diagnostics 工具；诊断只能从 get_code_actions 返回的 codeAction.diagnostics 里拿",
  "position_convention": "position.line 零基准、position.character 零基准；扩展自己的 schema 文本写的是 One-based line number —— 与实现不符，以实现为准",
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

## 4. 怎么调（MCP 握手 + 入参形状）

握手（标准 MCP SSE 两步）：

1. `GET /sse` → 服务推 `event: endpoint` + `data: /message?sessionId=<id>`；
2. `POST /message?sessionId=<id>` 发 `initialize` → 响应从 **SSE 流**上回来（不是 POST 的返回体）；
3. `POST` 同一地址发 `notifications/initialized`；
4. 之后 `tools/list` / `tools/call` 同理。

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

## 6. 已知限制（实测，别踩）

| 限制 | 说明 |
|---|---|
| **诊断没有独立工具** | 只有 `get_code_actions`；要拿「这个文件有哪些问题」得自己找位置逐个问 |
| **VS Code 的 TS 支持不跑 LSP** | 它跑 **tsserver 自有协议** ⇒ 跨语言引用在 TS 上结构性不可能 |
| **全工程符号检索默认 project-scoped** | `typescript.workspaceSymbols.scope` 默认只搜当前 tsconfig 项目；跨 package 要开 `allOpenProjects`，且结果上限 256 条 |
| **扩展型 MCP server 要求宿主进程活着** | VS Code 窗口关了，服务就没了 |
| **目标工作区会被扩展读** | 扩展读工作区根的 `bifrost.config.json`；实测**没有**被写出 `.vscode/` 或 `bifrost.config.json`（但探针仍须只调只读工具） |

## 7. 排障

| 现象 | 查什么 |
|---|---|
| 端口 8008 没监听 | VS Code 窗口开着没？扩展装好没？`code --list-extensions \| grep bifrost` |
| SSE 连上但收不到响应 | 握手顺序：必须先 `initialize` → `notifications/initialized` → 再发调用；`initialize` 的响应走 SSE 流不在 POST 返回体 |
| `Unable to read file '\'` | uri 形状错了（要 `file:///...`）或位置没落在符号上 |
| 查出来是别的符号 | **位置基准**：line 是零基准（schema 文本骗人） |
| 符号查不到 | 该仓是否装了对应语言扩展；VS Code 的 TS 索引是否就绪 |
