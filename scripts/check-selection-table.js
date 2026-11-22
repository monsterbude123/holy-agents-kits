#!/usr/bin/env node
// 选型决策表 ↔ 两份副本 ↔ 出处指针 的逐格对账（仓级门禁；`npm test` 会跑它）
//
// 为什么有它：选型结论落在两个**独立分发**的技能里（各自可能被单独安装），所以
//   ① 两份副本必须逐字相同（改一边忘了另一边 ⇒ agent 拿到两套结论）；
//   ② 表里每个数字都要能回查到出处（「指针解析得到 **且** 该处确有这个数」）；
//   ③ 每行的证据等级必须合法（未测撑不起一行、推断永远不能单独撑一行）。
// 纪律来源：.planning/03-CONTEXT.md 的 D-01 / D-08 / D-11。
//
// 契约：stdout 一行结论；退出码 0 = 对账通过 / 1 = 有不一致。
// 只读：不写任何文件。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SSOT = path.join(ROOT, 'skills/idea-backend/references/capability-matrix.md');
const COPY = path.join(ROOT, 'skills/vscode-backend/references/runtime.md');
const OPTIONS = path.join(ROOT, 'skills/idea-backend/references/semantic-backend-options.md');
const PKG = path.join(ROOT, 'package.json');

const SECTION_START = '<!-- selection-table:section:start -->';
const SECTION_END = '<!-- selection-table:section:end -->';
const BLOCK_START = '<!-- selection-table:begin -->';
const BLOCK_END = '<!-- selection-table:end -->';
const LEVELS_ALLOWED = ['实测', '结构事实', '既有实测', '未测'];
const LEVELS_STRONG = ['实测', '结构事实', '既有实测'];
const FORBIDDEN_WORDS = ['大概', '应该'];
// 指向另一技能的仓内路径（独立分发要求：只写「技能 <名> 的 <相对路径>」）
const CROSS_SKILL_PATHS = { [SSOT]: /skills\/vscode-backend\//, [COPY]: /skills\/idea-backend\// };

const problems = [];
const bad = (msg) => problems.push(msg);

const readText = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// ---- 小工具 ----
const between = (text, start, end) => {
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i === -1 || j === -1 || j < i) return null;
  return text.slice(i + start.length, j);
};

const isSeparatorRow = (line) => /^\s*\|[\s\-:|]+\|\s*$/.test(line);

const splitCells = (line) => {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
};

// 「这个数」的匹配：把文件里的数字全抽出来，去掉千分位后做**数值等价**比较
// （`4,567` ≡ `4567` ≡ `4567ms` ≡ `4567 ms` —— 不是文本包含，否则人读表的写法差异会假红）
const fileHasNumber = (text, value) => {
  const tokens = text.match(/\d[\d,]*(?:\.\d+)?/g) || [];
  for (const t of tokens) {
    const v = parseFloat(t.replace(/,/g, ''));
    if (!isFinite(v)) continue;
    if (Math.abs(v - value) <= Math.max(1e-9, Math.abs(value) * 1e-9)) return true;
  }
  return false;
};

const canon = (v) => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
};

// 出处指针的形态一次定死：「技能 <技能名> 的 <相对该技能根的路径>（§小节）」
const parsePointer = (p) => {
  const m = /^技能\s+(\S+)\s+的\s+(\S+?)\s*（(.+)）\s*$/.exec(String(p));
  if (!m) return null;
  return { skill: m[1], rel: m[2], section: m[3] };
};

// ---- 读两个文件 ----
const docs = [
  { name: 'idea-backend/capability-matrix.md', file: SSOT },
  { name: 'vscode-backend/runtime.md', file: COPY },
];
for (const d of docs) {
  d.text = readText(d.file);
  if (d.text === null) bad('文件不存在: ' + path.relative(ROOT, d.file));
}

const parsed = [];
for (const d of docs) {
  if (d.text === null) continue;
  const section = between(d.text, SECTION_START, SECTION_END);
  if (section === null) {
    bad(d.name + '：缺小节标记 ' + SECTION_START + ' / ' + SECTION_END);
    continue;
  }
  d.section = section;
  const block = between(d.text, BLOCK_START, BLOCK_END);
  if (block === null) {
    bad(d.name + '：缺机器可读块 ' + BLOCK_START + ' / ' + BLOCK_END);
    continue;
  }
  const fence = /```json\r?\n([\s\S]*?)\r?\n```/.exec(block);
  if (!fence) {
    bad(d.name + '：机器可读块里没有 json 围栏');
    continue;
  }
  let json = null;
  try {
    json = JSON.parse(fence[1]);
  } catch (e) {
    bad(d.name + '：机器可读块解析失败 —— ' + e.message);
    continue;
  }
  if (!json || json.schema !== 'selection-table/v1') bad(d.name + '：schema 不是 selection-table/v1');
  if (!json || !Array.isArray(json.rows) || !json.rows.length) {
    bad(d.name + '：rows[] 缺失或为空');
    continue;
  }
  d.json = json;
  parsed.push(d);
}

// ---- 两份副本逐格相等 ----
if (parsed.length === 2) {
  const [a, b] = parsed;
  if (a.section !== b.section) bad('两处表不一致（小节正文不是逐字相同）');
  if (JSON.stringify(canon(a.json.rows)) !== JSON.stringify(canon(b.json.rows)))
    bad('两处表不一致（两份 JSON 块逐格对不上）');
  if (a.json.rows.length !== b.json.rows.length) bad('两处表不一致（行数不同）');
}

// ---- 逐行体检 ----
const fileCache = new Map();
const readCached = (p) => {
  if (!fileCache.has(p)) fileCache.set(p, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  return fileCache.get(p);
};

for (const d of parsed) {
  const seenKeys = new Set();
  for (const row of d.json.rows) {
    const at = d.name + ' / ' + (row && row.key);
    for (const field of ['key', 'task', 'lang', 'recommend', 'backup', 'evidence', 'cost', 'not_when']) {
      if (!row || typeof row[field] !== 'string' || !row[field].trim()) bad(at + '：缺字段 ' + field);
    }
    if (row && row.key) {
      if (seenKeys.has(row.key)) bad(at + '：行键重复');
      seenKeys.add(row.key);
    }
    const levels = row && row.evidence_levels;
    if (!Array.isArray(levels) || !levels.length) {
      bad(at + '：证据等级不合法（数组为空）');
    } else {
      for (const lv of levels) {
        if (!LEVELS_ALLOWED.includes(lv)) bad(at + '：证据等级不合法 —— ' + lv);
      }
      if (!levels.some((lv) => LEVELS_STRONG.includes(lv)))
        bad(at + '：证据等级不合法（只有未测撑不起一行）');
      if (levels.includes('推断')) bad(at + '：推断不能单独撑一行');
    }
    const numbers = row && row.numbers;
    if (numbers !== undefined && !Array.isArray(numbers)) bad(at + '：numbers 不是数组');
    for (const n of numbers || []) {
      const where = at + ' 的数字 ' + JSON.stringify(n && n.value);
      if (!n || typeof n.value !== 'number' || !isFinite(n.value)) {
        bad(where + '：value 不是数字');
        continue;
      }
      const ptr = parsePointer(n.pointer);
      if (!ptr) {
        bad(where + '：指针形态不对（要「技能 <名> 的 <相对路径>（§小节）」）—— ' + n.pointer);
        continue;
      }
      const target = path.join(ROOT, 'skills', ptr.skill, ptr.rel);
      const text = readCached(target);
      if (text === null) {
        bad(where + '：指针解析不到 —— ' + path.relative(ROOT, target));
        continue;
      }
      if (!fileHasNumber(text, n.value))
        bad(where + '：该处没有这个数 —— ' + path.relative(ROOT, target));
    }
  }
}

// ---- markdown 表 ↔ JSON 块 ----
for (const d of parsed) {
  const lines = d.section.split(/\r?\n/);
  const blocks = [];
  let cur = [];
  for (const line of lines) {
    if (/^\s*\|/.test(line)) cur.push(line);
    else {
      if (cur.length) blocks.push(cur);
      cur = [];
    }
  }
  if (cur.length) blocks.push(cur);
  if (blocks.length !== 1) {
    bad(d.name + '：小节里的表不止一张（' + blocks.length + ' 张）—— 行数口径不明');
    continue;
  }
  const rows = blocks[0].filter((l) => !isSeparatorRow(l));
  const header = rows[0] || '';
  const data = rows.slice(1);
  if (!header.includes('任务类型') || !header.includes('推荐后端'))
    bad(d.name + '：表的表头不是约定的五列（任务类型 × 语言 / 推荐 / 依据 / 证据等级 / 代价 / 何时别选）');
  if (data.length !== d.json.rows.length)
    bad(d.name + '：行数不一致（表 ' + data.length + ' 行 vs JSON 块 ' + d.json.rows.length + ' 行）');
  for (let i = 0; i < Math.min(data.length, d.json.rows.length); i++) {
    const cells = splitCells(data[i]);
    const row = d.json.rows[i];
    const at = d.name + ' 第 ' + (i + 1) + ' 行';
    if (cells.length !== 6) {
      bad(at + '：列数不对（应为 6 列，实得 ' + cells.length + '）');
      continue;
    }
    if (!cells[0].includes(row.task) || !cells[0].includes(row.lang))
      bad(at + '：任务类型 × 语言与 JSON 不一致');
    if (!cells[1].includes(row.recommend) || !cells[1].includes(row.backup))
      bad(at + '：推荐 / 备与 JSON 不一致');
    if (!cells[2].includes(row.evidence)) bad(at + '：依据与 JSON 不一致');
    for (const lv of row.evidence_levels) if (!cells[3].includes(lv)) bad(at + '：证据等级与 JSON 不一致');
    if (!cells[4].includes(row.cost)) bad(at + '：代价与前提与 JSON 不一致');
    if (!cells[5].includes(row.not_when)) bad(at + '：何时别选它与 JSON 不一致');
  }
}

// ---- 禁词 + 跨技能仓内路径（只扫新增的两节） ----
for (const d of parsed) {
  for (const w of FORBIDDEN_WORDS) if (d.section.includes(w)) bad(d.name + '：新增小节里命中空话「' + w + '」');
  const cross = CROSS_SKILL_PATHS[d.file];
  if (cross && cross.test(d.section)) bad(d.name + '：新增小节里出现了指向另一技能的仓内路径');
}

// ---- 结论 ----
if (problems.length) {
  for (const p of problems) console.error('  ✗ ' + p);
  console.error('选型决策表对账失败（' + problems.length + ' 项）');
  process.exit(1);
}
const rowCount = parsed.length ? parsed[0].json.rows.length : 0;
console.log('选型决策表：两份副本逐字相同（' + rowCount + ' 行）· 每个数字的出处指针都能回查到该数 · 证据等级合法');
