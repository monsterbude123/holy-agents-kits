#!/usr/bin/env bash
# ONE-SHOT gate: inspect the current git working set (diff + untracked) via ide_inspect.
# Usage:
#   scripts/inspect-diff.sh [--all] [projectPath] [engine=full] [timeoutSec]
# Default: code files only (docs/spell-check noise is not a gate signal); --all inspects everything.
# Default project = cwd (must be the git repo); falls back to config commonProject.
# Output: daemon-core local findings (incl. P3C) + batch global tools. Exits non-zero on failure.
# 降级: 当前插件没暴露 ide_inspect 时(上游 5.20.x 只有 16 个工具), 自动改走 ide_diagnostics
#       文件级检视 —— 格式不变, 但拿不到 P3C/阿里规范与 global 批处理项, 工具列=severity。
# Agents: run THIS instead of hand-assembling file lists or JSON-RPC calls.

set -u
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/d'; exit 0
fi
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_RE='\.(java|kt|kts|xml|yml|yaml|properties|sql|gradle|ts|tsx|js|jsx|mjs|cjs|vue|svelte)$'
if [ "${1:-}" = "--all" ]; then shift; CODE_RE='.'; fi
PROJECT="${1:-$(pwd)}"
ENGINE="${2:-full}"
TIMEOUT="${3:-590}"

cd "$PROJECT" || { echo "ERROR: not a directory: $PROJECT"; exit 1; }
# IDE needs a Windows-style path; convert MSYS /d/... → D:/...
PROJECT=$(cygpath -m "$PROJECT" 2>/dev/null || echo "$PROJECT")

# working set = unstaged+staged vs HEAD, plus untracked (agent-authored new files)
FILES=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null \
  | sort -u | /usr/bin/grep -E "$CODE_RE" | while IFS= read -r f; do [ -f "$f" ] && echo "$f"; done )

COUNT=$(echo "$FILES" | /usr/bin/grep -c . 2>/dev/null || true)
if [ "${COUNT:-0}" = "0" ] || [ -z "$FILES" ]; then
  echo '{"gate":"clean","message":"no uncommitted changes — nothing to inspect"}'
  exit 0
fi

ARGS=$(node -e "
const fs=require('fs');
const files=process.argv[1].split('\n').filter(Boolean);
const cfgPath='$SKILL_DIR/config.json';
let pp='$PROJECT';
try{const c=JSON.parse(fs.readFileSync(cfgPath,'utf8'));if(c.idea&&c.idea.commonProject)pp=c.idea.commonProject;}catch(e){}
if(process.argv[2])pp=process.argv[2];
pp=pp.replace(/\\\\/g,'/');
console.log(JSON.stringify({scope:'files',engine:'$ENGINE',min_severity:'all',files:files,project_path:pp}));
" "$FILES" "$PROJECT")

# ── 工具门禁: ide_inspect 不在当前工具面 → 降级 ide_diagnostics ─────────────
MODE=inspect
bash "$SKILL_DIR/scripts/mcp-call.sh" has index ide_inspect >/dev/null 2>&1
RC=$?
if [ "$RC" = "1" ]; then
  MODE=diagnostics
  echo "[gate] ide_inspect 不可用 → 降级 ide_diagnostics 文件级检视(无 P3C)" >&2
elif [ "$RC" != "0" ]; then
  echo "ERROR: 工具面探测失败(tools/list 探不到, rc=$RC)"; exit 2
fi

if [ "$MODE" = "inspect" ]; then
  exec bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_inspect "$ARGS" "$TIMEOUT"
fi

# ide_diagnostics 单次最多 100 文件 → 分批（别静默丢掉第 101 个之后的文件）
TMPD=$(mktemp -d)
printf '%s\n' "$FILES" | /usr/bin/grep . > "$TMPD/files.txt" 2>/dev/null || true
split -l 100 "$TMPD/files.txt" "$TMPD/chunk_" 2>/dev/null
RAWS=""
NO=0
for c in "$TMPD"/chunk_*; do
  [ -f "$c" ] || continue
  NO=$((NO+1))
  C_WIN=$(cygpath -m "$c" 2>/dev/null || echo "$c")
  CH_ARGS=$(node -e "
const fs=require('fs');
const files=fs.readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean);
const cfgPath='$SKILL_DIR/config.json';
let pp='$PROJECT';
try{const c2=JSON.parse(fs.readFileSync(cfgPath,'utf8'));if(c2.idea&&c2.idea.commonProject)pp=c2.idea.commonProject;}catch(e){}
if(process.argv[2])pp=process.argv[2];
pp=pp.replace(/\\\\/g,'/');
console.log(JSON.stringify({files,severity:'all',includeBuildErrors:true,maxProblems:500,project_path:pp}));
" "$C_WIN" "$PROJECT")
  RAW="$TMPD/raw_$NO.txt"
  bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_diagnostics "$CH_ARGS" "$TIMEOUT" > "$RAW"
  RC=$?
  if [ "$RC" != "0" ]; then echo "ERROR: ide_diagnostics 调用失败(rc=$RC, 第 $NO 批)"; cat "$RAW"; exit "$RC"; fi
  RAWS="$RAWS $(cygpath -m "$RAW" 2>/dev/null || echo "$RAW")"
done
PARSER_WIN=$(cygpath -m "$SKILL_DIR/scripts/audit-parse.js" 2>/dev/null || echo "$SKILL_DIR/scripts/audit-parse.js")
node "$PARSER_WIN" $RAWS
