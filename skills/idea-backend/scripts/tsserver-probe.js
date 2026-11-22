#!/usr/bin/env node
/**
 * tsserver 能力实测 —— VS Code 的 TypeScript 支持真正走的引擎（tsserver 自有协议）
 *
 *   node scripts/tsserver-probe.js <projectDir> [--file <相对路径>] [--line N] [--symbol NAME]
 *                                 [--tsserver <tsserver.js>]
 *
 * 输出：capabilities / navtree（文档符号树）/ references（跨文件引用）/ navto（全工程符号检索）
 *       / rename（语义改名编辑面）/ geterr（诊断）/ 耗时。
 *
 * 为什么用它测 VS Code：VS Code 的 TS 扩展不跑 LSP，而是跑 tsserver 的自有协议
 * （src/vs/workbench/contrib/typescript/common/tsserver.ts → execute('navto'/'references'/'rename')），
 * 所以这是「VS Code 的 TS 语义能力」的忠实测量面。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
// MSYS/Git-Bash 路径（/c/... /d/...）Windows node 认不出 —— 统一归一成 Windows 形式
function winPath(p) {
  if (/^\/[a-zA-Z]\//.test(p)) {
    const m = /^\/([a-zA-Z])\/(.*)$/.exec(p);
    if (m) return m[1].toUpperCase() + ':' + m[2].split('/').join('\\');
  }
  return p;
}
const rawProject = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--'))) || '.';
const PROJECT = path.resolve(winPath(rawProject));
const REL_FILE = opt('file', '');
const LINE = parseInt(opt('line', '0'), 10);
const SYMBOL = opt('symbol', '');
const TSSERVER = opt('tsserver', '') || process.env.TSSERVER_JS || '';

if (!TSSERVER) {
  console.error('需要 --tsserver <tsserver.js>（或设 TSSERVER_JS）。VS Code 自带的在：');
  console.error('  <VSCode安装根>/<commit>/resources/app/extensions/node_modules/typescript/lib/_tsserver.js');
  process.exit(2);
}

const SRC = path.join(PROJECT, 'src');
function walk(dir, out = [], depth = 0) {
  if (depth > 4) return out;
  let es = [];
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out, depth + 1);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
// 路径比对必须统一分隔符：REL_FILE 传的是 'src/alpha.ts'，而 f 是绝对路径（反斜杠）
const norm = (p) => p.split('\\').join('/');
const wantFile = REL_FILE ? norm(REL_FILE) : '';
const FILES = walk(PROJECT).filter((f) => (wantFile ? norm(f).endsWith(wantFile) : true));

const child = spawn(process.execPath, [TSSERVER, '--useInferredProjectPerProjectRoot'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buf = '';
const pending = new Map();
let seq = 0;
const events = [];

child.stdout.on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'response' && pending.has(msg.request_seq)) {
      pending.get(msg.request_seq)(msg);
      pending.delete(msg.request_seq);
    } else if (msg.type === 'event') events.push(msg);
  }
});
child.stderr.on('data', (d) => process.stderr.write('[tsserver] ' + d));

function request(command, args, timeoutMs = 20000) {
  const s = ++seq;
  child.stdin.write(JSON.stringify({ seq: s, type: 'request', command, arguments: args }) + '\n');
  return new Promise((res) => {
    const t = setTimeout(() => { pending.delete(s); res({ timeout: true }); }, timeoutMs);
    pending.set(s, (m) => { clearTimeout(t); res(m); });
  });
}

(async () => {
  await request('configure', { hostInfo: 'idea-backend-probe' }, 15000);
  for (const f of FILES) await request('open', { file: f, projectRootPath: PROJECT }, 15000);
  await new Promise((r) => setTimeout(r, 2500));

  const info = await request('projectInfo', { file: FILES[0] });
  console.log('=== projectInfo ===');
  console.log('  configFileName:', info.body?.configFileName);
  console.log('  languageServiceDisabled:', info.body?.languageServiceDisabled);

  if (FILES[0]) {
    const tree = await request('navtree', { file: FILES[0] });
    console.log(`\n=== navtree(${path.basename(FILES[0])}) —— 文档符号树（VS Code 大纲的数据源）===`);
    const walk2 = (nodes, ind = '  ') => {
      for (const n of nodes || []) {
        console.log(`${ind}${n.kind} ${n.name}  (${(n.spans?.[0]?.start?.line ?? -1) + 1})`);
        if (n.childItems) walk2(n.childItems, ind + '  ');
      }
    };
    walk2(tree.body?.childItems);
  }

  if (LINE > 0 && FILES[0]) {
    const target = FILES.find((f) => REL_FILE && f.endsWith(REL_FILE.replace(/\\/g, '/'))) || FILES[0];
    const refs = await request('references', { file: target, line: LINE, offset: 18 });
    console.log(`\n=== references @ ${path.relative(PROJECT, target)}:${LINE} ===`);
    if (refs.body?.refs) {
      console.log('  symbolName:', refs.body.symbolName, '| 命中:', refs.body.refs.length);
      for (const r of refs.body.refs) {
        console.log(`   ${path.relative(PROJECT, r.file)}  ${(r.contextText || '').trim().slice(0, 70)}`);
      }
    } else {
      console.log('  ', JSON.stringify(refs.body ?? refs).slice(0, 300));
    }

    const ren = await request('rename', {
      file: target, line: LINE, offset: 18, findInStrings: false, findInComments: false,
    });
    console.log('\n=== rename（语义改名的编辑面）===');
    const info2 = ren.body?.info;
    if (info2?.renameLocations) {
      const byFile = {};
      for (const l of info2.renameLocations) {
        const f = path.relative(PROJECT, l.file);
        (byFile[f] = byFile[f] || []).push(`${l.prefixText}${l.text}${l.suffixText}`);
      }
      for (const [f, ls] of Object.entries(byFile)) console.log(`   ${f} → ${ls.length} 处`);
      console.log('   总计:', info2.renameLocations.length, '处');
    } else {
      console.log('  ', JSON.stringify(info2 ?? ren).slice(0, 240));
    }
  }

  if (SYMBOL) {
    const t0 = Date.now();
    const navto = await request('navto', { searchValue: SYMBOL, currentFileOnly: false, maxResultCount: 50 });
    console.log(`\n=== navto("${SYMBOL}") —— 全工程符号检索（${Date.now() - t0}ms）===`);
    console.log('  命中:', navto.body?.length ?? 0);
    for (const s of navto.body || []) {
      console.log(`   ${s.kind} ${s.name}  ${path.relative(PROJECT, s.file)}:${s.start.line}`);
    }
  }

  await request('geterr', { files: FILES, delay: 0 });
  await new Promise((r) => setTimeout(r, 1500));
  const diags = events.filter((e) => e.event === 'semanticDiag' || e.event === 'syntaxDiag');
  console.log('\n=== geterr（诊断）===');
  let n = 0;
  for (const e of diags) {
    for (const x of e.body || []) {
      n++;
      console.log(`  ${path.relative(PROJECT, x.file)}:${x.start.line + 1}:${x.start.offset + 1}  [${x.category}] ${x.text}`);
    }
  }
  if (!n) console.log('  (无诊断 —— 文件干净)');

  child.kill();
  process.exit(0);
})().catch((e) => { console.error(e); child.kill(); process.exit(1); });
