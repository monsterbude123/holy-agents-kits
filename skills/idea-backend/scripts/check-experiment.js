#!/usr/bin/env node
'use strict';
/**
 * 对照实验门禁（idea-backend / fixtures/experiment）—— 一条命令把三件事判完：
 *
 *   1. **gold 回仓重数**：按每个锚点的 count_scope + file_mask 回仓重数整词命中，
 *      与 gold.json 的 expect_files / expect_hits 对不上 ⇒ 「gold 对不上」（非 0 退出）。
 *   2. **results.json 体检**：6 任务 × 4 配置 = 24 格齐全、每格字段齐、status / failure_mode
 *      取值合法、能力缺席与未取两格免数字但必须带来源、flaky 标注与实测判据一致、
 *      召回与精度能被 gold 与实测命中数重算出来。
 *   3. **results.md ↔ results.json 逐列对账**：人读表与机器凭证必须逐列一致
 *      （**不许退化成「表里出现这个数字就算对上」**）。
 *   4. **凭证卫生**：evidence / metrics.detail 里不许有本机绝对路径（普通形态与 URL 编码形态都拦）、
 *      `raw` 不许是空壳（非空 + 长度下限）、诊断格（scope=diagnostics 且 status=完成）的
 *      问题条数与类型要合 gold 事先写死的判据（条数 ≥ min_count 且类型属 gold 指定的那类）。
 *
 * 用法：
 *   node scripts/check-experiment.js              # 全查（gold + results + 表）
 *   node scripts/check-experiment.js --gold       # 只查 gold（回仓重数）
 *   node scripts/check-experiment.js --render     # 由 results.json 重新生成 results.md（表不许手写）
 *   node scripts/check-experiment.js --normalize  # 把凭证里的本机绝对路径归一化成 <repo>（普通 + URL 编码形态）
 *   node scripts/check-experiment.js --selftest   # 反向自测：故意改坏数据，门禁必须转红
 *
 * 契约：stdout 一行/多行结论；退出码 0 = 通过 / 1 = 有问题。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SKILL = path.join(__dirname, '..');
const EXP = path.join(SKILL, 'fixtures', 'experiment');

const TASKS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
const CONFIGS = ['A', 'B', 'C', 'D'];
const STATUS = ['完成', 'flaky', '能力缺席', '未取', '环境未就绪'];
const FAILURE_MODES = ['无失败', '工具报错', '索引未就绪', '漏引用', '误报', '超时', '静默失效', '能力缺席', '残缺图', '环境未就绪'];
const NUMBER_EXEMPT = ['能力缺席', '未取', '环境未就绪'];
const STATUS_FAILURE_PAIR = {
  // 完成 = 答出来了（对不对由召回/精度说话，缺陷记在失败模式里）
  '完成': ['无失败', '漏引用', '误报', '静默失效'],
  '能力缺席': ['能力缺席'],
  '环境未就绪': ['环境未就绪'],
  // 未取 = 没取到数；静默失效 = 工具没报错但结果无效/为空（返 0 条 ≠ 没有问题）
  '未取': ['环境未就绪', '索引未就绪', '工具报错', '超时', '静默失效'],
  'flaky': FAILURE_MODES,
};
// 耗时极差判据：相对极差 > 20% **且** 绝对极差 ≥ 100ms（绝对下限是口径细化：
// 小于 100ms 的调用的相对抖动是噪声，不算 flaky —— 否则毫秒级调用会把整张表打成 flaky）。
const FLAKY_REL = 0.20;
const FLAKY_ABS_MS = 100;
const RATIO_TOL = 0.006;

// ---- 凭证卫生（机器本地绝对路径 / 空壳 raw / 诊断口径）----
// 本机绝对路径的两种形态：① 盘符形态 D:/workspace/... ② URL 编码形态 file:///d%3A/workspace/...
// 盘符字母**前面必须不是字母数字** —— 否则 JSON 转义（"-> str:\n24"）会假阳性。
const LOCAL_PATH_RE = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|[A-Za-z]%3[Aa][\\/])/;
// 归一化用的仓内相对尾巴（夹具仓根）；本机绝对路径命中它 ⇒ 归一化成 <repo>
const REPO_TAIL = 'skills/idea-backend/fixtures/experiment/repo';
// evidence.raw 的长度下限 —— 凭证不许是空壳。
// 取 16 的理由：本仓最短的真实凭证是 23 字符（`Error: Illegal argument`），16 留 7 字符余量给将来更短的
// 真实错误消息；低于 16 字符的 raw 只可能是人写的空壳（"" / 空白 / "ok" / "n/a" / "..."）。
const RAW_MIN_LEN = 16;
// 「问题类型属语法类」的机器判据（判据写死在门禁里 —— 凭证不许自带判据）：
//   · 反向：任何一条消息命中「类型 / 风格类」措辞 ⇒ 不是语法错，判红；
//   · 正向：每条消息都要命中「解析器措辞」⇒ 这批诊断确实是解析器吐的。
// 措辞来源：IDEA PyPsi（Formal parameter name expected / ':' expected）与 pyright 1.1.414
//           （Expected parameter name / "(" was not closed / Statements must be separated by ...）。
const PARSER_MSG_RES = [
  /\bexpected\b/i, /\bunexpected\b/i, /was not closed/i,
  /not allowed\b/i, /must be separated\b/i, /invalid syntax/i, /syntax error/i,
];
const NON_SYNTAX_MSG_RES = [
  /not assignable/i, /declared type/i, /cannot be assigned/i, /never used/i, /\bunused\b/i,
  /is not defined/i, /could not be resolved/i, /cannot find name/i, /unresolved/i,
];
// 「声明行」的机器判据 —— 行首（允许缩进与修饰符）出现声明关键字，且**紧接着就是该符号**。
// 只判「这一行含有该符号」不够：`def probe_run(item: ProbeItem)` 里也含 ProbeItem，但那是引用不是声明。
const DECL_LINE_RE = /^\s*(?:export\s+|default\s+|declare\s+|abstract\s+|public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|pub\s+)*(?:class|interface|enum|function|def|const|let|var|type|struct|fn|fun|impl|trait|namespace|module)\s+(?:const\s+|enum\s+)?/;

// ---------------------------------------------------------------- 工具函数

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);
const rel = (p) => p.split(path.sep).join('/');

function wordHits(text, symbol) {
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp('\\b' + esc + '\\b', 'g'));
  return m ? m.length : 0;
}

/** 这一行是不是「该符号的声明行」（声明关键字后面紧接着就是该符号） */
function isDeclLine(line, symbol) {
  const m = DECL_LINE_RE.exec(line);
  if (!m) return false;
  const esc = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + esc + '\\b').test(line.slice(m[0].length));
}

function maskToRe(mask) {
  const esc = mask.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp('^' + esc + '$');
}

function collectFiles(root, scopeRel, masks) {
  const scope = path.join(root, scopeRel);
  const res = [];
  if (!fs.existsSync(scope)) return res;
  const res_list = masks.map(maskToRe);
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git' || e.name === '.codegraph' || e.name === 'node_modules' || e.name === '.idea') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && res_list.some((r) => r.test(e.name))) res.push(p);
    }
  })(scope);
  return res;
}

/** 按 count_scope 回仓重数一个锚点 → {files:[相对路径], hits:n} */
function recountAnchor(repoRoot, anchor) {
  const masks = anchor.file_mask || (anchor.file_mask_hint || []);
  const files = collectFiles(repoRoot, anchor.count_scope, masks);
  const hitFiles = [];
  let hits = 0;
  for (const f of files) {
    const n = wordHits(fs.readFileSync(f, 'utf8'), anchor.symbol);
    if (n > 0) {
      hits += n;
      hitFiles.push(rel(path.relative(repoRoot, f)));
    }
  }
  hitFiles.sort();
  return { files: hitFiles, hits };
}

/** Python 解析器是否拒绝这个文件（故意语法错锚点的复核） */
function pythonRejects(file) {
  const script = 'import ast,sys;\ntry:\n ast.parse(open(sys.argv[1],encoding="utf-8").read())\n print("OK")\nexcept SyntaxError:\n print("SYNTAX_ERROR")';
  try {
    const out = execFileSync('python', ['-c', script, file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.trim() === 'SYNTAX_ERROR';
  } catch (e) {
    return null; // python 不可用 ⇒ 无法判定
  }
}

// ---------------------------------------------------------------- 凭证卫生

/** 本机绝对路径泄漏 —— 凭证里只许出现 <repo> / <project> 占位符 */
function checkNoLocalPath(tag, value, problems) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  if (!s) return;
  const m = LOCAL_PATH_RE.exec(s);
  if (m) problems.push(`本机绝对路径泄漏：${tag} 里有「${m[0]}」—— 机器本地绝对路径要归一化成 <repo> / <project>`);
}

/**
 * 诊断格（scope=diagnostics）的判定 —— D-07 事先写死的判据：
 * 「条数 ≥ 1 且类型属语法类」⇒ 机器判法 = 条数 ≥ gold 的 min_count，且**每条**问题消息都是解析器措辞
 * （命中解析器措辞、且不命中类型/风格类措辞）。
 */
function checkDiagnosticsDetail(tag, anchor, cell, problems) {
  const ep = (anchor && anchor.expect_problems) || {};
  const min = isNum(ep.min_count) ? ep.min_count : 1;
  const d = (cell.metrics && cell.metrics.detail) || {};
  if (!isInt(d.problem_count)) {
    problems.push(`诊断口径对不上：${tag} 的 metrics.detail.problem_count 缺或不是整数（gold 要求 ≥ ${min}）`);
  } else if (d.problem_count < min) {
    problems.push(`诊断口径对不上：${tag} 的 metrics.detail.problem_count=${d.problem_count}，gold 要求 ≥ ${min}`);
  }
  const types = d.problem_types;
  if (!Array.isArray(types) || !types.length) {
    problems.push(`诊断口径对不上：${tag} 的 metrics.detail.problem_types 缺 —— 问题类型要属 gold 指定的「${ep.type || 'syntax'}」类`);
    return;
  }
  if (isInt(d.problem_count) && d.problem_count !== types.length) {
    problems.push(`诊断口径对不上：${tag} 的 metrics.detail.problem_count=${d.problem_count} 与 problem_types 的 ${types.length} 条对不上`);
  }
  for (const t of types) {
    const s = String(t);
    if (NON_SYNTAX_MSG_RES.some((re) => re.test(s)))
      problems.push(`诊断口径对不上：${tag} 的问题「${s}」命中类型/风格类措辞 —— 不属 gold 指定的「${ep.type || 'syntax'}」类`);
    else if (!PARSER_MSG_RES.some((re) => re.test(s)))
      problems.push(`诊断口径对不上：${tag} 的问题「${s}」不是解析器措辞 —— 不属 gold 指定的「${ep.type || 'syntax'}」类`);
  }
}

/**
 * 归一化：把机器本地绝对路径换成占位符（仓内夹具仓 → <repo>）。
 * 四种形态一起处理：file:///d%3A/...（URL 编码）、裸的 %3A 形态、普通盘符形态；
 * 分隔符正反斜杠都认（Windows 工具的输出常带反斜杠）。
 * 盘符形态的盘符字母前面必须不是字母数字（否则 "-> str:\n" 会被误改）。
 */
function normalizeLocalPaths(text) {
  const tail = REPO_TAIL.split('/').join('[/\\\\]');
  const head = '(?:[^\\s"\'`]*?[/\\\\])?';
  // ① file:///d%3A/<abs>/<tail>  ⇒  file:///<repo>
  text = text.replace(new RegExp('file:///([A-Za-z])%3[Aa][\\\\/]' + head + tail, 'gi'), 'file:///<repo>');
  // ② 裸的 URL 编码盘符形态
  text = text.replace(new RegExp('(?<![A-Za-z0-9])[A-Za-z]%3[Aa][\\\\/]' + head + tail, 'g'), '<repo>');
  // ③ 普通盘符形态
  text = text.replace(new RegExp('(?<![A-Za-z0-9])[A-Za-z]:[\\\\/]' + head + tail, 'g'), '<repo>');
  return text;
}

/** 深度遍历所有字符串值并归一化；返回 {value, changed} */
function normalizeDeep(value) {
  let changed = false;
  const walk = (v) => {
    if (typeof v === 'string') {
      const n = normalizeLocalPaths(v);
      if (n !== v) changed = true;
      return n;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v)) out[k] = walk(v[k]);
      return out;
    }
    return v;
  };
  return { value: walk(value), changed };
}

// ---------------------------------------------------------------- 检查项

function checkGold(gold, repoRoot, problems) {
  const bad = (m) => problems.push('gold 对不上：' + m);
  if (!gold || !Array.isArray(gold.anchors) || !gold.anchors.length) {
    bad('gold.json 缺 anchors[]');
    return;
  }
  for (const a of gold.anchors) {
    const need = ['id', 'lang', 'symbol', 'decl_file', 'decl_line', 'expect_files', 'expect_hits', 'count_scope', 'normalization'];
    for (const k of need) if (a[k] === undefined) bad(`锚点 ${a.id || '?'} 缺字段 ${k}`);
    if (a.expect_files === undefined || a.expect_hits === undefined) continue;
    const got = recountAnchor(repoRoot, a);
    const expFiles = [...(a.expect_files || [])].sort();
    if (JSON.stringify(got.files) !== JSON.stringify(expFiles))
      bad(`锚点 ${a.id} 的命中文件集合对不上：期望 ${JSON.stringify(expFiles)}，实测 ${JSON.stringify(got.files)}`);
    if (got.hits !== a.expect_hits)
      bad(`锚点 ${a.id} 的整词命中数对不上：期望 ${a.expect_hits}，实测 ${got.hits}`);
    if (a.expect_problems && a.expect_problems.parse_error) {
      const f = path.join(repoRoot, a.decl_file);
      if (!fs.existsSync(f)) bad(`锚点 ${a.id} 的 decl_file 不存在：${a.decl_file}`);
      else {
        const rej = pythonRejects(f);
        if (rej === false) bad(`锚点 ${a.id}：${a.decl_file} 本该被 Python 解析器拒绝，却解析成功了`);
        else if (rej === null) problems.push(`WARN 锚点 ${a.id}：本机没有 python，跳过 parse_error 复核`);
      }
    }
    // decl_line 必须真的指着该符号的**声明行**（夹具行号漂移 ⇒ 判红；只核 decl_file 存在是不够的；
    // 只核「这一行含有该符号」也不够 —— `def probe_run(item: ProbeItem)` 含 ProbeItem 但不是它的声明）
    if (a.decl_file && a.decl_line && a.symbol) {
      const df = path.join(repoRoot, a.decl_file);
      if (fs.existsSync(df)) {
        const lines = fs.readFileSync(df, 'utf8').split(/\r?\n/);
        const line = lines[a.decl_line - 1];
        if (line === undefined) bad(`锚点 ${a.id} 的 decl_line ${a.decl_line} 超出 ${a.decl_file} 的行数（${lines.length}）`);
        else if (!wordHits(line, a.symbol))
          bad(`锚点 ${a.id} 的 decl_line ${a.decl_line} 上没有符号 ${a.symbol}（该行是「${line.trim()}」）`);
        else if (!isDeclLine(line, a.symbol))
          bad(`锚点 ${a.id} 的 decl_line ${a.decl_line} 不是 ${a.symbol} 的声明行（该行是「${line.trim()}」）`);
      }
    }
  }
  // G-03-15：诊断口径的判据不许被真值文件关掉 ——
  //   带 expect_problems 的锚点集合 **必须等于** 被 diagnostics 口径任务用到的锚点集合。
  //   （少带 ⇒ 判据没了；scope 被改成 references ⇒ 判据被关掉）
  const tasks = (gold && gold.tasks) || [];
  const anchors = (gold && gold.anchors) || [];
  const diagIds = new Set();
  for (const t of tasks) if (t.scope === 'diagnostics') for (const aid of t.anchors || []) diagIds.add(aid);
  for (const a of anchors) {
    const ep = a.expect_problems;
    const hasEp = !!(ep && isNum(ep.min_count) && ep.type);
    if (diagIds.has(a.id) && !hasEp)
      bad(`锚点 ${a.id} 被诊断口径的任务用到，却缺 expect_problems（min_count + type）—— 诊断判据不许被真值文件关掉`);
    if (!diagIds.has(a.id) && ep)
      bad(`锚点 ${a.id} 带 expect_problems 却没有诊断口径的任务用它 —— 诊断判据与真值口径对不上（scope 被降级？）`);
  }
}

function findAnchor(gold, symbol, file) {
  if (!gold || !Array.isArray(gold.anchors)) return null;
  return gold.anchors.find((a) => a.symbol === symbol && a.decl_file === file) || null;
}

/** 召回与精度的算式（唯一口径：tasks.md §3 + gold.json 的 scopes） */
function scopeGold(anchor, scope) {
  // 返回该口径下「文件 gold 集合」与「命中 gold 数」；null = 该口径不适用
  switch (scope) {
    case 'definition':
      return { files: [anchor.decl_file], hits: 1 };
    case 'references':
    case 'per_language':
      return { files: anchor.expect_files || [], hits: anchor.expect_hits };
    case 'impact':
      return { files: anchor.expect_files || [], hits: null };
    case 'diagnostics':
      return { files: null, hits: null };
    default:
      return { files: anchor.expect_files || [], hits: anchor.expect_hits };
  }
}

function recallOf(anchor, m, scope) {
  const g = scopeGold(anchor, scope || 'references');
  const files = m.files_reported || [];
  const goldFiles = g.files;
  const inter = goldFiles ? files.filter((f) => goldFiles.includes(f)).length : null;
  const by_files = goldFiles ? (goldFiles.length ? inter / goldFiles.length : null) : null;
  const precision_by_files = goldFiles && files.length ? inter / files.length : null;
  let by_hits = null;
  let precision_by_hits = null;
  if (isNum(m.hits_normalized) && isNum(g.hits)) {
    by_hits = g.hits ? Math.min(m.hits_normalized, g.hits) / g.hits : null;
    precision_by_hits = m.hits_normalized ? Math.min(m.hits_normalized, g.hits) / m.hits_normalized : null;
  }
  return { by_files, precision_by_files, by_hits, precision_by_hits };
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** 耗时极差是否达到 flaky 判据 */
function isFlakyByTime(raw) {
  if (!Array.isArray(raw) || raw.length < 2) return false;
  const mx = Math.max(...raw);
  const mn = Math.min(...raw);
  const med = median(raw);
  return (mx - mn) / med > FLAKY_REL && (mx - mn) >= FLAKY_ABS_MS;
}

function checkMetricsBlock(tag, m, problems, required) {
  const need = required
    ? ['calls', 'payload_bytes', 'prereq_steps', 'raw_ms', 'median_ms', 'hits_reported', 'files_reported']
    : [];
  for (const k of need) if (m[k] === undefined) problems.push(`字段缺失：${tag} 的 metrics.${k}`);
  if (m.raw_ms !== undefined) {
    if (!Array.isArray(m.raw_ms) || m.raw_ms.length !== 3 || !m.raw_ms.every(isNum))
      problems.push(`字段缺失：${tag} 的 metrics.raw_ms 必须是 3 个数字`);
    else if (isNum(m.median_ms) && Math.abs(median(m.raw_ms) - m.median_ms) > 0.05)
      problems.push(`字段缺失：${tag} 的 median_ms 与 raw_ms 的中位对不上（${m.median_ms} vs ${median(m.raw_ms).toFixed(1)}）`);
  }
  if (m.hits_reported !== undefined && m.hits_reported !== null && !isInt(m.hits_reported))
    problems.push(`字段缺失：${tag} 的 metrics.hits_reported 必须是整数或 null`);
  if (m.files_reported !== undefined && m.files_reported !== null && !Array.isArray(m.files_reported))
    problems.push(`字段缺失：${tag} 的 metrics.files_reported 必须是数组或 null`);
  if (m.calls !== undefined && !isInt(m.calls)) problems.push(`字段缺失：${tag} 的 metrics.calls 必须是整数`);
}

function checkRecallBlock(tag, anchor, m, r, problems, scope) {
  if (!r || typeof r !== 'object') {
    problems.push(`字段缺失：${tag} 缺 recall{}`);
    return;
  }
  for (const k of ['by_files', 'precision_by_files', 'by_hits', 'precision_by_hits'])
    if (!(k in r)) problems.push(`字段缺失：${tag} 的 recall.${k}`);
  if (!anchor || !m) return;
  const g = scopeGold(anchor, scope);
  if (!g.files && m.files_reported !== null && m.files_reported !== undefined)
    problems.push(`字段缺失：${tag} 的口径是 ${scope}（文件口径不适用）⇒ files_reported 应为 null`);
  if (!isNum(g.hits) && m.hits_normalized !== null && m.hits_normalized !== undefined)
    problems.push(`字段缺失：${tag} 的口径是 ${scope}（命中口径不适用）⇒ hits_normalized 应为 null`);
  const hasNums = Array.isArray(m.files_reported) || isNum(m.hits_normalized);
  if (!hasNums) return;
  const calc = recallOf(anchor, m, scope);
  for (const k of ['by_files', 'precision_by_files', 'by_hits', 'precision_by_hits']) {
    const got = r[k];
    const want = calc[k];
    if (want === null) {
      if (got !== null && got !== undefined) problems.push(`字段缺失：${tag} 的 recall.${k} 应为 null（口径不同义/不适用）`);
      continue;
    }
    if (!isNum(got)) { problems.push(`字段缺失：${tag} 的 recall.${k} 缺数字`); continue; }
    if (Math.abs(got - want) > RATIO_TOL)
      problems.push(`字段缺失：${tag} 的 recall.${k} 与真值算式不符（表里 ${got}，按 gold 与实测命中数应为 ${want.toFixed(3)}）`);
  }
}

function checkResults(results, gold, problems) {
  if (!results || !Array.isArray(results.cells)) {
    problems.push('结果缺格：results.json 缺 cells[]');
    return;
  }
  const taskSpecs = new Map(((gold && gold.tasks) || []).map((t) => [t.id, t]));
  const cells = results.cells;
  if (cells.length !== TASKS.length * CONFIGS.length)
    problems.push(`结果缺格：cells[] 有 ${cells.length} 格，应为 ${TASKS.length * CONFIGS.length} 格（6 任务 × 4 配置）`);
  const seen = new Set();
  cells.forEach((c, i) => {
    const tag = `cells[${i}]（${c && c.task}/${c && c.config}）`;
    for (const k of ['task', 'config', 'status', 'failure_mode', 'anchor', 'metrics', 'recall', 'evidence', 'source'])
      if (c[k] === undefined) problems.push(`字段缺失：${tag} 缺 ${k}`);
    if (!TASKS.includes(c.task)) problems.push(`字段缺失：${tag} 的 task 不在 6 个任务里`);
    if (!CONFIGS.includes(c.config)) problems.push(`字段缺失：${tag} 的 config 不在 A/B/C/D 里`);
    const key = c.task + '/' + c.config;
    if (seen.has(key)) problems.push(`结果缺格：${key} 有多格`);
    seen.add(key);
    if (!STATUS.includes(c.status)) problems.push(`失败模式取值非法：${tag} 的 status=${c.status}`);
    if (!FAILURE_MODES.includes(c.failure_mode)) problems.push(`失败模式取值非法：${tag} 的 failure_mode=${c.failure_mode}`);
    const allow = STATUS_FAILURE_PAIR[c.status];
    if (allow && !allow.includes(c.failure_mode))
      problems.push(`失败模式取值非法：${tag} 的 status=${c.status} 与 failure_mode=${c.failure_mode} 不匹配`);
    if (c.anchor && (c.anchor.symbol === undefined || c.anchor.file === undefined || c.anchor.line === undefined))
      problems.push(`字段缺失：${tag} 的 anchor{symbol,file,line} 不全`);
    const spec = taskSpecs.get(c.task);
    const scope = spec ? spec.scope : 'references';
    if (!spec) problems.push(`字段缺失：${tag} 的任务 ${c.task} 不在 gold.json 的 tasks[] 里`);
    const exempt = NUMBER_EXEMPT.includes(c.status);
    checkMetricsBlock(tag, c.metrics || {}, problems, !exempt);
    if (exempt) {
      if (!String(c.source || '').trim())
        problems.push(`字段缺失：${tag} 是「${c.status}」格 —— 免数字但必须带可核对的来源`);
    } else {
      if (!String(c.source || '').trim())
        problems.push(`字段缺失：${tag} 缺 source`);
      if (!Array.isArray(c.evidence) || !c.evidence.length)
        problems.push(`字段缺失：${tag} 缺 evidence[]（原始输出凭证不许手写）`);
      else
        c.evidence.forEach((e, j) => {
          for (const k of ['round', 'tool', 'at', 'elapsed_ms', 'payload_bytes', 'raw'])
            if (e[k] === undefined) problems.push(`字段缺失：${tag} 的 evidence[${j}] 缺 ${k}`);
          // raw 键存在不算数 —— 它必须真的是一段原始输出（非空 + 长度下限）
          if (typeof e.raw !== 'string' || !e.raw.trim())
            problems.push(`凭证是空壳：${tag} 的 evidence[${j}].raw 是空的 —— 原始输出片段不许留空`);
          else if (e.raw.trim().length < RAW_MIN_LEN)
            problems.push(`凭证是空壳：${tag} 的 evidence[${j}].raw 只有 ${e.raw.trim().length} 字符（下限 ${RAW_MIN_LEN}）—— 不是工具的真实输出`);
          checkNoLocalPath(`${tag} 的 evidence[${j}]`, e, problems);
        });
    }
    // metrics.detail 与 source 里也不许有本机绝对路径（两者都是凭证的一部分）
    if (c.metrics && c.metrics.detail) checkNoLocalPath(`${tag} 的 metrics.detail`, c.metrics.detail, problems);
    checkNoLocalPath(`${tag} 的 source`, c.source, problems);
    // 锚点必须在 gold 里，且必须属于该任务的锚点
    let anchor = null;
    if (c.anchor && c.anchor.symbol) {
      anchor = findAnchor(gold, c.anchor.symbol, c.anchor.file);
      if (!anchor) problems.push(`字段缺失：${tag} 的锚点 ${c.anchor.symbol}@${c.anchor.file} 不在 gold.json 里`);
      else if (spec && !(spec.anchors || []).includes(anchor.id))
        problems.push(`字段缺失：${tag} 的锚点 ${anchor.id} 不属于任务 ${c.task}（该任务的锚点是 ${(spec.anchors || []).join('、')}）`);
    }
    checkRecallBlock(tag, anchor, c.metrics || {}, c.recall, problems, scope);
    // 诊断口径（scope=diagnostics）：status=完成 ⇒ 条数 ≥ gold 的 min_count 且类型属 gold 指定的那类
    if (scope === 'diagnostics' && c.status === '完成' && anchor)
      checkDiagnosticsDetail(tag, anchor, c, problems);
    // flaky 标注与实测判据一致（命中数不一致 **或** 耗时极差到判据）
    if (c.metrics && Array.isArray(c.metrics.raw_ms) && c.metrics.raw_ms.length === 3) {
      const byTime = isFlakyByTime(c.metrics.raw_ms);
      const rh = c.metrics.raw_hits;
      const hitsVary = Array.isArray(rh) && rh.length === 3 && new Set(rh.map((x) => JSON.stringify(x))).size > 1;
      if (c.status === 'flaky' && !byTime && !hitsVary)
        problems.push(`失败模式取值非法：${tag} 标了 flaky，但三轮命中数一致且耗时没到极差判据（>${FLAKY_REL * 100}% 且 ≥${FLAKY_ABS_MS}ms）`);
      if (c.status === '完成' && (byTime || hitsVary))
        problems.push(`失败模式取值非法：${tag} 满足 flaky 判据（${hitsVary ? '命中数不一致' : '耗时极差'}），却标成了「完成」`);
      if (Array.isArray(rh) && rh.length === 3) {
        const common = rh.every((x) => JSON.stringify(x) === JSON.stringify(rh[0])) ? rh[0] : null;
        if (JSON.stringify(c.metrics.hits_reported) !== JSON.stringify(common))
          problems.push(`字段缺失：${tag} 的 metrics.hits_reported（${JSON.stringify(c.metrics.hits_reported)}）与三轮实测（${JSON.stringify(rh)}）对不上`);
      }
    }
    // T6 的分语言明细
    if (c.metrics && c.metrics.by_lang) {
      for (const [lang, v] of Object.entries(c.metrics.by_lang)) {
        const t2 = `${tag} 的 by_lang.${lang}`;
        if (!v || v.absent) {
          if (!NUMBER_EXEMPT.includes(c.status))
            problems.push(`失败模式取值非法：${t2} 记了能力缺席，但整格状态是「${c.status}」（该状态必须是能力缺席/未取/环境未就绪）`);
          continue;
        }
        const a2 = findAnchor(gold, v.symbol, v.file);
        if (!a2) { problems.push(`字段缺失：${t2} 的锚点 ${v.symbol}@${v.file} 不在 gold.json 里`); continue; }
        checkRecallBlock(t2, a2, v, v.recall, problems, 'references');
      }
    }
  });
  for (const t of TASKS) for (const c of CONFIGS)
    if (!seen.has(t + '/' + c)) problems.push(`结果缺格：${t}/${c} 这一格没有`);
}

// ---------------------------------------------------------------- results.md 对账

const MD_HEADER = ['任务', '配置', '锚点', '状态', '失败模式', '召回与精度', '调用次数', '载荷字节', '前置步数', '单次耗时', '3 轮中位', '证据指针', '来源'];

function fmtRatio(v) {
  return v === null || v === undefined ? '—' : Number(v).toFixed(2);
}
function fmtMs(v) {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(1)}ms`;
}
function anchorText(a) {
  return a ? `${a.symbol} @ ${a.file}:${a.line}` : '—';
}
function recallText(r) {
  if (!r) return '—';
  return `文件 ${fmtRatio(r.by_files)}/${fmtRatio(r.precision_by_files)} · 命中 ${fmtRatio(r.by_hits)}/${fmtRatio(r.precision_by_hits)}`;
}

/** 由 results.json 生成人读表（表不许手写 ⇒ 数字只能从 json 来） */
function renderTable(results) {
  const lines = [];
  lines.push('| ' + MD_HEADER.join(' | ') + ' |');
  lines.push('|' + MD_HEADER.map(() => '---').join('|') + '|');
  results.cells.forEach((c, i) => {
    const m = c.metrics || {};
    const r = c.recall || {};
    const cells = [
      c.task,
      c.config,
      anchorText(c.anchor),
      c.status,
      c.failure_mode,
      recallText(r),
      m.calls === undefined || m.calls === null ? '—' : String(m.calls),
      m.payload_bytes === undefined || m.payload_bytes === null ? '—' : String(m.payload_bytes),
      m.prereq_steps === undefined || m.prereq_steps === null ? '—' : String(m.prereq_steps),
      fmtMs(Array.isArray(m.raw_ms) ? m.raw_ms[0] : null),
      fmtMs(m.median_ms),
      `cells[${i}].evidence`,
      String(c.source || '').replace(/\|/g, '/'),
    ];
    lines.push('| ' + cells.join(' | ') + ' |');
  });
  // 附表：T6 的分语言明细（按语言分列，不合并成一个数）
  const langCells = results.cells.filter((c) => c.task === 'T6' && c.metrics && c.metrics.by_lang);
  if (langCells.length) {
    lines.push('');
    lines.push('## T6 · 分语言明细（按语言分列，不合并成一个数）');
    lines.push('');
    lines.push('| 任务 | 配置 | 语言 | 锚点 | 状态 | 命中 | 命中文件 | 召回·文件 | 精度·文件 | 召回·命中 | 精度·命中 | 备注 |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    langCells.forEach((c) => {
      for (const [lang, v] of Object.entries(c.metrics.by_lang)) {
        if (!v || v.absent) {
          lines.push('| ' + [c.task, c.config, lang, '—', '能力缺席', '—', '—', '—', '—', '—', '—', String((v && v.absent) || '').split('|').join('/')].join(' | ') + ' |');
          continue;
        }
        const r = v.recall || {};
        const note = (v.hits_normalized === null || v.hits_normalized === undefined)
          ? '命中口径不适用（口径不同义）' : ('命中口径归一后 ' + v.hits_normalized + ' 次');
        lines.push('| ' + [c.task, c.config, lang, anchorText(v), c.status,
          v.hits_reported === null ? '—' : v.hits_reported, (v.files_reported || []).length,
          fmtRatio(r.by_files), fmtRatio(r.precision_by_files), fmtRatio(r.by_hits), fmtRatio(r.precision_by_hits), note].join(' | ') + ' |');
      }
    });
  }
  // 附表：T5 的诊断明细（问题条数与类型）
  const diagCells = results.cells.filter((c) => c.task === 'T5');
  if (diagCells.length) {
    lines.push('');
    lines.push('## T5 · 单文件诊断明细（问题条数与类型；判定口径 = 条数 ≥ 1 且类型属语法类）');
    lines.push('');
    lines.push('| 任务 | 配置 | 状态 | 失败模式 | 问题条数 | 问题类型 / 备注 | 证据指针 |');
    lines.push('|---|---|---|---|---|---|---|');
    diagCells.forEach((c) => {
      const i = results.cells.indexOf(c);
      const d = (c.metrics && c.metrics.detail) || {};
      const n = d.problem_count === undefined ? '—' : d.problem_count;
      const types = Array.isArray(d.problem_types) ? d.problem_types.join(' / ') : (d.note || '—');
      lines.push('| ' + [c.task, c.config, c.status, c.failure_mode, n, String(types).split('|').join('/'), 'cells[' + i + '].evidence'].join(' | ') + ' |');
    });
  }
  return lines.join('\n') + '\n';
}

function parseMdRows(md) {
  const lines = md.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('|') && t.includes('任务') && t.includes('配置') && t.includes('锚点')) { start = i; break; }
  }
  if (start < 0) return null;
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) break;
    if (/^\|[\s\-|]+\|?$/.test(t)) continue;
    const parts = t.replace(/^\|/, '').replace(/\|$/, '').split('|').map((s) => s.trim());
    rows.push(parts);
  }
  return rows;
}

function checkTable(results, md, problems) {
  const rows = parseMdRows(md);
  if (!rows) { problems.push('表与凭证不一致：results.md 里找不到数据表（表头行）'); return; }
  if (rows.length !== results.cells.length)
    problems.push(`表与凭证不一致：results.md 有 ${rows.length} 行数据，应为 ${results.cells.length} 行（24 格）`);
  const byKey = new Map();
  results.cells.forEach((c, i) => byKey.set(c.task + '/' + c.config, { c, i }));
  const seen = new Set();
  rows.forEach((r, ri) => {
    if (r.length !== MD_HEADER.length) {
      problems.push(`表与凭证不一致：第 ${ri + 1} 行列数 ${r.length}，应为 ${MD_HEADER.length}`);
      return;
    }
    const key = r[0] + '/' + r[1];
    if (!byKey.has(key)) { problems.push(`表与凭证不一致：第 ${ri + 1} 行的 ${key} 在 results.json 里没有对应格`); return; }
    if (seen.has(key)) problems.push(`表与凭证不一致：${key} 在表里出现了多行`);
    seen.add(key);
    const { c, i } = byKey.get(key);
    const m = c.metrics || {};
    const rc = c.recall || {};
    const eq = (col, got, want) => {
      if (String(got).trim() !== String(want).trim())
        problems.push(`表与凭证不一致：${key} 的「${col}」列是「${got}」，results.json 里是「${want}」`);
    };
    eq('状态', r[3], c.status);
    eq('失败模式', r[4], c.failure_mode);
    eq('锚点', r[2].replace(/`/g, ''), anchorText(c.anchor));
    eq('召回与精度', r[5], recallText(rc));
    eq('调用次数', r[6], m.calls === undefined || m.calls === null ? '—' : String(m.calls));
    eq('载荷字节', r[7], m.payload_bytes === undefined || m.payload_bytes === null ? '—' : String(m.payload_bytes));
    eq('前置步数', r[8], m.prereq_steps === undefined || m.prereq_steps === null ? '—' : String(m.prereq_steps));
    eq('单次耗时', r[9], fmtMs(Array.isArray(m.raw_ms) ? m.raw_ms[0] : null));
    eq('3 轮中位', r[10], fmtMs(m.median_ms));
    if (!/cells\[\d+\]\.evidence/.test(r[11]))
      problems.push(`表与凭证不一致：${key} 的「证据指针」列没有指向 results.json 的 cells[]（现在写的是「${r[11]}」）`);
    else if (Number(r[11].match(/cells\[(\d+)\]/)[1]) !== i)
      problems.push(`表与凭证不一致：${key} 的「证据指针」列指向了 cells[${r[11].match(/cells\[(\d+)\]/)[1]}]，应是 cells[${i}]`);
    eq('来源', r[12], String(c.source || '').replace(/\|/g, '/'));
  });
  for (const key of byKey.keys())
    if (!seen.has(key)) problems.push(`表与凭证不一致：${key} 这一格在 results.md 里没有对应行`);
}

// ---------------------------------------------------------------- 入口

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { return null; }
}

function runAll({ goldPath, resultsPath, mdPath, repoRoot, skipGold, skipResults, skipTable }) {
  const problems = [];
  const gold = skipGold ? null : loadJson(goldPath);
  if (!skipGold && !gold) problems.push('gold 对不上：gold.json 读不出来或不是合法 JSON');
  const results = skipResults ? null : loadJson(resultsPath);
  if (!skipResults && !results) problems.push('结果缺格：results.json 读不出来或不是合法 JSON');
  const md = !skipTable && fs.existsSync(mdPath) ? fs.readFileSync(mdPath, 'utf8') : null;
  if (!skipTable && md === null) problems.push('表与凭证不一致：results.md 不存在');
  if (!skipGold) checkGold(gold, repoRoot, problems);
  if (!skipResults) checkResults(results, gold, problems);
  if (!skipTable && md !== null && results) checkTable(results, md, problems);
  return problems;
}

// ---------------------------------------------------------------- 反向自测

function selftest() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-experiment-selftest-'));
  const repo = path.join(tmp, 'repo');
  const mk = (p, content) => {
    const f = path.join(repo, p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content, 'utf8');
  };
  // 第 4 行既含 ProbeItem 又不是它的声明行（`def probe_run(item: ProbeItem)`）——
  // 用来验证「decl_line 必须是声明行」这条判据比「这一行含有该符号」严
  mk('py/src/probe_item.py', 'class ProbeItem:\n    pass\n\ndef probe_run(item: ProbeItem):\n    pass\n');
  mk('py/src/probe_consumer.py', 'from probe_item import ProbeItem\n');
  mk('py/src/probe_broken.py', 'def broken(:\n    return 1\n');
  mk('ts/src/alpha.ts', 'export interface ProbeItem {}\n');

  const gold = {
    tasks: [
      { id: 'T1', title: '按名找定义', anchors: ['py_probe_item'], scope: 'definition' },
      { id: 'T2', title: '按位置找定义', anchors: ['py_probe_run'], scope: 'definition' },
      { id: 'T3', title: '找引用', anchors: ['py_probe_item'], scope: 'references' },
      { id: 'T4', title: '影响面', anchors: ['py_probe_item'], scope: 'impact' },
      { id: 'T5', title: '单文件诊断', anchors: ['py_broken'], scope: 'diagnostics' },
      { id: 'T6', title: '跨语言', anchors: ['py_probe_item', 'ts_probe_item'], scope: 'per_language' },
    ],
    anchors: [
      { id: 'py_probe_item', lang: 'python', symbol: 'ProbeItem', decl_file: 'py/src/probe_item.py', decl_line: 1, expect_files: ['py/src/probe_consumer.py', 'py/src/probe_item.py'], expect_hits: 3, count_scope: 'py/', file_mask: ['*.py'], normalization: {} },
      { id: 'py_probe_run', lang: 'python', symbol: 'probe_run', decl_file: 'py/src/probe_item.py', decl_line: 4, expect_files: ['py/src/probe_item.py'], expect_hits: 1, count_scope: 'py/', file_mask: ['*.py'], normalization: {} },
      { id: 'py_broken', lang: 'python', symbol: 'broken', decl_file: 'py/src/probe_broken.py', decl_line: 1, expect_files: ['py/src/probe_broken.py'], expect_hits: 1, count_scope: 'py/', file_mask: ['*.py'], expect_problems: { parse_error: true, min_count: 1, type: 'syntax' }, normalization: {} },
      { id: 'ts_probe_item', lang: 'typescript', symbol: 'ProbeItem', decl_file: 'ts/src/alpha.ts', decl_line: 1, expect_files: ['ts/src/alpha.ts'], expect_hits: 1, count_scope: 'ts/', file_mask: ['*.ts', '*.tsx'], normalization: {} },
    ],
  };
  const goldPath = path.join(tmp, 'gold.json');
  fs.writeFileSync(goldPath, JSON.stringify(gold, null, 2), 'utf8');

  const byId = new Map(gold.anchors.map((a) => [a.id, a]));
  const cells = [];
  for (const spec of gold.tasks) {
    const anchor = byId.get(spec.anchors[0]);
    for (const cfg of CONFIGS) {
      const metrics = {
        calls: 1, payload_bytes: 100, prereq_steps: 0, raw_ms: [10, 10, 10], median_ms: 10,
        hits_reported: null, hits_normalized: null, files_reported: null, setup_calls: 0,
      };
      if (spec.scope === 'definition') {
        metrics.hits_reported = 1; metrics.hits_normalized = 1;
        metrics.files_reported = [anchor.decl_file];
      } else if (spec.scope === 'references' || spec.scope === 'per_language') {
        metrics.hits_reported = anchor.expect_hits; metrics.hits_normalized = anchor.expect_hits;
        metrics.files_reported = anchor.expect_files.slice();
      } else if (spec.scope === 'impact') {
        metrics.files_reported = anchor.expect_files.slice();
      }
      if (spec.scope === 'diagnostics') {
        // 诊断格要有可判的明细（条数 + 类型）—— 否则门禁的诊断口径无从核
        metrics.detail = { problem_count: 1, problem_types: ['Expected parameter name'] };
      }
      const recall = recallOf(anchor, metrics, spec.scope);
      cells.push({
        task: spec.id, config: cfg, status: '完成', failure_mode: '无失败',
        anchor: { symbol: anchor.symbol, file: anchor.decl_file, line: anchor.decl_line },
        metrics, recall,
        evidence: [{ round: 1, tool: 'selftest', arguments: {}, at: '2026-11-22T00:00:00.000+08:00', elapsed_ms: 10, payload_bytes: 100, raw: 'selftest raw output —— 原始输出片段占位' }],
        source: 'selftest',
      });
    }
  }
  const results = { meta: { rounds: 3 }, cells };
  const resultsPath = path.join(tmp, 'results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
  const mdPath = path.join(tmp, 'results.md');
  fs.writeFileSync(mdPath, renderTable(results), 'utf8');

  const base = { goldPath, resultsPath, mdPath, repoRoot: repo };
  const baseProblems = runAll(base);
  if (baseProblems.length) {
    console.error('SELFTEST 基线本该是绿的，却报：');
    baseProblems.forEach((p) => console.error('  - ' + p));
    console.error('反例未被发现');
    return 1;
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const writeAll = (g, r, m) => {
    fs.writeFileSync(goldPath, JSON.stringify(g, null, 2), 'utf8');
    fs.writeFileSync(resultsPath, JSON.stringify(r, null, 2), 'utf8');
    fs.writeFileSync(mdPath, m, 'utf8');
  };
  const cases = [
    {
      name: 'gold 的 expect_hits 被改坏',
      expect: 'gold 对不上',
      run() {
        const g = clone(gold); g.anchors[0].expect_hits = 99;
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: 'gold 的 expect_files 被改坏',
      expect: 'gold 对不上',
      run() {
        const g = clone(gold); g.anchors[0].expect_files = ['py/src/probe_item.py'];
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: '少一格（23 格）',
      expect: '结果缺格',
      run() {
        const r = clone(results); r.cells.pop();
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '一格缺字段（source）',
      expect: '字段缺失',
      run() {
        const r = clone(results); delete r.cells[3].source;
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '失败模式取值非法',
      expect: '失败模式取值非法',
      run() {
        const r = clone(results); r.cells[5].failure_mode = '玄学';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '能力缺席格没有来源',
      expect: '字段缺失',
      run() {
        const r = clone(results);
        r.cells[7].status = '能力缺席'; r.cells[7].failure_mode = '能力缺席';
        r.cells[7].source = '';
        r.cells[7].metrics = { calls: 0, payload_bytes: 0, prereq_steps: 0, raw_ms: [], median_ms: null, hits_reported: null, files_reported: null };
        r.cells[7].recall = { by_files: null, precision_by_files: null, by_hits: null, precision_by_hits: null };
        r.cells[7].evidence = [];
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '中位数与 raw_ms 对不上',
      expect: '字段缺失',
      run() {
        const r = clone(results); r.cells[2].metrics.median_ms = 999;
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '召回/精度与真值算式不符',
      expect: '字段缺失',
      run() {
        const r = clone(results); r.cells[9].recall.by_hits = 0.5;
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '格子的锚点不属于该任务',
      expect: '字段缺失',
      run() {
        const r = clone(results);
        r.cells[0].anchor = { symbol: 'probe_run', file: 'py/src/probe_item.py', line: 2 };
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '表里的数字被改坏',
      expect: '表与凭证不一致',
      run() {
        const r = clone(results);
        const md = renderTable(r).replace('| 1 | 100 | 0 |', '| 7 | 100 | 0 |');
        writeAll(clone(gold), r, md);
      },
    },
    {
      name: '表少一行',
      expect: '表与凭证不一致',
      run() {
        const r = clone(results);
        const md = renderTable(r).split('\n').filter((l, i) => !(l.startsWith('| T6'))).join('\n');
        writeAll(clone(gold), r, md);
      },
    },
    {
      name: '耗时极差到判据却标成完成',
      expect: '失败模式取值非法',
      run() {
        const r = clone(results);
        r.cells[0].metrics.raw_ms = [10, 300, 900];
        r.cells[0].metrics.median_ms = 300;
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: 'evidence 的 raw 被清空',
      expect: '凭证是空壳',
      run() {
        const r = clone(results);
        r.cells[0].evidence[0].raw = '';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: 'evidence 的 raw 是占位短串',
      expect: '凭证是空壳',
      run() {
        const r = clone(results);
        r.cells[0].evidence[0].raw = 'ok';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '凭证里泄漏本机绝对路径（盘符形态）',
      expect: '本机绝对路径泄漏',
      run() {
        const r = clone(results);
        r.cells[0].evidence[0].raw = 'D:/workspace/holy-agents-kits/skills/idea-backend/x/y.py';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '凭证里泄漏本机绝对路径（URL 编码形态）',
      expect: '本机绝对路径泄漏',
      run() {
        const r = clone(results);
        r.cells[0].evidence[0].raw = 'file:///d%3A/workspace/holy-agents-kits/skills/idea-backend/x/y.py';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: 'metrics.detail 里泄漏本机绝对路径',
      expect: '本机绝对路径泄漏',
      run() {
        const r = clone(results);
        r.cells[10].metrics.detail = { rows: ['16|8|d:/workspace/holy-agents-kits/x/y.py|7|8'] };
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '诊断格的问题条数低于 gold 的 min_count',
      expect: '诊断口径对不上',
      run() {
        const r = clone(results);
        r.cells[16].metrics.detail.problem_count = 0;
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: '诊断格的问题类型不属语法类',
      expect: '诊断口径对不上',
      run() {
        const r = clone(results);
        r.cells[16].metrics.detail.problem_types = ['Type "int" is not assignable to declared type "str"'];
        writeAll(clone(gold), r, renderTable(r));
      },
    },
    {
      name: 'gold 的 decl_line 漂移到别的行',
      expect: 'gold 对不上',
      run() {
        const g = clone(gold); g.anchors[2].decl_line = 2;
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: 'gold 的 decl_line 指向含该符号但不是声明行的行',
      expect: '不是 ProbeItem 的声明行',
      run() {
        const g = clone(gold); g.anchors[0].decl_line = 4;
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: '诊断锚点删掉 expect_problems（诊断判据被真值文件关掉）',
      expect: '缺 expect_problems',
      run() {
        const g = clone(gold); delete g.anchors[2].expect_problems;
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: '诊断任务的 scope 被降级成 references（诊断判据被关掉）',
      expect: 'scope 被降级',
      run() {
        const g = clone(gold); g.tasks[4].scope = 'references';
        const r = clone(results); writeAll(g, r, renderTable(r));
      },
    },
    {
      name: 'source 里泄漏本机绝对路径',
      expect: '本机绝对路径泄漏',
      run() {
        const r = clone(results);
        r.cells[0].source = '本机实测 —— D:/workspace/holy-agents-kits/skills/idea-backend/x/y.py';
        writeAll(clone(gold), r, renderTable(r));
      },
    },
  ];

  let failed = 0;
  for (const c of cases) {
    c.run();
    const problems = runAll(base);
    const hit = problems.some((p) => p.includes(c.expect));
    if (!hit) {
      failed++;
      console.error(`SELFTEST 反例未被发现：${c.name}（期望报出「${c.expect}」，实际：${problems.length ? problems.join(' | ') : '门禁判绿了'}）`);
    } else {
      console.log(`SELFTEST ok：${c.name} ⇒ 门禁转红`);
    }
  }
  // 复原一份干净的，避免临时目录里留着坏数据
  writeAll(gold, results, renderTable(results));
  if (failed) {
    console.error(`反例未被发现：${failed} 个`);
    return 1;
  }
  console.log(`SELFTEST 全部通过：${cases.length} 个反例都被门禁抓住`);
  return 0;
}

// ---------------------------------------------------------------- main

function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
    return 0;
  }
  if (args.includes('--selftest')) return selftest();

  const goldPath = path.join(EXP, 'gold.json');
  const resultsPath = path.join(EXP, 'results.json');
  const mdPath = path.join(EXP, 'results.md');
  const repoRoot = path.join(EXP, 'repo');

  if (args.includes('--render')) {
    const results = loadJson(resultsPath);
    if (!results) { console.error('ERROR: results.json 读不出来'); return 1; }
    fs.writeFileSync(mdPath, renderTable(results), 'utf8');
    console.log(`已由 results.json 重新生成 ${rel(mdPath)}（${results.cells.length} 行）`);
    return 0;
  }

  if (args.includes('--normalize')) {
    const raw = fs.existsSync(resultsPath) ? fs.readFileSync(resultsPath, 'utf8') : null;
    if (!raw) { console.error('ERROR: results.json 不存在'); return 1; }
    let results;
    try { results = JSON.parse(raw); }
    catch (e) { console.error('ERROR: results.json 不是合法 JSON —— ' + e.message); return 1; }
    const { value, changed } = normalizeDeep(results);
    if (!changed) {
      console.log('凭证归一化：results.json 里没有本机绝对路径，不用改');
      return 0;
    }
    // 保持原文件的换行风格与结尾（results.json 是 CRLF 且结尾无换行）
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const trailing = /\r?\n$/.test(raw) ? (eol === '\r\n' ? '\r\n' : '\n') : '';
    fs.writeFileSync(resultsPath, JSON.stringify(value, null, 2).replace(/\n/g, eol) + trailing, 'utf8');
    console.log(`凭证归一化：已把 results.json 里的本机绝对路径换成 <repo>（${rel(resultsPath)}）`);
    console.log('提示：表要跟着重生成 —— node scripts/check-experiment.js --render');
    return 0;
  }

  const problems = runAll({
    goldPath, resultsPath, mdPath, repoRoot,
    skipGold: args.includes('--gold') ? false : false,
    skipResults: args.includes('--gold'),
    skipTable: args.includes('--gold'),
  });
  if (!problems.length) {
    console.log('对照实验门禁：gold 回仓重数 / 24 格体检 / 表与凭证逐列对账 —— 全绿');
    return 0;
  }
  const errs = problems.filter((p) => !p.startsWith('WARN'));
  problems.forEach((p) => console.error((p.startsWith('WARN') ? 'WARN ' : 'ERROR ') + p));
  console.error(`对照实验门禁：${errs.length} 处问题（gold 对不上 / 结果缺格 / 字段缺失 / 失败模式取值非法 / 表与凭证不一致）`);
  return 1;
}

// 供测量台（backend-compare.sh 的实验模式）复用同一套计数/算式 —— 别各写一份
module.exports = {
  recountAnchor, recallOf, scopeGold, median, isFlakyByTime, renderTable, wordHits, collectFiles, findAnchor,
  normalizeLocalPaths,
};

if (require.main === module) process.exit(main(process.argv));
