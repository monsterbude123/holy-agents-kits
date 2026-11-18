#!/usr/bin/env bash
# Call an IDEA MCP tool and print the human-readable result (content[0].text).
# Usage:
#   scripts/mcp-call.sh index   <tool> '<json-args>' [timeoutSec]     # Index plugin (port from config or 29170, streamable HTTP)
#   scripts/mcp-call.sh builtin <tool> '<json-args>' [timeoutSec]     # built-in MCP (port from config or 64342, SSE)
# Reads config.json (ports, commonProject) when present. Exits non-zero on transport/tool failure.
# Agents: use this INSTEAD of hand-rolling curl+node JSON-RPC plumbing.

set -u
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/d'; exit 0
fi
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"

SERVER="${1:?usage: mcp-call.sh index|builtin <tool> '<json-args>' [timeoutSec]}"
TOOL="${2:?missing tool name}"
# NOTE: never write ARGS="${3:-{}}" — bash closes the expansion at the first '}', so when $3
# is non-empty a literal '}' gets appended (sent body had one brace too many). Explicit beats clever.
ARGS="$3"
[ -z "$ARGS" ] && ARGS='{}'
TIMEOUT="${4:-590}"

read_cfg() { # read_cfg <dotted.path> <default>   (MSYS /d/... paths are unreadable to Windows node → cygpath -m)
  local CFG_W
  CFG_W=$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")
  node -e "let v;try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));v=process.argv[2].split('.').reduce((o,k)=>o&&o[k],j)}catch(e){}console.log(v===undefined||v===null?process.argv[3]:v)" "$CFG_W" "$1" "$2" 2>/dev/null
}

# ---------- index plugin: streamable HTTP ----------
# Stateless call first (server accepts tools/call without mcp-session-id); fall back to
# the full initialize/session dance only if stateless fails. Long sessions leaked session
# slots on the server side — do NOT create sessions unless needed.
call_index() {
  local EP="http://127.0.0.1:${PORT}/index-mcp/streamable-http"
  local RESP
  RESP=$(curl -s -m "$TIMEOUT" -X POST "$EP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}")
  if echo "$RESP" | /usr/bin/grep -q '"id":2'; then echo "$RESP" | call_parse; return; fi

  local SID
  SID=$(curl -s -m 15 -X POST "$EP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -D - -o /dev/null -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"skill-agent","version":"1"}}}' \
    | /usr/bin/grep -io 'mcp-session-id: .*' | tr -d '\r' | awk '{print $2}')
  [ -n "$SID" ] || { echo "ERROR: stateless call failed and no mcp-session-id (IDEA running?)"; exit 4; }
  curl -s -m 8 -X POST "$EP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SID" -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
  RESP=$(curl -s -m "$TIMEOUT" -X POST "$EP" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -H "mcp-session-id: $SID" -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}")
  echo "$RESP" | call_parse
}

call_parse() {
  node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const line=d.split('\n').find(l=>l.startsWith('data: '))||d;try{const j=JSON.parse(line.trim());if(j.error){console.log('TOOL_ERROR:',JSON.stringify(j.error));process.exit(5)}const c=j.result&&j.result.content&&j.result.content[0]&&j.result.content[0].text;console.log(c!=null?c:JSON.stringify(j))}catch(e){console.log('PARSE_ERROR:',d.slice(0,400));process.exit(6)}})"
}

# ---------- built-in MCP: SSE (GET /sse for endpoint, POST /message?sessionId=...) ----------
call_builtin() {
  local EP="http://127.0.0.1:${PORT}/sse"
  local OUT; OUT=$(mktemp)
  curl -s -N -m "$TIMEOUT" "$EP" > "$OUT" 2>&1 &
  local CURLPID=$!
  local ENDPOINT=""
  for _ in $(seq 1 10); do
    sleep 1
    ENDPOINT=$(/usr/bin/grep -m1 "sessionId=" "$OUT" | sed 's/.*data: //' | tr -d '\r')
    [ -n "$ENDPOINT" ] && break
  done
  [ -n "$ENDPOINT" ] || { kill $CURLPID 2>/dev/null; echo "ERROR: no SSE endpoint event (IDEA running?)"; exit 4; }
  curl -s -m 30 -X POST "http://127.0.0.1:${PORT}${ENDPOINT}" -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$TOOL\",\"arguments\":$ARGS}}" >/dev/null
  # wait for the id:2 response on the SSE stream, then extract text
  local waited=0
  while [ $waited -lt "$TIMEOUT" ]; do
    if /usr/bin/grep -q '"id":2' "$OUT"; then break; fi
    sleep 2; waited=$((waited+2))
  done
  kill $CURLPID 2>/dev/null
  node -e "const fs=require('fs');const d=fs.readFileSync('$OUT','utf8');const line=d.split('\n').find(l=>l.startsWith('data: ')&&l.includes('\"id\":2'));if(!line){console.log('TIMEOUT: no response in ${TIMEOUT}s');process.exit(7)}try{const j=JSON.parse(line.slice(6));const c=j.result&&j.result.content&&j.result.content[0]&&j.result.content[0].text;console.log(c!=null?c:JSON.stringify(j))}catch(e){console.log('PARSE_ERROR:',line.slice(0,400));process.exit(6)}"
}

case "$SERVER" in
  index)   PORT=$(read_cfg ports.indexMcp 29170); call_index ;;
  builtin) PORT=$(read_cfg ports.builtinMcp 64342); call_builtin ;;
  *) echo "usage: mcp-call.sh index|builtin <tool> '<json-args>' [timeoutSec]"; exit 1 ;;
esac
