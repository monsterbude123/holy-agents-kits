#!/usr/bin/env bash
# 装 / 校验 VS Code 侧的 MCP 通道（BifrostMCP 扩展）
#
#   bash scripts/install-vscode-mcp.sh [--check] [<工作区路径>]
#
# --check   **只校验不改动**（扩展在不在 / 端点通不通；不写任何文件）
# 默认      装扩展 → 起 VS Code → 解析端口 → 写 config.json → 按 config 生成/合并工作区 .mcp.json
#            （安装模式**必须给工作区路径**：没有工作区就没有 .mcp.json 的落点，端点事实也会多出第二处）
#
# **只做缺口那部分**：装 + 起 + 把端点事实落成机器本地配置 + 翻译成宿主的 .mcp.json。
# **不实现 MCP 协议**（不握手、不自己发工具列表请求）—— 调用与工具面核对走平台原生 MCP 通道
# （.mcp.json → 宿主自带 MCP 客户端），本脚本不重复造那一层。
#
# 端点事实只有一处来源：机器本地 config.json（skills/*/config.json，仓内 .gitignore 覆盖，不入库）。
# 端口的**来源**是工作区的 bifrost.config.json（扩展自己读的那份），缺省 8008。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
EXT_ID="connorhallman.bifrost-mcp"

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

# --- 端点存活（SSE 端点会一直挂着连接 ⇒ curl 超时是正常的，看状态码即可）------------
endpoint_alive() { # <port>
  local code
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$1/sse" 2>/dev/null)"
  [ "$code" = "200" ]
}

# --- 写机器本地 config.json（端点事实的唯一落点）--------------------------------------
write_config() { # <port> <transport>
  mkdir -p "$(dirname "$CONFIG")"
  node -e "
    const fs=require('fs'),path=require('path');
    const file=process.argv[1], port=Number(process.argv[2]), transport=process.argv[3];
    let j={};
    try{ j=JSON.parse(fs.readFileSync(file,'utf8')); }catch(e){}
    j._comment='机器本地运行时配置（不入库、不分发；.gitignore 的 skills/*/config.json 覆盖）。端口来源：工作区 bifrost.config.json，缺省 8008；url 由本文件拼出，.mcp.json 由它生成 —— 端点只有这一处事实源。';
    j.vscode={port, transport, extension:'connorhallman.bifrost-mcp', url:'http://127.0.0.1:'+port+'/sse'};
    fs.writeFileSync(file, JSON.stringify(j,null,2)+'\n');
  " "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")" "$1" "$2"
}

# --- 按 config.json 生成/合并工作区 .mcp.json（宿主原生 MCP 通道的落点）----------------
write_mcp_json() { # <workspace>
  local ws="$1"
  [ -n "$ws" ] || return 0
  node -e "
    const fs=require('fs'),path=require('path');
    const ws=process.argv[1], cfg=process.argv[2];
    const j=JSON.parse(fs.readFileSync(cfg,'utf8'));
    const v=j.vscode||{};
    if(!v.url){ console.error('config.json 里没有 vscode.url'); process.exit(1); }
    const f=path.join(ws,'.mcp.json');
    let doc={};
    try{ doc=JSON.parse(fs.readFileSync(f,'utf8')); }catch(e){ doc={}; }
    doc.mcpServers=doc.mcpServers||{};
    doc.mcpServers.vscode={type:'sse', url:v.url, timeoutMs:60000};
    fs.writeFileSync(f, JSON.stringify(doc,null,2)+'\n');
    // 机器本地文件：写进 .git/info/exclude（不动 .gitignore —— 那是仓内规则）
    try{
      const ex=path.join(ws,'.git','info','exclude');
      if(fs.existsSync(path.dirname(ex))){
        const cur=fs.existsSync(ex)?fs.readFileSync(ex,'utf8'):'';
        if(!cur.includes('.mcp.json')) fs.appendFileSync(ex,(cur===''||cur.endsWith('\n')?'':'\n')+'.mcp.json\n');
      }
    }catch(e){}
    console.log(f);
  " "$(cygpath -m "$ws" 2>/dev/null || echo "$ws")" "$(cygpath -m "$CONFIG" 2>/dev/null || echo "$CONFIG")"
}

if [ "$MODE" = "install" ] && [ -z "$WORKSPACE" ]; then
  fail "安装模式要给工作区路径（.mcp.json 写在那里）：bash scripts/install-vscode-mcp.sh <工作区路径>"
fi

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
  if ! endpoint_alive "$PORT"; then
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
endpoint_alive "$PORT" || fail "端点不通（http://127.0.0.1:$PORT/sse 无响应）—— VS Code 窗口开着没？扩展服务在跑没？"

if [ "$MODE" = "check" ]; then
  echo "通道就绪：sse=http://127.0.0.1:${PORT}/sse（--check 不写任何文件）"
  echo "  工具面核对走原生 MCP 通道（会话里 list 一次工具）—— 判定规则见 references/setup.md 的事实块"
  exit 0
fi

# 写 config.json（机器本地文件，不入库）—— 端点事实的唯一落点
write_config "$PORT" "sse"

echo "通道就绪：sse=http://127.0.0.1:${PORT}/sse"
echo "  config: $CONFIG"
OUT="$(write_mcp_json "$WORKSPACE")" || fail "写 .mcp.json 失败"
echo "  mcp.json: $OUT（机器本地，已加进 .git/info/exclude）"
echo "  工具面核对走原生 MCP 通道（会话里 list 一次工具）—— 判定规则见 references/setup.md 的事实块"
