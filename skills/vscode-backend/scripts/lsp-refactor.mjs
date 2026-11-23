#!/usr/bin/env node
// LSP 抽方法（refactor）—— 直连语言服务器，把「抽方法」这类 **command 型** 重构真正落盘。
//
// 为什么需要它（实测 2026-11-23）：
//   TS/JS 的「Extract to function」是 **command 型** code action（`_typescript.applyRefactoring`），
//   **不带 edit** ⇒ 凡是「只收 edit 型动作」的 MCP 都给不了它：
//     · BifrostMCP 的 get_code_actions  → 返回映射里没有 action.edit / action.command（只剩标题）
//     · vsc-lsp-mcp 的 code_actions     → 过滤掉无 edit 的动作（只剩 quickfix）
//     · agent-lsp 的 refactor           → 只列带 edit 的重构（只给得出 “Move to a new file”）
//   而 TS 的 refactor command 会反过来让服务器向客户端发 `workspace/applyEdit` —— 客户端不接就永远超时。
//
// 复用：协议栈用**微软官方** `vscode-jsonrpc`（MIT，零依赖），不自造 JSON-RPC / 分帧 / 取消机制。
//
// 用法：
//   node lsp-refactor.mjs --file <绝对路径> --line <1-based> --col <1-based> [--end-line N --end-col N] [--list|--apply "<动作标题>"]
//   可选：--server "<可直接 spawn 的命令>"（默认 typescript-language-server）｜--project <工程根>（默认取文件所在工程）
//
// 退出码：0 成功；1 失败；2 参数错。
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep, join } from 'node:path'
import { createMessageConnection, StreamMessageReader, StreamMessageWriter } from 'vscode-jsonrpc/node'

const argv = process.argv.slice(2)
const arg = (name, dflt) => {
  const i = argv.indexOf('--' + name)
  return i === -1 ? dflt : argv[i + 1]
}
const has = (name) => argv.includes('--' + name)

const file = arg('file')
if (!file) {
  console.error('用法: node lsp-refactor.mjs --file <绝对路径> --line <1-based> --col <1-based> [--end-line N --end-col N] [--list|--apply "<标题>"]')
  process.exit(2)
}
const line = Number(arg('line'))
const col = Number(arg('col'))
const endLine = arg('end-line') ? Number(arg('end-line')) : undefined
const endCol = arg('end-col') ? Number(arg('end-col')) : undefined
const applyTitle = arg('apply')
const serverSpec = arg('server', 'typescript-language-server')
const filePath = resolve(file)

// --server 给的是「可直接 spawn 的命令 + 参数」（空格分隔），例如 "typescript-language-server"
const parts = serverSpec.split(' ').filter(Boolean)
const serverBin = parts[0]
const serverArgs = parts.slice(1)

// Windows 上 npm 的 bin 是 .cmd 垫片 ⇒ 必须走 shell 才 spawn 得到
const child = spawn(serverBin, [...serverArgs, '--stdio'], { stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' })
const connection = createMessageConnection(new StreamMessageReader(child.stdout), new StreamMessageWriter(child.stdin))

const toUri = (p) => 'file:///' + p.replace(/\\/g, '/')
const fileUri = toUri(filePath)

// ---- 客户端必须接住服务器的请求，否则 command 型重构会一直等（实测会超时）----
const changed = new Map()
connection.onRequest('workspace/applyEdit', async (params) => {
  const edit = params.edit || {}
  const groups = []
  for (const [uri, edits] of Object.entries(edit.changes || {})) groups.push({ uri, edits })
  for (const dc of edit.documentChanges || []) {
    if (dc && dc.textDocument && dc.edits) groups.push({ uri: dc.textDocument.uri, edits: dc.edits })
  }
  for (const { uri, edits } of groups) {
    const abs = decodeURIComponent(uri.replace(/^file:\/\/\//, '').replace(/\//g, sep))
    let text = changed.get(abs) ?? readFileSync(abs, 'utf8')
    const offsetOf = (pos, src) => {
      // CRLF 的换行是两个字符 ⇒ 不能按「行长 + 1」累加，否则偏移会漂（实测会把文件写坏）
      let off = 0
      let line = 0
      while (line < pos.line) {
        const nl = src.indexOf(String.fromCharCode(10), off)
        if (nl === -1) return src.length
        off = nl + 1
        line++
      }
      return off + pos.character
    }
    for (const ed of edits.slice().sort((a, b) => offsetOf(b.range.start, text) - offsetOf(a.range.start, text))) {
      const s = offsetOf(ed.range.start, text)
      const e = offsetOf(ed.range.end, text)
      text = text.slice(0, s) + (ed.newText ?? '') + text.slice(e)
    }
    changed.set(abs, text)
  }
  for (const [abs, text] of changed) writeFileSync(abs, text)
  return { applied: true }
})
// 服务器在 applyRefactoring 之后会要求客户端做一次改名（_typescript.rename）—— 不接就报 Unhandled method
connection.onRequest('_typescript.rename', () => null)
connection.onRequest('workspace/configuration', () => null)
connection.onRequest('client/registerCapability', () => null)
connection.onRequest('window/workDoneProgress/create', () => null)
connection.onNotification('window/logMessage', () => {})
connection.onNotification('$/typescriptVersion', () => {})
connection.listen()

// 选区规则（实测）：TS 的「Extract to function」只在选区**盖住整条语句并越过语句结尾**时出现；
// 少一列 ⇒ 只剩 “Move to a new file”。所以不给 end 时，自动取「该行末尾 + 1 列」。
const NEWLINE_RE = new RegExp(String.fromCharCode(13) + '?' + String.fromCharCode(10))
const srcText = readFileSync(filePath, 'utf8')
const srcLines = srcText.split(NEWLINE_RE)  // NEWLINE_RE 等价于 CRLF 或 LF 两种换行
const startLine = line - 1
const startChar = col - 1
const endLineIdx = endLine ? endLine - 1 : startLine
const endChar = endCol ? endCol - 1 : (srcLines[startLine] ?? '').length + 1
const range = { start: { line: startLine, character: startChar }, end: { line: endLineIdx, character: endChar } }

// 工程根默认取「最近一个带 tsconfig.json 的祖先目录」——
// 取成文件所在目录会让 tsserver 不把文件认进工程 ⇒ 重构动作只剩 “Move to a new file”
function findProjectRoot(start) {
  let dir = dirname(start)
  for (;;) {
    try { readFileSync(join(dir, 'tsconfig.json')); return dir } catch { /* 继续往上找 */ }
    const parent = dirname(dir)
    if (parent === dir) return dirname(start)
    dir = parent
  }
}

try {
  const rootUri = toUri(arg('project', findProjectRoot(filePath)))
  await connection.sendRequest('initialize', {
    processId: process.pid,
    rootUri,
    capabilities: {
      workspace: { applyEdit: true, executeCommand: {} },
      textDocument: { codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'refactor.extract', 'refactor.rewrite', 'source'] } } } },
    },
    workspaceFolders: [{ uri: rootUri, name: 'refactor' }],
  })
  connection.sendNotification('initialized', {})
  connection.sendNotification('textDocument/didOpen', {
    textDocument: { uri: fileUri, languageId: 'typescript', version: 1, text: readFileSync(filePath, 'utf8') },
  })
  await new Promise((r) => setTimeout(r, 2500)) // 等 tsserver 建 project graph

  // CRLF 提示（实测 2026-11-23）：tsserver 生成的编辑文本用 LF ⇒ CRLF 文件会被插入 LF 行，
  // 落盘后变成**混合换行**。内容是对的，但仓库最好统一 LF（.gitattributes: text=auto eol=lf）。
  if (srcText.indexOf(String.fromCharCode(13)) !== -1) {
    console.warn('提示：目标文件是 CRLF 换行 ⇒ 抽方法插入的行是 LF，落盘后会变成混合换行（内容正确）。')
  }
  const res = await connection.sendRequest('textDocument/codeAction', {
    textDocument: { uri: fileUri },
    range,
    context: { diagnostics: [], only: ['refactor'] },
  })
  const actions = Array.isArray(res) ? res : (res && res.actions) || []
  if (!actions.length) {
    console.error('该位置没有 refactor 型 code action（TS 的抽方法需要选中一段语句，而不是光标）')
    process.exit(1)
  }
  console.log('可用重构:')
  for (const a of actions) console.log('  - ' + a.title + '   [' + (a.kind || '') + ']')

  if (!applyTitle) {
    console.log('\n加 --apply "<标题>" 即可执行并落盘')
    process.exit(0)
  }
  const target = actions.find((a) => a.title === applyTitle)
  if (!target) {
    console.error('没有标题为「' + applyTitle + '」的动作')
    process.exit(1)
  }
  if (!target.command) {
    console.error('该动作不带 command（无法执行）')
    process.exit(1)
  }
  await connection.sendRequest('workspace/executeCommand', {
    command: target.command.command,
    arguments: target.command.arguments || [],
  })
  console.log('\n已执行并落盘: ' + target.title)
  for (const [abs, text] of changed) console.log('  * ' + abs)
  process.exit(0)
} catch (err) {
  console.error('失败: ' + (err && err.message ? err.message : String(err)))
  process.exit(1)
} finally {
  try { connection.dispose(); child.kill() } catch { /* ignore */ }
}
