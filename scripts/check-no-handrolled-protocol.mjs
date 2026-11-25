#!/usr/bin/env node
// 门禁：仓内脚本**不许手写协议栈**（自己拼 JSON-RPC 报文 / 自己按行读协议流 / 自己写协议帧头）。
//
// 为什么有它:2026-11-25 的一次治理里,agent 为"直连 LSP 抽方法"手写了一套 JSON-RPC 分帧 +
// applyEdit 处理(还有几个临时探针脚本堆在系统 Temp)。能力其实早有现成件:官方
// `vscode-jsonrpc`(MIT,零依赖)与 Python MCP SDK。⇒ 抽象的"不要手搓轮子"会被绕过,
// 所以这里做成**机器可判**的门禁。
//
// 指纹说明(只抓"协议栈"的写法,不动 HTTP 头等正常用法):
//   ① "jsonrpc":"2.0" 报文          ⇒ 自己实现 MCP/JSON-RPC 客户端
//   ② readline.createInterface      ⇒ 自己按行读协议流
//   ③ Content-Length 作为裸帧头行   ⇒ 自己写 LSP 帧(区别于 self.send_header("Content-Length", …))
//
// 存量白名单:scripts/protocol-allowlist.txt(每行 = 路径 + 理由)
//
// 契约:stdout 一行结论;退出码 0 = 通过 / 1 = 有手写协议栈。只读:不写任何文件。

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const ALLOWLIST_FILE = join(ROOT, 'scripts/protocol-allowlist.txt')

const SCAN_DIRS = ['scripts', 'skills']
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.py', '.sh'])

const PATTERNS = [
  { re: /["']jsonrpc["']\s*:\s*["']2\.0["']/, why: '手写 JSON-RPC 报文 ⇒ 用官方 MCP SDK / vscode-jsonrpc' },
  { re: /readline\.createInterface/, why: '自己按行读协议流 ⇒ 用官方客户端库' },
  // 帧头写法是 "Content-Length: " + n（引号里带冒号）;HTTP 的 send_header("Content-Length", x) 是逗号 ⇒ 不误伤
  { re: /["']Content-Length:\s*["']/i, why: '自己写协议帧头 ⇒ 用官方 vscode-jsonrpc' },
]

const allow = new Map()
if (existsSync(ALLOWLIST_FILE)) {
  for (const line of readFileSync(ALLOWLIST_FILE, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const [path, ...rest] = t.split(/\s+#\s*/)
    if (path) allow.set(path.trim(), (rest.join(' # ') || '未写理由').trim())
  }
}

const problems = []
const skipped = []
let scanned = 0

function walk(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (['node_modules', '.git', '__pycache__', '.venv'].includes(name)) continue
      walk(p)
    } else if (CODE_EXT.has(extname(name))) {
      const rel = relative(ROOT, p).replace(/\\/g, '/')
      if (rel === SELF) continue
      scanned++
      if (allow.has(rel)) {
        skipped.push(`${rel}（白名单：${allow.get(rel)}）`)
        continue
      }
      const text = readFileSync(p, 'utf8')
      text.split('\n').forEach((line, i) => {
        for (const { re, why } of PATTERNS) {
          if (re.test(line)) problems.push(`${rel}:${i + 1}  ${why}  →  ${line.trim().slice(0, 90)}`)
        }
      })
    }
  }
}

for (const d of SCAN_DIRS) walk(join(ROOT, d))

if (problems.length) {
  for (const p of problems) console.error('  ✗ ' + p)
  console.error(`手写协议栈门禁失败（${problems.length} 处）—— 现成件:vscode-jsonrpc / Python MCP SDK / ruff --output-format=json / jscpd`)
  process.exit(1)
}
const sk = skipped.length ? `；白名单 ${skipped.length} 个（${skipped.join(' / ')}）` : ''
console.log(`无手写协议栈（扫了 ${scanned} 个脚本${sk}）`)
