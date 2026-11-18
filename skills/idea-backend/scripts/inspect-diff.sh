#!/usr/bin/env bash
# ONE-SHOT gate: inspect the current git working set (diff + untracked) via ide_inspect.
# Usage:
#   scripts/inspect-diff.sh [--all] [projectPath] [engine=full] [timeoutSec]
# Default: code files only (docs/spell-check noise is not a gate signal); --all inspects everything.
# Default project = cwd (must be the git repo); falls back to config commonProject.
# Output: daemon-core local findings (incl. P3C) + batch global tools. Exits non-zero on failure.
# Agents: run THIS instead of hand-assembling file lists or JSON-RPC calls.

set -u
if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "${1:-}" = "help" ]; then
  sed -n '2,/^[^#]/p' "$0" | sed 's/^# \{0,1\}//' | sed '/^$/d'; exit 0
fi
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODE_RE='\.(java|kt|kts|xml|yml|yaml|properties|sql|gradle)$'
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

exec bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_inspect "$ARGS" "$TIMEOUT"
