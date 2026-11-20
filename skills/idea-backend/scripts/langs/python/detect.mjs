#!/usr/bin/env node
// Python 分册探测器：判一个已有 Python 项目的形态与事实，供通用分发器
// （scripts/inspect-project.mjs）过滤本分册的适用清单条目。
//
//   node scripts/langs/python/detect.mjs <project-dir>
//
// 打印 key=value 行（含 CONDITIONS=，逗号分隔的条件集合）。不写任何文件；
// 不是 Python 项目就如实报 PYPROJECT=no。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const dirArg = args.find((a) => !a.startsWith('--'));
if (!dirArg) {
  console.error('usage: detect.mjs <project-dir>');
  process.exit(2);
}
const DIR = resolve(dirArg);

const facts = {};
const set = (k, v) => { facts[k] = v === undefined || v === null ? '' : String(v); };

// pyproject.toml 是 TOML；用 python 的 tomllib 解析（3.11+ 自带），不引第三方依赖
function readToml(file) {
  const res = spawnSync(
    'python',
    ['-c', 'import sys,tomllib,json;d=tomllib.load(open(sys.argv[1],"rb"));print(json.dumps(d,default=str))', file],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) return null;
  try { return JSON.parse(res.stdout); } catch { return null; }
}

set('PROJECT_DIR', DIR);

// ---- pyproject.toml --------------------------------------------------------
const pyprojectPath = join(DIR, 'pyproject.toml');
const hasPyproject = existsSync(pyprojectPath);
set('PYPROJECT', hasPyproject ? 'yes' : 'no');
let pyproject = hasPyproject ? readToml(pyprojectPath) : null;
if (!pyproject && hasPyproject) set('PYPROJECT_PARSE', 'failed');
set('PYPROJECT_PARSE', pyproject ? 'ok' : (hasPyproject ? 'failed' : 'absent'));

const project = pyproject?.project ?? {};
set('PROJECT_NAME', project.name ?? '');
set('REQUIRES_PYTHON', project['requires-python'] ?? project.requires_python ?? '');
set('PROJECT_VERSION', project.version ?? '');
set('RUNTIME_DEPS', Array.isArray(project.dependencies) ? project.dependencies.length : 0);

// ---- tool tables ------------------------------------------------------------
const tool = (name) => (pyproject?.tool ?? {})[name] ?? null;
set('RUFF_CONFIG', tool('ruff') ? 'pyproject' : '');
set('MYPY_CONFIG', tool('mypy') ? 'pyproject' : '');
set('PYTEST_CONFIG', tool('pytest')?.ini_options ? 'pyproject' : '');
if (!facts.PYTEST_CONFIG) {
  for (const f of ['pytest.ini', 'tox.ini', 'setup.cfg']) {
    if (existsSync(join(DIR, f))) { set('PYTEST_CONFIG', f); break; }
  }
}

// ---- package manager / lockfile --------------------------------------------
const LOCKS = {
  'uv.lock': 'uv',
  'poetry.lock': 'poetry',
  'pdm.lock': 'pdm',
  'Pipfile.lock': 'pipenv',
  'requirements.txt': 'pip',
  'requirements-dev.txt': 'pip',
};
const presentLocks = Object.keys(LOCKS).filter((f) => existsSync(join(DIR, f)));
set('LOCKFILES', presentLocks.join(',') || '');
const pmFromTool = tool('uv') ? 'uv' : '';
const pm = pmFromTool || (presentLocks.length ? LOCKS[presentLocks[0]] : '');
set('PACKAGE_MANAGER', pm || 'unknown');

// ---- virtualenv ------------------------------------------------------------
const venvDir = ['.venv', 'venv', 'env'].find((d) => existsSync(join(DIR, d)));
set('VENV_DIR', venvDir ?? '');
set('VENV_PRESENT', venvDir ? 'yes' : 'no');

// ---- python version pin ----------------------------------------------------
let pin = '';
try { pin = readFileSync(join(DIR, '.python-version'), 'utf8').trim().split('\n')[0]; } catch { /* none */ }
set('PY_VERSION_FILE', pin ? '.python-version' : '');
set('PY_VERSION_PIN', pin);
const req = facts.REQUIRES_PYTHON;
const reqMin = (req.match(/>=\s*(\d+\.\d+)/) || [])[1] || '';
set('REQUIRES_PYTHON_MIN', reqMin);
set('PY_VERSION_COMPATIBLE', reqMin && pin ? (pin === reqMin ? 'yes' : 'no') : 'unknown');

// ---- layout ----------------------------------------------------------------
const srcDir = join(DIR, 'src');
const hasSrc = existsSync(srcDir) && readdirSync(srcDir).some((d) => !d.startsWith('.') && !d.startsWith('__'));
set('SRC_LAYOUT', hasSrc ? 'src' : 'flat');
const pkgName = facts.PROJECT_NAME.replace(/-/g, '_');
set('EXPECTED_PACKAGE_DIR', pkgName);
set('PACKAGE_DIR_PRESENT', hasSrc && existsSync(join(srcDir, pkgName)) ? 'yes' : 'no');

let pyFiles = 0;
try { pyFiles = readdirSync(DIR).filter((f) => f.endsWith('.py')).length; } catch { /* none */ }
set('ROOT_PY_FILES', pyFiles);

// ---- test / type / lint detection -----------------------------------------
const devGroup = pyproject?.['dependency-groups']?.dev ?? [];
const devNames = devGroup.map((d) => String(d).split(/[<>=!~[]/)[0].trim().toLowerCase());
const allDeps = [...(project.dependencies ?? []), ...devGroup].map((d) => String(d).split(/[<>=!~[]/)[0].trim().toLowerCase());
const has = (name) => allDeps.includes(name);

let testRunner = 'none';
if (has('pytest')) testRunner = 'pytest';
else if (existsSync(join(DIR, 'tests')) || existsSync(join(DIR, 'test'))) testRunner = 'pytest';
else if (has('unittest')) testRunner = 'unittest';
set('TEST_RUNNER', testRunner);

let typeChecker = 'none';
if (has('mypy')) typeChecker = 'mypy';
else if (has('pyright')) typeChecker = 'pyright';
set('TYPE_CHECKER', typeChecker);

let linter = 'none';
if (has('ruff')) linter = 'ruff';
else if (has('flake8')) linter = 'flake8';
else if (has('pylint')) linter = 'pylint';
set('LINTER', linter);

let formatter = 'none';
if (has('ruff')) formatter = 'ruff';
else if (has('black')) formatter = 'black';
set('FORMATTER', formatter);

// ---- conditions ------------------------------------------------------------
const conditions = new Set();
if (hasPyproject) conditions.add('pyproject');
if (pm === 'uv') conditions.add('uv');
if (pm === 'poetry') conditions.add('poetry');
if (testRunner === 'pytest') conditions.add('pytest');
if (typeChecker === 'mypy') conditions.add('mypy');
if (typeChecker === 'pyright') conditions.add('pyright');
if (linter === 'ruff') conditions.add('ruff');
if (formatter === 'ruff') conditions.add('ruff-format');
if (hasSrc) conditions.add('src-layout');
if (facts.VENV_PRESENT === 'yes') conditions.add('venv');
if (facts.REQUIRES_PYTHON) conditions.add('version-pinned');
set('DEV_DEPS', devNames.join(',') || '');
set('CONDITIONS', [...conditions].sort().join(','));

// ---- 输出事实 -------------------------------------------------------------
for (const [k, v] of Object.entries(facts)) console.log(`${k}=${v}`);
