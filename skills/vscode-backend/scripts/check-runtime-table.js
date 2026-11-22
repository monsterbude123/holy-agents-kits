#!/usr/bin/env node
// 档位表 ↔ 实测凭证 的逐格对账（仓内门禁；`npm test` 会跑它）
//
// 为什么有它：`references/runtime.md` 的每个数字都声称来自实测 —— 这条纪律必须**机器可判**，
// 否则谁改表都不会有人发现。规则口径见 `references/tiers.md` 与 `references/runtime.md`。
//
// 契约：stdout 一行结论；退出码 0 = 对账通过 / 1 = 有不一致。
//
// 只读：不写任何文件。
const fs = require('fs');
const path = require('path');

const SKILL = path.join(__dirname, '..');
const MEAS_DIR = path.join(SKILL, 'references', 'measurements');
const TIERS = path.join(SKILL, 'references', 'tiers.md');
const RUNTIME = path.join(SKILL, 'references', 'runtime.md');
const HEADER = '| 档@路线 | 手段 | 语言 | 命中数 | 原始ms | 净ms | 判据 |';
const TIERS_L0_L5 = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];
// 净耗时 = max(0, 原始耗时 − 该路线基线)；凭证里的数已四舍五入到 0.1ms ⇒ 留 0.2ms 余量
const NET_TOLERANCE_MS = 0.2;

const problems = [];
const bad = (msg) => problems.push(msg);

// ---- 读凭证 ----
if (!fs.existsSync(MEAS_DIR)) {
  console.error('ERROR: 缺实测凭证目录: ' + MEAS_DIR);
  process.exit(1);
}
const files = fs.readdirSync(MEAS_DIR).filter((f) => f.endsWith('.json'));
if (!files.length) bad('实测凭证目录里没有文件');
const records = [];
const seen = new Set();
let cred = null;
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(MEAS_DIR, f), 'utf8'));
  if (!cred) cred = j;
  if (!Array.isArray(j.routes) || !j.routes.length) bad('凭证 ' + f + ' 缺 routes[]（分路线的口径/基线段）');
  for (const r of j.routes || []) {
    if (typeof r.baseline_ms !== 'number' || typeof r.cold_start_ms !== 'number')
      bad('路线 ' + r.route + ' 的基线/冷启动不是数字');
  }
  for (const x of j.records || []) {
    const key = x.tier + '@' + x.route;
    if (seen.has(key)) bad('凭证里 ' + key + ' 有多条记录 —— 一个 tier@route 恰好一条');
    seen.add(key);
    if (x.status !== 'ok') bad('凭证 ' + key + ' 状态不是 ok —— 没真跑过');
    if (!x.evidence || !String(x.evidence).trim()) bad('凭证 ' + key + ' 没有 evidence —— 不许手写数字');
    if (/\b[A-Za-z]:[\\/]|%3A\/|ai-collaborate|Users\//.test(String(x.evidence)))
      bad('凭证 ' + key + ' 的 evidence 里有本机绝对路径 —— 要归一化成 <project>');
    if (typeof x.hits !== 'number' || typeof x.raw_ms !== 'number' || typeof x.net_ms !== 'number')
      bad('凭证 ' + key + ' 的数字字段不全');
    if (!x.tool || !x.lang) bad('凭证 ' + key + ' 缺 tool 或 lang');
    if (/\b[A-Za-z]:[\\/]/.test(JSON.stringify(x.args)))
      bad('凭证 ' + key + ' 的 args 里有机器本地绝对路径 —— 要归一化成 <project>');
    records.push(x);
  }
}
if (!records.length) bad('实测凭证里没有记录');

// ---- 读缺口清单 ----
const tiersText = fs.readFileSync(TIERS, 'utf8');
const blocks = [...tiersText.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)]
  .map((m) => { try { return JSON.parse(m[1]); } catch (e) { return null; } })
  .filter(Boolean);
const gapBlock = blocks.find((b) => b.gaps);
if (!gapBlock) bad('tiers.md 缺机器可读缺口清单');
if (!gapBlock || !Array.isArray(gapBlock.measured_tiers) || !gapBlock.gaps)
  bad('缺口清单字段不全（measured_tiers / gaps）');

// ---- 读档位表 ----
const runtime = fs.readFileSync(RUNTIME, 'utf8');
if (!runtime.includes(HEADER)) bad('档位表头与约定不一致');
const rows = {};
for (const line of runtime.split(/\r?\n/)) {
  const m = line.trim().match(/^\|\s*(L[0-5](?:-[a-z0-9]+)?@[A-Za-z0-9_-]+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|$/);
  if (!m) continue;
  if (rows[m[1]]) bad('表里有重复行键: ' + m[1]);
  rows[m[1]] = { tool: m[2].trim(), lang: m[3].trim(), hits: m[4].trim(), raw: m[5].trim(), net: m[6].trim(), note: m[7].trim() };
}
if (!Object.keys(rows).length) bad('档位表里没有档位行');

// ---- 六档覆盖 ----
for (const tier of TIERS_L0_L5) {
  if (!Object.keys(rows).some((k) => k.split('@')[0].split('-')[0] === tier))
    bad('档位表缺 ' + tier + ' 档 —— 六档要全覆盖');
}

// ---- 逐行对账 ----
for (const key of Object.keys(rows)) {
  const rec = records.find((x) => x.tier + '@' + x.route === key);
  if (rec) {
    if (rows[key].hits !== String(rec.hits)) bad(key + ': 表里命中数 ' + rows[key].hits + ' != 凭证 ' + rec.hits);
    if (rows[key].raw !== String(rec.raw_ms)) bad(key + ': 表里原始耗时 != 凭证 ' + rec.raw_ms);
    if (rows[key].net !== String(rec.net_ms)) bad(key + ': 表里净耗时 != 凭证 ' + rec.net_ms);
    if (rows[key].tool !== rec.tool) bad(key + ': 表里手段 ' + rows[key].tool + ' != 凭证工具 ' + rec.tool);
    if (rows[key].lang !== rec.lang) bad(key + ': 表里语言 ' + rows[key].lang + ' != 凭证语言 ' + rec.lang);
    const route = ((cred.routes || []).find((r) => r.route === rec.route) || {});
    if (typeof route.baseline_ms !== 'number') bad(key + ': 凭证里没有该路线的 baseline_ms —— 净耗时无从核算');
    else if (Math.abs(rec.net_ms - Math.max(0, rec.raw_ms - route.baseline_ms)) > NET_TOLERANCE_MS)
      bad(key + ': 净耗时 != max(0, 原始耗时 - 该路线基线) —— 口径脱钩');
  } else {
    const gap = gapBlock.gaps[key];
    if (gap) {
      if (rows[key].hits !== '—' || rows[key].raw !== '—' || rows[key].net !== '—')
        bad(key + ': 缺口行三列都应为 —');
      if (!rows[key].note.includes('无此能力')) bad(key + ': 缺口行必须写「无此能力」');
      if (!rows[key].note.includes(gap)) bad(key + ': 缺口行来源与 tiers 的缺口清单对不上（须逐字一致）');
    } else if (/未测/.test(rows[key].note)) {
      if (rows[key].hits !== '—' || rows[key].raw !== '—' || rows[key].net !== '—')
        bad(key + ': 未测行三列都应为 —');
    } else {
      bad(key + ': 这一行既无凭证、也不在缺口清单、也不是未测行 —— 数字是手写的?');
    }
  }
}
for (const rec of records) {
  const key = rec.tier + '@' + rec.route;
  if (!rows[key]) bad('凭证里的 ' + key + ' 在表里没有对应行');
}

// ---- 缺口清单 ↔ 表 ----
for (const g of Object.keys(gapBlock.gaps)) {
  if (!rows[g]) bad('缺口清单里的 ' + g + ' 在表里没有对应行');
  if (!/^(协议层|实现层)：/.test(gapBlock.gaps[g]))
    bad('缺口清单 ' + g + ' 的值要以「协议层：」或「实现层：」开头（种类要机器可读）');
  if (records.find((x) => x.tier + '@' + x.route === g))
    bad(g + ' 同时是实测档又是缺口档 —— 语义矛盾');
}
const measured = [...new Set(records.map((x) => x.tier.split('-')[0]))].sort().join(',');
const declared = [...gapBlock.measured_tiers].sort().join(',');
if (measured !== declared)
  bad('tiers 的 measured_tiers(' + declared + ') != 凭证里出现过的档(' + measured + ')');

// ---- 结论 ----
if (problems.length) {
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('档位表对账失败（' + problems.length + ' 项）');
  process.exit(1);
}
console.log('档位表 == 实测凭证（' + records.length + ' 条记录 / ' + Object.keys(rows).length + ' 行，六档全覆盖）');
