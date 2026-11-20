#!/usr/bin/env bash
# Wire a TypeScript project into IntelliJ IDEA from the shipped template.
#
#   bash scripts/init-ts-project.sh <target-dir> [--name <pkg-name>] [--no-install]
#
# Copies templates/ts-project/ into the target (never overwriting existing
# files unless --force), renames the IDEA module to the project name, and
# optionally installs the toolchain.
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
TEMPLATE="$SKILL_DIR/templates/ts-project"

TARGET=""; NAME=""; INSTALL=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --no-install) INSTALL=0; shift ;;
    --force) FORCE=1; shift ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || { echo "usage: init-ts-project.sh <target-dir> [--name <pkg>] [--no-install] [--force]" >&2; exit 1; }
[ -d "$TEMPLATE" ] || { echo "missing template: $TEMPLATE" >&2; exit 1; }
mkdir -p "$TARGET" || exit 1
TARGET="$(cd "$TARGET" && pwd)"
if command -v cygpath >/dev/null 2>&1; then TARGET="$(cygpath -m "$TARGET")"; fi
[ -n "$NAME" ] || NAME="$(basename "$TARGET")"

# ---- copy template (never clobber unless --force) -------------------------
copied=0; skipped=0
while IFS= read -r -d '' src; do
  rel="${src#$TEMPLATE/}"
  case "$rel" in node_modules/*|dist/*|coverage/*) continue ;; esac
  dst="$TARGET/$rel"
  mkdir -p "$(dirname "$dst")"
  if [ -e "$dst" ] && [ "$FORCE" -eq 0 ]; then
    skipped=$((skipped+1))
    continue
  fi
  cp -R "$src" "$dst"
  copied=$((copied+1))
done < <(find "$TEMPLATE" -mindepth 1 -print0)
echo "copied $copied file(s), skipped $skipped existing"

# ---- rename the IDEA module to the project name ---------------------------
if [ -f "$TARGET/.idea/ts-project.iml" ]; then
  mv "$TARGET/.idea/ts-project.iml" "$TARGET/.idea/$NAME.iml"
fi
if [ -f "$TARGET/.idea/modules.xml" ]; then
  sed -i "s/ts-project\.iml/$NAME.iml/g" "$TARGET/.idea/modules.xml"
fi

# ---- package.json name + .nvmrc -------------------------------------------
if [ -f "$TARGET/package.json" ]; then
  node -e '
    const fs=require("fs");
    const p=process.argv[1];
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    j.name=process.argv[2];
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
  ' "$TARGET/package.json" "$NAME"
fi

# ---- toolchain ------------------------------------------------------------
if [ "$INSTALL" -eq 1 ]; then
  echo "installing toolchain in $TARGET ..."
  (cd "$TARGET" && npm install --no-fund --no-audit) || {
    echo "npm install failed — fix it, then re-run: (cd \"$TARGET\" && npm install)" >&2
    exit 1
  }
else
  echo "skipped npm install (--no-install)"
fi

echo
echo "Next: run  bash scripts/verify-item.sh --all  from the skill dir, then follow"
echo "references/setup-0to1.md for the IDE-side steps (Node runtime, TS service, ESLint, Prettier)."
