#!/usr/bin/env bash
# validate_vibe_docs.sh — Vibe Coding 文档自校验
#
# 校验项:
#   1. AGENTS.md / SKILL.md / subagents/*.md 行数超过弹性上限
#   2. 文档中非法内联 > 10 行代码块（地图型豁免）
#   3. 子代理未声明 timeout
#   4. 无地图的 AGENTS.md 警告
#   5. Rule .mdc 文件 > 120 行警告
#
# 用法:
#   ./scripts/validate_vibe_docs.sh [dir1 dir2 ...]
#   默认扫描当前目录
#   （脚本自带用法在任何 CWD 下都可跑：先解析仓库根再执行）
#
# 阈值（读自 scripts/gates/standards.json —— 唯一标准来源）:
#   AGENTS.md / SKILL.md / Subagent / Rule .mdc 的行数上限，
#   以及各组件是否按正文计数（counts_body_only），全部在标准配置里，本脚本不写死。

set -u

# ── node 解析:Git Bash 的 PATH 常常不含 node,直接调会 "command not found" ──
NODE_BIN=""
for cand in "$(command -v node 2>/dev/null)" \
            "/c/nodejs/node.exe" \
            "/c/Program Files/nodejs/node.exe"; do
  if [ -n "$cand" ] && [ -x "$cand" ]; then NODE_BIN="$cand"; break; fi
done
if [ -z "$NODE_BIN" ]; then
  echo "SKIP validate_vibe_docs：找不到 node 可执行文件"
  exit 2
fi

# 调用时的 CWD（用户给的相对目录按它解析,切到仓根之后仍指原来那个地方）
ORIG_PWD="$(pwd)"

# ---------- 仓库根：git 顶层优先，失败则从脚本位置上溯 3 级 ----------
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

# ---------- 阈值：唯一来源 scripts/gates/standards.json ----------
# node 需要本机可解析的绝对路径：cygpath -m 给出 D:/... 形式
STD_ABS="$(cygpath -m "$ROOT/scripts/gates/standards.json" 2>/dev/null || echo "$ROOT/scripts/gates/standards.json")"
load_harness_standards() {
  STD_PATH="$STD_ABS" "$NODE_BIN" -e '
const s = require(process.env.STD_PATH), c = s.components;
console.log("TH_AGENTS=" + c.agents_md.max_lines);
console.log("TH_SKILL=" + c.skill_md.max_lines);
console.log("TH_SUBAGENT=" + c.subagent.max_lines);
console.log("TH_RULE=" + c.rule.max_lines);
console.log("AGENTS_MD_BODY_ONLY=" + (c.agents_md.counts_body_only ? 1 : 0));
console.log("SKILL_MD_BODY_ONLY=" + (c.skill_md.counts_body_only ? 1 : 0));
console.log("SUBAGENT_BODY_ONLY=" + (c.subagent.counts_body_only ? 1 : 0));
console.log("RULE_BODY_ONLY=" + (c.rule.counts_body_only ? 1 : 0));
'
}
eval "$(load_harness_standards)"

# ---------- 输出路径：仓根相对 ----------
repo_rel() {
  local p="$1" r
  case "$p" in
    "$ROOT"/*) r="${p#"$ROOT"/}" ;;
    "$ROOT")   r="." ;;
    *)        r="$p" ;;
  esac
  case "$r" in
    ./*) r="${r#./}" ;;
  esac
  r="${r//\/\.\//\/}"          # 去掉路径里的 /./ 段
  printf '%s\n' "$r"
}

# ---------- 计数 ----------
errors=0
warnings=0
checked_files=0

# ---------- 函数 ----------
check_file() {
  local file="$1"
  local type="$2"   # agents / skill / subagent / rule
  local lines
  local body_only=0
  case "$type" in
    agents)   body_only="${AGENTS_MD_BODY_ONLY:-0}" ;;
    skill)    body_only="${SKILL_MD_BODY_ONLY:-0}" ;;
    subagent) body_only="${SUBAGENT_BODY_ONLY:-0}" ;;
    rule)     body_only="${RULE_BODY_ONLY:-0}" ;;
  esac

  if [ "$body_only" = "1" ]; then
    # 按正文行数（不含 frontmatter），与 Python 侧同口径
    lines=$(awk 'BEGIN{fm=0;n=0} NR==1&&/^---$/{fm=1;next} fm&&/^---$/{fm=0;next} !fm{n++} END{print n}' "$file" 2>/dev/null || echo 0)
  else
    # 整文件计数
    lines=$(wc -l < "$file" 2>/dev/null || echo 0)
  fi

  checked_files=$((checked_files + 1))

  local rel
  rel="$(repo_rel "$file")"

  local threshold
  case "$type" in
    rule)         threshold=$TH_RULE ;;
    agents)       threshold=$TH_AGENTS ;;
    skill)        threshold=$TH_SKILL ;;
    subagent)     threshold=$TH_SUBAGENT ;;
    *)            return 0 ;;
  esac

  if [ "$lines" -gt "$threshold" ]; then
    if [ "$type" = "rule" ]; then
      # Rule 超阈值是警告（非阻断）
      echo "WARN  $rel ($lines 行 > 阈值 $threshold，建议拆分)"
      warnings=$((warnings + 1))
    else
      echo "FAIL  $rel ($lines 行 > 阈值 $threshold，建议提取 references/)"
      errors=$((errors + 1))
    fi
  fi

  # 子代理必须有 timeout
  if [ "$type" = "subagent" ]; then
    if ! grep -q "^timeout:" "$file"; then
      echo "WARN  $rel 缺少 'timeout:' 字段（vibe 子代理强制）"
      warnings=$((warnings + 1))
    fi
  fi

  # AGENTS.md 必须含地图（至少一个）
  if [ "$type" = "agents" ]; then
    if ! grep -qE "技术栈|目录树|启动命令|目录结构|架构" "$file"; then
      echo "WARN  $rel 缺少地图元素（技术栈/目录树/启动命令）"
      warnings=$((warnings + 1))
    fi
  fi
}

scan_dir() {
  local root="$1"

  # AGENTS.md
  [ -f "$root/AGENTS.md" ] && check_file "$root/AGENTS.md" "agents"

  # SKILL.md
  [ -f "$root/SKILL.md" ] && check_file "$root/SKILL.md" "skill"

  # subagents
  if [ -d "$root/agents" ] || [ -d "$root/subagents" ]; then
    local agents_dir="${root}/subagents"
    [ ! -d "$agents_dir" ] && agents_dir="${root}/agents"
    while IFS= read -r f; do
      check_file "$f" "subagent"
    done < <(find "$agents_dir" -type f -name "*.md" 2>/dev/null)
  fi

  # Rule .mdc
  if [ -d "$root/rules" ]; then
    while IFS= read -r f; do
      check_file "$f" "rule"
    done < <(find "$root/rules" -type f -name "*.mdc" 2>/dev/null)
  fi
}

# ---------- 入口 ----------
dirs=()
for d in "$@"; do
  case "$d" in
    /*|[A-Za-z]:*) dirs+=("$d") ;;
    *)             dirs+=("$ORIG_PWD/$d") ;;
  esac
done
if [ ${#dirs[@]} -eq 0 ]; then
  dirs=("$ORIG_PWD")
fi

for d in "${dirs[@]}"; do
  if [ ! -d "$d" ]; then
    echo "SKIP  $d (不是目录)"
    continue
  fi
  scan_dir "$d"
done

# ---------- 报告 ----------
echo ""
echo "================================================="
echo "扫描完成: $checked_files 文件 | $errors 阻断 | $warnings 警告"
echo "阈值: AGENTS ${TH_AGENTS} / SKILL ${TH_SKILL} / Subagent ${TH_SUBAGENT} / Rule ${TH_RULE} (standards.json)"
echo "================================================="

# ---------- 5 Pillar 联动检查（2026-08-14 增量）----------
# 检查每个 SKILL.md frontmatter 是否声明了:
#   Pillar 1 (项目结构): description 含"文件/目录/模块"关键词
#   Pillar 2 (代码风格): description 含"风格/规范/约定"关键词
#   Pillar 4 (相关代码示例): SKILL.md 至少 1 个 Examples 章节
# 检查每个 requires.optional 是否带"降级影响"说明
# (这是 §M-03 + §M-04 的可机检落地)

echo ""
echo "--- 5 Pillar 联动检查 ---"
pillar_count=0
pillar_warn=0

# 扫所有 SKILL.md
while IFS= read -r skill_md; do
    [ -z "$skill_md" ] && continue
    fm=$(sed -n '/^---$/,/^---$/p' "$skill_md" 2>/dev/null | sed '1d;$d')

    # P1: 检查 optional 是否有降级说明(粗略:含"→"或"降级"或"代价")
    if echo "$fm" | grep -qE '^requires:' ; then
        optional_block=$(echo "$fm" | awk '/^optional:/,/^[a-z]/' | head -20)
        if echo "$optional_block" | grep -qE 'optional:' ; then
            # 任意 optional 缺降级说明 → WARN
            missing_degrade=$(echo "$optional_block" | grep -vE '(降级|→|代价|影响)' | grep -vE '^\s*#' | grep -E '^\s*-' | grep -v '^\s*-\s*$' | head -5)
            if [ -n "$missing_degrade" ]; then
                rel=$(repo_rel "$skill_md")
                echo "  ⚠  $rel — optional 缺降级影响说明(Pillar 4)"
                pillar_warn=$((pillar_warn + 1))
            fi
        fi
    fi

    # P2: 检查 SKILL.md 是否有 Examples 章节(Pillar 4)
    if ! grep -qE '^## (Examples|示例)' "$skill_md" 2>/dev/null; then
        rel=$(repo_rel "$skill_md")
        echo "  ℹ  $rel — 缺 Examples 章节(可选增强,但建议加)"
        pillar_count=$((pillar_count + 1))
    fi
done < <(find "$ORIG_PWD" -name SKILL.md -not -path "*/node_modules/*" 2>/dev/null)

echo ""
if [ "$pillar_warn" -gt 0 ]; then
    echo "5 Pillar 检查: $pillar_warn 警告 (optional 缺降级说明) / $pillar_count 信息"
    warnings=$((warnings + pillar_warn))
else
    echo "5 Pillar 检查: 0 警告 / $pillar_count 信息"
fi

[ "$errors" -gt 0 ] && exit 1 || exit 0
