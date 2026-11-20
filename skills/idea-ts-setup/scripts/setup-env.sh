#!/usr/bin/env bash
# idea-ts-setup: detect the TypeScript toolchain + this machine's IDEA edition,
# and write the machine-local config.json.
#
#   setup-env.sh roots                 # list areas to ask the user about
#   setup-env.sh detect [area]         # probe an approved area for IDEA
#   setup-env.sh init <installRoot>    # write config.json from a confirmed root
#   setup-env.sh check                 # report the current facts (no write)
#   setup-env.sh probe <installRoot>   # print facts for a root, no write
#
# Machine facts live in config.json; this script and SKILL.md never hard-code
# a machine path. config.json is machine-local and is NOT distributed (the
# repo .gitignore already excludes skills/*/config.json).
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"

have_cygpath() { command -v cygpath >/dev/null 2>&1; }
to_msys() { if have_cygpath; then cygpath -u "$1" 2>/dev/null || echo "$1"; else echo "$1"; fi; }
to_mixed() { if have_cygpath; then cygpath -m "$1" 2>/dev/null || echo "${1//\\//}"; else echo "${1//\\//}"; fi; }

platform_id() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "mac" ;;
    *) echo "windows" ;;
  esac
}

exe_name() { case "$(uname -s)" in Linux*|Darwin*) echo "idea.sh" ;; *) echo "idea64.exe" ;; esac; }

SUGGESTED_AREAS_WIN=(
  "D:/workplace" "C:/Program Files/JetBrains" "$HOME/AppData/Local/JetBrains"
  "$HOME/AppData/Local/Programs"
)
SUGGESTED_AREAS_LINUX=(
  "/opt" "/usr/local" "$HOME/.local/share/JetBrains/Toolbox/apps" "$HOME/Applications"
)

roots() {
  echo "Suggested areas to ask the user about (do NOT scan without user consent):"
  if [ "$(platform_id)" = "windows" ]; then
    printf '  %s\n' "${SUGGESTED_AREAS_WIN[@]}"
  else
    printf '  %s\n' "${SUGGESTED_AREAS_LINUX[@]}"
  fi
  echo "Then run: setup-env.sh detect <that-area>"
}

# ---- facts ---------------------------------------------------------------
# json_field <file> <key>  -> value (node if available, else grep)
json_field() {
  local file="$1" key="$2"
  [ -f "$file" ] || return 1
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs=require("fs");
      try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
      const v=j[process.argv[2]];if(v!=null)process.stdout.write(String(v));}catch(e){}
    ' "$file" "$key" 2>/dev/null
  else
    grep -oE "\"$key\"\s*:\s*\"[^\"]*\"" "$file" 2>/dev/null | head -1 | sed -E "s/.*:\s*\"([^\"]*)\".*/\1/"
  fi
}

# edition: productCode IC=Community IU=Ultimate WS=WebStorm
edition_of_code() {
  case "$1" in
    IC) echo "community" ;;
    IU) echo "ultimate" ;;
    WS) echo "webstorm" ;;
    *) echo "unknown" ;;
  esac
}

# Native TS support = the bundled JavaScript/TypeScript plugin stack is present.
# Community (IC) ships without it; Ultimate (IU) and WebStorm (WS) ship it.
ts_plugins_state() {
  local root="$1"
  local found="absent"
  if [ -d "$root/plugins" ]; then
    if ls "$root/plugins" 2>/dev/null | grep -qiE 'javascript-(impl|frontend)|typescript'; then
      found="present"
    fi
  fi
  echo "$found"
}

ts_service_state() { # 1 if the running IDE has a TS language service configured
  local cfgdir="$1"
  [ -n "$cfgdir" ] && [ -d "$cfgdir/options" ] || { echo "unknown"; return; }
  if ls "$cfgdir/options" 2>/dev/null | grep -qiE 'javascriptLanguageService|typescriptLanguageService'; then
    echo "configured"
  else
    echo "not-configured"
  fi
}

# IDEA registers the Node interpreters it knows about in
# <configDir>/options/nodejs.xml, under the NodeJsLocalInterpreterManager
# component. That file only exists once the (Ultimate-only) JS/TS plugin stack
# is installed, so it doubles as an edition marker.
node_registry_state() {
  local cfgdir="$1"
  [ -n "$cfgdir" ] && [ -f "$cfgdir/options/nodejs.xml" ] || { echo "absent"; return; }
  if grep -q 'NodeJsLocalInterpreterManager' "$cfgdir/options/nodejs.xml" 2>/dev/null; then
    echo "present"
  else
    echo "absent"
  fi
}

detect_area() {
  local root="${1:-}"
  if [ -z "$root" ]; then
    echo "PRIVACY RULE: global scanning is not allowed (repo ruling)."
    echo "1) ASK the user where IDEA might be (suggest the areas below)."
    roots
    echo "2) Then: setup-env.sh detect <that-area>"
    exit 1
  fi
  root="$(to_msys "$root")"
  [ -d "$root" ] || { echo "ERROR: area not found: $root"; exit 1; }
  local exe; exe="$(exe_name)"
  echo "== probing user-approved area: $root (looking for bin/$exe) =="
  local found=0
  while IFS= read -r -d '' f; do
    echo "FOUND: $(dirname "$(dirname "$f")")"
    found=1
  done < <(find "$root" -maxdepth 3 -name "$exe" -path "*/bin/*" -print0 2>/dev/null)
  if [ "$found" = "0" ] && [ "$exe" = "idea.sh" ]; then
    while IFS= read -r -d '' f; do
      echo "FOUND: $(dirname "$(dirname "$f")")"
      found=1
    done < <(find "$root" -maxdepth 3 -name "idea" -path "*/bin/*" -print0 2>/dev/null)
  fi
  if [ "$found" = "0" ]; then
    echo "NONE: no IDEA launcher under '$root'. Ask the user for another area."
    exit 1
  fi
}

probe_root() {
  local root; root="$(to_msys "${1//\\//}")"
  local exe; exe="$(exe_name)"
  local bin="$root/bin/$exe"
  if [ ! -f "$bin" ]; then
    # some layouts: bin/idea.sh (linux) or bin/idea64.exe
    if [ -f "$root/bin/idea.sh" ]; then bin="$root/bin/idea.sh"; exe="idea.sh"
    elif [ -f "$root/bin/idea64.exe" ]; then bin="$root/bin/idea64.exe"; exe="idea64.exe"
    else echo "ERROR: no IDEA launcher under $root/bin"; return 1; fi
  fi
  local pinfo="$root/product-info.json"
  local code ver build cfgdir
  code="$(json_field "$pinfo" productCode || true)"
  ver="$(json_field "$pinfo" version || true)"
  build="$(json_field "$pinfo" buildNumber || true)"
  [ -n "$code" ] || code="IC"
  [ -n "$ver" ] || ver="$(cat "$root/build.txt" 2>/dev/null | tr -d '\r\n')"

  # config dir: %APPDATA%/JetBrains/<dataDirectoryName> (windows) or ~/.config/JetBrains/<dataDirectoryName>
  local ddir; ddir="$(json_field "$pinfo" dataDirectoryName || true)"
  [ -n "$ddir" ] || ddir="Idea$(echo "$code" | sed 's/^I/Idea/')"
  if [ "$(platform_id)" = "windows" ]; then
    cfgdir="$(to_mixed "${APPDATA:-C:/Users/$USERPROFILE}/JetBrains/$ddir")"
  else
    cfgdir="$HOME/.config/JetBrains/$ddir"
  fi

  echo "IDEA_INSTALL_ROOT=$(to_mixed "$root")"
  echo "IDEA_EXE=$(to_mixed "$bin")"
  echo "IDEA_VERSION=$ver"
  echo "IDEA_BUILD=$build"
  echo "IDEA_PRODUCT_CODE=$code"
  echo "IDEA_EDITION=$(edition_of_code "$code")"
  echo "IDEA_CONFIG_DIR=$cfgdir"
  echo "IDEA_TS_PLUGINS=$(ts_plugins_state "$root")"
  echo "IDEA_TS_SERVICE=$(ts_service_state "$cfgdir")"
  echo "IDEA_NODE_REGISTRY=$(node_registry_state "$cfgdir")"
}

node_facts() {
  local nb; nb="$(command -v node 2>/dev/null || true)"
  local npmb; npmb="$(command -v npm 2>/dev/null || true)"
  echo "NODE_BIN=${nb:-none}"
  echo "NODE_VERSION=$(node -v 2>/dev/null || echo none)"
  echo "NPM_BIN=${npmb:-none}"
  echo "NPM_VERSION=$(npm -v 2>/dev/null || echo none)"
}

init_config() {
  local root="$1"
  [ -n "$root" ] || { echo "ERROR: init needs <installRoot>"; exit 1; }
  local facts; facts="$(probe_root "$root")" || exit 1
  local nodefacts; nodefacts="$(node_facts)"
  {
    echo "{"
    echo "  \"_comment\": \"机器本地运行时配置（由 scripts/setup-env.sh init 生成）。分发 skill 时不携带此文件。\","
    echo "  \"platform\": \"$(platform_id)\","
    echo "  \"idea\": {"
    echo "    \"installRoot\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_INSTALL_ROOT=//p')\","
    echo "    \"exe\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_EXE=//p')\","
    echo "    \"version\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_VERSION=//p')\","
    echo "    \"build\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_BUILD=//p')\","
    echo "    \"productCode\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_PRODUCT_CODE=//p')\","
    echo "    \"edition\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_EDITION=//p')\","
    echo "    \"configDir\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_CONFIG_DIR=//p')\","
    echo "    \"tsPlugins\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_TS_PLUGINS=//p')\","
    echo "    \"tsService\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_TS_SERVICE=//p')\","
    echo "    \"nodeRegistry\": \"$(printf '%s\n' "$facts" | sed -n 's/^IDEA_NODE_REGISTRY=//p')\""
    echo "  },"
    echo "  \"toolchain\": {"
    echo "    \"nodeBin\": \"$(printf '%s\n' "$nodefacts" | sed -n 's/^NODE_BIN=//p')\","
    echo "    \"nodeVersion\": \"$(printf '%s\n' "$nodefacts" | sed -n 's/^NODE_VERSION=//p')\","
    echo "    \"npmBin\": \"$(printf '%s\n' "$nodefacts" | sed -n 's/^NPM_BIN=//p')\","
    echo "    \"npmVersion\": \"$(printf '%s\n' "$nodefacts" | sed -n 's/^NPM_VERSION=//p')\""
    echo "  }"
    echo "}"
  } > "$CONFIG"
  echo "wrote $CONFIG"
  cat "$CONFIG"
}

check_config() {
  if [ ! -f "$CONFIG" ]; then
    echo "NO CONFIG: $CONFIG missing — run 'setup-env.sh detect' then 'init <root>'"
    exit 2
  fi
  node -e '
    const fs=require("fs");
    const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const root=c.idea?.installRoot;
    if(!root){console.error("config.json missing idea.installRoot");process.exit(1);}
    if(!fs.existsSync(root)){console.error("idea.installRoot does not exist: "+root);process.exit(1);}
    console.log("OK: idea="+c.idea.edition+" ("+c.idea.productCode+") tsPlugins="+(c.idea.tsPlugins||"?")+" nodeRegistry="+(c.idea.nodeRegistry||"?")+" node="+(c.toolchain?.nodeVersion||"?"));
  ' "$CONFIG"
}

install_deps() {
  local tpl="$SKILL_DIR/templates/ts-project"
  [ -d "$tpl" ] || { echo "ERROR: template not found: $tpl"; exit 1; }
  echo "installing the template toolchain in $tpl ..."
  (cd "$tpl" && npm install --no-fund --no-audit) || {
    echo "ERROR: npm install failed" >&2
    exit 1
  }
  echo "toolchain ready"
}

case "${1:-}" in
  roots) roots ;;
  detect) shift; detect_area "${1:-}" ;;
  probe) shift; probe_root "${1:-}" ;;
  init) shift; init_config "${1:-}" ;;
  install-deps) install_deps ;;
  check) check_config ;;
  *) echo "usage: setup-env.sh roots | detect [area] | probe <root> | init <root> | install-deps | check" >&2; exit 1 ;;
esac
