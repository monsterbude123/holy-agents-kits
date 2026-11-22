#!/usr/bin/env node
// JVM 分册探测器：判一个已有 Java/Kotlin 项目的构建形态与事实，供通用分发器
// （scripts/inspect-project.mjs）过滤本分册的适用清单条目。
//
//   node scripts/langs/java/detect.mjs <project-dir>
//
// 打印 key=value 行（含 CONDITIONS=）。不写任何文件；不是 JVM 项目就如实报 BUILD_TOOL=none。
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--'));
if (!dirArg) {
  console.error('usage: detect.mjs <project-dir>');
  process.exit(2);
}
const DIR = resolve(dirArg);

const facts = {};
const set = (k, v) => { facts[k] = v === undefined || v === null ? '' : String(v); };
const read = (f) => { try { return readFileSync(join(DIR, f), 'utf8'); } catch { return ''; } };

// ---- build tool ------------------------------------------------------------
const hasPom = existsSync(join(DIR, 'pom.xml'));
const hasGradle = existsSync(join(DIR, 'build.gradle')) || existsSync(join(DIR, 'build.gradle.kts'));
set('BUILD_FILE', hasPom ? 'pom.xml' : hasGradle ? (existsSync(join(DIR, 'build.gradle.kts')) ? 'build.gradle.kts' : 'build.gradle') : '');
set('BUILD_TOOL', hasPom ? 'maven' : hasGradle ? 'gradle' : 'none');
set('HAS_WRAPPER', existsSync(join(DIR, 'mvnw')) || existsSync(join(DIR, 'mvnw.cmd')) || existsSync(join(DIR, 'gradlew')) ? 'yes' : 'no');

// ---- modules ---------------------------------------------------------------
function walkModules(dir, depth = 0) {
  if (depth > 3) return [];
  let out = [];
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target' || e.name === 'build') continue;
    const sub = join(dir, e.name);
    if (existsSync(join(sub, 'pom.xml')) || existsSync(join(sub, 'build.gradle')) || existsSync(join(sub, 'build.gradle.kts'))) out.push(sub);
    out = out.concat(walkModules(sub, depth + 1));
  }
  return out;
}
const modules = walkModules(DIR);
set('MODULE_COUNT', String(modules.length + 1));

// ---- java version ----------------------------------------------------------
const pom = read('pom.xml');
let javaVersion = '';
const pomProp = pom.match(/<(?:maven\.compiler\.(?:source|release)|java\.version)>\s*([^<]+)</);
if (pomProp) javaVersion = pomProp[1].trim();
const gradle = read('build.gradle') + read('build.gradle.kts');
const gradleToolchain = gradle.match(/languageVersion\s*\.?\s*set\s*\(\s*JavaLanguageVersion\.of\s*\(\s*(\d+)/);
if (!javaVersion && gradleToolchain) javaVersion = gradleToolchain[1];
set('JAVA_VERSION', javaVersion);

// ---- source layout ---------------------------------------------------------
// 多模块工程里约定目录在**各模块下**，不在根上 → 根 + 模块一起扫，报告"工程里存在哪些约定目录"
const CONVENTION_DIRS = ['src/main/java', 'src/main/kotlin', 'src/test/java', 'src/test/kotlin'];
const layoutRoots = [DIR, ...modules];
const srcDirs = CONVENTION_DIRS.filter((d) => layoutRoots.some((r) => existsSync(join(r, d))));
set('SOURCE_DIRS', srcDirs.join(',') || '');
set('SOURCE_DIRS_IN_ROOT', CONVENTION_DIRS.filter((d) => existsSync(join(DIR, d))).join(',') || '');
set('HAS_JAVA_SRC', srcDirs.some((d) => d.endsWith('java')) ? 'yes' : 'no');
set('HAS_KOTLIN_SRC', srcDirs.some((d) => d.endsWith('kotlin')) ? 'yes' : 'no');

// ---- test framework --------------------------------------------------------
const junit5 = /junit-jupiter|junit5/.test(pom) || /junit.*jupiter|junitPlatform/i.test(gradle);
const junit4 = /<artifactId>junit<\/artifactId>|junit:junit/.test(pom) || /junit:junit/.test(gradle);
const testng = /testng/i.test(pom + gradle);
set('TEST_FRAMEWORK', junit5 ? 'junit-jupiter' : junit4 ? 'junit4' : testng ? 'testng' : 'none');

// ---- project name ----------------------------------------------------------
const artifact = pom.match(/<artifactId>([^<]+)<\/artifactId>/);
set('MODULE_NAME', artifact ? artifact[1].trim() : '');

// ---- conditions ------------------------------------------------------------
const conditions = new Set();
if (hasPom) conditions.add('maven');
if (hasGradle) conditions.add('gradle');
if (modules.length) conditions.add('multi-module');
if (srcDirs.some((d) => d.endsWith('java'))) conditions.add('java');
if (srcDirs.some((d) => d.endsWith('kotlin'))) conditions.add('kotlin');
if (junit5) conditions.add('junit5');
if (junit4) conditions.add('junit4');
if (javaVersion) conditions.add('java-version-pinned');
set('CONDITIONS', [...conditions].sort().join(','));

// ---- 输出事实 -------------------------------------------------------------
for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
