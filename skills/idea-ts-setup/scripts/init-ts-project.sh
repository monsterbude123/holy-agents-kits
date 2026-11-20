#!/usr/bin/env bash
# Wire a TypeScript project into IntelliJ IDEA from the shipped template.
#
#   bash scripts/init-ts-project.sh <target-dir> [--template ts-project|ts-web] [--name <pkg-name>] [--no-install]
#
# Copies a template into the target (never overwriting existing files unless
# --force), renames the IDEA module to the project name, and optionally installs
# the toolchain.
#
#   ts-project  Node ESM service, built by tsc (nodenext + dist/ + sourcemap)
#   ts-web      bundler-driven frontend (Vite + React + TS, preserve + noEmit + paths)
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
TPL_NAME="ts-project"
TEMPLATE="$SKILL_DIR/templates/$TPL_NAME"

TARGET=""; NAME=""; INSTALL=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --name) NAME="${2:-}"; shift 2 ;;
    --template) TPL_NAME="${2:-}"; TEMPLATE="$SKILL_DIR/templates/${2:-}"; shift 2 ;;
    --no-install) INSTALL=0; shift ;;
    --force) FORCE=1; shift ;;
    *) TARGET="$1"; shift ;;
  esac
done

[ -n "$TARGET" ] || { echo "usage: init-ts-project.sh <target-dir> [--template ts-project|ts-web] [--name <pkg>] [--no-install] [--force]" >&2; exit 1; }
[ -d "$TEMPLATE" ] || { echo "missing template: $TEMPLATE" >&2; exit 1; }
mkdir -p "$TARGET" || exit 1
TARGET="$(cd "$TARGET" && pwd)"
if command -v cygpath >/dev/null 2>&1; then TARGET="$(cygpath -m "$TARGET")"; fi
[ -n "$NAME" ] || NAME="$(basename "$TARGET")"

# ---- copy template (files only; never clobber unless --force) -------------
# Files only: copying directories would nest (.idea/.idea) when the target
# already has one, and would mark the template's own children as "existing".
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
  cp "$src" "$dst"
  copied=$((copied+1))
done < <(find "$TEMPLATE" -type f -print0)
echo "copied $copied file(s), skipped $skipped existing"

# ---- rename the IDEA module to the project name ---------------------------
for iml in "$TARGET/.idea"/*.iml; do
  [ -e "$iml" ] || continue
  [ "$(basename "$iml")" = "$NAME.iml" ] && continue
  mv "$iml" "$TARGET/.idea/$NAME.iml"
done
if [ -f "$TARGET/.idea/modules.xml" ]; then
  # both the fileurl="file://$PROJECT_DIR$/.idea/x.iml" and the
  # filepath="$PROJECT_DIR$/.idea/x.iml" attributes must be rewritten
  sed -i "s#\.idea/[A-Za-z0-9._-]*\.iml#.idea/$NAME.iml#g" "$TARGET/.idea/modules.xml"
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
