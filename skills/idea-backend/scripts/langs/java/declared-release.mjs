#!/usr/bin/env node
// Print the byte-code target a JVM project declares, or nothing.
//
//   node scripts/langs/java/declared-release.mjs [project-dir]
//
// Maven : <maven.compiler.release> in pom.xml (property or plugin config)
//         also reports legacy <maven.compiler.source>/<target> as
//         "source=N,target=N" so the caller can tell the two apart.
// Gradle: options.release = N / release = N in build.gradle(.kts), or
//         JavaLanguageVersion.of(N) inside a java { toolchain { … } } block.
//
// stdout: one line — "release=N" | "source=N,target=N" | "" (nothing declared)
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIR = resolve(process.argv[2] ?? '.');
const read = (f) => { try { return readFileSync(join(DIR, f), 'utf8'); } catch { return ''; } };

// --- Maven ----------------------------------------------------------------
const pom = read('pom.xml');
if (pom) {
  const rel = pom.match(/<maven\.compiler\.release>\s*([0-9]+)\s*<\/maven\.compiler\.release>/);
  if (rel) { console.log(`release=${rel[1]}`); process.exit(0); }
  // plugin <configuration> form
  const cfg = pom.match(/<release>\s*([0-9]+)\s*<\/release>/);
  if (cfg) { console.log(`release=${cfg[1]}`); process.exit(0); }
  const src = pom.match(/<maven\.compiler\.source>\s*([0-9]+)\s*<\/maven\.compiler\.source>/);
  const tgt = pom.match(/<maven\.compiler\.target>\s*([0-9]+)\s*<\/maven\.compiler\.target>/);
  if (src || tgt) {
    console.log(`source=${src?.[1] ?? ''},target=${tgt?.[1] ?? ''}`);
    process.exit(0);
  }
  // compiler 插件里的 <source>${java.version}</source> 形式：把属性引用解成数值
  const resolveProp = (raw) => {
    if (!raw) return '';
    const ref = raw.match(/^\$\{\s*([\w.-]+)\s*\}$/);
    if (!ref) return raw;
    const v = pom.match(new RegExp(`<${ref[1]}>\\s*([^<]+?)\\s*</${ref[1]}>`));
    return v ? v[1] : raw;
  };
  const srcEl = pom.match(/<source>\s*([^<]+?)\s*<\/source>/);
  const tgtEl = pom.match(/<target>\s*([^<]+?)\s*<\/target>/);
  if (srcEl || tgtEl) {
    console.log(`source=${resolveProp(srcEl?.[1])},target=${resolveProp(tgtEl?.[1])}`);
    process.exit(0);
  }
}

// --- Gradle ---------------------------------------------------------------
for (const f of ['build.gradle', 'build.gradle.kts']) {
  if (!existsSync(join(DIR, f))) continue;
  const g = read(f);
  const opt = g.match(/options\.release\s*=\s*([0-9]+)/) ?? g.match(/^\s*release\s*=\s*([0-9]+)/m);
  if (opt) { console.log(`release=${opt[1]}`); process.exit(0); }
  const tc = g.match(/JavaLanguageVersion\.of\(\s*([0-9]+)\s*\)/) ?? g.match(/languageVersion\.of\(\s*([0-9]+)\s*\)/);
  if (tc) { console.log(`release=${tc[1]}`); process.exit(0); }
}

// nothing declared
console.log('');
