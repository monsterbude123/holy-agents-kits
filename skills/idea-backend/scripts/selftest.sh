#!/usr/bin/env bash
# selftest.sh — idea-backend 脚本自检（改完 scripts/ 跑一遍）
#
# 用法:
#   bash scripts/selftest.sh
#
# 三类检查:
#   A. 离线确定性: MSYS/Windows 路径桥接、清单解析（ide_diagnostics 降级格式）
#   B. 在线可跳过: 工具面探测（IDEA 在跑才有意义；server 没起 = SKIP 不是 FAIL）
#   C. 契约检查: 脚本引用、SKILL.md 提到的脚本都在
#
# 退出码: 0 = 全过（或仅 SKIP）; 1 = 有 FAIL

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP=$(mktemp -d)
FAIL=0

ok()   { echo "  [PASS] $1"; }
bad()  { echo "  [FAIL] $1"; FAIL=1; }
skip() { echo "  [SKIP] $1"; }

echo "A. 离线确定性"
# A1: node 读 MSYS 临时文件（历史翻车: mcp-call.sh 把 /tmp/x 传给 Windows node → ENOENT: D:\tmp\x）
T=$(mktemp); printf 'bridge-ok' > "$T"
T_WIN=$(cygpath -m "$T" 2>/dev/null || echo "$T")
if node -e "process.exit(require('fs').readFileSync(process.argv[1],'utf8')==='bridge-ok'?0:1)" "$T_WIN"; then
  ok "MSYS→Windows 路径桥接（cygpath -m）"
else
  bad "MSYS→Windows 路径桥接: node 读不到 $T_WIN"
fi

# A2: audit-parse.js 能把 ide_diagnostics 的降级输出解析成清单
cat > "$TMP/diag.json" <<'JSON'
{"problems":[{"message":"unused variable 'unusedVar'","severity":"WARNING","file":"src/a.ts","line":12,"column":9},{"message":"Cannot resolve symbol 'x'","severity":"ERROR","file":"src/b.ts","line":3,"column":5}],"buildErrors":[],"problemCount":2,"problemsTruncated":false}
JSON
PARSER_WIN=$(cygpath -m "$SKILL_DIR/scripts/audit-parse.js" 2>/dev/null || echo "$SKILL_DIR/scripts/audit-parse.js")
OUT=$(node "$PARSER_WIN" "$(cygpath -m "$TMP/diag.json")" 2>/dev/null)
if echo "$OUT" | /usr/bin/grep -q "src/a.ts:12 | WARNING | unused variable" \
   && echo "$OUT" | /usr/bin/grep -q "src/b.ts:3 | ERROR | Cannot resolve symbol"; then
  ok "audit-parse.js 解析 ide_diagnostics 降级输出"
else
  bad "audit-parse.js 没解析出降级清单，实际输出: ${OUT:0:200}"
fi

# A3: 清单里的问题不会被噪音规则吞掉（NonAsciiCharacters 单列）
if echo "$OUT" | /usr/bin/grep -q "uniqueParsed"; then
  ok "清单输出含 [SUMMARY]/[STATS] 头"
else
  bad "清单输出缺少 [SUMMARY]/[STATS] 头"
fi

echo "B. 在线探测（IDEA 未运行则 SKIP）"
bash "$SKILL_DIR/scripts/mcp-call.sh" has index ide_index_status >/dev/null 2>&1
RC=$?
if [ "$RC" = "0" ]; then
  ok "idea-index server 可达，ide_index_status 在工具面里"
  TOOLS=$(bash "$SKILL_DIR/scripts/mcp-call.sh" list index 2>/dev/null | wc -l)
  if [ "${TOOLS:-0}" -gt 0 ]; then ok "list index 返回 $TOOLS 个工具"; else bad "list index 没返回工具名"; fi
  if bash "$SKILL_DIR/scripts/mcp-call.sh" has index __no_such_tool__ >/dev/null 2>&1; then
    bad "has 对不存在的工具返回了 0（应为 1）"
  else
    ok "has 对不存在的工具返回非 0"
  fi
elif [ "$RC" = "2" ]; then
  skip "IDEA / idea-index server 没起（tools/list 探不到）"
else
  bad "ide_index_status 不在工具面里（rc=$RC）——检查插件构建（上游版 16 个工具）"
fi

echo "C. 契约检查"
for f in mcp-call.sh audit-baseline.sh inspect-diff.sh audit-parse.js audit-brief.md selftest.sh setup-env.sh inspect-project.mjs verify-item.sh verify-quotes.mjs; do
  if [ -f "$SKILL_DIR/scripts/$f" ]; then ok "scripts/$f 存在"; else bad "scripts/$f 缺失"; fi
done
for f in ../references/ops-memo.md ../references/capability-matrix.md ../references/langs/ts/runtime.md ../references/langs/ts/setup.md ../references/langs/java/profile.md ../references/langs/python/setup.md; do
  if [ -f "$SKILL_DIR/scripts/$f" ]; then ok "references/$(basename "$f") 存在"; else bad "references/$(basename "$f") 缺失"; fi
done

echo "D. 语言分册（骨架 + 溯源门禁）"
LANGS="$SKILL_DIR/references/langs"
if [ -d "$LANGS" ]; then
  for d in "$LANGS"/*/; do
    lang="$(basename "$d")"
    [ -f "$d/profile.json" ] && ok "分册 $lang: profile.json" || bad "分册 $lang: 缺 profile.json"
    if [ -f "$d/profile.json" ]; then
      det="$(node -e 'const fs=require("fs");try{const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(p.detector||"")}catch(e){}' "$d/profile.json")"
      if [ -n "$det" ] && [ -f "$SKILL_DIR/$det" ]; then ok "分册 $lang: 探测器 $det"; else bad "分册 $lang: 探测器缺失（profile.detector=${det:-none}）"; fi
    fi
    # IDE 侧设置条目：逐条过结构校验（此前这个检查没有任何门禁在跑 = 死检查）
    if [ -f "$d/idea-settings.json" ]; then
      ids="$(node -e 'const fs=require("fs");try{const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write((Array.isArray(r)?r:[]).map(x=>x.id).join(" "))}catch(e){}' "$d/idea-settings.json")"
      bad_ids=""
      for i in $ids; do
        bash "$SKILL_DIR/scripts/check-registry-entry.sh" "$i" --lang "$lang" >/dev/null 2>&1 || bad_ids="$bad_ids $i"
      done
      if [ -z "$bad_ids" ]; then ok "分册 $lang: IDE 侧设置条目结构校验（$(echo "$ids" | wc -w) 条）"; else bad "分册 $lang: IDE 侧设置条目不合格 →$bad_ids"; fi
    fi
  done
  if node "$SKILL_DIR/scripts/verify-quotes.mjs" >/dev/null 2>&1; then
    ok "溯源门禁: 每条 quote 都能在 sources.md 逐字命中"
  else
    bad "溯源门禁: 有 quote 命不中（node scripts/verify-quotes.mjs 看明细）"
  fi
  if node "$SKILL_DIR/scripts/inspect-project.mjs" --list-langs >/dev/null 2>&1; then
    ok "通用探测器: --list-langs 可用"
  else
    bad "通用探测器: --list-langs 失败"
  fi
else
  bad "缺 references/langs 目录"
fi

rm -rf "$TMP" 2>/dev/null
echo ""
if [ "$FAIL" = "0" ]; then echo "结论：全部通过"; exit 0; else echo "结论：存在 FAIL，需修复"; exit 1; fi
