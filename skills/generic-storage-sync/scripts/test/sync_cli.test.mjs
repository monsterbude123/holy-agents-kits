// sync_cli.test.mjs — CLI 冒烟测试（node:test，零依赖）
// 口径：全部通过子进程跑真实 CLI（黑盒），临时目录隔离，绝不碰仓库内任何真实数据。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'sync_cli.mjs');
const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf-8', windowsHide: true }).stdout.trim();

/** 子进程环境：剔除继承的 STORAGE_* / PROJECT_ROOT，再叠加本用例的隔离配置 */
function childEnv(extra = {}) {
  const base = { ...process.env };
  for (const k of Object.keys(base)) {
    if (k.startsWith('STORAGE_') || k === 'GITHUB_KNOWLEDGE_HELPER_SPACE' || k === 'GITHUB_KOWNLEDGE_HELPER_SPACE') delete base[k];
  }
  return { ...base, ...extra };
}

/** 跑真实 CLI（黑盒） */
function cli(args, env = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: env.__cwd || process.cwd(), encoding: 'utf-8', windowsHide: true,
    env: childEnv(env),
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

/** 真实 git fixture：main 分支 + tag */
function makeRepo(root, name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 't@t']);
  git(dir, ['config', 'user.name', 't']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'c1']);
  return { path: dir, headSha: git(dir, ['rev-parse', 'HEAD']) };
}

let tmpRoot, repo, media, buffer, env;

beforeEach(() => {
  tmpRoot = mkdtemp();
  repo = makeRepo(tmpRoot, 'acme__widget');
  media = join(tmpRoot, 'media');
  buffer = join(tmpRoot, 'buffer');
  mkdirSync(media, { recursive: true });
  mkdirSync(buffer, { recursive: true });
  env = {
    __cwd: tmpRoot,
    GITHUB_KNOWLEDGE_HELPER_SPACE: tmpRoot,
    STORAGE_BUFFER_SPACE: buffer,
    STORAGE_TARGET_DISK: `local:${media}`,
  };
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function mkdtemp() {
  return mkdtempSync(join(tmpdir(), 'gss-cli-'));
}

/** 追加一次提交（制造第二个快照） */
function commitAgain() {
  writeFileSync(join(repo.path, 'README.md'), '# fixture v2\n');
  git(repo.path, ['add', '.']);
  git(repo.path, ['commit', '-q', '-m', 'c2']);
  return git(repo.path, ['rev-parse', 'HEAD']);
}

describe('sync_cli · 帮助与版本', () => {
  it('1 · --help 打印全部命令且退出码 0', () => {
    const r = cli(['--help'], env);
    assert.equal(r.code, 0);
    for (const c of ['target', 'status', 'diff', 'pack', 'push', 'pull', 'prune', 'clean-trash', 'clean-staging']) {
      assert.ok(r.out.includes(c), `--help 必须列出 ${c}`);
    }
  });

  it('2 · --version 输出版本号', () => {
    const r = cli(['--version'], env);
    assert.equal(r.code, 0);
    assert.match(r.out.trim(), /^\d+\.\d+\.\d+$/);
  });

  it('3 · 未知命令退出码 1', () => {
    const r = cli(['nope'], env);
    assert.equal(r.code, 1);
    assert.match(r.err + r.out, /未知命令/);
  });
});

describe('sync_cli · target 管理', () => {
  it('4 · target list 列出 .agents/.env 变量登记的介质', () => {
    const r = cli(['target', 'list'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /\[disk\] type=local/);
    assert.match(r.out, /共 1 个介质/);
  });

  it('5 · target add 写入索引 targets 表并可被列出', () => {
    const r = cli(['target', 'add', 'disk2', '--type', 'local', '--endpoint', join(tmpRoot, 'm2')], env);
    assert.equal(r.code, 0);
    const idx = JSON.parse(readFileSync(join(buffer, '.ghh-index.json'), 'utf-8'));
    assert.equal(idx.targets.disk2.type, 'local');
    const list = cli(['target', 'list'], env);
    assert.match(list.out, /\[disk2\]/);
  });

  it('6 · target add 非法类型被拒（退出码 1）', () => {
    const r = cli(['target', 'add', 'x', '--type', 'ftp', '--endpoint', 'p'], env);
    assert.equal(r.code, 1);
    assert.match(r.err + r.out, /非法介质类型/);
  });

  it('7 · target test 本地介质探活通过', () => {
    const r = cli(['target', 'test', 'disk'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /ping ok/);
  });

  it('8 · 未安装的介质类型明确报错，不假装成功', () => {
    const r = cli(['target', 'test', 'oss'], { ...env, STORAGE_TARGET_OSS: 'baidu:ep' });
    assert.equal(r.code, 1);
    assert.match(r.out + r.err, /驱动未安装/);
    assert.match(r.out + r.err, /driver-spi\.md/);
  });
});

describe('sync_cli · status / diff', () => {
  it('9 · status 输出缓冲盘、索引与介质健康状况', () => {
    const r = cli(['status'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /缓冲盘:/);
    assert.match(r.out, /索引:/);
    assert.match(r.out, /ping=ok/);
  });

  it('10 · status --trash 附回收站占用', () => {
    const r = cli(['status', '--trash'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /回收站:/);
    assert.match(r.out, /\.staging\/ 残卷/);
  });

  it('11 · diff 给出 toUpload / toTrash / upToDate 三段', () => {
    cli(['push', repo.path, '--target', 'disk'], env);
    const r = cli(['diff', 'disk'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /toUpload: 0/);
    assert.match(r.out, /toTrash: 0/);
    assert.match(r.out, /upToDate: 1/);
  });
});

describe('sync_cli · pack / push / pull', () => {
  it('12 · pack 产出 bundle 落到本地缓冲盘并记账', () => {
    const r = cli(['pack', repo.path], env);
    assert.equal(r.code, 0);
    const bundles = readdirSync(buffer).filter((f) => f.endsWith('.bundle'));
    assert.equal(bundles.length, 1);
    assert.match(r.out, new RegExp(bundles[0].replace(/\./g, '\\.')));
    const idx = JSON.parse(readFileSync(join(buffer, '.ghh-index.json'), 'utf-8'));
    assert.equal(idx.snapshots['acme/widget'].archiveName, bundles[0]);
  });

  it('13 · push 走两阶段提交：介质上有产物且远端索引已记账', () => {
    const r = cli(['push', repo.path, '--target', 'disk'], env);
    assert.equal(r.code, 0);
    assert.match(r.out, /阶段 1/);
    assert.match(r.out, /阶段 2/);
    const remote = JSON.parse(readFileSync(join(media, '.ghh-index.json'), 'utf-8'));
    assert.equal(remote.snapshots['acme/widget'].commitSha, repo.headSha);
    assert.equal(remote.syncRecords['acme/widget::disk'].status, 'synced');
    const bundles = readdirSync(media).filter((f) => f.endsWith('.bundle'));
    assert.equal(bundles.length, 1);
  });

  it('14 · pull 从介质拉回并 git clone 还原工作区', () => {
    cli(['push', repo.path, '--target', 'disk'], env);
    const dest = join(tmpRoot, 'restored');
    const r = cli(['pull', 'acme/widget', '--from', 'disk', '--dest', dest], env);
    assert.equal(r.code, 0);
    assert.ok(existsSync(join(dest, 'README.md')), '必须还原出工作区');
    assert.equal(git(dest, ['rev-parse', 'HEAD']), repo.headSha);
  });
});

describe('sync_cli · prune / clean-trash / clean-staging', () => {
  it('15 · prune 默认 dry-run：只出清单不删文件', () => {
    cli(['push', repo.path, '--target', 'disk'], env);
    commitAgain();
    cli(['push', repo.path, '--target', 'disk'], env);
    const r = cli(['prune', 'disk'], { ...env, STORAGE_MAX_RETAINED_SNAPSHOTS: '1' });
    assert.equal(r.code, 0);
    assert.match(r.out, /dry-run/);
    assert.match(r.out, /待淘汰 1 个/);
    assert.match(r.out, /仓库 acme\/widget/);
    assert.match(r.out, /可释放/);
    assert.equal(readdirSync(media).filter((f) => f.endsWith('.bundle')).length, 2, 'dry-run 不得删任何文件');
    assert.equal(existsSync(join(media, '.trash')), false, 'dry-run 不得产生回收站条目');
  });

  it('16 · prune --yes 才软淘汰进回收站（不物理删除）', () => {
    cli(['push', repo.path, '--target', 'disk'], env);
    commitAgain();
    cli(['push', repo.path, '--target', 'disk'], env);
    const r = cli(['prune', 'disk', '--yes'], { ...env, STORAGE_MAX_RETAINED_SNAPSHOTS: '1' });
    assert.equal(r.code, 0);
    assert.match(r.out, /已移入回收站 1 个/);
    assert.equal(readdirSync(media).filter((f) => f.endsWith('.bundle')).length, 1);
    const trash = readdirSync(join(media, '.trash'));
    assert.equal(trash.length, 1, '淘汰件必须落在 .trash/');
  });

  it('17 · clean-trash 默认 dry-run；--yes 且冷却期满才物理清理', () => {
    cli(['push', repo.path, '--target', 'disk'], env);
    commitAgain();
    cli(['push', repo.path, '--target', 'disk'], env);
    cli(['prune', 'disk', '--yes'], { ...env, STORAGE_MAX_RETAINED_SNAPSHOTS: '1' });
    // 老化回收站条目时间戳（文件名 <ts>_ 前缀），模拟冷却期满
    const trashDir = join(media, '.trash');
    const name = readdirSync(trashDir)[0];
    renameSync(join(trashDir, name), join(trashDir, `20200101T000000Z_${name.split('_').slice(1).join('_')}`));

    const dry = cli(['clean-trash', 'disk'], env);
    assert.equal(dry.code, 0);
    assert.match(dry.out, /到期 1 个/);
    assert.equal(readdirSync(trashDir).length, 1, 'dry-run 不得物理删除');

    const wet = cli(['clean-trash', 'disk', '--yes'], env);
    assert.equal(wet.code, 0);
    assert.match(wet.out, /已物理清理 1 个/);
    assert.equal(readdirSync(trashDir).length, 0);
  });

  it('18 · clean-staging 清掉 .staging 残卷与索引临时件', () => {
    mkdirSync(join(buffer, '.staging'), { recursive: true });
    writeFileSync(join(buffer, '.staging', 'junk.bundle.part'), 'x');
    writeFileSync(join(buffer, '.ghh-index.json.tmp'), '{');
    const r = cli(['clean-staging'], env);
    assert.equal(r.code, 0);
    assert.equal(readdirSync(join(buffer, '.staging')).length, 0);
    assert.equal(existsSync(join(buffer, '.ghh-index.json.tmp')), false);
  });
});
