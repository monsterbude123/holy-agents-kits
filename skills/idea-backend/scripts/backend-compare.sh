#!/usr/bin/env bash
# 语义后端同题对比台 —— 同一个符号、同一批问题，跑多个引擎，出可比表
#
#   bash scripts/backend-compare.sh <工程目录> --symbol <符号名> [--file <相对路径>] [--line N]
#                                 [--tsserver <tsserver.js>]
#
# 参与的引擎（缺哪个就跳过哪个，并写明原因）：
#   IDEA+Index MCP   —— 需要该工程已在 IDEA 里打开（位置法；与语言无关）
#   codegraph        —— 需要该工程已 `codegraph init`（IDE 无关的静态符号图）
#   tsserver         —— 只对 TS/JS 有效（VS Code 的 TS 引擎；需 --tsserver）
#
# 输出：每个引擎的「引用命中数 / 耗时 / 判据（resolvedSymbol.kind 等）」，
#       便于把「谁更准、谁更快」量化 —— 别凭感觉比。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT=""; SYMBOL=""; REL_FILE=""; LINE=0; TSSERVER=""
while [ $# -gt 0 ]; do
  case "$1" in
    --symbol) SYMBOL="${2:-}"; shift 2;;
    --file) REL_FILE="${2:-}"; shift 2;;
    --line) LINE="${2:-0}"; shift 2;;
    --tsserver) TSSERVER="${2:-}"; shift 2;;
    *) PROJECT="$1"; shift;;
  esac
done
[ -n "$PROJECT" ] || { echo "usage: backend-compare.sh <projectDir> --symbol <name> [--file <rel>] [--line N] [--tsserver <js>]" >&2; exit 2; }
[ -n "$SYMBOL" ] || { echo "ERROR: 必须给 --symbol" >&2; exit 2; }
PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd || echo "$PROJECT")"
PROJ_JSON="$(echo "$PROJECT" | sed 's#\\#/#g')"

echo "### 语义后端同题对比：$SYMBOL"
echo "工程：$PROJECT"
echo ""

printf '%-22s %-10s %-12s %-s\n' "引擎" "引用命中" "耗时" "判据 / 备注"
printf '%s\n' "----------------------------------------------------------------------"

# ---------- 1) IDEA + Index MCP（位置法）----------
idea_row() {
  local t0 t1 out kind n
  t0=$(date +%s%N)
  if [ "$LINE" -gt 0 ] && [ -n "$REL_FILE" ]; then
    out=$(bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_find_references \
      "{\"file\":\"$REL_FILE\",\"line\":$LINE,\"column\":8,\"project_path\":\"$PROJ_JSON\"}" 2>&1 | head -c 4000)
  else
    out=$(bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_find_class \
      "{\"query\":\"$SYMBOL\",\"project_path\":\"$PROJ_JSON\"}" 2>&1 | head -c 4000)
  fi
  t1=$(date +%s%N)
  local ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -o '"totalCount":[0-9]*' | head -1 | cut -d: -f2)
  kind=$(echo "$out" | grep -o '"kind":"[^"]*"' | head -1 | cut -d'"' -f4)
  if echo "$out" | grep -q '"classes"'; then
    n=$(echo "$out" | grep -o '"totalCount":[0-9]*' | head -1 | cut -d: -f2)
    kind=$(echo "$out" | grep -o '"kind":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi
  if [ -z "$n" ]; then
    printf '%-22s %-10s %-12s %s\n' "IDEA+Index MCP" "—" "${ms}ms" "未命中/未打开工程：$(echo "$out" | head -c 60)"
  else
    printf '%-22s %-10s %-12s %s\n' "IDEA+Index MCP" "${n}" "${ms}ms" "resolvedSymbol.kind=${kind:-n/a}"
  fi
}

# ---------- 2) codegraph ----------
codegraph_row() {
  [ -d "$PROJECT/.codegraph" ] || { printf '%-22s %-10s %-12s %s\n' "codegraph" "—" "—" "该工程未索引（codegraph init .）"; return; }
  command -v codegraph >/dev/null 2>&1 || { printf '%-22s %-10s %-12s %s\n' "codegraph" "—" "—" "未安装"; return; }
  local t0 t1 out n ms
  t0=$(date +%s%N)
  out=$(cd "$PROJECT" && codegraph impact "$SYMBOL" 2>&1 | head -c 4000)
  t1=$(date +%s%N)
  ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -oE '[0-9]+ affected symbols' | head -1 | grep -oE '^[0-9]+')
  printf '%-22s %-10s %-12s %s\n' "codegraph" "${n:-?}" "${ms}ms" "$(echo "$out" | grep -m1 'Impact of' | cut -c1-40)"
}

# ---------- 3) tsserver（VS Code 的 TS 引擎）----------
tsserver_row() {
  [ -n "$TSSERVER" ] || { printf '%-22s %-10s %-12s %s\n' "tsserver" "—" "—" "未给 --tsserver（VS Code 自带）"; return; }
  local t0 t1 out n ms
  t0=$(date +%s%N)
  out=$(node "$SKILL_DIR/scripts/tsserver-probe.js" "$PROJ_JSON" --symbol "$SYMBOL" --tsserver "$TSSERVER" ${REL_FILE:+--file "$REL_FILE"} ${LINE:+--line "$LINE"} 2>&1 | head -c 8000)
  t1=$(date +%s%N)
  ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -oE '命中: [0-9]+' | head -1 | grep -oE '[0-9]+')
  [ -z "$n" ] && n=$(echo "$out" | grep -oE '命中: [0-9]+' | tail -1 | grep -oE '[0-9]+')
  printf '%-22s %-10s %-12s %s\n' "tsserver" "${n:-?}" "${ms}ms（含启动）" "$(echo "$out" | grep -m1 'configFileName' | cut -c1-40)"
}

idea_row
codegraph_row
tsserver_row

echo ""
echo "注：各引擎的『引用』口径不同（IDEA=真代码引用；codegraph=受影响符号，含 import 边与成员；tsserver=引用位置），"
echo "    数字不可直接相减；要比就按同一口径重算。判据看 IDEA 的 resolvedSymbol.kind 是否为代码符号。"
