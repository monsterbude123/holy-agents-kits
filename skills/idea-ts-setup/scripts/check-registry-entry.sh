#!/usr/bin/env bash
# Assert that an IDE-settings registry entry exists and is fully specified.
#
#   bash scripts/check-registry-entry.sh <id>
#
# references/idea-settings.json is the IDE-side half of the checklist: every
# entry must state WHERE the setting lives (path), WHAT state it must be in
# (expected), HOW to tell it worked (assertion), and where the claim comes
# from (source + quote). An entry missing any of those is not actionable.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
export SKILL_DIR

ID="${1:-}"
[ -n "$ID" ] || { echo "usage: check-registry-entry.sh <id>" >&2; exit 2; }

node -e '
  const fs=require("fs");
  const reg=JSON.parse(fs.readFileSync(process.env.SKILL_DIR+"/references/idea-settings.json","utf8"));
  const id=process.argv[1];
  const e=reg.find(x=>x&&x.id===id);
  if(!e){console.error("registry entry not found: "+id);process.exit(1);}
  for(const k of ["title","path","expected","assertion","source","quote"]){
    if(!e[k]||!String(e[k]).trim()){
      console.error("registry entry "+id+" is missing "+k);
      process.exit(1);
    }
  }
  if(!["any","ultimate"].includes(e.applies_to)){
    console.error("registry entry "+id+" has an invalid applies_to: "+e.applies_to);
    process.exit(1);
  }
' "$ID"
