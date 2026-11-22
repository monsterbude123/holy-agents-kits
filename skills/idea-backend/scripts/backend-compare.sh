#!/usr/bin/env bash
# 语义后端同题对比台 —— 同一个符号、同一批问题，跑多个引擎，出可比表
#
#   bash scripts/backend-compare.sh <工程目录> --symbol <符号名> [--file <相对路径>] [--line N]
#                                 [--tsserver <tsserver.js>]
#
#   # 对照实验模式（phase 03）：一个任务 × 一条配置 × 3 轮，出 D-10 度量集
#   bash scripts/backend-compare.sh --experiment --task <T1..T6> --config <A|B|C|D>
#                                 --repo <夹具仓根> [--gold <gold.json>] [--anchor <锚点id>]
#                                 [--rounds 3] [--sdk-records <目录>] [--out <记录.json>]
#
# 参与的引擎（缺哪个就跳过哪个，并写明原因）：
#   IDEA+Index MCP   —— 需要该工程已在 IDEA 里打开（位置法；与语言无关）
#   codegraph        —— 需要该工程已 `codegraph init`（IDE 无关的静态符号图）
#   tsserver         —— 只对 TS/JS 有效（VS Code 的 TS 引擎；需 --tsserver）
#   B BifrostMCP     —— **窗口内**：走 VS Code 原生 SSE 通道，调用由官方 MCP SDK 客户端驱动
#   C agent-lsp      —— **窗口外**：走 stdio，调用由官方 MCP SDK 客户端驱动
#
# 输出：每个引擎的「命中数 / 文件数 / 调用次数 / 载荷字节 / 前置步数 / 3 轮中位耗时 /
#       两个口径分别换算的召回与精度 / 失败模式」——
#       便于把「谁更准、谁更贵」量化 —— 别凭感觉比。
#
# ⚠️ B/C 两腿的**协议层不在这里**：本脚本只做「仓内可复现的那部分」（IDEA 腿走 mcp-call.sh、
#    codegraph 腿走其 CLI、gold 回仓重数），B/C 两腿的调用由本机的官方 MCP SDK 客户端驱动，
#    本脚本从 --sdk-records 目录读它们的记录并汇总（**不自建 MCP 协议层**）。
set -uo pipefail

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT=""; SYMBOL=""; REL_FILE=""; LINE=0; TSSERVER=""
EXPERIMENT=0; TASK=""; CONFIG=""; REPO=""; GOLD=""; ANCHOR=""; ROUNDS=1; SDK_RECORDS=""; OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --symbol) SYMBOL="${2:-}"; shift 2;;
    --file) REL_FILE="${2:-}"; shift 2;;
    --line) LINE="${2:-0}"; shift 2;;
    --tsserver) TSSERVER="${2:-}"; shift 2;;
    --experiment) EXPERIMENT=1; shift;;
    --task) TASK="${2:-}"; shift 2;;
    --config) CONFIG="${2:-}"; shift 2;;
    --repo) REPO="${2:-}"; shift 2;;
    --gold) GOLD="${2:-}"; shift 2;;
    --anchor) ANCHOR="${2:-}"; shift 2;;
    --rounds) ROUNDS="${2:-1}"; shift 2;;
    --sdk-records) SDK_RECORDS="${2:-}"; shift 2;;
    --out) OUT="${2:-}"; shift 2;;
    *) PROJECT="$1"; shift;;
  esac
done

if [ "$EXPERIMENT" = "1" ]; then
  [ -n "$TASK" ] || { echo "ERROR: --experiment 必须给 --task" >&2; exit 2; }
  [ -n "$CONFIG" ] || { echo "ERROR: --experiment 必须给 --config" >&2; exit 2; }
  [ -n "$REPO" ] || REPO="$SKILL_DIR/fixtures/experiment/repo"
  [ -n "$GOLD" ] || GOLD="$SKILL_DIR/fixtures/experiment/gold.json"
  BENCH_JS="$(mktemp "${TMPDIR:-/tmp}/bench-XXXXXX.js")"
  cat > "$BENCH_JS" <<'BENCH_EOF'
'use strict';
// 对照实验测量台（由 backend-compare.sh --experiment 调起；逻辑随脚本走，不另立门户）
// 职责：IDEA 臂走 mcp-call.sh、codegraph 腿走其 CLI、gold 回仓重数；
//       B/C 两腿从官方 MCP SDK 客户端的记录里读（**不自建 MCP 协议层**）；出 D-10 度量集。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TASK = arg('--task');
const CONFIG = arg('--config');
const REPO = path.resolve(arg('--repo'));
const GOLD = arg('--gold');
const SKILL = arg('--skill-dir');
const ROUNDS = Number(arg('--rounds', '3'));
const SDK_RECORDS = arg('--sdk-records', '');
const OUT = arg('--out', '');
const ANCHOR_ID = arg('--anchor', '');

const gate = require(path.join(SKILL, 'scripts', 'check-experiment.js'));
const gold = JSON.parse(fs.readFileSync(GOLD, 'utf8'));
const spec = gold.tasks.find((t) => t.id === TASK);
if (!spec) { console.error('ERROR: gold.json 里没有任务 ' + TASK); process.exit(2); }
const anchors = new Map(gold.anchors.map((a) => [a.id, a]));
const anchor = anchors.get(ANCHOR_ID || spec.anchors[0]);
if (!anchor) { console.error('ERROR: 找不到锚点 ' + ANCHOR_ID); process.exit(2); }
const PROJ = REPO.replace(/\\/g, '/').replace(/^([a-z]):/, (m, d) => d.toUpperCase() + ':');
// Windows 上 codegraph 是 .cmd 包装脚本 —— node 的 spawn 不能直接跑无扩展名的 sh 包装
const CG = process.platform === 'win32' ? 'codegraph.cmd' : 'codegraph';
const nowIso = () => new Date().toISOString();

// 声明行上的符号列（1-based）—— 从文件内容算，不手写
function declColumn(a) {
  const line = fs.readFileSync(path.join(REPO, a.decl_file), 'utf8').split(/\r?\n/)[a.decl_line - 1] || '';
  const i = line.indexOf(a.symbol);
  return i >= 0 ? i + 1 : 1;
}

// ---------- 能力缺席的既定来源（协议级 / 实现级事实，逐条可核对） ----------
const ABSENT = {
  'B:T4': '能力缺席 —— 实测 BifrostMCP 0.0.14 的 get_rename_locations 报 Unexpected type（见 skills/vscode-backend/references/setup.md §0 事实块）',
  'B:T5': '能力缺席 —— 实测 BifrostMCP 0.0.14 的 get_code_actions 报 Illegal argument（见 skills/vscode-backend/references/setup.md §0 事实块）',
  'D:T5': '能力缺席 —— codegraph 1.7.0 的 CLI 没有检视/诊断子命令（命令表见 `codegraph --help`）',
};
const ABSENT_LANG = {
  'A': { ts: '能力缺席 —— IDEA 社区版 2026.2.5 装不了 JS/TS 插件 ⇒ .ts 无 PSI（结构事实，见 skills/idea-backend/references/langs/ts/runtime.md）' },
  'C': { ts: '能力缺席 —— LSP 协议级「one server serves one tool」且本腿只起 pyright ⇒ 没有 TS 侧符号空间（结构事实，见 skills/idea-backend/references/semantic-backend-options.md）' },
};

// ---------- 各臂的提问姿势（tasks.md §1 的映射；每步带 role 与解析方式） ----------
function planA(t, a) {
  const f = a.decl_file, l = a.decl_line, c = declColumn(a);
  const P = PROJ;
  switch (t) {
    case 'T1': return [{ tool: 'ide_find_class', args: { query: a.symbol, project_path: P }, role: 'answer', parse: 'class' }];
    case 'T2': return [{ tool: 'ide_find_definition', args: { file: f, line: l, column: c, language: 'Python', project_path: P }, role: 'answer', parse: 'definition' }];
    case 'T3': return [{ tool: 'ide_find_references', args: { file: f, line: l, column: c, language: 'Python', project_path: P }, role: 'answer', parse: 'usages' }];
    case 'T4': return [{ tool: 'ide_refactor_rename', args: { file: f, line: l, column: c, newName: a.symbol + 'Renamed', dryRun: true, project_path: P }, role: 'answer', parse: 'rename' }];
    case 'T5': return [{ tool: 'ide_diagnostics', args: { file: f, project_path: P }, role: 'answer', parse: 'diagnostics' }];
    case 'T6': return [
      { tool: 'ide_find_class', args: { query: a.symbol, project_path: P }, role: 'prereq', parse: 'class' },
      { tool: 'ide_find_references', args: { file: f, line: l, column: c, language: 'Python', project_path: P }, role: 'answer', parse: 'usages' }];
  }
  return [];
}
function planD(t, a, tsAnchor) {
  switch (t) {
    case 'T1': return [{ cmd: 'query', args: [a.symbol, '-p', '.', '--kind', 'class'], role: 'answer', parse: 'cg_query' }];
    case 'T2': return [{ cmd: 'node', args: [a.symbol, '-p', '.'], role: 'answer', parse: 'cg_node' }];
    case 'T3': return [{ cmd: 'impact', args: [a.symbol, '-p', '.', '-f', a.decl_file, '-j'], role: 'answer', parse: 'cg_impact' }];
    case 'T4': return [{ cmd: 'impact', args: [a.symbol, '-p', '.', '-f', a.decl_file, '-j'], role: 'answer', parse: 'cg_impact' }];
    case 'T5': return [];
    case 'T6': return [
      { cmd: 'query', args: [a.symbol, '-p', '.'], role: 'prereq', parse: 'cg_query' },
      { cmd: 'impact', args: [a.symbol, '-p', '.', '-f', a.decl_file, '-j'], role: 'answer', parse: 'cg_impact' },
      { cmd: 'impact', args: [a.symbol, '-p', '.', '-f', (tsAnchor ? tsAnchor.decl_file : ''), '-j'], role: 'answer', parse: 'cg_impact' }];
  }
  return [];
}

// ---------- 原始输出 → 度量 ----------
function parseA(kind, raw, a) {
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { j = null; }
  if (!j) return { failure_mode: '工具报错', detail: { error: String(raw).slice(0, 300) } };
  if (j.error) return { failure_mode: '工具报错', detail: { error: JSON.stringify(j.error).slice(0, 300) } };
  switch (kind) {
    case 'class': {
      const hit = (j.classes || []).filter((c) => c.name === a.symbol)[0];
      if (!hit) return { failure_mode: '漏引用', detail: { classes: j.classes } };
      return { hits_reported: 1, hits_normalized: 1, files_reported: [hit.file], detail: { kind: hit.kind, line: hit.line, qualifiedName: hit.qualifiedName } };
    }
    case 'definition': {
      if (!j.file) return { failure_mode: '漏引用', detail: { raw: String(raw).slice(0, 300) } };
      return { hits_reported: 1, hits_normalized: 1, files_reported: [j.file], detail: { line: j.line, column: j.column, symbolName: j.symbolName } };
    }
    case 'usages': {
      if (!j.resolvedSymbol) return { failure_mode: '静默失效', detail: { raw: String(raw).slice(0, 300) } };
      const kind2 = j.resolvedSymbol.kind;
      if (!kind2 || ['directory', 'package', 'file'].includes(kind2))
        return { failure_mode: '静默失效', detail: { resolvedSymbol: j.resolvedSymbol } };
      const usages = j.usages || [];
      const files = [...new Set(usages.map((u) => u.file))];
      if (!files.includes(a.decl_file)) files.push(a.decl_file);
      files.sort();
      return { hits_reported: usages.length, hits_normalized: usages.length + 1, files_reported: files, detail: { resolvedSymbolKind: kind2, totalCount: j.totalCount } };
    }
    case 'rename': {
      if (!j.canApply) return { failure_mode: '工具报错', detail: { raw: String(raw).slice(0, 300) } };
      const files = (j.affectedFiles || []).slice().sort();
      return { hits_reported: null, hits_normalized: null, files_reported: files, detail: { canApply: j.canApply, usageCount: j.usageCount, conflictCount: j.conflictCount } };
    }
    case 'diagnostics': {
      const problems = j.problems || [];
      if (!problems.length) return { failure_mode: '漏引用', detail: { problemCount: 0 } };
      return { hits_reported: null, hits_normalized: null, files_reported: null, detail: { problem_count: j.problemCount, problem_types: problems.map((p) => p.message), problems } };
    }
  }
  return { failure_mode: '工具报错' };
}
function cgLocations(raw) {
  return [...String(raw).matchAll(/^\s+([\w./-]+\.\w+):(\d+)\s*$/gm)].map((x) => ({ file: x[1], line: Number(x[2]) }));
}
function parseD(kind, raw, a) {
  if (kind === 'cg_node') {
    const m = String(raw).match(/\*\*Location:\*\*\s*([^\s:]+):(\d+)/);
    if (!m) return { failure_mode: '漏引用', detail: { raw: String(raw).slice(0, 300) } };
    return { hits_reported: 1, hits_normalized: 1, files_reported: [m[1]], detail: { line: Number(m[2]) } };
  }
  if (kind === 'cg_query') {
    const locs = cgLocations(raw);
    if (!locs.length) return { failure_mode: '漏引用', detail: { raw: String(raw).slice(0, 300) } };
    const scope = a.count_scope.replace(/\/$/, '');
    const inScope = locs.filter((l) => l.file.startsWith(scope + '/'));
    return { hits_reported: inScope.length, hits_normalized: inScope.length, files_reported: inScope.map((l) => l.file), detail: { locations: locs } };
  }
  // cg_impact
  let j = null;
  try { j = JSON.parse(raw); } catch (e) { return { failure_mode: '工具报错', detail: { raw: String(raw).slice(0, 300) } }; }
  const affected = (j.definitions || []).flatMap((d) => d.affected || []);
  const files = [...new Set(affected.map((x) => x.filePath))].sort();
  return { hits_reported: affected.length, hits_normalized: null, files_reported: files, detail: { affected_symbols: affected.length, aggregation: j.aggregation, ambiguous: j.ambiguous } };
}

// ---------- 跑某一臂 ----------
function runA(t, a, rounds) {
  const plan = planA(t, a);
  const calls = [];
  const measure = [];
  for (let r = 1; r <= rounds; r++) {
    const perRound = [];
    for (const step of plan) {
      const t0 = process.hrtime.bigint();
      const res = spawnSync('bash', [path.join(SKILL, 'scripts', 'mcp-call.sh'), 'index', step.tool, JSON.stringify(step.args)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const raw = (res.stdout || '') + (res.stderr || '');
      const call = { round: r, name: step.tool, arguments: step.args, at: nowIso(), elapsed_ms: Math.round(ms * 10) / 10, payload_bytes: Buffer.byteLength(raw, 'utf8'), raw: raw.slice(0, 4000), role: step.role };
      calls.push(call);
      perRound.push({ call, parsed: parseA(step.parse, raw, a) });
    }
    const ans = perRound.filter((x) => x.call.role === 'answer').pop() || perRound[perRound.length - 1];
    if (!ans) { measure.push({ round: r, answering_tool: null, failure_mode: '能力缺席', detail: { note: '该臂的工具面里没有这个任务的能力' } }); continue; }
    const m = Object.assign({ round: r, answering_tool: ans.call.name }, ans.parsed);
    if (t === 'T6') {
      // 分语言：py 半边 = 答案调用；ts 半边 = 社区版无 JS/TS 插件 ⇒ 结构性能力缺席
      const reason = (ABSENT_LANG['A'] || {}).ts;
      m.by_lang_detail = {
        py: { symbol: a.symbol, file: a.decl_file, line: a.decl_line, hits_reported: ans.parsed.hits_reported, hits_normalized: ans.parsed.hits_normalized, files_reported: ans.parsed.files_reported },
        ts: reason ? { absent: reason } : null,
      };
    }
    measure.push(m);
  }
  return { calls, measure };
}
function runD(t, a, rounds, tsAnchor) {
  const plan = planD(t, a, tsAnchor);
  const calls = [];
  const measure = [];
  for (let r = 1; r <= rounds; r++) {
    const perRound = [];
    for (const step of plan) {
      const t0 = process.hrtime.bigint();
      const res = spawnSync(CG, [step.cmd, ...step.args], { encoding: 'utf8', cwd: REPO, maxBuffer: 64 * 1024 * 1024, shell: true });
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      const raw = (res.stdout || '') + (res.stderr || '');
      const call = { round: r, name: 'codegraph ' + step.cmd, arguments: { cmd: 'codegraph', args: step.args }, at: nowIso(), elapsed_ms: Math.round(ms * 10) / 10, payload_bytes: Buffer.byteLength(raw, 'utf8'), raw: raw.slice(0, 4000), role: step.role };
      calls.push(call);
      perRound.push({ call, parsed: parseD(step.parse, raw, a) });
    }
    const ans = perRound.filter((x) => x.call.role === 'answer').pop() || perRound[perRound.length - 1];
    if (!ans) { measure.push({ round: r, answering_tool: null, failure_mode: '能力缺席', detail: { note: '该臂的工具面里没有这个任务的能力' } }); continue; }
    const m = Object.assign({ round: r, answering_tool: ans.call.name }, ans.parsed);
    if (t === 'T6') {
      // 分语言：py 半边 = 锚点自己的 impact；ts 半边 = 另一个锚点的 impact
      const half = (file, anc) => {
        const hit = perRound.find((x) => x.call.name === 'codegraph impact' && JSON.stringify(x.call.arguments.args).includes(file));
        if (!hit || !anc) return null;
        return { symbol: anc.symbol, file: anc.decl_file, line: anc.decl_line, hits_reported: hit.parsed.hits_reported, hits_normalized: null, files_reported: hit.parsed.files_reported };
      };
      m.by_lang_detail = { py: half(a.decl_file, a), ts: half(tsAnchor ? tsAnchor.decl_file : '', tsAnchor) };
    }
    measure.push(m);
  }
  return { calls, measure };
}

// ---------- 汇总（度量集 + 召回/精度） ----------
function summarize(record, spec, anchor) {
  const rounds = record.measure.length;
  const raw_ms = [];
  const hits = [];
  const filesSets = [];
  let calls = 0, payload = 0, prereq = 0;
  for (let r = 1; r <= rounds; r++) {
    const rc = record.calls.filter((c) => c.round === r);
    raw_ms.push(Math.round(rc.reduce((s, c) => s + c.elapsed_ms, 0) * 10) / 10);
    calls = rc.length;
    payload = rc.reduce((s, c) => s + c.payload_bytes, 0);
    prereq = rc.filter((c) => c.role === 'prereq').length;
    const m = record.measure.find((x) => x.round === r) || {};
    // T6：顶格数字取 py 半边（单元格锚点就是 py 侧）
    const src = (m.by_lang_detail && m.by_lang_detail.py) ? m.by_lang_detail.py : m;
    hits.push(src.hits_reported === undefined ? null : src.hits_reported);
    filesSets.push(src.files_reported === undefined ? null : src.files_reported);
  }
  const first = record.measure[0] || {};
  const firstSrc = (first.by_lang_detail && first.by_lang_detail.py) ? first.by_lang_detail.py : first;
  const hitsReported = hits.every((h) => h === hits[0]) ? hits[0] : null;
  const files = filesSets.every((f) => JSON.stringify(f) === JSON.stringify(filesSets[0])) ? filesSets[0] : null;
  const metrics = {
    calls, payload_bytes: payload, prereq_steps: prereq, setup_calls: record.setup_calls || 0,
    raw_ms, median_ms: gate.median(raw_ms),
    hits_reported: hitsReported,
    hits_normalized: firstSrc.hits_normalized === undefined ? null : firstSrc.hits_normalized,
    files_reported: files, by_lang: first.by_lang_detail || null,
  };
  const recall = gate.recallOf(anchor, metrics, spec.scope);
  return { metrics, recall };
}

// ---------- 主流程 ----------
const absent = ABSENT[CONFIG + ':' + TASK];
const tsAnchor = TASK === 'T6' ? spec.anchors.map((id) => anchors.get(id)).find((a) => a && a.id !== anchor.id) : null;
let record;
if (CONFIG === 'A') record = Object.assign({ transport: 'mcp-index' }, runA(TASK, anchor, ROUNDS));
else if (CONFIG === 'D') record = Object.assign({ transport: 'cli' }, runD(TASK, anchor, ROUNDS, tsAnchor));
else {
  const p = path.join(SDK_RECORDS || '', CONFIG + '-' + TASK + '.json');
  if (!SDK_RECORDS || !fs.existsSync(p)) {
    console.error('ERROR: 找不到 ' + CONFIG + '/' + TASK + ' 的 SDK 客户端记录（' + p + '）');
    process.exit(2);
  }
  record = JSON.parse(fs.readFileSync(p, 'utf8'));
}

let status = '完成';
let failure_mode = '无失败';
let source = '本机实测记录（本记录的 calls[] 里有逐条原始输出片段）';
if (absent) {
  status = '能力缺席';
  failure_mode = '能力缺席';
  source = absent;
} else {
  const bad = record.measure.find((m) => m.failure_mode && m.failure_mode !== '无失败');
  if (bad) {
    failure_mode = bad.failure_mode;
    status = (failure_mode === '漏引用' || failure_mode === '误报') ? 'flaky' : '完成';
    source = '本机实测记录；本轮失败模式：' + failure_mode;
  }
}
// T6 的分语言明细：缺一侧 ⇒ 该侧记能力缺席（结构事实，带出处）
if (TASK === 'T6' && !absent) {
  let byLang = (record.measure[0] && record.measure[0].by_lang_detail) || null;
  if (!byLang) {
    const reason = (ABSENT_LANG[CONFIG] || {}).ts;
    const py = { symbol: anchor.symbol, file: anchor.decl_file, line: anchor.decl_line, hits_reported: record.measure[0].hits_reported, hits_normalized: record.measure[0].hits_normalized, files_reported: record.measure[0].files_reported };
    byLang = { py, ts: reason ? { absent: reason } : null };
    record.measure.forEach((x) => { x.by_lang_detail = byLang; });
  }
  if (byLang.ts && byLang.ts.absent) {
    status = '能力缺席';
    failure_mode = '能力缺席';
    source = byLang.ts.absent;
  }
}

const { metrics, recall } = summarize(record, spec, anchor);
const goldRecount = gate.recountAnchor(REPO, anchor);

const out = {
  task: TASK, config: CONFIG, rounds: ROUNDS, transport: record.transport,
  calls: record.calls, measure: record.measure,
  summary: {
    status, failure_mode, source, metrics, recall,
    anchor: { symbol: anchor.symbol, file: anchor.decl_file, line: anchor.decl_line },
    gold_recount: goldRecount,
  },
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2), 'utf8');

const r2 = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
console.log('### 对照实验测量台：' + TASK + ' · 配置 ' + CONFIG + ' · 锚点 ' + anchor.symbol + ' @ ' + anchor.decl_file + ':' + anchor.decl_line);
console.log('gold 回仓重数：期望文件 ' + (anchor.expect_files || []).length + ' 个 / 期望命中 ' + anchor.expect_hits + ' 次；实测 ' + goldRecount.files.length + ' 个 / ' + goldRecount.hits + ' 次');
console.log('');
console.log(['状态', '失败模式', '命中', '文件', '调用', '载荷字节', '前置', '单次耗时', '3轮中位', '召回(文件)', '精度(文件)', '召回(命中)', '精度(命中)'].join('\t'));
console.log([status, failure_mode,
  metrics.hits_reported === null ? '—' : metrics.hits_reported,
  metrics.files_reported === null ? '—' : metrics.files_reported.length,
  metrics.calls, metrics.payload_bytes, metrics.prereq_steps,
  metrics.raw_ms[0] + 'ms', metrics.median_ms + 'ms',
  r2(recall.by_files), r2(recall.precision_by_files), r2(recall.by_hits), r2(recall.precision_by_hits)].join('\t'));
if (OUT) console.log('记录已写：' + OUT);
BENCH_EOF
  node "$BENCH_JS" --task "$TASK" --config "$CONFIG" --repo "$REPO" --gold "$GOLD" \
    --anchor "${ANCHOR:-}" --rounds "$ROUNDS" --sdk-records "$SDK_RECORDS" --out "$OUT" --skill-dir "$SKILL_DIR"
  RC=$?
  rm -f "$BENCH_JS"
  exit $RC
fi

[ -n "$PROJECT" ] || { echo "usage: backend-compare.sh <projectDir> --symbol <name> [--file <rel>] [--line N] [--tsserver <js>]" >&2; exit 2; }
[ -n "$SYMBOL" ] || { echo "ERROR: 必须给 --symbol" >&2; exit 2; }
PROJECT="$(cd "$PROJECT" 2>/dev/null && pwd || echo "$PROJECT")"
PROJ_JSON="$(echo "$PROJECT" | sed 's#\\#/#g')"

echo "### 语义后端同题对比：$SYMBOL"
echo "工程：$PROJECT"
echo ""

printf '%-22s %-10s %-12s %-s\n' "引擎" "引用命中" "耗时" "判据 / 备注"
printf '%s\n' "----------------------------------------------------------------------"

# ---------- 1) IDEA + Index MCP（位置法）----------
idea_row() {
  local t0 t1 out kind n
  t0=$(date +%s%N)
  if [ "$LINE" -gt 0 ] && [ -n "$REL_FILE" ]; then
    out=$(bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_find_references \
      "{\"file\":\"$REL_FILE\",\"line\":$LINE,\"column\":8,\"project_path\":\"$PROJ_JSON\"}" 2>&1 | head -c 4000)
  else
    out=$(bash "$SKILL_DIR/scripts/mcp-call.sh" index ide_find_class \
      "{\"query\":\"$SYMBOL\",\"project_path\":\"$PROJ_JSON\"}" 2>&1 | head -c 4000)
  fi
  t1=$(date +%s%N)
  local ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -o '"totalCount":[0-9]*' | head -1 | cut -d: -f2)
  kind=$(echo "$out" | grep -o '"kind":"[^"]*"' | head -1 | cut -d'"' -f4)
  if echo "$out" | grep -q '"classes"'; then
    n=$(echo "$out" | grep -o '"totalCount":[0-9]*' | head -1 | cut -d: -f2)
    kind=$(echo "$out" | grep -o '"kind":"[^"]*"' | head -1 | cut -d'"' -f4)
  fi
  if [ -z "$n" ]; then
    printf '%-22s %-10s %-12s %s\n' "IDEA+Index MCP" "—" "${ms}ms" "未命中/未打开工程：$(echo "$out" | head -c 60)"
  else
    printf '%-22s %-10s %-12s %s\n' "IDEA+Index MCP" "${n}" "${ms}ms" "resolvedSymbol.kind=${kind:-n/a}"
  fi
}

# ---------- 2) codegraph ----------
codegraph_row() {
  [ -d "$PROJECT/.codegraph" ] || { printf '%-22s %-10s %-12s %s\n' "codegraph" "—" "—" "该工程未索引（codegraph init .）"; return; }
  command -v codegraph >/dev/null 2>&1 || { printf '%-22s %-10s %-12s %s\n' "codegraph" "—" "—" "未安装"; return; }
  local t0 t1 out n ms
  t0=$(date +%s%N)
  out=$(cd "$PROJECT" && codegraph impact "$SYMBOL" 2>&1 | head -c 4000)
  t1=$(date +%s%N)
  ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -oE '[0-9]+ affected symbols' | head -1 | grep -oE '^[0-9]+')
  printf '%-22s %-10s %-12s %s\n' "codegraph" "${n:-?}" "${ms}ms" "$(echo "$out" | grep -m1 'Impact of' | cut -c1-40)"
}

# ---------- 3) tsserver（VS Code 的 TS 引擎）----------
tsserver_row() {
  [ -n "$TSSERVER" ] || { printf '%-22s %-10s %-12s %s\n' "tsserver" "—" "—" "未给 --tsserver（VS Code 自带）"; return; }
  local t0 t1 out n ms
  t0=$(date +%s%N)
  out=$(node "$SKILL_DIR/scripts/tsserver-probe.js" "$PROJ_JSON" --symbol "$SYMBOL" --tsserver "$TSSERVER" ${REL_FILE:+--file "$REL_FILE"} ${LINE:+--line "$LINE"} 2>&1 | head -c 8000)
  t1=$(date +%s%N)
  ms=$(( (t1 - t0) / 1000000 ))
  n=$(echo "$out" | grep -oE '命中: [0-9]+' | head -1 | grep -oE '[0-9]+')
  [ -z "$n" ] && n=$(echo "$out" | grep -oE '命中: [0-9]+' | tail -1 | grep -oE '[0-9]+')
  printf '%-22s %-10s %-12s %s\n' "tsserver" "${n:-?}" "${ms}ms（含启动）" "$(echo "$out" | grep -m1 'configFileName' | cut -c1-40)"
}

idea_row
codegraph_row
tsserver_row

echo ""
echo "注：各引擎的『引用』口径不同（IDEA=真代码引用；codegraph=受影响符号，含 import 边与成员；tsserver=引用位置），"
echo "    数字不可直接相减；要比就按同一口径重算。判据看 IDEA 的 resolvedSymbol.kind 是否为代码符号。"
