#!/usr/bin/env bash
# setup-env.sh — 机器事实探测与 config.json 维护（idea-backend 唯一入口）
#
#   setup-env.sh roots                      # suggested areas to ASK the user about (no scanning)
#   setup-env.sh detect <area>              # probe ONLY the user-approved area
#   setup-env.sh probe <installRoot>        # print facts for a root (no write)
#   setup-env.sh init <installRoot> [proj]  # write config.json from a chosen root
#   setup-env.sh check                      # validate current config.json (exit 0 = usable)
#   setup-env.sh plugins [installRoot]      # per-language plugin availability (from references/langs/*/profile.json)
#   setup-env.sh install-deps --lang <lang> # install the language profile's template toolchain
#
# One config.json holds every machine fact: the IDE, the MCP ports, the runtime
# budgets, which language plugins are installed, and the per-language toolchains.
# Language facts live under "toolchains.<lang>"; what each language needs lives
# in references/langs/<lang>/profile.json (see scripts/inspect-project.mjs).
#
# Privacy rule (user ruling): never scan the whole machine by default. If the user
# has not said where IDEA lives, ASK which area to search, then run detect.
# Cross-platform: works on Windows (Git Bash/MSYS) and Linux. exe name differs per OS.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"
LANGS_DIR="$SKILL_DIR/references/langs"

SUGGESTED_AREAS_WIN=( "D:/workplace" "C:/workplace" "C:/Program Files/JetBrains" "C:/Program Files" "%LOCALAPPDATA%/Programs" )
SUGGESTED_AREAS_LINUX=( "$HOME/idea" "$HOME/soft" "/opt" "/usr/local" "$HOME/Applications" )

have_cygpath() { command -v cygpath >/dev/null 2>&1; }
to_msys() {
  if have_cygpath; then cygpath -u "$1" 2>/dev/null || echo "$1"; else echo "$1"; fi
}
to_mixed() {
  if have_cygpath; then cygpath -m "$1" 2>/dev/null || echo "$1"; else echo "${1//\\//}"; fi
}
exe_name() {
  case "$(uname -s)" in
    Linux*|Darwin*) echo "idea.sh" ;;
    *) echo "idea64.exe" ;;
  esac
}
platform_id() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "mac" ;;
    *) echo "windows" ;;
  esac
}

# --- product-info.json facts -------------------------------------------------
json_field() { # <file> <key>
  local file="$1" key="$2"
  if command -v node >/dev/null 2>&1; then
    node -e '
      const fs=require("fs");
      let j={};try{j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){}
      const v=j[process.argv[2]];if(v!=null)process.stdout.write(String(v));
    ' "$file" "$key" 2>/dev/null
  else
    grep -oE "\"$key\"\s*:\s*\"[^\"]*\"" "$file" 2>/dev/null | head -1 | sed -E "s/.*:\s*\"([^\"]*)\".*/\1/"
  fi
}

edition_of_code() { # productCode IC=Community IU=Ultimate WS=WebStorm PY=PyCharm
  case "$1" in
    IC) echo "community" ;;
    IU) echo "ultimate" ;;
    WS) echo "webstorm" ;;
    PY) echo "pycharm" ;;
    *) echo "unknown" ;;
  esac
}

roots() {
  echo "Suggested areas to ask the user about (do NOT scan without user consent):"
  if [ "$(platform_id)" = "windows" ]; then
    printf '  %s\n' "${SUGGESTED_AREAS_WIN[@]}"
  else
    printf '  %s\n' "${SUGGESTED_AREAS_LINUX[@]}"
  fi
  echo "Then run: setup-env.sh detect <that-area>"
}

detect_area() {
  local root="${1:-}"
  if [ -z "$root" ]; then
    echo "PRIVACY RULE: global scanning is not allowed (user ruling)."
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
    echo "NONE: no IDEA launcher under '$root'. Ask the user for another area or the fresh-install flow."
    exit 1
  fi
}

# --- facts -------------------------------------------------------------------
config_dir_of() { # <root> <productCode> <dataDirectoryName>
  local root="$1" code="$2" ddir="$3"
  [ -n "$ddir" ] || ddir="Idea$(echo "$code" | sed 's/^I/Idea/')"
  if [ "$(platform_id)" = "windows" ]; then
    echo "${APPDATA:-C:/Users/$USERPROFILE}/JetBrains/$ddir"
  else
    echo "$HOME/.config/JetBrains/$ddir"
  fi
}

log_dir_of() {
  local cfgdir="$1"
  if [ "$(platform_id)" = "windows" ]; then
    echo "${LOCALAPPDATA:-C:/Users/$USERPROFILE}/JetBrains/$(basename "$cfgdir")/log"
  else
    echo "$HOME/.local/share/JetBrains/$(basename "$cfgdir")/log"
  fi
}

probe_root() {
  local root; root="$(to_msys "${1//\\//}")"
  local exe; exe="$(exe_name)"
  local bin="$root/bin/$exe"
  if [ ! -f "$bin" ]; then
    if [ -f "$root/bin/idea.sh" ]; then bin="$root/bin/idea.sh"; exe="idea.sh"
    elif [ -f "$root/bin/idea64.exe" ]; then bin="$root/bin/idea64.exe"; exe="idea64.exe"
    else echo "ERROR: no IDEA launcher under $root/bin" >&2; return 1; fi
  fi
  local pinfo="$root/product-info.json"
  local code ver build ddir cfgdir
  code="$(json_field "$pinfo" productCode || true)"
  ver="$(json_field "$pinfo" version || true)"
  build="$(json_field "$pinfo" buildNumber || true)"
  ddir="$(json_field "$pinfo" dataDirectoryName || true)"
  [ -n "$code" ] || code="IC"
  [ -n "$ver" ] || ver="$(cat "$root/build.txt" 2>/dev/null | tr -d '\r\n')"
  cfgdir="$(config_dir_of "$root" "$code" "$ddir")"

  echo "IDEA_INSTALL_ROOT=$(to_mixed "$root")"
  echo "IDEA_EXE=$(to_mixed "$bin")"
  echo "IDEA_VERSION=$ver"
  echo "IDEA_BUILD=$build"
  echo "IDEA_PRODUCT_CODE=$code"
  echo "IDEA_EDITION=$(edition_of_code "$code")"
  echo "IDEA_CONFIG_DIR=$(to_mixed "$cfgdir")"
  echo "IDEA_LOG_DIR=$(to_mixed "$(log_dir_of "$cfgdir")")"
  lang_facts "$root" "$cfgdir"
}

# --- per-language plugin availability ---------------------------------------
# What a language NEEDS lives in references/langs/<lang>/profile.json
# (pluginDirs / bundledIn / edition / registries). What is actually ON DISK lives here.
plugin_state() { # <installRoot> <configDir> <pluginDirName>
  local root="$1" cfgdir="$2" name="$3"
  if [ -d "$root/plugins/$name" ] || [ -d "$cfgdir/plugins/$name" ]; then echo "present"; return; fi
  # bundled plugin jars may live under plugins/<name>/lib
  if [ -d "$root/plugins/$name/lib" ]; then echo "present"; return; fi
  echo "absent"
}

profile_json() { # <profile.json path> <js expression over `p`>
  node -e '
    const fs=require("fs");
    let p={};try{p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"))}catch(e){}
    const out=eval(process.argv[2]);
    if(out!==undefined&&out!==null)process.stdout.write(String(out));
  ' "$1" "$2" 2>/dev/null
}

# Machine keys: IDEA_<LANG>_PLUGINS / IDEA_<LANG>_GATE / per-registry keys.
# (Legacy-compatible: the ts profile still answers IDEA_TS_PLUGINS.)
lang_facts() { # <installRoot> <configDir>
  local root="$1" cfgdir="$2"
  [ -d "$LANGS_DIR" ] || return
  for dir in "$LANGS_DIR"/*/; do
    [ -f "$dir/profile.json" ] || continue
    local lang up dirs gate state
    lang="$(json_field "$dir/profile.json" lang)"
    [ -n "$lang" ] || continue
    up="$(echo "$lang" | tr '[:lower:]' '[:upper:]')"
    dirs="$(profile_json "$dir/profile.json" '(p.pluginDirs||[]).join(" ")')"
    gate="$(profile_json "$dir/profile.json" '(p.edition||"")')"
    state="absent"
    for d in $dirs; do
      if [ "$(plugin_state "$root" "$cfgdir" "$d")" = "present" ]; then state="present"; break; fi
    done
    echo "IDEA_${up}_PLUGINS=$state"
    [ -n "$gate" ] && echo "IDEA_${up}_GATE=$gate"
    # registries: the IDE's own options/ files (e.g. nodejs.xml) prove a language service is wired
    local regfiles; regfiles="$(profile_json "$dir/profile.json" 'Object.keys(p.registries||{}).join(" ")')"
    for rf in $regfiles; do
      local key contains rstate
      key="$(profile_json "$dir/profile.json" "(p.registries['$rf']||{}).key||''")"
      contains="$(profile_json "$dir/profile.json" "(p.registries['$rf']||{}).contains||''")"
      [ -n "$key" ] || continue
      rstate="absent"
      if [ -f "$cfgdir/options/$rf" ]; then
        if [ -z "$contains" ] || grep -q "$contains" "$cfgdir/options/$rf" 2>/dev/null; then rstate="present"; fi
      fi
      echo "${key}=$rstate"
    done
  done
}

plugins_report() {
  local root; root="$(to_msys "${1//\\//}")"
  local exe; exe="$(exe_name)"
  local pinfo="$root/product-info.json"
  local code ddir cfgdir
  code="$(json_field "$pinfo" productCode || true)"; [ -n "$code" ] || code="IC"
  ddir="$(json_field "$pinfo" dataDirectoryName || true)"
  cfgdir="$(config_dir_of "$root" "$code" "$ddir")"

  echo "IDEA_EDITION=$(edition_of_code "$code")"
  if [ ! -d "$LANGS_DIR" ]; then echo "NO_PROFILES"; return; fi
  for dir in "$LANGS_DIR"/*/; do
    [ -f "$dir/profile.json" ] || continue
    local lang; lang="$(json_field "$dir/profile.json" lang)"
    local dirs; dirs="$(profile_json "$dir/profile.json" '(p.pluginDirs||[]).join(" ")')"
    local gate; gate="$(profile_json "$dir/profile.json" '(p.edition||"")')"
    printf 'LANG_PLUGIN %s edition-gate=%s' "${lang}" "$gate"
    for d in $dirs; do
      printf ' %s=%s' "$d" "$(plugin_state "$root" "$cfgdir" "$d")"
    done
    printf '\n'
  done
}

# --- per-language toolchains -------------------------------------------------
toolchain_facts() { # <lang>
  case "${1:-}" in
    node)
      echo "NODE_BIN=$(command -v node 2>/dev/null || echo none)"
      echo "NODE_VERSION=$(node -v 2>/dev/null || echo none)"
      echo "NPM_BIN=$(command -v npm 2>/dev/null || echo none)"
      echo "NPM_VERSION=$(npm -v 2>/dev/null || echo none)"
      ;;
    python)
      echo "PYTHON_BIN=$(command -v python 2>/dev/null || echo none)"
      echo "PYTHON_VERSION=$(python --version 2>&1 | awk '{print $2}')"
      echo "PIP_BIN=$(command -v pip 2>/dev/null || echo none)"
      echo "PIP_VERSION=$(pip --version 2>/dev/null | awk '{print $2}')"
      echo "UV_BIN=$(command -v uv 2>/dev/null || echo none)"
      echo "UV_VERSION=$(uv --version 2>/dev/null | awk '{print $2}')"
      ;;
    jdk)
      echo "JAVA_BIN=$(command -v java 2>/dev/null || echo none)"
      echo "JAVA_VERSION=$(java -version 2>&1 | head -1)"
      ;;
    *) ;;
  esac
}

# --- write config.json -------------------------------------------------------
init_config() {
  local root="$1" project="${2:-}"
  [ -n "$root" ] || { echo "ERROR: init needs <installRoot>" >&2; exit 1; }
  local facts; facts="$(probe_root "$root")" || exit 1
  local val; val() { echo "$facts" | sed -n "s/^$1=//p" | head -1; }

  local install_root exe version build code edition cfgdir logdir
  install_root="$(val IDEA_INSTALL_ROOT)"; exe="$(val IDEA_EXE)"
  version="$(val IDEA_VERSION)"; build="$(val IDEA_BUILD)"
  code="$(val IDEA_PRODUCT_CODE)"; edition="$(val IDEA_EDITION)"
  cfgdir="$(val IDEA_CONFIG_DIR)"; logdir="$(val IDEA_LOG_DIR)"

  local projectJson="null"
  [ -n "$project" ] && projectJson="\"$(to_mixed "$project")\""

  # per-language plugin presence (what is on disk right now)
  local pluginJson="{}"
  if [ -d "$LANGS_DIR" ]; then
    pluginJson="$(node -e '
      const fs=require("fs"), path=require("path");
      const dir=process.argv[1], root=process.argv[2], cfg=process.argv[3];
      const out={};
      for(const d of fs.readdirSync(dir)){
        const pf=path.join(dir,d,"profile.json");
        if(!fs.existsSync(pf)) continue;
        let p={};try{p=JSON.parse(fs.readFileSync(pf,"utf8"))}catch(e){continue}
        const present=(p.pluginDirs||[]).filter(n=>
          fs.existsSync(path.join(root,"plugins",n))||fs.existsSync(path.join(cfg,"plugins",n)));
        out[p.lang]={required:(p.pluginDirs||[]).length,present:present.length,
                     state:present.length===(p.pluginDirs||[]).length&&present.length>0?"present":"absent"};
      }
      console.log(JSON.stringify(out));
    ' "$LANGS_DIR" "$root" "$cfgdir")"
  fi

  cat > "$CONFIG" <<EOF
{
  "_comment": "机器本地运行时配置（由 scripts/setup-env.sh init 生成）。分发 skill 时不携带此文件。",
  "platform": "$(platform_id)",
  "idea": {
    "installRoot": "$install_root",
    "exe": "$exe",
    "version": "$version",
    "build": "$build",
    "productCode": "$code",
    "edition": "$edition",
    "fallbackRoot": null,
    "commonProject": $projectJson,
    "configDir": "$cfgdir",
    "logDir": "$logdir"
  },
  "ports": { "builtinMcp": 64342, "indexMcp": 29170 },
  "runtime": { "endpointReadyTimeoutSec": 60, "warmupSecondsBeforeVerdict": 120, "maxFilesPerInspect": 200 },
  "plugins": {
    "indexMcp": { "id": "com.github.hechtcarmel.jetbrainsindexmcpplugin", "monsterRepo": "https://github.com/monsterbude123/jetbrains-index-mcp-plugin-monster", "sideLoadDir": "$cfgdir/plugins/jetbrains-index-mcp-plugin", "probe": "bash scripts/mcp-call.sh list index" },
    "installed": $pluginJson
  },
  "toolchains": {
    "node": { "bin": "$(command -v node 2>/dev/null || echo none)", "version": "$(node -v 2>/dev/null || echo none)", "npmBin": "$(command -v npm 2>/dev/null || echo none)", "npmVersion": "$(npm -v 2>/dev/null || echo none)" },
    "python": { "bin": "$(command -v python 2>/dev/null || echo none)", "version": "$(python --version 2>&1 | awk '{print $2}')", "pipBin": "$(command -v pip 2>/dev/null || echo none)", "uvBin": "$(command -v uv 2>/dev/null || echo none)" }
  }
}
EOF
  echo "WROTE: $CONFIG"
  check_config || true
}

check_config() {
  [ -f "$CONFIG" ] || { echo "NO CONFIG: $CONFIG missing — run 'setup-env.sh detect' then 'init <root>' (SKILL.md 环境门禁)"; exit 2; }
  if /usr/bin/grep -q "<IDEA 安装根目录>" "$CONFIG"; then
    echo "INVALID: config.json still contains template placeholders"; exit 3
  fi
  node -e '
    const fs=require("fs");
    const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const root=c.idea?.installRoot;
    if(!root){console.error("config.json missing idea.installRoot");process.exit(1);}
    if(!fs.existsSync(root)){console.error("idea.installRoot does not exist: "+root);process.exit(1);}
    console.log("OK: idea="+(c.idea.edition||"?")+" ("+(c.idea.productCode||"?")+")"
      +" version="+(c.idea.version||"?")
      +" node="+(c.toolchains?.node?.version||"?")
      +" python="+(c.toolchains?.python?.version||"?")
      +" langPlugins="+JSON.stringify(c.plugins?.installed||{}));
  ' "$CONFIG"
}

install_deps() {
  local lang="${1:-}"
  [ -n "$lang" ] || { echo "ERROR: install-deps needs --lang <lang>" >&2; exit 2; }
  local tpl="$SKILL_DIR/templates/$lang-project"
  [ -d "$tpl" ] || { echo "ERROR: template not found: $tpl" >&2; exit 1; }
  echo "installing the $lang template toolchain in $tpl ..."
  case "$lang" in
    ts)   (cd "$tpl" && npm install --no-fund --no-audit) ;;
    python)
      if command -v uv >/dev/null 2>&1; then
        (cd "$tpl" && uv sync --no-progress) || (cd "$tpl" && uv pip install --system ruff mypy pytest)
      else
        (cd "$tpl" && python -m pip install --quiet ruff mypy pytest)
      fi
      ;;
    *) echo "ERROR: no install-deps recipe for lang '$lang'" >&2; exit 1 ;;
  esac
  echo "toolchain ready"
}

case "${1:-}" in
  roots) roots ;;
  detect) shift; detect_area "${1:-}" ;;
  probe) shift; probe_root "${1:?usage: probe <installRoot>}" ;;
  plugins) shift; plugins_report "${1:-}" ;;
  init) shift; init_config "${1:?usage: init <installRoot> [projectPath]}" "${2:-}" ;;
  install-deps)
    shift
    LANG=""; while [ $# -gt 0 ]; do case "$1" in --lang) LANG="${2:-}"; shift 2 ;; *) shift ;; esac; done
    install_deps "$LANG" ;;
  check) check_config ;;
  *) echo "usage: setup-env.sh roots | detect <area> | probe <root> | plugins [root] | init <installRoot> [projectPath] | install-deps --lang <lang> | check" >&2; exit 1 ;;
esac
