#!/usr/bin/env node
// verify-quotes.mjs — 溯源门禁：每条清单/设置条目的 quote 必须能在该分册的
// sources.md 里逐字命中。**不许凭记忆写引文**。
//
//   node scripts/verify-quotes.mjs                 # 全部分册
//   node scripts/verify-quotes.mjs --lang python   # 指定分册
//
// 退出码: 0 = 全部命中；1 = 有 quote 命不中。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SKILL_DIR = resolve(import.meta.dirname, '..');
const LANGS_DIR = join(SKILL_DIR, 'references', 'langs');

const args = process.argv.slice(2);
const langIdx = args.indexOf('--lang');
const only = langIdx >= 0 ? args[langIdx + 1] : null;

function loadJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

const profiles = readdirSync(LANGS_DIR)
  .filter((d) => existsSync(join(LANGS_DIR, d, 'profile.json')))
  .map((d) => ({ lang: d, dir: join(LANGS_DIR, d) }))
  .filter((p) => !only || p.lang === only);

let checked = 0;
let missing = 0;

for (const p of profiles) {
  const sourcesPath = join(p.dir, 'sources.md');
  if (!existsSync(sourcesPath)) {
    console.log(`SKIP ${p.lang}: 没有 sources.md（引文无法核验）`);
    continue;
  }
  const sources = readFileSync(sourcesPath, 'utf8');
  const groups = [
    ['checklist', loadJson(join(p.dir, 'checklist.json'))],
    ['idea-settings', loadJson(join(p.dir, 'idea-settings.json'))],
  ];
  for (const [kind, items] of groups) {
    if (!Array.isArray(items)) continue;
    for (const it of items) {
      const quote = (it.quote || '').trim();
      if (!quote) {
        console.log(`FAIL ${p.lang}/${kind}/${it.id}: 没有 quote`);
        missing++;
        continue;
      }
      checked++;
      if (!sources.includes(quote)) {
        console.log(`FAIL ${p.lang}/${kind}/${it.id}: quote 在 sources.md 里命不中 → ${quote.slice(0, 80)}`);
        missing++;
      }
    }
  }
  console.log(`OK   ${p.lang}: ${sourcesPath.replace(SKILL_DIR + '\\', '')}`);
}

console.log('----');
console.log(`checked: ${checked}   missing: ${missing}`);
process.exit(missing ? 1 : 0);
