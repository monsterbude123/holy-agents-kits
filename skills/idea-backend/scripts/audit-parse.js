#!/usr/bin/env node
/**
 * audit-parse.js — 把 ide_inspect 的原始输出归一化成「可分派的精确清单」
 *
 * 用法:
 *   node scripts/audit-parse.js --out <合并清单.txt> <raw1> [raw2 ...] [--xml-dir <dir>]
 *
 * 输入:
 *   raw*   — ide_inspect 原始输出文件(每行可能是 JSON summary 或 "[WARNING] ..." 问题行)
 *   --xml-dir — ide_inspect 返回的 xmlDir(批处理管线产出的全量 XML 报告目录);
 *               这里的项是 **完整** 的(problems 文本清单会被截断, XML 不会)
 *
 * 输出到 stdout:
 *   [SUMMARY] <json>            合并后的 byTool 计数与总量
 *   [MAIN] <file>:<line> | <tool> | <desc>
 *   [TEST] <file>:<line> | <tool> | <desc>
 *   [STATS] 去重前后条数 / 截断信息
 *
 * 坑(都踩过):
 *   - problems 文本清单会被截断(summary.total 大于实际返回行数) → 以 XML + byTool 为准
 *   - problems 行里文件路径是相对路径, XML 里是 file://$PROJECT_DIR$/... → 两种都要归一
 *   - 同一问题可能同时出现在 daemon-core 段与 XML global 段 → 按 (tool,file,line,desc) 去重
 *   - desc 里的 HTML 实体(&lt; &gt; &quot; &amp;) 与 <code> 标签要还原
 */
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
let outFile = null;
let xmlDir = null;
const raws = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') { outFile = argv[++i]; continue; }
  if (argv[i] === '--xml-dir') { xmlDir = argv[++i]; continue; }
  raws.push(argv[i]);
}

const dec = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&')
  .replace(/<\/?code>/g, '');

const normFile = (f) => {
  let s = String(f || '').trim();
  // XML 里是 file://$PROJECT_DIR$/src/... ；problems 行里是 src/...
  s = s.replace(/^file:\/\/\$PROJECT_DIR\$/i, '');
  s = s.replace(/^file:\/\//, '');
  s = s.replace(/\\/g, '/');
  return s.replace(/^\/+/, '');
};

const items = [];          // {file,line,tool,desc,src}
const byTool = {};
const summaries = [];

// P3C 噪音规则: 本仓规范就是中文注释, 该规则会把每条中文注释报一遍 -> 单列, 不进清单
const NOISE_TOOLS = new Set(['NonAsciiCharacters']);

function addItem(file, line, tool, desc, src) {
  if (!file) return;
  const it = { file: normFile(file), line: parseInt(line, 10) || 0, tool: tool || '?', desc: dec(desc || ''), src };
  items.push(it);
  byTool[it.tool] = (byTool[it.tool] || 0) + 1;
}

// ── 1. 解析 raw 输出 ───────────────────────────────────────────────────────
// 格式实测:  "  [WARNING] <tool> — <file>:<line> <desc>"
//   (工具名在破折号前; 位置与描述之间是空格, 不是冒号)
const PROBLEM_RE = /^\s*\[(WARNING|ERROR|INFO)\]\s+([A-Za-z][A-Za-z0-9_]*)\s+—\s+(.+)$/;
for (const rf of raws) {
  if (!rf || !fs.existsSync(rf)) continue;
  const text = fs.readFileSync(rf, 'utf8').replace(/\r/g, '');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('{')) {
      try { summaries.push(JSON.parse(t)); } catch (e) { /* 非 summary 行 */ }
      continue;
    }
    const m = PROBLEM_RE.exec(t);
    if (!m) continue;
    const [, sev, tool, rest] = m;
    const lm = /^(.*?):(\d+)\s*(.*)$/.exec(rest);
    if (!lm) continue;
    addItem(lm[1], lm[2], tool, lm[3] || '', 'daemon');
  }
}

// ── 2. 解析 XML 报告目录(全量 global 工具结果) ─────────────────────────────
if (xmlDir && fs.existsSync(xmlDir)) {
  for (const f of fs.readdirSync(xmlDir)) {
    if (!f.endsWith('.xml')) continue;
    const tool = f.replace(/\.xml$/, '');
    let x;
    try { x = fs.readFileSync(path.join(xmlDir, f), 'utf8'); } catch (e) { continue; }
    const blocks = x.split(/<problem>/).slice(1);
    for (const b of blocks) {
      const fileM = /<file>([^<]*)<\/file>/.exec(b);
      const lineM = /<line>([^<]*)<\/line>/.exec(b);
      const descM = /<description>([^<]*)/.exec(b);
      const clsM = /problem_class id="([^"]+)"/.exec(b);
      if (!fileM) continue;
      addItem(fileM[1], lineM ? lineM[1] : 0, clsM ? clsM[1] : tool, descM ? descM[1] : '', 'xml');
    }
  }
}

// ── 3. 去重(同一问题可能来自 daemon 段与 xml 段) ──────────────────────────
const seen = new Set();
const uniq = [];
for (const it of items) {
  const k = `${it.tool}|${it.file}|${it.line}|${it.desc.slice(0, 80)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(it);
}

// ── 4. 输出 ────────────────────────────────────────────────────────────────
const main = uniq.filter(i => i.file.startsWith('src/main/') && !NOISE_TOOLS.has(i.tool));
const test = uniq.filter(i => i.file.startsWith('src/test/') && !NOISE_TOOLS.has(i.tool));
const other = uniq.filter(i => !i.file.startsWith('src/main/') && !i.file.startsWith('src/test/') && !NOISE_TOOLS.has(i.tool));
const noise = uniq.filter(i => NOISE_TOOLS.has(i.tool));

const fmt = (i) => `${i.file}:${i.line} | ${i.tool} | ${i.desc}`;
const merged = {};
for (const s of summaries) {
  if (s && s.byTool) for (const [k, v] of Object.entries(s.byTool)) merged[k] = (merged[k] || 0) + v;
}
const totalReported = summaries.reduce((a, s) => a + (s.total || 0), 0);

const lines = [];
lines.push(`[SUMMARY] ${JSON.stringify({ reportedTotal: totalReported, uniqueParsed: uniq.length, actionable: uniq.length - noise.length, main: main.length, test: test.length, other: other.length, noiseSuppressed: noise.length, byTool: merged })}`);
lines.push('[STATS] reportedTotal 是各次 summary.total 累加(跨批重复计数, 只作量级参考); uniqueParsed 是去重后的真实条目数; actionable 已剔除噪音工具(NonAsciiCharacters 等 P3C 中文注释规则); 若 actionable 明显小于 reportedTotal, 说明 problems 文本清单被截断, 以 XML 条目为准。');
lines.push('--- MAIN (src/main) ---');
main.forEach(i => lines.push('[MAIN] ' + fmt(i)));
lines.push('--- TEST (src/test) ---');
test.forEach(i => lines.push('[TEST] ' + fmt(i)));
if (other.length) {
  lines.push('--- OTHER ---');
  other.forEach(i => lines.push('[OTHER] ' + fmt(i)));
}
if (noise.length) {
  lines.push('--- NOISE (已豁免, 仅计数) ---');
  const byNoise = {};
  noise.forEach(i => { byNoise[i.tool] = (byNoise[i.tool] || 0) + 1; });
  lines.push(`[NOISE] ${JSON.stringify(byNoise)}`);
}
const text = lines.join('\n');
if (outFile) {
  try { fs.writeFileSync(outFile, text, 'utf8'); } catch (e) { /* ignore */ }
}
process.stdout.write(text + '\n');
