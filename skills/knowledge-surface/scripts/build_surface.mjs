#!/usr/bin/env node
/**
 * build_surface.mjs — Markdown 语料 → 「一眼全图 + 披露式明细」的单文件界面
 *
 * 零依赖（Node 标准库）。产出：
 *   --out xxx.html   数据内嵌的单文件 HTML（双击即开，file:// 可用）
 *   --json xxx.json  同一份数据（供其它程序消费）
 *
 * 设计要点见 skill 的 references/parsing.md 与 references/relations.md。
 */
import { readFile, writeFile, readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.dirname(HERE);
const ASSET_VIEWER = path.join(SKILL_DIR, 'assets', 'viewer.html');

const PALETTE = ['#5b9dff', '#3ecf8e', '#f0b429', '#ef6461', '#b07cff', '#2ec4b6', '#ff9f1c', '#ff6fb5', '#9aa4b5', '#7dd3fc'];

const STOP = new Set([
  '答案', '面试怎么答', '追问预判', '理论名词', '为什么这么设计', '为什么这样答', '关键设计', '注意',
  '避免什么及为什么', '为什么', '怎么办', '是什么', '三个对照', '一句话', '补强', '三句话', '必须能脱口',
  '题目', '本轮目标', '自评', '要点清单', '摘要', '总结', '背景', '目标', '说明', '示例', '例子', '要点',
  '结论', '原理', '步骤', '备注', '提示', '目录', '附录', '引用', '来源', '参考', '正文', '内容', '全文',
  // 结构标签与时间单位：出现频繁但不是概念，用它们连边只会造出假关联
  '分钟', '小时', '秒', '问题', '读到能脱口', '脱稿', '速记', '这一张', '你的', '以及', '面试怎么答（起手式）',
  '关键词', '定义', '作用', '场景', '对比', '案例', '练习', '任务', '自测',
]);

/** 概念词是否够格当关联依据（去掉包裹引号后判定） */
const cleanTerm = t => String(t).replace(/["'“”「」『』]/g, '').trim();
const termOk = t => {
  const c = cleanTerm(t);
  return c.length >= 2 && c.length <= 14 && !STOP.has(c)
    && !/[？?：:。！!，,、；;\s]/.test(c) && !/^\d+$/.test(c) && !/^[A-Za-z]\d+$/.test(c);
};

const DEFAULT_SUMMARY_SECTIONS = ['答案', 'essence', '摘要', '一句话', '结论', '核心结论'];

/** 图形化围栏（mermaid / ASCII 框线）不进线性通道：摘要、朗读稿都不该出现它们 */
const DIAGRAM_LANG = /^(mermaid|graph|flowchart|sequencediagram|plantuml|dot)$/i;
const DIAGRAM_CHAR = /[\u2500-\u257F]|▶|►|▼|▲|◄|◀|➡|➤/;

/* ────────────────────────── CLI ────────────────────────── */

function parseArgs(argv) {
  const o = {
    in: '', out: '', json: '', config: '', title: '', echarts: '',
    maxNodes: 800, maxLinks: 6, maxBodyChars: 6000, leafPattern: '', help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺值`);
      return v;
    };
    switch (a) {
      case '--in': o.in = next(); break;
      case '--out': o.out = next(); break;
      case '--json': o.json = next(); break;
      case '--config': o.config = next(); break;
      case '--title': o.title = next(); break;
      case '--echarts': o.echarts = next(); break;
      case '--max-nodes': o.maxNodes = +next(); break;
      case '--max-links': o.maxLinks = +next(); break;
      case '--max-body-chars': o.maxBodyChars = +next(); break;
      case '--leaf-pattern': o.leafPattern = next(); break;
      case '-h': case '--help': o.help = true; break;
      default: throw new Error(`未知参数 ${a}（--help 看用法）`);
    }
  }
  return o;
}

const HELP = `build_surface.mjs — Markdown 语料 → 一眼全图的可探索界面（单文件 HTML）

用法：
  node build_surface.mjs --in <语料目录> --out <产物.html> [选项]

必填：
  --in <dir>            语料目录（递归扫描 *.md）
  --out <file.html>     输出单文件界面（数据内嵌，双击即开）

常用选项：
  --config <file>       配置文件，默认 <in>/surface.config.json（不存在则用默认值）
  --json <file.json>    同时输出数据 JSON
  --title <text>        覆盖界面标题（默认取目录名）
  --echarts <file>      本地 echarts.min.js，内联进产物 → 离线自包含
  --leaf-pattern <re>   正文中识别叶节点的标题正则（默认取 md 标题层级）
  --max-nodes <n>       节点上限（默认 800，超出截断并告警）
  --max-links <n>       每个叶节点最多几条关联（默认 6）
  --max-body-chars <n>  每个叶节点正文字数上限（默认 6000）
  -h, --help            本帮助

配置文件 surface.config.json（全部可选）：
  {
    "title": "界面标题",
    "groups": [ { "id": "gateway", "name": "AI 网关", "color": "#5b9dff", "match": "day-0[234]" } ],
    "summarySections": ["答案", "摘要"],
    "palette": ["#5b9dff", "..."]
  }
  groups.match 是对**文件名**（不含扩展名）的正则；未命中的文件归入 "其它" 组。
`;

/* ────────────────────────── 工具 ────────────────────────── */

const log = (...a) => console.error(...a);
const stripMd = (s) => String(s)
  .replace(/`([^`]*)`/g, '$1')
  .replace(/\*\*([^*]*)\*\*/g, '$1')
  .replace(/\*([^*]*)\*/g, '$1')
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/^[>-\s*+]+\s*/gm, '')
  .replace(/^\s*\[[ xX✓✔]\]\s*/gm, '')     // 复选框符号不是内容（要在剥引用符之后）
  .replace(/\s+/g, ' ')
  .trim();

/** 在句边界截断，不切碎句子 */
function firstSentence(text, max = 140) {
  const flat = stripMd(text);
  if (!flat) return '';
  if (flat.length <= max) return flat;
  const window = flat.slice(0, max);
  let cut = -1;
  for (const ch of ['。', '！', '？', '；', '!', '?', ';']) {
    const i = window.lastIndexOf(ch);
    if (i > cut) cut = i;
  }
  if (cut > 20) return window.slice(0, cut + 1);
  const sp = window.lastIndexOf(' ');
  if (sp > 20) return window.slice(0, sp) + '…';
  return window + '…';
}

/** 纯标签行（如 **要点**：）不算内容 */
const isLabelOnly = (line) => /^\s*\*\*[^*\n]{1,30}\*\*\s*[:：]?\s*$/.test(line);
const isTableRow = (line) => /^\s*\|/.test(line);
const isFence = (line) => /^\s*(```|~~~)/.test(line);

/* ────────────────────────── Markdown 解析 ────────────────────────── */

/** 抽出标题行（忽略代码围栏内的 #） */
function findHeadings(lines) {
  const heads = [];
  let fence = null;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (fence) { if (t.startsWith(fence)) fence = null; return; }
    if (/^```/.test(t) || /^~~~/.test(t)) { fence = t.slice(0, 3); return; }
    const m = t.match(/^(#{1,6})\s+(.*)$/);
    if (m) heads.push({ level: m[1].length, title: m[2].replace(/\s+#+\s*$/, '').trim(), line: i });
  });
  return heads;
}

/** 标题正文区间：[line+1, end]，end = 下一个同级或更高级标题的前一行 */
function markRanges(heads, total) {
  for (let i = 0; i < heads.length; i++) {
    let end = total - 1;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j].level <= heads[i].level) { end = heads[j].line - 1; break; }
    }
    heads[i].end = end;
  }
  return heads;
}

/** 建父子关系（同级栈） */
function linkParents(heads) {
  const stack = [];
  for (const h of heads) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    h.parent = stack.length ? stack[stack.length - 1] : null;
    h.children = [];
    if (h.parent) h.parent.children.push(h);
    stack.push(h);
  }
  return heads;
}

/** 取标题的“自身正文”（排除子标题覆盖的行） */
function ownBody(lines, h) {
  const childRanges = (h.children || []).map(c => [c.line, c.end]);
  const inChild = (i) => childRanges.some(([a, b]) => i >= a && i <= b);
  const out = [];
  for (let i = h.line + 1; i <= h.end; i++) {
    if (inChild(i)) continue;
    out.push(lines[i]);
  }
  return out;
}

/** 标签判定：短、且不含句末标点——整段加粗的正文不是标签 */
const LABEL_RE = /^[^*\n]{1,16}$/;
const labelOk = s => LABEL_RE.test(s) && !/[。！？，、；]/.test(s);

/** 把正文拆成命名小节（**标签** 独占一行 / **标签**：行内内容 / --- 分隔） */
function splitSections(bodyLines) {
  const secs = [];
  let cur = { label: '', text: [] };
  const push = () => { if (cur.text.length) secs.push(cur); cur = { label: '', text: [] }; };
  for (const raw of bodyLines) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*---+\s*$/.test(line)) { push(); continue; }
    const solo = line.match(/^\s*\*\*([^*\n]{1,30})\*\*\s*[:：]?\s*$/);
    if (solo && labelOk(solo[1].trim())) { push(); cur = { label: solo[1].trim(), text: [] }; continue; }
    const inline = line.match(/^\s*\*\*([^*\n]{1,30})\*\*\s*[:：]\s*(.+)$/);
    if (inline && labelOk(inline[1].trim())) { push(); cur = { label: inline[1].trim(), text: [inline[2]] }; continue; }
    cur.text.push(line);
  }
  push();
  return secs;
}

/** 有实质内容的正文行 */
function meaningfulLines(bodyLines) {
  const out = [];
  let inFence = false;
  for (const raw of bodyLines) {
    const t = raw.trim();
    if (isFence(t)) { inFence = !inFence; continue; }
    if (inFence) continue;
    if (!t) continue;
    if (isTableRow(t)) continue;
    if (isLabelOnly(t)) continue;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) continue;      // 分隔线
    if (!stripMd(t)) continue;                            // 纯标记行
    out.push(t);
  }
  return out;
}

/** 表格里的第一行数据（跳过表头），作为摘要兜底 */
function tableText(bodyLines) {
  const rows = bodyLines.filter(l => isTableRow(l.trim()));
  if (!rows.length) return '';
  const cells = r => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim()).filter(Boolean);
  const head = cells(rows[0]);
  const data = rows.slice(1).map(cells).find(r => r.length && !r.every(c => /^:?-{2,}:?$/.test(c)));
  if (!data || !data.length) return '';
  return (head.length ? head[0] + '：' : '') + data.slice(0, 2).join(' · ');
}

/** 代码围栏里的纯文本（口诀、清单这类）；图形化围栏跳过 */
function fenceText(bodyLines) {
  let inFence = false, lang = '', buf = [];
  const flush = () => {
    const eligible = !DIAGRAM_LANG.test(lang) && buf.length && !buf.some(l => DIAGRAM_CHAR.test(l));
    const t = eligible ? buf.filter(Boolean).join(' ') : '';
    lang = ''; buf = [];
    return t;
  };
  const out = [];
  for (const raw of bodyLines) {
    const t = raw.trim();
    const m = t.match(/^(?:```|~~~)\s*([\w-]*)\s*$/);
    if (m) {
      if (!inFence) { inFence = true; lang = m[1] || ''; buf = []; }
      else { inFence = false; const v = flush(); if (v) out.push(v); }
      continue;
    }
    if (inFence) buf.push(t);
  }
  if (inFence) { const v = flush(); if (v) out.push(v); }
  return out.join(' ');
}

/** 正文里有没有图形化代码块（mermaid / ASCII 框线图） */
function hasDiagram(bodyLines) {
  let inFence = false, lang = '', buf = [], found = false;
  const check = () => {
    const d = DIAGRAM_LANG.test(lang) || buf.some(l => DIAGRAM_CHAR.test(l));
    lang = ''; buf = [];
    return d;
  };
  for (const raw of bodyLines) {
    const t = raw.trim();
    const m = t.match(/^(?:```|~~~)\s*([\w-]*)\s*$/);
    if (m) {
      if (!inFence) { inFence = true; lang = m[1] || ''; buf = []; }
      else { inFence = false; if (check()) found = true; }
      continue;
    }
    if (inFence) buf.push(t);
  }
  if (inFence && check()) found = true;
  return found;
}

/** 摘要：designated 段 → 其后第一个有内容的段 → 首个命名段 → 首个实质行 → 围栏纯文本 → 表格首行 → 图示标记 */
function pickSummary(bodyLines, summarySections) {
  const secs = splitSections(bodyLines);
  const hasText = s => s.text.join('').trim().length > 0;
  const idx = secs.findIndex(s => s.label && summarySections.some(n => s.label.toLowerCase().includes(n.toLowerCase())));
  if (idx >= 0) {
    if (hasText(secs[idx])) return firstSentence(secs[idx].text.join('\n'));
    // 标签独占一行、内容在下一个命名段（「**答案**：」+「**（一）…**」）→ 取后面第一个有内容的段
    const nxt = secs.slice(idx + 1).find(hasText);
    if (nxt) return firstSentence(nxt.text.join('\n'));
  }
  const named = secs.filter(s => s.label && hasText(s));
  if (named.length) return firstSentence(named[0].text.join('\n'));
  const lines = meaningfulLines(bodyLines);
  if (lines.length) return firstSentence(lines.join(' '));
  const fence = fenceText(bodyLines);
  if (fence) return firstSentence(fence);
  const table = firstSentence(tableText(bodyLines));
  if (table) return table;
  if (hasDiagram(bodyLines)) return '（图示）';      // 本节正文就是一张图，没有文字说明
  return '';
}

/** 强概念词：只来自正文里的 **加粗术语**，用于连边 */
function pickTerms(bodyLines) {
  const set = new Set();
  const body = bodyLines.join('\n');
  for (const m of body.matchAll(/\*\*([^*\n]{2,14})\*\*/g)) {
    const t = cleanTerm(m[1]);
    if (!termOk(t)) continue;
    set.add(t);
    if (set.size >= 10) break;
  }
  return [...set];
}

/** 标签式出现的 **词**（行首加粗 + 冒号，或独占一行）：模板小节名，不是正文概念 */
function pickSoloTerms(bodyLines) {
  const set = new Set();
  for (const raw of bodyLines) {
    const m = raw.match(/^\s*\*\*([^*\n]{2,14})\*\*\s*(?:[:：]|$)/);
    if (m && termOk(m[1])) set.add(cleanTerm(m[1]));
  }
  return [...set];
}

/**
 * 模板标签识别：三类词不能拿来连边
 *   1. 协议词——几乎每篇都出现（实测「测试」出现在 24/25 篇），它是常量，信息量为零
 *   2. 高频词——节点占比过高，连出去就是一张毛线团
 *   3. 模板小节名——总是以「**标签**：」形式出现（「来源说明」「进阶思考」）
 */
function markStructuralTerms(nodes, { soloRatio = 0.6, hotRatio = 0.2, spreadRatio = 0.5, minDf = 3 } = {}) {
  const info = new Map();
  for (const n of nodes) {
    for (const t of new Set(n.terms || [])) {
      let e = info.get(t);
      if (!e) { e = { df: 0, solo: 0, files: new Set() }; info.set(t, e); }
      e.df++;
      e.files.add(n.file || '');
      if ((n.soloTerms || []).includes(t)) e.solo++;
    }
  }
  const leaves = nodes.filter(n => n.type === 'leaf').length;
  const fileCount = new Set(nodes.map(n => n.file).filter(Boolean)).size || 1;
  const hot = Math.max(5, Math.round(leaves * hotRatio));
  const drop = new Set();
  for (const [t, e] of info) {
    if (e.files.size > fileCount * spreadRatio) { drop.add(t); continue; }  // 协议词
    if (e.df > hot) { drop.add(t); continue; }                               // 高频毛线团
    if (e.df >= minDf && e.solo >= 2 && e.solo / e.df >= soloRatio) { drop.add(t); continue; } // 模板小节名
  }
  for (const n of nodes) {
    if (!n.terms) continue;
    n.terms = n.terms.filter(t => !drop.has(t));
    n.keywords = (n.keywords || []).filter(k => !drop.has(k));
  }
  return drop;
}

/** 关键词（展示 + 搜索用）：强概念词 + 标题切词 */
function pickKeywords(bodyLines, title) {
  const set = new Set(pickTerms(bodyLines));
  for (const t of String(title).split(/[·、，,：:（）()\s—|]+/)) {
    const c = t.trim();
    if (termOk(c)) set.add(c);
    if (set.size >= 12) break;
  }
  return [...set];
}

/* ────────────────────────── 语料 → 节点树 ────────────────────────── */

async function walkMd(dir, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'out' || e.name === 'dist') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walkMd(p, out, depth + 1);
    else if (e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

function groupOf(fileRel, groups) {
  const base = path.basename(fileRel, '.md');
  for (const g of groups) {
    if (!g.match) continue;
    try { if (new RegExp(g.match).test(base)) return g.id; } catch { /* 配置里的正则坏了 → 跳过该组 */ }
  }
  if (groups.length) {
    return '__other__';
  }
  // 没有配置：按第一层目录分组，根目录下的文件归「其它」
  return fileRel.includes('/') ? fileRel.split('/')[0] : '__other__';
}

function buildNodes(files, cfg, args) {
  const nodes = [];
  const warnings = [];
  const summarySections = cfg.summarySections?.length ? cfg.summarySections : DEFAULT_SUMMARY_SECTIONS;

  nodes.push({ id: 'root', type: 'root', parentId: null, title: cfg.title || args.title || '知识表面', group: null, depth: 0, summary: '', keywords: [], body: '', links: [] });

  const groupIds = [];
  const seenGroup = new Set();
  for (const f of files) {
    const gid = groupOf(f.rel, cfg.groups || []);
    if (!seenGroup.has(gid)) { seenGroup.add(gid); groupIds.push(gid); }
  }
  const groupDefs = (cfg.groups || []).slice();
  const palette = cfg.palette?.length ? cfg.palette : PALETTE;
  const groups = groupIds.map((gid, i) => {
    const def = groupDefs.find(g => g.id === gid);
    return {
      id: gid,
      name: def?.name || (gid === '__other__' ? '其它' : gid),
      color: def?.color || palette[i % palette.length],
    };
  });
  for (const g of groups) nodes.push({ id: `g:${g.id}`, type: 'group', parentId: 'root', title: g.name, group: g.id, depth: 1, summary: '', keywords: [], body: '', links: [] });

  let fileSeq = 0;
  for (const f of files) {
    fileSeq++;
    const gid = groupOf(f.rel, cfg.groups || []);
    const gnode = groups.find(g => g.id === gid);
    const fileId = `f${String(fileSeq).padStart(3, '0')}`;
    const h1 = f.heads.find(h => h.level === 1);
    const title = h1 ? h1.title : path.basename(f.rel, '.md');
    const body = h1 ? ownBody(f.lines, h1) : f.lines;
    nodes.push({
      id: fileId, type: 'file', parentId: `g:${gid}`, title, group: gid, depth: 2,
      summary: pickSummary(body, summarySections), keywords: pickKeywords(body, title),
      terms: pickTerms(body), soloTerms: pickSoloTerms(body),
      body: '', file: f.rel, links: [],
    });

    // 顶层标题（H1 之外）作为子节点
    const top = f.heads.filter(h => !(h.level === 1 && h === h1));
    let seq = 0;
    const walkHead = (h, parentId, depth) => {
      seq++;
      const id = `${fileId}n${String(seq).padStart(3, '0')}`;
      const kids = h.children || [];
      const own = ownBody(f.lines, h);
      const isLeaf = kids.length === 0;
      const cleanBody = meaningfulLines(own);
      const type = isLeaf && (cleanBody.length > 0 || own.some(l => l.trim())) ? 'leaf' : (isLeaf ? 'empty' : 'section');
      const node = {
        id, type, parentId, title: h.title, group: gid, depth,
        summary: pickSummary(own, summarySections),
        keywords: pickKeywords(own, h.title),
        terms: pickTerms(own), soloTerms: pickSoloTerms(own),
        body: type === 'leaf' ? own.join('\n').trim().slice(0, args.maxBodyChars) : '',
        file: f.rel, links: [],
      };
      nodes.push(node);
      for (const c of kids) walkHead(c, id, depth + 1);
    };
    for (const h of top) walkHead(h, fileId, 3);

    // 文件本身没有标题层级 → 整个文件当叶节点
    if (!top.length) {
      const node = nodes[nodes.length - 1];
      node.type = 'leaf';
      node.depth = 3;
      node.body = f.lines.join('\n').trim().slice(0, args.maxBodyChars);
    }
  }

  if (nodes.length > args.maxNodes) {
    warnings.push(`节点数 ${nodes.length} 超过上限 ${args.maxNodes}，已截断（按组切分语料可解）`);
  }
  return { nodes, groups, warnings };
}

/* ────────────────────────── 关联推断 ────────────────────────── */

function computeLinks(nodes, maxLinks) {
  const leaves = nodes.filter(n => n.type === 'leaf');
  const byFile = new Map();
  for (const l of leaves) {
    if (!byFile.has(l.file)) byFile.set(l.file, []);
    byFile.get(l.file).push(l);
  }
  for (const a of leaves) {
    const scored = [];
    // 只用正文概念词连边：标题切词是展示材料，用它连边会造出整片假关联
    const aTerms = a.terms || [];
    for (const b of leaves) {
      if (a.id === b.id) continue;
      const bTerms = b.terms || [];
      const shared = aTerms.filter(k => bTerms.includes(k));
      if (!shared.length) continue;
      let score = shared.length;
      if (a.group === b.group) score += 0.5;
      if (a.file === b.file) score += 0.5;
      if (score >= 1) scored.push({ id: b.id, score, shared: shared.slice(0, 3), basis: 'kw' });
    }
    scored.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1));
    a.links = scored.slice(0, maxLinks);
  }
  // 孤岛兜底：没有关键词关联的叶节点，挂到同文件相邻节点上（标注 basis=sibling，不编关键词）
  for (const a of leaves) {
    if (a.links.length) continue;
    const sibs = (byFile.get(a.file) || []).filter(s => s.id !== a.id);
    a.links = sibs.slice(0, 2).map(s => ({ id: s.id, score: 0.5, shared: [], basis: 'sibling' }));
  }
  return leaves.filter(l => l.links.some(x => x.basis === 'kw')).length;
}

/* ────────────────────────── 输出 ────────────────────────── */

function esc(s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

async function build(args) {
  const inDir = path.resolve(args.in);
  const st = await stat(inDir).catch(() => null);
  if (!st || !st.isDirectory()) throw new Error(`--in 不是目录：${args.in}`);

  let cfg = {};
  const cfgPath = args.config ? path.resolve(args.config) : path.join(inDir, 'surface.config.json');
  try {
    cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  } catch (e) {
    if (args.config) throw new Error(`配置文件读不出来：${cfgPath}（${e.message}）`);
    cfg = {};
  }

  const paths = await walkMd(inDir);
  if (!paths.length) throw new Error(`目录里没有 .md：${args.in}`);
  const files = [];
  for (const p of paths) {
    const md = await readFile(p, 'utf8');
    const lines = md.split(/\r?\n/);
    const heads = linkParents(markRanges(findHeadings(lines), lines.length));
    files.push({ path: p, rel: path.relative(inDir, p).replace(/\\/g, '/'), lines, heads });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));

  const { nodes, groups, warnings } = buildNodes(files, cfg, args);
  const structural = markStructuralTerms(nodes);
  const linkedCount = computeLinks(nodes, args.maxLinks);

  const leaves = nodes.filter(n => n.type === 'leaf');
  const noSummary = leaves.filter(n => !n.summary).map(n => n.title);
  if (noSummary.length) warnings.push(`${noSummary.length} 个叶节点没有摘要：${noSummary.slice(0, 5).join(' / ')}${noSummary.length > 5 ? ' …' : ''}`);
  const orphans = nodes.filter(n => n.type !== 'root' && n.type !== 'group' && !nodes.some(p => p.id === n.parentId));
  if (orphans.length) warnings.push(`孤儿节点 ${orphans.length} 个`);

  const surface = {
    title: cfg.title || args.title || path.basename(inDir),
    generatedAt: new Date().toISOString(),
    groups,
    nodes,
    counts: {
      files: files.length, groups: groups.length, leaves: leaves.length,
      linked: linkedCount, total: nodes.length,
    },
    templateLabels: [...structural],
    warnings,
  };

  const jsonPath = args.json ? path.resolve(args.json) : null;
  if (jsonPath) {
    await mkdir(path.dirname(jsonPath), { recursive: true });
    await writeFile(jsonPath, JSON.stringify(surface, null, 2));
  }

  let echartsTag = '<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js"></script>';
  if (args.echarts) {
    const js = await readFile(path.resolve(args.echarts), 'utf8');
    echartsTag = `<script>/* inlined echarts */\n${js}\n</script>`;
  }

  let tpl = await readFile(ASSET_VIEWER, 'utf8');
  if (!tpl.includes('__SURFACE_JSON__') || !tpl.includes('__ECHARTS_TAG__')) {
    throw new Error(`viewer 模板缺占位符：${ASSET_VIEWER}`);
  }
  // 用函数形式替换：字符串里出现 "$&" / "$1" 时会被当成替换模式吃掉内容
  tpl = tpl.replace('__ECHARTS_TAG__', () => echartsTag);
  tpl = tpl.replace('__SURFACE_JSON__', () => JSON.stringify(surface).replace(/</g, '\\u003c'));

  const outPath = path.resolve(args.out);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, tpl);

  const c = surface.counts;
  log(`[ok] ${c.files} 文件 / ${c.groups} 组 / ${c.leaves} 叶节点（${c.total} 节点，${c.linked} 个有关联）`);
  for (const w of warnings) log(`[warn] ${w}`);
  log(`[out] ${outPath}${jsonPath ? ` + ${jsonPath}` : ''}`);
  console.log(`${outPath}\n${c.files} files · ${c.groups} groups · ${c.leaves} leaves · ${c.linked} linked`);
}

export { pickSummary, meaningfulLines, splitSections, firstSentence, findHeadings, markRanges, linkParents, ownBody, buildNodes, computeLinks, stripMd, pickTerms, pickSoloTerms, markStructuralTerms, cleanTerm, termOk };

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = parseArgs(process.argv);
  if (args.help) { console.log(HELP); process.exit(0); }
  if (!args.in || !args.out) { console.error(HELP); process.exit(1); }
  build(args).catch(e => { console.error(`[error] ${e.message}`); process.exit(1); });
}
