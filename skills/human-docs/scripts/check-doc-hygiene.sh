#!/usr/bin/env bash
# check-doc-hygiene.sh — human-docs 入库底线检查器(可重跑、可移植)
#
# 两族底线(SKILL.md「机器自检」条款的机器执行):
#   A. 机器特定路径:盘符(C:\ / C:/)、URL 编码盘符(C%3A/)、MSYS 家目录(/c/Users/…)
#   B. gitignore 死引用:markdown 链接目标在本机存在、却匹配 .gitignore
#      ——本机可达、克隆必断的假绿引用(与 check-dead-refs 的「定位不到」互补)
#
# 豁免:行内 `<!-- doc-hygiene:allow -->`(与 skill_schema.py 的 forbid_windows_paths
#      共用同一标记;教学示例与「字面量即证据」的行专用)
# 排除:standards.json doc_hygiene.exclude_globs;缺省 skills/*/references/vendor/*
# 口径:git 仓内只扫 git ls-files 的 tracked *.md(.tasks/、.auto/ 等过程目录天然出局);
#      非 git 环境降级为全量 *.md(排除 .git、node_modules)。扫描引擎在
#      scan-doc-hygiene.mjs(口径细节见其头注)
# 用法:
#   bash check-doc-hygiene.sh [目录…]     # 仓根相对目录,缺省整仓
#   bash check-doc-hygiene.sh --selftest  # 内置样例自测(全过 → exit 0)
# 输出:FAIL <仓根相对路径>:<行号> <信息>(对齐 harness-check parseShellIssues 契约)
# 退出码:0=干净 / 1=有命中 / 2=环境错误
set -u

# ── selftest:临时 git 仓注入阳性/阴性样本,期望恰 2 条 FAIL;全过 exit 0 ──
if [ "${1:-}" = "--selftest" ]; then
  T="$(mktemp -d)" || exit 2
  trap 'rm -rf "$T"' EXIT
  GT="$(cygpath -m "$T" 2>/dev/null || echo "$T")"   # 原生 git 不认 MSYS 虚拟路径(/tmp/…)
  git -C "$GT" init -q 2>/dev/null || exit 2
  printf '%s\n' 'secret/' > "$T/.gitignore"
  mkdir -p "$T/secret"
  echo x > "$T/secret/x.md"
  printf '%s\n' '[bad](secret/x.md)' '本机路径 C:\Users\me\anaconda3' > "$T/b.md"
  printf '%s\n' '[ok](b.md)' '盘符教学 C:/ok 示例 <!-- doc-hygiene:allow -->' > "$T/good.md"
  git -C "$GT" add -A >/dev/null 2>&1
  SCRIPT="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"   # $0 可能是相对路径,cd 进临时仓后必须绝对
  SCRIPT="$(cygpath -m "$SCRIPT" 2>/dev/null || echo "$SCRIPT")"
  OUT="$(cd "$T" && bash "$SCRIPT" 2>/dev/null)" || true
  N="$(printf '%s\n' "$OUT" | grep -c '^FAIL ' || true)"
  if [ "$N" -eq 2 ]; then
    echo "selftest OK：阳性 2/2 检出（盘符 + gitignore 死链）、阴性 0 误报（标记行/正常链接）"
    exit 0
  fi
  printf '%s\n' "$OUT" | sed 's/^/  /'
  echo "selftest FAIL：期望恰 2 条 FAIL，实得 $N"
  exit 1
fi

# ── ROOT 解析(照 check-dead-refs.sh 先例:git 顶层,失败则脚本位置上溯) ──
if ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" && [ -n "$ROOT" ]; then
  :
else
  ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
fi
cd "$ROOT" || exit 2
ROOT="$(pwd)"

# 目标目录(仓根相对;缺省整仓)
DIRS=()
for a in "$@"; do
  a="${a#./}"
  DIRS+=("${a:-.}")
done
[ ${#DIRS[@]} -eq 0 ] && DIRS+=(.)
DIRS_CSV="$(IFS=,; echo "${DIRS[*]}")"

# 排除清单:standards.json doc_hygiene.exclude_globs(node 边车,缺省 vendor)
STD_ABS="$(cygpath -m "$ROOT/scripts/gates/standards.json" 2>/dev/null || echo "$ROOT/scripts/gates/standards.json")"
EXCLUDES="$(STD_PATH="$STD_ABS" node -e 'const s=require(process.env.STD_PATH);((s.doc_hygiene||{}).exclude_globs||["skills/*/references/vendor/*"]).forEach(g=>console.log(g))' 2>/dev/null)"
[ -z "$EXCLUDES" ] && EXCLUDES="skills/*/references/vendor/*"
EXCLUDES_CSV="$(printf '%s' "$EXCLUDES" | tr '\n' ',')"

LIST="$(mktemp)" && HITS="$(mktemp)" && CANDS="$(mktemp)" || exit 2
trap 'rm -f "$LIST" "$HITS" "$CANDS"' EXIT

# 文件集:tracked 优先(过程目录天然出局),非 git 降级全量
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git ls-files -- '*.md' > "$LIST"
else
  find . -name '*.md' -not -path './.git/*' -not -path './node_modules/*' | sed 's|^\./||' > "$LIST"
fi

# ── 扫描(引擎 scan-doc-hygiene.mjs,输出 TSV:A=file/line/snippet B=file/line/目标) ──
SCAN="$(dirname "$0")/scan-doc-hygiene.mjs"
SCAN_ABS="$(cygpath -m "$SCAN" 2>/dev/null || echo "$SCAN")"
ROOT_ABS="$(cygpath -m "$ROOT" 2>/dev/null || echo "$ROOT")"
node "$SCAN_ABS" "$ROOT_ABS" "$DIRS_CSV" "$EXCLUDES_CSV" < "$LIST" > "$HITS" || { echo "SKIP check-doc-hygiene：扫描边车异常"; exit 2; }

FAILED=0
while IFS=$'\t' read -r kind f ln rest; do
  [ "$kind" = "A" ] && { echo "FAIL $f:$ln 机器特定路径：$rest"; FAILED=1; }
done < "$HITS"

# ── B 档批量过 git check-ignore:被列出的 = 匹配 ignore 规则(克隆后不会有) ──
cut -f4 "$HITS" | sort -u > "$CANDS"
if [ -s "$CANDS" ] && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  IGNORED="$(git check-ignore --stdin < "$CANDS" 2>/dev/null || true)"
  while IFS= read -r p; do
    [ -z "$p" ] && continue
    while IFS=$'\t' read -r kind f ln rp; do
      [ "$kind" = "B" ] && [ "$rp" = "$p" ] && { echo "FAIL $f:$ln 引用目标被 .gitignore 忽略（本机可达、克隆必断）：$p"; FAILED=1; }
    done < "$HITS"
  done <<< "$IGNORED"
fi

[ "$FAILED" -eq 1 ] && exit 1
exit 0
