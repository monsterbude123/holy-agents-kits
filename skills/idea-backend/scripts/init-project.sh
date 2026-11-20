#!/usr/bin/env bash
# Wire a project of some language into IntelliJ IDEA from the shipped template.
#
#   bash scripts/init-project.sh <target-dir> [--lang <lang>] [--template <name>] [--name <pkg-name>] [--no-install]
#
# Copies a language profile's template into the target (never overwriting existing
# files unless --force), renames the IDEA module to the project name, and optionally
# installs the toolchain.
#
#   --lang ts      → templates/ts-project (default), templates/ts-web
#   --lang python  → templates/py-project
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v cygpath >/dev/null 2>&1; then SKILL_DIR="$(cygpath -m "$SKILL_DIR")"; fi
LANG="ts"; TPL_NAME=""; TEMPLATE=""

TARGET=""; NAME=""; INSTALL=1; FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --lang) LANG="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --template) TPL_NAME="${2:-}"; TEMPLATE="$SKILL_DIR/templates/${2:-}"; shift 2 ;;
    --no-install) INSTALL=0; shift ;;
    --force) FORCE=1; shift ;;
    *) TARGET="$1"; shift ;;
  esac
done
[ -n "$TPL_NAME" ] || TPL_NAME="$(node -e '
  const fs=require("fs");
  const p=process.argv[1];
  try{
    const prof=JSON.parse(fs.readFileSync(p,"utf8"));
    const t=(prof.templates||[])[0];
    if(t) process.stdout.write(t);
  }catch(e){}
' "$SKILL_DIR/references/langs/$LANG/profile.json" 2>/dev/null)"
[ -n "$TPL_NAME" ] || TPL_NAME="$LANG-project"
[ -n "$TEMPLATE" ] || TEMPLATE="$SKILL_DIR/templates/$TPL_NAME"

[ -n "$TARGET" ] || { echo "usage: init-project.sh <target-dir> [--lang <lang>] [--template <name>] [--name <pkg>] [--no-install] [--force]" >&2; exit 1; }
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
  case "$rel" in
    node_modules/*|dist/*|coverage/*|.venv/*|venv/*|__pycache__/*|*.egg-info/*|.mypy_cache/*|.ruff_cache/*|.pytest_cache/*|*.pyc) continue ;;
  esac
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

# ---- package.json name (JS/TS 分册) / pyproject name (Python 分册） -------
if [ -f "$TARGET/package.json" ]; then
  node -e '
    const fs=require("fs");
    const p=process.argv[1];
    const j=JSON.parse(fs.readFileSync(p,"utf8"));
    j.name=process.argv[2];
    fs.writeFileSync(p, JSON.stringify(j,null,2)+"\n");
  ' "$TARGET/package.json" "$NAME"
fi
if [ -f "$TARGET/pyproject.toml" ]; then
  python - "$TARGET/pyproject.toml" "$NAME" <<'PY'
import re, sys
path, name = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read()
if re.search(r'^name\s*=', text, flags=re.M):
    text = re.sub(r'^name\s*=.*$', f'name = "{name}"', text, count=1, flags=re.M)
else:
    text = f'name = "{name}"\n' + text
open(path, "w", encoding="utf-8").write(text)
PY
fi

# ---- toolchain ------------------------------------------------------------
if [ "$INSTALL" -eq 1 ]; then
  echo "installing toolchain in $TARGET ..."
  if [ -f "$TARGET/package.json" ]; then
    (cd "$TARGET" && npm install --no-fund --no-audit) || {
      echo "npm install failed — fix it, then re-run: (cd \"$TARGET\" && npm install)" >&2
      exit 1
    }
  elif [ -f "$TARGET/pyproject.toml" ]; then
    if command -v uv >/dev/null 2>&1; then
      (cd "$TARGET" && uv sync --no-progress) || {
        echo "uv sync failed — fix it, then re-run: (cd \"$TARGET\" && uv sync)" >&2
        exit 1
      }
    else
      (cd "$TARGET" && python -m pip install --quiet -e ".[dev]") || {
        echo "pip install failed — fix it, then re-run: (cd \"$TARGET\" && python -m pip install -e \".[dev]\")" >&2
        exit 1
      }
    fi
  else
    echo "no package manifest in the template — skipped toolchain install"
  fi
else
  echo "skipped toolchain install (--no-install)"
fi

echo
echo "Next: run  bash scripts/verify-item.sh --lang $LANG --all  from the skill dir, then follow"
if [ -f "$SKILL_DIR/references/langs/$LANG/setup.md" ]; then
  echo "references/langs/$LANG/setup.md for the setup steps."
else
  echo "references/langs/$LANG/setup-0to1.md for the setup steps."
fi
