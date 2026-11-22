#!/usr/bin/env bash
# VS Code 侧 MCP 调用出口 —— 与 idea-backend 的 mcp-call.sh 同样姿势，但**独立实现**
# （两个技能要能各自单独安装，互不 import 对方的脚本）。
#
#   bash scripts/vscode-mcp-call.sh list                    # 一行一个工具名
#   bash scripts/vscode-mcp-call.sh <tool> '<json-args>'   # 单行 JSON
#
# 端点与传输从**机器本地** config.json 读（skills/*/config.json，仓内 .gitignore 覆盖，不入库）。
# config 不存在 → 报错并提示先跑 install-vscode-mcp.sh，**不静默用默认值**（端点事实只有一处来源）。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
TIMEOUT="${VSCODEMCP_TIMEOUT:-60}"

usage() {
  cat >&2 <<'USAGE'
usage:
  vscode-mcp-call.sh list                     列出工具（一行一个工具名）
  vscode-mcp-call.sh <tool> '<json-args>'    调用工具，输出单行 JSON
USAGE
  exit 2
}
[ $# -ge 1 ] || usage

MODE="${1:-}"; TOOL=""; ARGS=""
if [ "$MODE" != "list" ]; then
  TOOL="$MODE"
  [ $# -ge 2 ] || usage
  ARGS="$2"
  [ -n "$ARGS" ] || ARGS='{}'
  node -e "JSON.parse(process.argv[1])" "$ARGS" >/dev/null 2>&1 || { echo "ERROR: 工具参数不是合法 JSON: $ARGS" >&2; exit 2; }
fi

[ -f "$CONFIG" ] || { echo "ERROR: 缺 $CONFIG —— 先跑 scripts/install-vscode-mcp.sh（端点事实只有这一处来源，不用默认值）" >&2; exit 2; }

PORT="$(node -e "
  try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const v=(j.vscode||{}); process.stdout.write(String(v.port||''));}catch(e){}
" "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")")"
TRANSPORT="$(node -e "
  try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
      const v=(j.vscode||{}); process.stdout.write(String(v.transport||''));}catch(e){}
" "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")")"

[ -n "$PORT" ] || { echo "ERROR: $CONFIG 里没有 vscode.port —— 跑 scripts/install-vscode-mcp.sh 重新写" >&2; exit 2; }
[ "$TRANSPORT" = "sse" ] || { echo "ERROR: 本脚本只实现了 sse 传输（config 写的是 '$TRANSPORT'）" >&2; exit 2; }
BASE="http://127.0.0.1:${PORT}"

# --- SSE 握手：GET /sse 拿 endpoint，再 POST /message?sessionId=... ------------------------
OUT="$(mktemp)"; OUT_WIN="$(cygpath -m "$OUT" 2>/dev/null || echo "$OUT")"
curl -s -N -m "$TIMEOUT" "${BASE}/sse" > "$OUT" 2>&1 &
CURL_PID=$!
cleanup() { kill $CURL_PID 2>/dev/null; rm -f "$OUT"; }
trap cleanup EXIT

EP=""
for _ in $(seq 1 15); do
  sleep 1
  EP="$(grep -m1 'sessionId=' "$OUT" | sed 's/.*data: //' | tr -d '\r')"
  [ -n "$EP" ] && break
done
[ -n "$EP" ] || { echo "ERROR: 端点没响应（${BASE}/sse）—— VS Code 窗口开着没？扩展服务在跑没？" >&2; exit 4; }

post() { curl -s -m 30 -X POST "${BASE}${EP}" -H 'Content-Type: application/json' -d "$1" -o /dev/null; }

post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"idea-backend-vscode","version":"1"}}}' >/dev/null
sleep 2
post '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
sleep 1

if [ "$MODE" = "list" ]; then
  post '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' >/dev/null
  waited=0
  while [ "$waited" -lt "$TIMEOUT" ]; do grep -q '"id":2' "$OUT" && break; sleep 1; waited=$((waited+1)); done
  node -e "
    const fs=require('fs');
    const raw=fs.readFileSync(process.argv[1],'utf8');
    for(const line of raw.split('\n')){
      if(!line.startsWith('data: ')||!line.includes('\"id\":2')) continue;
      const j=JSON.parse(line.slice(6));
      const tools=(j.result&&j.result.tools)||[];
      if(!tools.length){console.error('工具表为空');process.exit(1);}
      for(const t of tools) console.log(t.name);
      process.exit(0);
    }
    console.error('TIMEOUT: 没等到 tools/list 响应');
    process.exit(7);
  " "$OUT_WIN"
  exit $?
fi

# --- 工具调用：单行 JSON -------------------------------------------------------------
node -e "
  const body=JSON.stringify({jsonrpc:'2.0',id:3,method:'tools/call',params:{name:process.argv[1],arguments:JSON.parse(process.argv[2])}});
  process.stdout.write(body);
" "$TOOL" "$ARGS" > "$OUT.req"
post "$(cat "$OUT.req")" >/dev/null
rm -f "$OUT.req"
waited=0
while [ "$waited" -lt "$TIMEOUT" ]; do grep -q '"id":3' "$OUT" && break; sleep 1; waited=$((waited+1)); done

node -e "
  const fs=require('fs');
  const raw=fs.readFileSync(process.argv[1],'utf8');
  for(const line of raw.split('\n')){
    if(!line.startsWith('data: ')||!line.includes('\"id\":3')) continue;
    const j=JSON.parse(line.slice(6));
    if(j.error){ console.log(JSON.stringify({ok:false,error:j.error})); process.exit(5); }
    const content=(j.result&&j.result.content)||[];
    const text=content.length?String(content[0].text===undefined?'':content[0].text):JSON.stringify(j.result);
    let out;
    try{ out=JSON.stringify(JSON.parse(text)); }        // 工具本身返回 JSON → 压成一行
    catch(e){ out=JSON.stringify({text:text.replace(/\n/g,'\\\\n')}); }  // 非 JSON → 包一层，仍是单行 JSON
    process.stdout.write(out+'\n');
    process.exit(content.length&&content[0].isError?1:0);
  }
  console.error('TIMEOUT: 没等到工具调用响应');
  process.exit(7);
" "$OUT_WIN"
exit $?
