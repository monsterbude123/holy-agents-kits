#!/usr/bin/env bash
# audit-baseline.sh — 一次拿全「审查基线」，输出可直接分派的精确清单
#
# 用法:
#   scripts/audit-baseline.sh [projectPath] [batchSize=15] [--ext java] [--files-only <glob>]
#   scripts/audit-baseline.sh --whole          # 追加一次 scope=whole(全项目 global 工具)
#
# 输出:
#   [SUMMARY] byTool 计数 / main / test 计数
#   [MAIN] file:line | tool | desc     ← 按文件分组后即可切簇分派
#   [TEST] file:line | tool | desc
#
# 为什么有这条脚本(实战教训):
#   - problems 文本清单会被截断(summary.total 远大于返回行数) → 必须解析每批产出的 XML
#   - scope=files 的每一批都会跑批处理管线并产出 xmlDir → 分批即可拼出全量 global 项
#   - 手搓 curl / 反复单跑 ide_inspect 是最大的时间黑洞 → 这里一次跑完
#
# 降级: 当前插件没暴露 ide_inspect 时(上游 5.20.x 只有 16 个工具), 自动改走 ide_diagnostics
#       文件级检视 —— 输出格式不变, 但拿不到 P3C/阿里规范与 global 批处理项, 工具列=severity。
#
# 依赖: scripts/mcp-call.sh（统一出口，不要绕过它手搓 JSON-RPC）

set -u
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/d'; exit 0
fi
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT="${1:-$(pwd)}"
BATCH="${2:-15}"
EXT="java"
WHOLE=0
FILES_ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --whole) WHOLE=1; shift ;;
    --ext) EXT="$2"; shift 2 ;;
    --files-only) FILES_ONLY="$2"; shift 2 ;;
    *) shift ;;
  esac
done

cd "$PROJECT" || { echo "ERROR: not a directory: $PROJECT"; exit 1; }
PROJECT_WIN=$(cygpath -m "$PROJECT" 2>/dev/null || echo "$PROJECT")
TMP=$(mktemp -d)
# 清单必须留在可寻址的位置(tmp 会被清理), 用 node 可写的 Windows 形式
OUT_RAW="${OUT:-${TMPDIR:-/tmp}/idea-audit-baseline.txt}"
OUT=$(cygpath -m "$OUT_RAW" 2>/dev/null || echo "$OUT_RAW")

# ── 门禁: 进程 + 端点 + 索引就绪(不通过就别浪费几分钟跑检视) ───────────────
if ! tasklist 2>/dev/null | /usr/bin/grep -qi idea64; then
  echo "ERROR: IDEA 未运行(按 SKILL.md 环境门禁: 先启动再跑审查)"; exit 2
fi
if ! bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_index_status '{}' 20 | /usr/bin/grep -q '"isDumbMode":false'; then
  echo "ERROR: 索引未就绪或端点不可用(ide_index_status 非 isDumbMode:false)"; exit 2
fi

# ── 工具门禁: ide_inspect 在不在当前插件的工具面 ────────────────────────────
# 上游插件版(5.20.x)只暴露 16 个工具, 没有 ide_inspect → 整条流水线不可用。
# 判据 = server 当前的 tools/list(不是文档), 探测脚本: scripts/mcp-call.sh list index
MODE=inspect
bash "$SKILL_DIR/scripts/mcp-call.sh" has index ide_inspect >/dev/null 2>&1
RC=$?
if [ "$RC" = "1" ]; then
  MODE=diagnostics
  echo "[gate] 当前 idea-index 未暴露 ide_inspect → 降级: ide_diagnostics 文件级检视" >&2
  echo "[gate] ⚠️ 降级拿不到 P3C/阿里规范 与 global 批处理项(unused declaration 等), 工具列=severity" >&2
  if [ "$BATCH" -gt 100 ]; then
    echo "[gate] ide_diagnostics 单次最多 100 文件 → batch 夹到 100" >&2
    BATCH=100
  fi
elif [ "$RC" != "0" ]; then
  echo "ERROR: 工具面探测失败(tools/list 探不到, rc=$RC)"; exit 2
fi

# ── 文件清单 ────────────────────────────────────────────────────────────────
# --files-only <路径正则>: 只取匹配的路径（glob 用 shell 展开不了，按正则匹配相对路径）
if [ -n "$FILES_ONLY" ]; then
  # 走 git 取（快，且天然排除 node_modules 等忽略目录）；非 git 仓才 fallback find
  FILES=$({ git ls-files 2>/dev/null; git ls-files --others --exclude-standard 2>/dev/null; } | /usr/bin/grep -E "\.$EXT$" | /usr/bin/grep -E "$FILES_ONLY")
  [ -z "$FILES" ] && FILES=$(find . \( -name node_modules -o -name .next -o -name .git -o -name target -o -name dist -o -name out \) -prune -o -type f -name "*.$EXT" -print 2>/dev/null | sed 's|^\./||' | /usr/bin/grep -E "$FILES_ONLY")
else
  FILES=$(git ls-files 2>/dev/null | /usr/bin/grep -E "\.$EXT$")
  [ -z "$FILES" ] && FILES=$(find . \( -name node_modules -o -name .next -o -name .git -o -name target -o -name dist -o -name out \) -prune -o -type f -name "*.$EXT" -print 2>/dev/null | sed 's|^\./||')
fi
COUNT=$(printf '%s\n' "$FILES" | /usr/bin/grep -c . || true)
echo "[gate] IDEA 就绪 | 待检视文件 $COUNT 个 | batch=$BATCH" >&2

# ── 分批检视(每批: daemon-core 含 P3C + 批处理 global, 并产出 xmlDir) ────────
BATCH_NO=0
RAWS=""
printf '%s\n' "$FILES" | /usr/bin/grep . | while IFS= read -r f; do
  echo "$f"
done > "$TMP/files.txt"

split -l "$BATCH" "$TMP/files.txt" "$TMP/batch_" 2>/dev/null
for b in "$TMP"/batch_*; do
  [ -f "$b" ] || continue
  BATCH_NO=$((BATCH_NO+1))
  # ⚠️ MSYS 坑: node(Windows) 读不了 /tmp/... (会解析成 D:\tmp\...) → 路径必须 cygpath -m
  B_WIN=$(cygpath -m "$b")
  RAW="$TMP/raw_$BATCH_NO.txt"
  if [ "$MODE" = "inspect" ]; then
    ARGS=$(node -e "
      const fs=require('fs');
      const files=fs.readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
      console.log(JSON.stringify({scope:'files',engine:'full',min_severity:'all',files,project_path:process.argv[2]}));
    " "$B_WIN" "$PROJECT_WIN")
    bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_inspect "$ARGS" 590 > "$RAW" 2>/dev/null
  else
    # 降级: ide_diagnostics 文件级检视(单次最多 100 文件 → 批次夹到 100)
    ARGS=$(node -e "
      const fs=require('fs');
      const files=fs.readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean).slice(0,100);
      console.log(JSON.stringify({files,severity:'all',includeBuildErrors:true,maxProblems:500,project_path:process.argv[2]}));
    " "$B_WIN" "$PROJECT_WIN")
    bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_diagnostics "$ARGS" 590 > "$RAW" 2>/dev/null
  fi
  RAWS="$RAWS $RAW"
  RAW_WIN=$(cygpath -m "$RAW")
  # 每批都产 XML(xmlDir), 逐批合并目录 -> 全量 global 项(仅 inspect 模式)
  XMLD=$(node -e "
    const fs=require('fs');
    const t=fs.readFileSync(process.argv[1],'utf8').replace(/\r/g,'');
    for(const l of t.split('\n')){ if(l.trim().startsWith('{')){ try{const j=JSON.parse(l.trim()); if(j.xmlDir){console.log(j.xmlDir.replace('file:///',''));break;}}catch(e){} } }
  " "$RAW_WIN")
  if [ -n "$XMLD" ]; then
    XMLD_U=$(cygpath -u "$XMLD" 2>/dev/null || echo "$XMLD")
    if [ -d "$XMLD_U" ]; then
      mkdir -p "$TMP/xml/$BATCH_NO"
      cp "$XMLD_U"/*.xml "$TMP/xml/$BATCH_NO/" 2>/dev/null
    fi
  fi
  echo "[batch $BATCH_NO] done" >&2
done

# ── 可选: whole scope(全项目 global 工具一次跑完, 比拼批 XML 更稳) ──────────
if [ "$WHOLE" = "1" ] && [ "$MODE" = "diagnostics" ]; then
  echo "[gate] 降级模式忽略 --whole(global 批处理项在降级路径拿不到)" >&2
fi
if [ "$WHOLE" = "1" ] && [ "$MODE" = "inspect" ]; then
  ARGS=$(node -e "console.log(JSON.stringify({scope:'whole',engine:'full',min_severity:'all',project_path:process.argv[1]}))" "$PROJECT_WIN")
  RAW="$TMP/raw_whole.txt"
  bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_inspect "$ARGS" 590 > "$RAW" 2>/dev/null
  RAWS="$RAWS $RAW"
  RAW_WIN=$(cygpath -m "$RAW")
  XMLD=$(node -e "
    const fs=require('fs');
    const t=fs.readFileSync(process.argv[1],'utf8').replace(/\r/g,'');
    for(const l of t.split('\n')){ if(l.trim().startsWith('{')){ try{const j=JSON.parse(l.trim()); if(j.xmlDir){console.log(j.xmlDir.replace('file:///',''));break;}}catch(e){} } }
  " "$RAW_WIN")
  if [ -n "$XMLD" ]; then
    XMLD_U=$(cygpath -u "$XMLD" 2>/dev/null || echo "$XMLD")
    if [ -d "$XMLD_U" ]; then
      mkdir -p "$TMP/xml/whole"; cp "$XMLD_U"/*.xml "$TMP/xml/whole/" 2>/dev/null
    fi
  fi
fi

# ── 解析成归一化清单 ───────────────────────────────────────────────────────
# XML 目录逐批合并: 解析器按 <problem> 块扫内容, 与文件名无关, 直接拼接即可
MERGED_XML="$TMP/xml_merged"
mkdir -p "$MERGED_XML"
for d in "$TMP"/xml/*/; do
  [ -d "$d" ] || continue
  for f in "$d"/*.xml; do
    [ -f "$f" ] || continue
    cat "$f" >> "$MERGED_XML/merged.xml" 2>/dev/null
  done
done
MERGED_XML_WIN=$(cygpath -m "$MERGED_XML")

# raw 路径也要 Windows 形式(node 读)
RAW_ARGS=""
for r in $RAWS; do RAW_ARGS="$RAW_ARGS $(cygpath -m "$r")"; done

PARSER_WIN=$(cygpath -m "$SKILL_DIR/scripts/audit-parse.js" 2>/dev/null || echo "$SKILL_DIR/scripts/audit-parse.js")
node "$PARSER_WIN" --out "$OUT" $RAW_ARGS --xml-dir "$MERGED_XML_WIN" \
  2>/dev/null || node "$PARSER_WIN" $RAW_ARGS --xml-dir "$MERGED_XML_WIN"

echo "[done] 清单: $OUT_RAW" >&2
