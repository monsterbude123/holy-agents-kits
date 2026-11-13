#!/usr/bin/env bash
# scripts/gates/__GATE_NO__.sh — 门禁:__标题__
# 来源:__审计报告编号__(原位置 __规则文件 §小节__)
# 规则原文:__规则全文__
# 口径:__检查对象与范围__ <= 基线 __N__(__YYYY-MM-DD__ 实测)   [仅 ratchet 型需要此行]
#
# 用法:bash scripts/gates/__GATE_NO__.sh
# 退出码:0=通过(含已在 EXCEPTIONS.md 登记的 SKIP) / 1=违规 / 2=用法或环境错误
#
# ── 占位符清单(全部替换完再跑)──────────────────────────────────
#   __GATE_NO__  门禁编号,与审计报告行号一致
#   __标题__      一句话标题
#   __审计报告编号__ 上游审计报告编号
#   __规则文件 §小节__  规则原来在哪个文件哪一节(删正文后靠它寻址)
#   __规则全文__   规则原文,一字不改
#   __检查对象与范围__ 检查什么
#   LITERAL       要禁的字面量
#   SCAN_PATH     扫描根目录
#   SCAN_INC      --include 参数组
# ── 落地前必做(缺一不可)──────────────────────────────────────
# 1. 在 scripts/gates/README.md 索引表登记本 gate(编号/规则/原位置/口径/基线)
# 2. 基线在**本脚本文件内**实测(命令行手测含 $& / !$ 的正则会被外层引号展开篡改)
# 3. 自测:构造最小违规样例 -> 断言 exit=1 且输出含 文件:行 + 规则原文 -> 撤销 -> 断言 exit=0
#
# 注:占位符一律用 __大写下划线__,不要用 <> —— shell 会把 < > 当重定向符。
# ───────────────────────────────────────────────────────────
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

GATE_NO="__GATE_NO__"
LITERAL='__要禁的字面量__'
SCAN_PATH='src'
SCAN_INC=(--include='*.ts' --include='*.tsx')
BASELINE=0

RULE='__规则全文__'

# ── 豁免逃生口:「违规必须修复或登记」的登记处 ──────────────────
if [ -f scripts/gates/EXCEPTIONS.md ] && \
   grep -qE "^gate-${GATE_NO}([^0-9]|$)" scripts/gates/EXCEPTIONS.md 2>/dev/null; then
  echo "SKIP gate-${GATE_NO}：已在 scripts/gates/EXCEPTIONS.md 登记例外"
  exit 0
fi

# ── 采集 + 计数 ───────────────────────────────────────────────
# grep 无命中时退出码为 1,必须 || true 兜住,否则整条管道判失败
matches=$(grep -rn "$LITERAL" "$SCAN_PATH" "${SCAN_INC[@]}" 2>/dev/null || true)
count=$(printf '%s\n' "$matches" | grep -c . || true)
count=${count:-0}

if [ "$count" -le "$BASELINE" ]; then
  echo "PASS gate-${GATE_NO} __短标题__: current=$count baseline=$BASELINE"
  exit 0
fi

# ── 违规分支:先说清哪条规则,再列样例 ─────────────────────────
echo "违规 __审计报告编号__(__规则文件 §小节__ __规则短标题__)"
echo "规则原文：$RULE"
echo "current=$count baseline=$BASELINE（ratchet 只减不增;下列为命中样例,文件:行）"
printf '%s\n' "$matches" | head -20
exit 1

# ═══════════════════════════════════════════════════════════════
# 形态二 · 配对型(A 改了 B 必须同批) —— 替换上面「采集 + 计数」到「exit 1」整段
# ═══════════════════════════════════════════════════════════════
#
#   changed=$(git diff --name-only HEAD -- FILE_A FILE_B 2>/dev/null || true)
#   if ! printf '%s\n' "$changed" | grep -qx "FILE_A"; then
#     echo "PASS gate-${GATE_NO}: FILE_A 相对 HEAD 无改动"
#     exit 0
#   fi
#   if printf '%s\n' "$changed" | grep -qx "FILE_B"; then
#     echo "PASS gate-${GATE_NO}: FILE_A 与 FILE_B 同批改动"
#     exit 0
#   fi
#   echo "违规 __审计报告编号__(__规则文件 §小节__ __规则短标题__)"
#   echo "规则原文：$RULE"
#   echo "FILE_A:1（相对 HEAD 有改动,但 FILE_B 未同批改动）"
#   exit 1
#
# ═══════════════════════════════════════════════════════════════
# 形态三 · 包装型(已有检查脚本,只加编号 + 退出码契约) ───────────
# ═══════════════════════════════════════════════════════════════
#
#   if out=$(bash __既有脚本路径__ "$@" 2>&1); then
#     echo "PASS gate-${GATE_NO} __短标题__: $(printf '%s' "$out" | tail -1)"
#     exit 0
#   fi
#   echo "违规 __审计报告编号__(__规则文件 §小节__ __规则短标题__)"
#   echo "规则原文：$RULE"
#   printf '%s\n' "$out" | tail -20
#   exit 1
