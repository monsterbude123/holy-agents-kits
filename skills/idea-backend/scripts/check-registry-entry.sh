#!/usr/bin/env bash
# Assert that an IDE-settings registry entry exists and is fully specified.
#
#   bash scripts/check-registry-entry.sh <id> [--lang <lang>]
#
# references/langs/<lang>/idea-settings.json is the IDE-side half of a language
# profile's checklist: every entry must state WHERE the setting lives (path),
# WHAT state it must be in (expected), HOW to tell it worked (assertion), and
# where the claim comes from (source + quote). An entry missing any of those is
# not actionable.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
export SKILL_DIR

LANGS_DIR="$SKILL_DIR/references/langs"

ID=""; LANG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG="${2:-}"; shift 2 ;;
    *) ID="$1"; shift ;;
  esac
done
[ -n "$ID" ] || { echo "usage: check-registry-entry.sh <id> [--lang <lang>]" >&2; exit 2; }
# 定位分册：--lang 优先；否则按 id 在各分册的 idea-settings.json 里找（id 全局唯一）
if [ -z "$LANG" ]; then
  for d in "$LANGS_DIR"/*/; do
    [ -f "$d/idea-settings.json" ] || continue
    if node -e '
      const fs=require("fs");
      const id=process.argv[2];
      try{
        const reg=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
        process.exit(reg.some(x=>x&&x.id===id)?0:1);
      }catch(e){process.exit(1)}
    ' "$d/idea-settings.json" "$ID" 2>/dev/null; then
      if [ -n "$LANG" ]; then LANG=""; break; fi
      LANG="$(basename "$d")"
    fi
  done
fi
[ -n "$LANG" ] || { echo "ERROR: 找不到 id=$ID 的设置条目，或它在多个分册里重复 → 请显式指定 --lang <lang>" >&2; exit 2; }
export LANG

node -e '
  const fs=require("fs");
  const reg=JSON.parse(fs.readFileSync(process.env.SKILL_DIR+"/references/langs/"+process.env.LANG+"/idea-settings.json","utf8"));
  const id=process.argv[1];
  const e=reg.find(x=>x&&x.id===id);
  if(!e){console.error("registry entry not found: "+id);process.exit(1);}
  for(const k of ["title","path","expected","assertion","source","quote"]){
    if(!e[k]||!String(e[k]).trim()){
      console.error("registry entry "+id+" is missing "+k);
      process.exit(1);
    }
  }
  if(!["any","ultimate"].includes(e.edition)){
    console.error("registry entry "+id+" has an invalid edition: "+e.edition);
    process.exit(1);
  }
' "$ID"
