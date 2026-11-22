#!/usr/bin/env bash
# 装 / 校验 VS Code 侧的 MCP 通道（BifrostMCP 扩展）
#
#   bash scripts/install-vscode-mcp.sh [--check] [<工作区路径>]
#
#   --check   只校验不改动（扩展在不在 / 端点通不通 / 工具面达不达标）
#   默认      装扩展 → 起 VS Code → 校验 → 把端口与传输写进机器本地 config.json
#
# 端点事实只有一处来源：机器本地 config.json（skills/*/config.json，仓内 .gitignore 覆盖，不入库）。
# 端口的**来源**是工作区的 bifrost.config.json（扩展自己读的那份），缺省 8008。
# 工具面判定规则见 references/setup.md 的「机器可读事实块」。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
EXT_ID="connorhallman.bifrost-mcp"
# 符号级工具：判定规则要求这 6 个里命中 >=4（见 references/setup.md）
SYMBOL_TOOLS=(find_usages go_to_definition get_workspace_symbols get_document_symbols get_rename_locations get_type_definition)
DIAG_TOOL="get_code_actions"
MIN_SYMBOL_TOOLS=4

MODE="install"; WORKSPACE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --check) MODE="check"; shift;;
    --help|-h) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0;;
    *) WORKSPACE="$1"; shift;;
  esac
done

fail() { echo "ERROR: $*" >&2; exit 1; }
note() { echo "  $*"; }

# --- code CLI 定位（不在 PATH 时给全路径提示）----------------------------------------
CODE_CMD="code"
command -v code >/dev/null 2>&1 || CODE_CMD="/c/Users/septe/AppData/Local/Programs/Microsoft VS Code/bin/code"
[ -x "$CODE_CMD" ] || command -v code >/dev/null 2>&1 || fail "找不到 code CLI（装 VS Code 或把 bin 目录加进 PATH）"

# --- 端口来源：工作区 bifrost.config.json → 缺省 8008 --------------------------------
resolve_port() {
  local ws="$1" cfg=""
  [ -n "$ws" ] && cfg="$ws/bifrost.config.json"
  if [ -n "$cfg" ] && [ -f "$cfg" ]; then
    node -e "
      try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
          if(j && j.port) {process.stdout.write(String(j.port));process.exit(0)}}catch(e){}
      process.stdout.write('8008');
    " "$(cygpath -m "$cfg" 2>/dev/null || echo "$cfg")"
  else
    echo "8008"
  fi
}

# --- 扩展在不在 ---------------------------------------------------------------------
ext_installed() { "$CODE_CMD" --list-extensions 2>/dev/null | grep -qi "^${EXT_ID}$"; }

# --- 端点 + tools/list（返回工具名，一行一个；失败则非 0）------------------------------
probe_tools() { # <port>
  local port="$1" out out_win ep pid i
  out="$(mktemp)"; out_win="$(cygpath -m "$out" 2>/dev/null || echo "$out")"
  curl -s -N -m 60 "http://127.0.0.1:${port}/sse" > "$out" 2>&1 &
  pid=$!
  for i in $(seq 1 15); do sleep 1; grep -q "sessionId=" "$out" && break; done
  ep="$(grep -m1 'sessionId=' "$out" | sed 's/.*data: //' | tr -d '\r')"
  if [ -z "$ep" ]; then kill $pid 2>/dev/null; rm -f "$out"; return 1; fi
  post() { curl -s -m 30 -X POST "http://127.0.0.1:${port}${ep}" -H 'Content-Type: application/json' -d "$1" -o /dev/null; }
  post '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"idea-backend-vscode","version":"1"}}}' >/dev/null
  sleep 2
  post '{"jsonrpc":"2.0","method":"notifications/initialized"}' >/dev/null
  sleep 1
  post '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' >/dev/null
  local waited=0
  while [ "$waited" -lt 30 ]; do grep -q '"id":2' "$out" && break; sleep 1; waited=$((waited+1)); done
  kill $pid 2>/dev/null
  node -e "
    const fs=require('fs');
    const raw=fs.readFileSync(process.argv[1],'utf8');
    let tools=null;
    for(const line of raw.split('\n')){
      if(!line.startsWith('data: ')||!line.includes('\"id\":2')) continue;
      try{const j=JSON.parse(line.slice(6)); if(j.result&&j.result.tools) tools=j.result.tools;}catch(e){}
    }
    if(!tools){console.error('未拿到 tools/list');process.exit(1);}
    for(const t of tools) console.log(t.name);
  " "$out_win"
  local rc=$?
  rm -f "$out"
  return $rc
}

# --- 写机器本地 config.json（端点事实的唯一落点）--------------------------------------
write_config() { # <port> <transport>
  mkdir -p "$(dirname "$CONFIG")"
  node -e "
    const fs=require('fs'),path=require('path');
    const file=process.argv[1], port=Number(process.argv[2]), transport=process.argv[3];
    let j={};
    try{ j=JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){}
    j._comment='机器本地运行时配置（不入库、不分发；.gitignore 的 skills/*/config.json 覆盖）。端口来源：工作区 bifrost.config.json，缺省 8008；URL 由脚本拼。';
    j.vscode={port, transport, extension:'connorhallman.bifrost-mcp'};
    fs.writeFileSync(file, JSON.stringify(j,null,2)+'\n');
  " "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")" "$1" "$2"
}

PORT="$(resolve_port "$WORKSPACE")"

# ================= install =================
if [ "$MODE" = "install" ]; then
  if ! ext_installed; then
    note "装扩展 $EXT_ID ..."
    "$CODE_CMD" --install-extension "$EXT_ID" >/dev/null 2>&1 || fail "扩展安装失败（code --install-extension $EXT_ID）"
  fi
  ext_installed || fail "扩展装完仍不在：code --list-extensions | grep $EXT_ID"
  note "扩展在位"
  # 起 VS Code（服务跑在扩展宿主里，窗口必须活着）
  if ! curl -s -o /dev/null -m 3 "http://127.0.0.1:${PORT}/sse" 2>/dev/null; then
    if [ -n "$WORKSPACE" ]; then
      note "起 VS Code（工作区 $WORKSPACE）..."
      "$CODE_CMD" "$WORKSPACE" >/dev/null 2>&1 &
      sleep 12
    else
      note "端点未起（VS Code 窗口没开？扩展宿主不在服务就不在）"
    fi
  fi
fi

# ================= 校验 =================
ext_installed || fail "扩展不在：code --list-extension $EXT_ID（--check 模式不装扩展，请先跑一次不带 --check 的安装）"

TOOLS="$(probe_tools "$PORT")" || fail "endpoint unreachable —— 扩展服务没起（VS Code 窗口开着没？端口 $PORT 监听没？）"

COUNT="$(printf '%s\n' "$TOOLS" | grep -c . || true)"
[ "$COUNT" -ge 1 ] || fail "tools/list 返回空"

HIT=0
for t in "${SYMBOL_TOOLS[@]}"; do
  printf '%s\n' "$TOOLS" | grep -qx -- "$t" && HIT=$((HIT+1))
done
if [ "$HIT" -lt "$MIN_SYMBOL_TOOLS" ]; then
  echo "ERROR: symbol tools $HIT/$MIN_SYMBOL_TOOLS —— 工具面不达标" >&2
  printf '%s\n' "$TOOLS" | sed 's/^/    /' >&2
  exit 1
fi
printf '%s\n' "$TOOLS" | grep -qx -- "$DIAG_TOOL" || { echo "ERROR: no diagnostics tool（缺 $DIAG_TOOL）" >&2; exit 1; }

# 写 config.json（--check 模式也写：让端点事实始终有落点；机器本地文件，不入库）
write_config "$PORT" "sse"

echo "通道就绪：sse=http://127.0.0.1:${PORT}/sse  tools=$COUNT  symbol_tools=$HIT/$MIN_SYMBOL_TOOLS  diagnostics=$DIAG_TOOL"
echo "  config: $CONFIG"
