#!/usr/bin/env node
// inspect-project.mjs — 通用项目探测器：判项目是什么语言 → 调该语言分册的探测器
// → 出事实 → 按事实过滤该语言分册的适用清单条目。
//
//   node scripts/inspect-project.mjs <project-dir> [--lang <lang>] [--ids] [--json]
//   node scripts/inspect-project.mjs --list-langs
//
// 语言分册的契约（新增一门语言只要满足这三条）：
//   1) references/langs/<lang>/profile.json  —— 标记文件 / 插件目录 / edition 门禁 / 清单文件名
//   2) scripts/langs/<lang>/detect.mjs       —— 导出 detect(dir) => {facts, conditions}
//   3) references/langs/<lang>/checklist.json —— 可选：配置侧清单条目（没有就只报事实）
//
// 打印 key=value 行（--ids 打印适用条目 id，--json 打印完整 JSON）。不写任何文件。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, basename } from 'node:path';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const LANGS_DIR = join(SKILL_DIR, 'references', 'langs');

const args = process.argv.slice(2);
const wantIds = args.includes('--ids');
const wantJson = args.includes('--json');
const checkIds = args.includes('--check-ids');
const listLangs = args.includes('--list-langs');
const langIdx = args.indexOf('--lang');
const forcedLang = langIdx >= 0 ? args[langIdx + 1] : null;
const dirArg = args.find((a) => !a.startsWith('--') && a !== forcedLang);
const DIR = dirArg ? resolve(dirArg) : null;

function loadProfiles() {
  if (!existsSync(LANGS_DIR)) return [];
  return readdirSync(LANGS_DIR)
    .filter((d) => existsSync(join(LANGS_DIR, d, 'profile.json')))
    .map((d) => {
      const p = JSON.parse(readFileSync(join(LANGS_DIR, d, 'profile.json'), 'utf8'));
      return { ...p, dir: join(LANGS_DIR, d) };
    })
    .sort((a, b) => a.lang.localeCompare(b.lang));
}

const profiles = loadProfiles();

if (listLangs) {
  console.log('LANGUAGES');
  for (const p of profiles) {
    console.log(`  ${p.lang.padEnd(8)} ${p.displayName.padEnd(24)} edition=${p.edition} markers=${(p.markers || []).join('|')}`);
  }
  process.exit(0);
}

if (!DIR) {
  console.error('usage: inspect-project.mjs <project-dir> [--lang <lang>] [--ids] [--json]');
  console.error('       inspect-project.mjs --list-langs');
  process.exit(2);
}

function detectLanguage() {
  if (forcedLang) {
    const p = profiles.find((x) => x.lang === forcedLang);
    if (!p) {
      console.error(`unknown language "${forcedLang}"; known: ${profiles.map((x) => x.lang).join(', ')}`);
      process.exit(2);
    }
    return { profile: p, by: 'forced' };
  }
  // marker 命中即认定；多门语言都命中时取 marker 更具体的那个（列表更短 = 更具体）
  const hits = profiles
    .map((p) => ({ p, hits: (p.markers || []).filter((m) => existsSync(join(DIR, m))) }))
    .filter((x) => x.hits.length > 0)
    .sort((a, b) => a.hits.length - b.hits.length);
  if (hits.length) return { profile: hits[0].p, by: `markers:${hits[0].hits.join('+')}` };
  return { profile: null, by: 'no-marker' };
}

const { profile, by } = detectLanguage();
const facts = { PROJECT_DIR: DIR, LANG: profile ? profile.lang : 'unknown', LANG_DETECTED_BY: by };
const conditions = new Set(['any']);

if (profile) {
  const detectorPath = profile.detector ? join(SKILL_DIR, profile.detector) : null;
  if (detectorPath && existsSync(detectorPath)) {
    // 分册探测器是独立进程：只吐 key=value 事实行，条件集合走 CONDITIONS=
    const res = spawnSync(process.execPath, [detectorPath, DIR], { encoding: 'utf8' });
    if (res.status === 0) {
      for (const line of res.stdout.split('\n')) {
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const k = line.slice(0, eq);
        const v = line.slice(eq + 1);
        if (k === 'CONDITIONS') {
          for (const c of v.split(',').filter(Boolean)) conditions.add(c);
        } else {
          facts[k] = v;
        }
      }
    } else {
      facts.LANG_DETECTOR_ERROR = `exit ${res.status}: ${(res.stderr || '').trim().slice(0, 200)}`;
    }
  }
  facts.LANG_EDITION_GATE = profile.edition;
  facts.LANG_PLUGINS_REQUIRED = (profile.pluginDirs || []).join('|');
}

// ---- 该语言分册的适用清单条目 -----------------------------------------------
// 分册可以声明 checklistRequires：这些条件没满足 → 该分册的清单整体不适用
//（例：纯 JS 仓没有 tsconfig → TS 分册的 tsconfig 清单条目一条都不该被推荐）
let applicable = [];
let knownIds = new Set();
let checklistApplicable = 'yes';
const checklistFile = profile?.checklist ? join(profile.dir, profile.checklist) : null;
const missing = (profile?.checklistRequires || []).filter((c) => !conditions.has(c));
if (missing.length) checklistApplicable = `no (缺 ${missing.join('+')})`;
if (checklistFile && existsSync(checklistFile) && checklistApplicable === 'yes') {
  const items = JSON.parse(readFileSync(checklistFile, 'utf8'));
  knownIds = new Set(items.map((it) => it.id));
  applicable = items
    .filter((it) => {
      const conds = Array.isArray(it.applies_to) ? it.applies_to : [it.applies_to ?? 'any'];
      return conds.includes('any') || conds.some((c) => conditions.has(c));
    })
    .map((it) => it.id);
}
facts.CONDITIONS = [...conditions].sort().join(',');
facts.APPLICABLE_COUNT = applicable.length;
facts.CHECKLIST = checklistFile ? basename(checklistFile) : 'none';
facts.CHECKLIST_APPLICABLE = checklistApplicable;

// --check-ids: the inspector must only ever hand back ids that exist
if (checkIds) {
  const unknown = applicable.filter((id) => !knownIds.has(id));
  if (unknown.length) {
    console.error(`inspector returned unknown checklist ids: ${unknown.join(', ')}`);
    process.exit(1);
  }
  console.error(`all ${applicable.length} applicable ids exist in the checklist`);
}

if (wantIds) {
  for (const id of applicable) console.log(id);
} else if (wantJson) {
  console.log(JSON.stringify({ facts, applicable }, null, 2));
} else {
  for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
  if (!profile) {
    console.error(`no language profile matched this project (known: ${profiles.map((p) => p.lang).join(', ')})`);
    console.error('→ 只有通用能力可用（文件索引 / 文本检索 / IDE GUI 重构）；要接这门语言，缺一个 references/langs/<lang>/profile.json + 探测器 + 清单');
  }
  if (process.stderr.isTTY) console.error(`${basename(DIR)}: ${facts.LANG} (${applicable.length} applicable items)`);
}
