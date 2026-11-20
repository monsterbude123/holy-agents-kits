#!/usr/bin/env bash
# Run the `verify` command of a language profile's checklist items — the skill's own self-proof.
#
#   bash scripts/verify-item.sh <id>                 # one item (language auto-detected)
#   bash scripts/verify-item.sh --all                # every item of that language
#   bash scripts/verify-item.sh --lang python --all  # pick the language profile
#
# Every item in references/langs/<lang>/checklist.json carries a `verify` command
# that is executed for real (with $SKILL_DIR pointing at this skill) and must exit 0.
# An item whose command fails is NOT configured.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# Mixed (forward-slash, drive-qualified) form: readable by bash AND by node.
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
export SKILL_DIR

LANGS_DIR="$SKILL_DIR/references/langs"

lang_of() { # --lang wins, else the only profile that ships a checklist
  if [ -n "$1" ]; then echo "$1"; return; fi
  local found=""
  for d in "$LANGS_DIR"/*/; do
    [ -f "$d/checklist.json" ] || continue
    if [ -n "$found" ]; then echo ""; return; fi   # 多个分册都有清单 → 必须显式 --lang
    found="$(basename "$d")"
  done
  echo "$found"
}

ARGS=(); LANG=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG="${2:-}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
LANG="$(lang_of "$LANG")"
[ -n "$LANG" ] || { echo "ERROR: 不能确定语言分册，请显式指定 --lang <lang>（可选: $(ls "$LANGS_DIR" 2>/dev/null | tr '\n' ' ')）" >&2; exit 2; }
CHECKLIST="$LANGS_DIR/$LANG/checklist.json"

[ -f "$CHECKLIST" ] || { echo "missing $CHECKLIST (lang=$LANG)" >&2; exit 2; }

ids_of() {
  node -e '
    const fs=require("fs");
    const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    for(const it of items){ if(it && it.id) console.log(it.id); }
  ' "$CHECKLIST"
}

verify_of() {
  node -e '
    const fs=require("fs");
    const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const it=items.find(x=>x && x.id===process.argv[2]);
    if(!it){console.error("no such checklist item: "+process.argv[2]);process.exit(2);}
    process.stdout.write(it.verify||"");
  ' "$CHECKLIST" "$1"
}

run_one() {
  local id="$1" cmd
  cmd="$(verify_of "$id")" || return 2
  local out rc
  out="$(bash -c "$cmd" 2>&1)"
  rc=$?
  if [ "$rc" -eq 0 ]; then
    printf 'PASS  %s\n' "$id"
  else
    printf 'FAIL  %s (exit %d)\n' "$id" "$rc"
    [ -n "$out" ] && printf '%s\n' "$out" | sed 's/^/        /'
  fi
  return "$rc"
}

case "${ARGS[0]:---all}" in
  --all|"")
    pass=0; fail=0
    while IFS= read -r id; do
      [ -z "$id" ] && continue
      if run_one "$id"; then pass=$((pass+1)); else fail=$((fail+1)); fi
    done < <(ids_of)
    echo "----"
    echo "passed: $pass   failed: $fail   (lang=$LANG)"
    [ "$fail" -eq 0 ]
    ;;
  *)
    run_one "${ARGS[0]}"
    ;;
esac
