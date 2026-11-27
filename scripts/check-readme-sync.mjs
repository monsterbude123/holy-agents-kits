#!/usr/bin/env node
// check-readme-sync.mjs —— README 门面与 skills/ 交付清单一致性门禁
// 缘起（真实漏网案例）：0.10.x 期间 session-distiller / vibe-coding-standards /
// website-helper-skill / codebase-slimming 先后入库，README 门面停在 12 个技能，
// 标题「十二个技能」漂移了两个发版周期才被发现。本门禁只检查可机械枚举的面：
//   ①「技能一览」表格行  ② mermaid mindmap 一级节点  ③「### 名字 ——」详解节
//   ④「仓库结构」目录树  ⑤ 标题中文计数（如「十六个技能分别做什么」）
// 用法：node scripts/check-readme-sync.mjs [--readme <path>]（默认 README.md，供红测用）
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const readmePath = argv[argv.indexOf('--readme') + 1] || 'README.md';
const fail = (msg) => { console.error('README 门面不同步：' + msg); process.exit(1); };

// ── 期望集合：skills/ 下带 SKILL.md 的目录 ────────────────────────────
const expected = readdirSync('skills').filter((d) =>
  statSync(join('skills', d)).isDirectory() && existsSync(join('skills', d, 'SKILL.md'))
).sort();
if (expected.length === 0) fail('skills/ 下没有带 SKILL.md 的技能');

const md = readFileSync(readmePath, 'utf8');

// ── ①「技能一览」表格行（只在 §技能一览 与下一个 ## 之间取，避免误收安装参数表）──
function section(heading) {
  const start = md.indexOf(heading);
  if (start === -1) return null;
  const next = md.indexOf('\n## ', start + heading.length);
  return md.slice(start, next === -1 ? md.length : next);
}
const overview = section('## 技能一览');
if (overview === null) fail('找不到「## 技能一览」');
const table = [...overview.matchAll(/^\| `([a-z0-9][a-z0-9-]*)` +\|/gm)].map((m) => m[1]);

// ── ② mermaid mindmap 一级节点（4 空格缩进的纯标识符行）──────────────
const mermaid = md.slice(md.indexOf('```mermaid'), md.indexOf('```', md.indexOf('```mermaid') + 10));
const mindmap = [...mermaid.matchAll(/^    ([a-z0-9][a-z0-9-]*)$/gm)].map((m) => m[1]);

// ── ③ 详解节 ### <name> —— ──────────────────────────────────────────
const detail = [...md.matchAll(/^### ([a-z0-9][a-z0-9-]*) ——/gm)].map((m) => m[1]);

// ── ④ 仓库结构目录树 ────────────────────────────────────────────────
const treeBlock = md.slice(md.indexOf('## 仓库结构'));
const tree = [...treeBlock.matchAll(/│   [├└]── ([a-z0-9][a-z0-9-]+)\//g)].map((m) => m[1]);

// ── ⑤ 标题中文计数 ──────────────────────────────────────────────────
const CN = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnToNum(s) {
  const m = s.match(new RegExp('十|[一二三四五六七八九]', 'g')) || [];
  if (m.length === 0) return NaN;
  if (!m.includes('十')) return Number(m.map((c) => CN[c]).join(''));
  const tens = m[0] === '十' ? 1 : CN[m[0]];
  const ones = m.length > 1 && m[m.length - 1] !== '十' ? CN[m[m.length - 1]] : 0;
  return tens * 10 + ones;
}
const problems = [];
const headingCount = (md.match(/^## ([一二三四五六七八九十]+)个技能分别做什么/m) || [])[1];
if (headingCount === undefined) problems.push('找不到「## N个技能分别做什么」标题');
else {
  const claimed = cnToNum(headingCount);
  if (claimed !== expected.length)
    problems.push(`标题写「${headingCount}个」（=${claimed}）但 skills/ 实际 ${expected.length} 个`);
}

// ── 对账 ───────────────────────────────────────────────────────────
const norm = (a) => [...new Set(a)].sort();
const surfaces = [['技能表', table], ['mindmap', mindmap], ['详解', detail], ['仓库结构', tree]];
for (const [name, got] of surfaces) {
  const missing = expected.filter((s) => !got.includes(s));
  const extra = norm(got).filter((s) => !expected.includes(s));
  if (missing.length) problems.push(`${name} 缺技能: ${missing.join(', ')}`);
  if (extra.length) problems.push(`${name} 多出: ${extra.join(', ')}`);
}
if (problems.length) {
  console.error('README 门面不同步：');
  for (const p of problems) console.error('  ✗ ' + p);
  process.exit(1);
}
console.log(`README 门面同步：${expected.length} 个技能 × 4 面全对账，标题「${headingCount}个」相符`);
