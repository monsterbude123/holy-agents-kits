#!/usr/bin/env bash
# check-dead-refs.sh — 规则文件死引用检查（可重跑）
#
# 口径:规则文件里的「路径型引用」必须能在磁盘上定位;定位不到 = 死引用
#      （规则指向了不存在的文件 —— 比规则本身腐烂更隐蔽,因为文字读起来完全正常）
#
#      两种引用形式:
#        1. markdown 链接 ](<path>)  —— 链接目标必须存在(剥掉 #fragment)
#        2. 反引号 token `<path>`    —— 只判「首段是所在技能(根级文件则仓根)下已存在的目录」的 token
#      样本集由 scripts/gates/standards.json 的 dead_refs.link_globs / dead_refs.tick_globs 驱动
#      命令行显式传入的文件按「反引号 + markdown 链接」两档都判
#
# 用法:
#   bash check-dead-refs.sh                     # 扫默认规则文件集
#   bash check-dead-refs.sh a.md b.md           # 扫指定文件
#   bash check-dead-refs.sh --selftest          # 内置样例自测（期望检出 1 条死引用 → exit 1）
# 退出码:0=无死引用 / 1=发现死引用 / 2=用法或环境错误
#
# 放置:skills/rules-layer-governance/templates/;ROOT 自动回退到 git 顶层(脚本位置上溯 3 级)。
set -u

# ── node 解析:Git Bash 的 PATH 常常不含 node,直接调会 "command not found" ──
NODE_BIN=""
for cand in "$(command -v node 2>/dev/null)" \
            "/c/nodejs/node.exe" \
            "/c/Program Files/nodejs/node.exe"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  echo "SKIP check-dead-refs：找不到 node 可执行文件"
  exit 2
fi

# 注意:不要写成 `git ... || cd ... && pwd` —— shell 里 || 与 && 左结合,
# git 成功时仍会执行 pwd,两段路径会被拼成两行,后续 cd 必失败。
if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$ROOT" ]; then
  :
else
  ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
fi
cd "$ROOT" || exit 2
# 统一成 pwd 形式:后面所有路径比较(仓根相对)都用同一个形态
ROOT="$(pwd)"

# node 需要本机可解析的绝对路径:cygpath -m 给出 D:/... 形式
STD_ABS="$(cygpath -m "$ROOT/scripts/gates/standards.json" 2>/dev/null || echo "$ROOT/scripts/gates/standards.json")"

# 唯一标准来源：scripts/gates/standards.json（node 边车输出 KEY=VALUE）
load_harness_standards() {
  STD_PATH="$STD_ABS" "$NODE_BIN" -e '
const s = require(process.env.STD_PATH), d = s.dead_refs || {};
const q = (v) => JSON.stringify(String(v == null ? "" : v));
console.log("DEAD_REFS_ENABLED=" + (d.enabled ? 1 : 0));
console.log("DEAD_REFS_SCAN_LINKS=" + (d.scan_markdown_links ? 1 : 0));
console.log("DEAD_REFS_LINK_GLOBS=" + q((d.link_globs || []).join(" ")));
console.log("DEAD_REFS_TICK_GLOBS=" + q((d.tick_globs || []).join(" ")));
'
}
eval "$(load_harness_standards)"
if [ "${DEAD_REFS_ENABLED:-0}" != "1" ]; then
  echo "SKIP check-dead-refs：标准配置未启用"
  exit 0
fi

# ── 例外登记(scripts/gates/EXCEPTIONS.md)────────────────────────
# 两种形式互不触发:
#   gate-<编号或标识>           → 整门 SKIP(本门整体跳过、exit 0)
#   except-<编号或标识>: <token> → 单 token 例外(只有这一个 token 不判死引用)
EXCEPTIONS_FILE="scripts/gates/EXCEPTIONS.md"
if [ -f "$EXCEPTIONS_FILE" ] && grep -qE "^gate-dead-refs([^0-9]|$)" "$EXCEPTIONS_FILE" 2>/dev/null; then
  echo "SKIP check-dead-refs：已在 $EXCEPTIONS_FILE 登记整门例外"
  exit 0
fi

# 例外按 token 字符串全等匹配(不做 glob、不做前缀匹配)
EXCEPT_TOKENS=""
if [ -f "$EXCEPTIONS_FILE" ]; then
  EXCEPT_TOKENS=" $(sed -n 's/^except-[^:]*:[[:space:]]*//p' "$EXCEPTIONS_FILE" | tr '\n' ' ')"
fi

RULE='地图与代码不符 → 先更代码库地图再同步规则文件;死指针及时删。'
WS="${WORKSPACE:-$ROOT}"   # 路径解析基准。自测时样例写在临时目录,但基准必须仍是真实仓库根
SELFTEST=0
FIX="$ROOT/.crs-fixture.$$"
EXPLICIT=0

case "${1:-}" in
  --selftest) SELFTEST=1; shift ;;
  -*) echo "用法: bash check-dead-refs.sh [--selftest] [规则文件...]" >&2; exit 2 ;;
esac

# ── 规则文件集 ────────────────────────────────────────────────
if [ $SELFTEST -eq 1 ]; then
  rm -rf "$FIX"; mkdir -p "$FIX/src"
  {
    echo "# 自测样例（期望恰好 1 条死引用）"
    echo "- 指向存在的文件：\`./AGENTS.md\`（样例文件自身,相对样例目录必存在）"
    echo "- 指向不存在的文件：\`src/lib/does-not-exist.ts\`"
    echo "- 通配/占位/URL/命令不算路径：\`docs/**/*.md\`、\`src/<domain>/route.ts\`、\`https://x.com\`、\`npm run dev\`"
  } > "$FIX/AGENTS.md"
  echo "自测：样例已生成于 $FIX（跑完即删;路径解析基准仍为仓库根 $ROOT）"
  SAMPLES=("$FIX/AGENTS.md")
  EXPLICIT=1
elif [ $# -gt 0 ]; then
  SAMPLES=()
  for f in "$@"; do [ -f "$f" ] && SAMPLES+=("$f"); done
  [ ${#SAMPLES[@]} -eq 0 ] && { echo "指定的文件都不存在" >&2; exit 2; }
  EXPLICIT=1
else
  # 样本集由标准配置驱动:link_globs(判 markdown 链接)+ tick_globs(额外判反引号 token)
  SAMPLES=()
  for g in ${DEAD_REFS_LINK_GLOBS:-} ${DEAD_REFS_TICK_GLOBS:-}; do
    for f in $g; do
      [ -f "$f" ] || continue
      case " ${SAMPLES[*]} " in *" $f "*) continue ;; esac
      SAMPLES+=("$f")
    done
  done
  [ ${#SAMPLES[@]} -eq 0 ] && { echo "标准配置没有匹配到任何规则文件" >&2; exit 2; }
fi

# ── 路径型 token 判定 ─────────────────────────────────────────
# 明确不是「本仓文件路径」的 token → 不判
is_excluded_token() {
  local t="$1"
  # git rev range:含 .. 且不以 ../ 开头(如 origin/main..HEAD);
  # ../2026-08-14/x.md 是真相对路径,不排除
  case "$t" in
    *..*) case "$t" in ../*) ;; *) return 0 ;; esac ;;
  esac
  case "$t" in
    /*)                          return 0 ;;   # POSIX 绝对路径
    [A-Za-z]:*)                  return 0 ;;   # 盘符绝对路径(C:/… C:\…)
    *://*|mailto:*|tel:*)        return 0 ;;   # URL
    *'*'*|*'?'*|*'<'*|*'>'*|*'{'*|*'}'*|*'$'*|*'|'*|*'('*|*')'*|*'#'*) return 0 ;;  # 通配/占位
    *' '*|*'"'*|*"'"*|*'--'*)    return 0 ;;   # 带空格/引号/CLI 选项
    '~'*)                        return 0 ;;   # 家目录
  esac
  return 1
}

# markdown 链接目标:含 / 或带扩展名才像路径(同目录文件如 ts-web.md 也要判)
is_link_target() {
  local t="$1"
  [ -n "$t" ] || return 1
  case "$t" in
    */*) return 0 ;;
    *.*) return 0 ;;
  esac
  return 1
}

# ── 显式声明为「非本仓」的引用 → 不计 ──────────────────────────
# 命中这些词说明作者已经声明「这不是本仓文件」,不该报死引用
skip_line() {
  case "$1" in
    *本仓不存在*|*外部约定*|*源仓库*|*下游仓库*|*若项目有*|*若存在*|*若有* \
    |*例如*|*示例*|*e.g.*|*Claude\ Code*|*Trae*|*Codex*|*Copilot*|*Cursor*) return 0 ;;
  esac
  return 1
}

# 仓根相对路径(输出用):设置 REL_PATH
repo_rel() {
  local p="$1" r
  case "$p" in
    "$ROOT"/*) r="${p#"$ROOT"/}" ;;
    "$ROOT")   r="." ;;
    *)         r="$p" ;;
  esac
  case "$r" in ./*) r="${r#./}" ;; esac
  r="${r//\/\.\//\/}"          # 去掉路径里的 /./ 段
  REL_PATH="${r//\\//}"        # 路径分隔符归一为 /
}

# 反引号 token 的上下文根:所在技能目录;根级文件(或不在仓内的文件)则仓根:设置 CTX_ROOT
context_root() {
  local f="$1" rel rest skill
  if [ $SELFTEST -eq 1 ]; then CTX_ROOT="$FIX"; return 0; fi
  repo_rel "$f"; rel="$REL_PATH"
  case "$rel" in
    skills/*/*)
      rest="${rel#skills/}"; skill="${rest%%/*}"
      CTX_ROOT="$ROOT/skills/$skill"; return 0 ;;
    .agents/skills/*/*)
      rest="${rel#.agents/skills/}"; skill="${rest%%/*}"
      CTX_ROOT="$ROOT/.agents/skills/$skill"; return 0 ;;
  esac
  CTX_ROOT="$ROOT"
}

# 仓根相对路径是否命中某个 glob
in_globs() {
  local rel="$1" g
  for g in $2; do
    case "$rel" in
      $g) return 0 ;;
    esac
  done
  return 1
}

RAW=".crs-raw.$$"
trap 'rm -f "$RAW"' EXIT

# git 里存在的文件名（子目录下的 basename 集合）—— 供反引号 token 判定
TRACKED_BASES=" $(git ls-files 2>/dev/null | awk -F/ 'NF>1 {print $NF}' | sort -u | tr '\n' ' ')"

# 判断一个 token 是不是死引用:0=死引用,1=活
# $1=token $2=文件所在目录 $3=上下文根(空=不做首段限制) $4=mode(tick|link)
judge_token() {
  local tok="$1" dir="$2" ctx="$3" mode="$4" first last base
  [ -n "$tok" ] || return 1
  is_excluded_token "$tok" && return 1

  if [ "$mode" = "tick" ]; then
    # 反引号 token:必须是路径型,且首段是上下文根下已存在的目录
    # （外部工程源码路径 / 运行时目录 / 示例路径 都不判）
    case "$tok" in */*) ;; *) return 1 ;; esac
    last="${tok##*/}"
    case "$last" in
      *.*) ;;
      *) [ "${tok%/}" != "$tok" ] || return 1 ;;
    esac
    first="${tok%%/*}"
    [ -d "$ctx/$first" ] || return 1
  fi

  [ -e "$dir/$tok" ] && return 1      # 相对文件目录
  [ -e "$WS/$tok" ] && return 1        # 仓库根
  [ -e "$WS/.agents/skills/$tok" ] && return 1

  if [ "$mode" = "tick" ]; then
    base="${tok##*/}"
    case "$TRACKED_BASES" in *" $base "*) return 1 ;; esac   # git 里存在同名路径
  fi

  case "$EXCEPT_TOKENS" in *" $tok "*) return 1 ;; esac       # 已登记的单 token 例外
  return 0
}

# 抽取一组文件里的两类 token:文件 / 行号 / 类型 / token / 整行
# 闸门 A:行内含反引号 **或** markdown 链接才进入扫描
extract_tokens() {
  local do_tick="$1" do_link="$2"; shift 2
  [ $# -gt 0 ] || return 0
  awk -v do_tick="$do_tick" -v do_link="$do_link" '
    {
      line = $0
      if (do_link && line ~ /\]\(/) {
        rest = line
        while (match(rest, /\]\([^)]*\)/)) {
          seg = substr(rest, RSTART + 2, RLENGTH - 3)
          rest = substr(rest, RSTART + RLENGTH)
          gsub(/^</, "", seg); gsub(/>$/, "", seg)
          sub(/[[:space:]].*$/, "", seg)      # 去掉标题
          sub(/#.*$/, "", seg)                # 去掉 #fragment
          print FILENAME "\t" FNR "\tLINK\t" seg "\t" line
        }
      }
      if (do_tick && line ~ /`/) {
        rest = line
        while (match(rest, /`[^`]+`/)) {
          seg = substr(rest, RSTART + 1, RLENGTH - 2)
          rest = substr(rest, RSTART + RLENGTH)
          sub(/[，。；：、,.]+$/, "", seg)
          print FILENAME "\t" FNR "\tTICK\t" seg "\t" line
        }
      }
    }
  ' "$@"
}

# 样本分组:tick 文件(反引号 + 链接)与只判链接的文件
LINK_FILES=()
TICK_FILES=()
for f in "${SAMPLES[@]}"; do
  repo_rel "$f"; rel="$REL_PATH"
  scan_tick=0
  scan_link=0
  if [ $EXPLICIT -eq 1 ]; then
    # 命令行显式传入:反引号 + markdown 链接两档都判
    scan_tick=1
    scan_link=1
  else
    if [ "${DEAD_REFS_SCAN_LINKS:-0}" = "1" ] && in_globs "$rel" "${DEAD_REFS_LINK_GLOBS:-}"; then
      scan_link=1
    fi
    if in_globs "$rel" "${DEAD_REFS_TICK_GLOBS:-}"; then
      scan_tick=1
      scan_link=1        # tick 文件额外判 markdown 链接
    fi
  fi
  if [ "$scan_tick" = "1" ]; then
    TICK_FILES+=("$f")
  elif [ "$scan_link" = "1" ]; then
    LINK_FILES+=("$f")
  fi
done

scan_group() {   # $1=是否判反引号(1/0) $2..=文件
  local do_tick="$1"; shift
  extract_tokens "$do_tick" 1 "$@" \
    | while IFS=$'\t' read -r ff lineno kind tok rest; do
        [ -n "$ff" ] || continue
        fnorm="${ff//\\//}"
        case "$fnorm" in
          */*) dir="${fnorm%/*}" ;;
          *)   dir="." ;;
        esac
        repo_rel "$ff"; rel="$REL_PATH"
        case "$kind" in
          TICK)
            # 闸门 B:整行豁免只作用于反引号 token(markdown 链接目标不受豁免)
            skip_line "$rest" && continue
            context_root "$ff"
            judge_token "$tok" "$dir" "$CTX_ROOT" tick || continue
            ;;
          LINK)
            is_link_target "$tok" || continue
            judge_token "$tok" "$dir" "" link || continue
            ;;
          *) continue ;;
        esac
        echo "$rel|$lineno|$tok"
      done
}

{
  scan_group 0 "${LINK_FILES[@]+"${LINK_FILES[@]}"}"
  scan_group 1 "${TICK_FILES[@]+"${TICK_FILES[@]}"}"
} > "$RAW" 2>/dev/null

hits=$(grep -c . "$RAW" 2>/dev/null || true); hits=${hits:-0}

report() {   # $1=文件 $2=行号 $3=token
  echo "死引用 $1:$2 → \`$3\`"
  echo "  规则原文：$RULE"
}

if [ $SELFTEST -eq 1 ]; then
  echo "自测样例中被判为死引用的路径：$hits（期望 1）"
  grep '|' "$RAW" 2>/dev/null | while IFS='|' read -r ff ln tok; do report "$ff" "$ln" "$tok"; done
  rm -rf "$FIX" "$RAW"
  if [ "$hits" -eq 1 ]; then
    echo "SELFTEST PASS：能抓到死引用（exit 1 = 发现死引用，符合契约）"
    exit 1
  fi
  echo "SELFTEST FAIL：期望 1 条,实际 $hits（检查 is_path_token 过滤是否过宽 / 解析基准是否搞混）"
  exit 2
fi

grep '|' "$RAW" 2>/dev/null | while IFS='|' read -r ff ln tok; do report "$ff" "$ln" "$tok"; done
rm -f "$RAW"
if [ "$hits" -gt 0 ]; then
  echo ""
  echo "FAIL check-dead-refs：发现 $hits 条无法定位的路径引用"
  echo "（逐条人工分类:真死引用要修 / 外来约定 / 示例 / 他 agent 配置 —— 后三类不修）"
  exit 1
fi
echo "PASS check-dead-refs：规则文件路径引用全部可定位（0 死引用）"
exit 0
