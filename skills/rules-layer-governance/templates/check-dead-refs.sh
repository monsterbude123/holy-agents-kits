#!/usr/bin/env bash
# check-dead-refs.sh — 规则文件死引用检查（可重跑）
#
# 口径:规则文件中反引号包裹的「路径型引用」必须能在磁盘上定位;定位不到 = 死引用
#      （规则指向了不存在的文件 —— 比规则本身腐烂更隐蔽,因为文字读起来完全正常）
#
# 用法:
#   bash check-dead-refs.sh                     # 扫默认规则文件集
#   bash check-dead-refs.sh a.md b.md           # 扫指定文件
#   bash check-dead-refs.sh --selftest          # 内置样例自测（期望检出 1 条死引用 → exit 1）
# 退出码:0=无死引用 / 1=发现死引用 / 2=用法或环境错误
#
# 放置:建议放 <repo>/scripts/gates/check-dead-refs.sh;ROOT 自动回退到 git 顶层。
set -u

# 注意:不要写成 `git ... || cd ... && pwd` —— shell 里 || 与 && 左结合,
# git 成功时仍会执行 pwd,两段路径会被拼成两行,后续 cd 必失败。
if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$ROOT" ]; then
  :
else
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
cd "$ROOT" || exit 2

RULE='地图与代码不符 → 先更代码库地图再同步规则文件;死指针及时删。'
WS="${WORKSPACE:-$ROOT}"   # 路径解析基准。自测时样例写在临时目录,但基准必须仍是真实仓库根
SELFTEST=0
FIX="$ROOT/.crs-fixture.$$"

case "${1:-}" in
  --selftest) SELFTEST=1; shift ;;
  -*) echo "用法: bash check-dead-refs.sh [--selftest] [规则文件...]" >&2; exit 2 ;;
esac

# ── 规则文件集 ────────────────────────────────────────────────
if [ $SELFTEST -eq 1 ]; then
  rm -rf "$FIX"; mkdir -p "$FIX"
  {
    echo "# 自测样例（期望恰好 1 条死引用）"
    echo "- 指向存在的文件：\`./AGENTS.md\`（样例文件自身,相对样例目录必存在）"
    echo "- 指向不存在的文件：\`src/lib/does-not-exist.ts\`"
    echo "- 通配/占位/URL/命令不算路径：\`docs/**/*.md\`、\`src/<domain>/route.ts\`、\`https://x.com\`、\`npm run dev\`"
  } > "$FIX/AGENTS.md"
  echo "自测：样例已生成于 $FIX（跑完即删;路径解析基准仍为仓库根 $ROOT）"
  SAMPLES=("$FIX/AGENTS.md")
elif [ $# -gt 0 ]; then
  SAMPLES=()
  for f in "$@"; do [ -f "$f" ] && SAMPLES+=("$f"); done
  [ ${#SAMPLES[@]} -eq 0 ] && { echo "指定的文件都不存在" >&2; exit 2; }
else
  SAMPLES=(AGENTS.md)
  for f in .agents/skills/*/SKILL.md .agents/skills/*/AGENTS.md \
           plugins/_scaffold/skills/*/SKILL.md docs/*/AGENTS.md; do
    [ -f "$f" ] && SAMPLES+=("$f")
  done
fi

# ── 路径型 token 判定 ─────────────────────────────────────────
is_path_token() {
  local t="$1"
  case "$t" in */*) ;; *) return 1 ;; esac          # 必须含 /
  case "$t" in */*.*|*/) ;; *) return 1 ;; esac     # 末段须带点或是目录
  case "$t" in                                             # 通配/占位/管道/代码
    *'*'*|*'?'*|*'<'*|*'>'*|*'{'*|*'}'*|*'$'*|*'|'*|*'('*|*')'*) return 1 ;;
    *'://'*|*' '*|*'--'*|'~'*) return 1 ;;                    # URL/带空格/CLI选项/家目录
  esac
  return 0
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

RAW=".crs-raw.$$"
LSF=".crs-ls.$$"
git ls-files > "$LSF" 2>/dev/null || : > "$LSF"

for f in "${SAMPLES[@]}"; do
  dir="$(cd "$(dirname "$f")" && pwd)"
  grep -nE '`' "$f" 2>/dev/null | while IFS=: read -r lineno rest; do
    skip_line "$rest" && continue
    printf '%s\n' "$rest" \
      | grep -oE '`[^`]+`' \
      | sed 's/^`//; s/`$//; s/[，。；：、,.]$//' \
      | while IFS= read -r tok; do
          is_path_token "$tok" || continue
          [ -e "$dir/$tok" ] && continue      # 相对文件目录
          [ -e "$WS/$tok" ] && continue        # 仓库根
          [ -e "$WS/.agents/skills/$tok" ] && continue
          base="${tok##*/}"
          grep -qF "/$base" "$LSF" 2>/dev/null && continue   # git 里存在同名路径
          echo "$f|$lineno|$tok"
        done
  done
done > "$RAW" 2>/dev/null

hits=$(grep -c . "$RAW" 2>/dev/null || true); hits=${hits:-0}

report() {   # $1=文件 $2=行号 $3=token
  echo "死引用 $1:$2 → \`$3\`"
  echo "  规则原文：$RULE"
}

if [ $SELFTEST -eq 1 ]; then
  echo "自测样例中被判为死引用的路径：$hits（期望 1）"
  grep '|' "$RAW" 2>/dev/null | while IFS='|' read -r ff ln tok; do report "$ff" "$ln" "$tok"; done
  rm -rf "$FIX" "$RAW" "$LSF"
  if [ "$hits" -eq 1 ]; then
    echo "SELFTEST PASS：能抓到死引用（exit 1 = 发现死引用，符合契约）"
    exit 1
  fi
  echo "SELFTEST FAIL：期望 1 条,实际 $hits（检查 is_path_token 过滤是否过宽 / 解析基准是否搞混）"
  exit 2
fi

grep '|' "$RAW" 2>/dev/null | while IFS='|' read -r ff ln tok; do report "$ff" "$ln" "$tok"; done
rm -f "$RAW" "$LSF"
if [ "$hits" -gt 0 ]; then
  echo ""
  echo "FAIL check-dead-refs：发现 $hits 条无法定位的路径引用"
  echo "（逐条人工分类:真死引用要修 / 外来约定 / 示例 / 他 agent 配置 —— 后三类不修）"
  exit 1
fi
echo "PASS check-dead-refs：规则文件路径引用全部可定位（0 死引用）"
exit 0
