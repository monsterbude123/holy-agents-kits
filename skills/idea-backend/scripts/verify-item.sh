#!/usr/bin/env bash
# Run the `verify` command of a language profile's checklist items — the skill's own self-proof.
#
#   bash scripts/verify-item.sh <id>                 # one item (language auto-detected)
#   bash scripts/verify-item.sh --all                # every item of that language
#   bash scripts/verify-item.sh --lang python --all  # pick the language profile
#   bash scripts/verify-item.sh --lang java --all --dir <project>   # check a REAL project
#
# Every item in references/langs/<lang>/checklist.json carries a `verify` command
# that is executed for real (with $SKILL_DIR pointing at this skill) and must exit 0.
# An item whose command fails is NOT configured.
#
# **被检工程 = 工作目录**：分册的 verify 以当前目录为被检工程（相对路径读 pom.xml /
# .idea/…）。技能自证时默认切到该分册的模板目录（profile.json 的 templates[0]）；
# 要拿真实工程跑，用 --dir <工程目录>。
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

ARGS=(); LANG=""; TARGET_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG="${2:-}"; shift 2 ;;
    --dir) TARGET_DIR="${2:-}"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
LANG="$(lang_of "$LANG")"
[ -n "$LANG" ] || { echo "ERROR: 不能确定语言分册，请显式指定 --lang <lang>（可选: $(ls "$LANGS_DIR" 2>/dev/null | tr '\n' ' ')）" >&2; exit 2; }
CHECKLIST="$LANGS_DIR/$LANG/checklist.json"

[ -f "$CHECKLIST" ] || { echo "missing $CHECKLIST (lang=$LANG)" >&2; exit 2; }

# 被检工程：--dir 指定的真实工程，或该分册的模板（profile.json 的 templates[0]）
if [ -z "$TARGET_DIR" ]; then
  TARGET_DIR="$(node -e '
    const fs=require("fs");
    try{
      const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const t=(p.templates||[])[0];
      if(t) process.stdout.write(process.argv[2]+"/templates/"+t);
    }catch(e){}
  ' "$LANGS_DIR/$LANG/profile.json" "$SKILL_DIR")"
fi
if [ -n "$TARGET_DIR" ] && [ -d "$TARGET_DIR" ]; then
  cd "$TARGET_DIR" || exit 2
else
  echo "ERROR: 被检目录不存在: ${TARGET_DIR:-（分册模板未声明 templates）}" >&2
  exit 2
fi

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

# 某条目要求「工程已经是 IDEA 工程」（.idea/ 由 IDEA 生成）→ 工程还没开过时判 SKIP 而非 FAIL
needs_idea_project() {
  node -e '
    const fs=require("fs");
    const items=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const it=items.find(x=>x && x.id===process.argv[2]);
    process.stdout.write(it && it.requiresIdeaProject ? "yes" : "no");
  ' "$CHECKLIST" "$1"
}

run_one() {
  local id="$1" cmd
  cmd="$(verify_of "$id")" || return 2
  if [ "$(needs_idea_project "$id")" = "yes" ] && [ ! -d .idea ]; then
    printf 'SKIP  %s  (工程还没在 IDEA 里开过：.idea/ 由 IDEA 生成后才存在)
' "$id"
    return 3
  fi
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
    pass=0; fail=0; skip=0
    while IFS= read -r id; do
      [ -z "$id" ] && continue
      run_one "$id"; rc=$?
      case "$rc" in
        0) pass=$((pass+1)) ;;
        3) skip=$((skip+1)) ;;
        *) fail=$((fail+1)) ;;
      esac
    done < <(ids_of)
    echo "----"
    echo "passed: $pass   failed: $fail   skipped: $skip   (lang=$LANG)"
    [ "$fail" -eq 0 ]
    ;;
  *)
    run_one "${ARGS[0]}"
    ;;
esac
