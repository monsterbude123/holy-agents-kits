#!/usr/bin/env bash
# idea-backend skill: detect existing IDEA installation / generate machine-local config.json.
# Usage:
#   scripts/setup-env.sh detect <root>     # probe ONLY the user-provided area (never scan globally)
#   scripts/setup-env.sh roots             # print suggested areas to ASK the user about (no scanning)
#   scripts/setup-env.sh init <installRoot> [projectPath]   # write config.json from a chosen root
#   scripts/setup-env.sh check             # validate current config.json (exit 0 = usable)
# Privacy rule (user ruling): never scan the whole machine by default. If the user has not
# said where IDEA lives, ASK which area to search, then run detect with that area.
# Cross-platform: works on Windows (Git Bash/MSYS) and Linux. exe name differs per OS.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="$SKILL_DIR/config.json"

# Suggested areas — printed for the conversation, NOT scanned automatically.
SUGGESTED_AREAS_WIN=( "D:/workplace" "C:/workplace" "C:/Program Files/JetBrains" "C:/Program Files" "%LOCALAPPDATA%/Programs" )
SUGGESTED_AREAS_LINUX=( "$HOME/idea" "$HOME/soft" "/opt" "/usr/local" "$HOME/Applications" )

have_cygpath() { command -v cygpath >/dev/null 2>&1; }
to_msys() { # Windows-native path -> MSYS form when cygpath exists (no-op on Linux)
  if have_cygpath; then cygpath -u "$1" 2>/dev/null || echo "$1"; else echo "$1"; fi
}
to_mixed() { # any path -> forward-slash form that is JSON-safe and OS-native
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

roots() {
  echo "Suggested areas to ask the user about (do NOT scan without user consent):"
  if [ "$(platform_id)" = "windows" ]; then
    printf '  %s\n' "${SUGGESTED_AREAS_WIN[@]}"
  else
    printf '  %s\n' "${SUGGESTED_AREAS_LINUX[@]}"
  fi
  echo "Then run: setup-env.sh detect <that-area>"
}

detect() {
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
  # Linux IDEA tarballs may also ship the launcher as bin/idea (shell wrapper)
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

version_of() { # <root ending in idea-2026.2.5> -> IdeaIC2026.2 (config/log dir suffix)
  local v
  v="$(basename "$1" | sed -n 's/^idea-//p')"
  if [ -z "$v" ]; then echo ""; return; fi
  echo "IdeaIC$(echo "$v" | cut -d. -f1,2)"
}

init() {
  local root="$1"; local project="${2:-}"
  root="$(to_msys "${root//\\//}")"
  case "$root" in
    /*) ;;
    [A-Za-z]:/*) root="$(to_msys "$root")" ;;
    *) echo "ERROR: installRoot must be an absolute path"; exit 1 ;;
  esac
  local exe_name; exe_name="$(exe_name)"
  local exe="$root/bin/$exe_name"
  [ -f "$exe" ] || { echo "ERROR: $exe not found (need the IDEA install root, e.g. $(platform_id)=linux && echo /opt/idea-2026.2.5 || echo D:/workplace/idea-2026.2.5)"; exit 1; }

  local ver cfgdir logdir platform
  ver="$(version_of "$root")"
  platform="$(platform_id)"
  if [ "$platform" = "windows" ] && have_cygpath; then
    local roaming; roaming="$(to_msys "${APPDATA:-}")"
    local appdata; appdata="$(to_msys "${LOCALAPPDATA:-}")"
    if [ -n "$ver" ] && [ -n "$roaming" ] && [ -d "$roaming/JetBrains/$ver" ]; then cfgdir="$(to_mixed "$roaming/JetBrains/$ver")"; else cfgdir="<APPDATA>\\JetBrains\\$ver"; fi
    if [ -n "$ver" ] && [ -n "$appdata" ] && [ -d "$appdata/JetBrains/$ver/log" ]; then logdir="$(to_mixed "$appdata/JetBrains/$ver/log")"; else logdir="<LOCALAPPDATA>\\JetBrains\\$ver\\log"; fi
  else
    # Linux/macOS: config & system live under ~/.config/JetBrains/<Product><ver> and ~/.local/share/JetBrains/...
    local home; home="$HOME"
    if [ -n "$ver" ] && [ -d "$home/.config/JetBrains/$ver" ]; then cfgdir="$(to_mixed "$home/.config/JetBrains/$ver")"; else cfgdir="$home/.config/JetBrains/$ver"; fi
    if [ -n "$ver" ] && [ -d "$home/.local/share/JetBrains/$ver/log" ]; then logdir="$(to_mixed "$home/.local/share/JetBrains/$ver/log")"; else logdir="$home/.local/share/JetBrains/$ver/log"; fi
  fi

  local projectJson="null"
  [ -n "$project" ] && projectJson="\"$(to_mixed "$project")\""

  cat > "$CONFIG" <<EOF
{
  "_comment": "机器本地运行时配置（由 scripts/setup-env.sh init 生成）。分发 skill 时不携带此文件。",
  "platform": "$platform",
  "idea": {
    "installRoot": "$(to_mixed "$root")",
    "exe": "$(to_mixed "$exe")",
    "fallbackRoot": null,
    "commonProject": $projectJson,
    "configDir": "$cfgdir",
    "logDir": "$logdir"
  },
  "ports": { "builtinMcp": 64342, "indexMcp": 29170 },
  "runtime": { "endpointReadyTimeoutSec": 60, "warmupSecondsBeforeVerdict": 120, "maxFilesPerInspect": 200 },
  "plugins": {
    "indexMcp": { "id": "com.github.hechtcarmel.jetbrainsindexmcpplugin", "monsterRepo": "https://github.com/monsterbude123/jetbrains-index-mcp-plugin-monster", "sideLoadDir": "$cfgdir/plugins/jetbrains-index-mcp-plugin" },
    "p3c": { "id": "com.alibaba.p3c.xenoamess", "source": "Marketplace" },
    "lombok": { "id": "Lombok", "source": "Marketplace" }
  }
}
EOF
  echo "WROTE: $CONFIG"
  check || true
}

check() {
  [ -f "$CONFIG" ] || { echo "NO CONFIG: $CONFIG missing — run 'setup-env.sh detect' then 'init <root>' (SKILL.md 环境门禁)"; exit 2; }
  # minimal sanity: exe path present and non-placeholder
  if /usr/bin/grep -q "<IDEA 安装根目录>" "$CONFIG"; then
    echo "INVALID: config.json still contains template placeholders"; exit 3
  fi
  echo "OK: $CONFIG"
}

case "${1:-}" in
  detect) shift; detect "${1:-}" ;;
  roots) roots ;;
  init) shift; init "${1:?usage: init <installRoot> [projectPath]}" "${2:-}" ;;
  check) check ;;
  *) echo "usage: setup-env.sh roots | detect <area> | init <installRoot> [projectPath] | check"; exit 1 ;;
esac
