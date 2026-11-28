// local_driver.test.mjs — LocalFsDriver 与 BaseDriver 路径规整单测（node:test，零依赖）
// 全部用例在 mkdtemp 临时目录内跑；afterEach 强删（Windows 需 maxRetries 抗 EBUSY）。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BaseDriver, DRIVER_ERROR_CODES, joinStoragePath, normalizeStoragePath } from '../driver_spi.mjs';
import { LocalFsDriver } from '../local_driver.mjs';

let tmpRoot, media, driver;
beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'gss-'));
  media = join(tmpRoot, 'media');
  mkdirSync(media, { recursive: true });
  driver = new LocalFsDriver({ root: media });
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

describe('路径规整 normalizeStoragePath / joinStoragePath', () => {
  it('UNC 反斜杠前缀不被压成单斜杠', () => {
    assert.equal(normalizeStoragePath('\\\\nas\\share\\snap.bundle'), '//nas/share/snap.bundle');
    assert.equal(normalizeStoragePath('//nas/share/snap.bundle'), '//nas/share/snap.bundle');
    assert.ok(normalizeStoragePath('//nas/share').startsWith('//'));
  });
  it('Windows 反斜杠转 POSIX 正斜杠，盘符保持不变', () => {
    assert.equal(normalizeStoragePath('E:\\media\\repo.bundle'), 'E:/media/repo.bundle');
    assert.equal(normalizeStoragePath('E:/media\\repo.bundle'), 'E:/media/repo.bundle');
  });
  it('joinStoragePath 在 UNC 根上拼接仍保留双斜杠前缀', () => {
    assert.equal(joinStoragePath('//nas/share', 'sub', 'a.bundle'), '//nas/share/sub/a.bundle');
    assert.equal(joinStoragePath('E:/media', '.trash', 'x.bundle'), 'E:/media/.trash/x.bundle');
  });
  it('三重以上前导斜杠按 POSIX 收敛为单斜杠（非 UNC）', () => {
    assert.equal(normalizeStoragePath('///tmp/x'), '/tmp/x');
  });
});

describe('LocalFsDriver 传输', () => {
  it('upload → download 内容一致且 SHA-256 相同', async () => {
    const src = join(tmpRoot, 'src.bundle');
    const payload = Buffer.from('hello-generic-storage-sync');
    writeFileSync(src, payload);
    const up = await driver.upload(src, 'owner__repo-abc123.bundle');
    assert.equal(up.bytesWritten, payload.length);
    assert.equal(up.sha256, createHash('sha256').update(payload).digest('hex'));
    assert.ok(existsSync(join(media, 'owner__repo-abc123.bundle')));
    const back = join(tmpRoot, 'back.bundle');
    const down = await driver.download('owner__repo-abc123.bundle', back);
    assert.equal(down.bytesWritten, payload.length);
    assert.equal(down.sha256, up.sha256);
    assert.deepEqual(readFileSync(back), payload);
  });
  it('上传触发 onProgress 进度回调且字节数单调递增至总量', async () => {
    const src = join(tmpRoot, 'big.bundle');
    const payload = Buffer.alloc(512 * 1024, 3);
    writeFileSync(src, payload);
    const calls = [];
    await driver.upload(src, 'big.bundle', { onProgress: (t, n) => calls.push([t, n]) });
    assert.ok(calls.length >= 1, '进度回调必须被触发');
    assert.equal(calls.at(-1)[0], payload.length);
    assert.equal(calls.at(-1)[1], payload.length);
    for (let i = 1; i < calls.length; i++) assert.ok(calls[i][0] >= calls[i - 1][0], '进度必须单调不倒退');
  });
  it('AbortSignal 能中断上传，目标文件不落地', async () => {
    const src = join(tmpRoot, 'abort.bundle');
    writeFileSync(src, Buffer.alloc(4 * 1024 * 1024, 9));
    const ac = new AbortController();
    let fired = 0;
    const p = driver.upload(src, 'abort.bundle', {
      signal: ac.signal,
      onProgress: () => { if (++fired === 1) ac.abort(); },
    });
    await assert.rejects(p, (e) => e.code === DRIVER_ERROR_CODES.GSS_E_ABORTED);
    assert.equal(existsSync(join(media, 'abort.bundle')), false);
  });
});

describe('LocalFsDriver 软删除与回收站', () => {
  it('moveToTrash 后源文件不在原位，目标落在 .trash/ 下', async () => {
    const target = join(media, 'snap.bundle');
    writeFileSync(target, 'payload');
    const r = await driver.moveToTrash('snap.bundle');
    assert.equal(existsSync(target), false);
    assert.ok(existsSync(r.to), '回收站副本必须存在');
    assert.ok(r.to.includes('/.trash/'), '必须落在介质端 .trash/ 下');
    assert.match(r.to.split('/').pop(), /^\d{8}T\d{6}Z_snap\.bundle$/);
    assert.equal(readFileSync(r.to, 'utf-8'), 'payload');
  });
  it('跨盘 EXDEV 兜底：复制 → 校验 → 删除源，文件仍落在 .trash/', async () => {
    const target = join(media, 'exdev.bundle');
    writeFileSync(target, 'exdev-payload');
    class ExdevDriver extends LocalFsDriver {
      async _rename(from, to) {
        if (to.includes('/.trash/')) {
          const err = new Error('EXDEV: cross-device link not permitted');
          err.code = 'EXDEV';
          throw err;
        }
        return super._rename(from, to);
      }
    }
    const d = new ExdevDriver({ root: media });
    const r = await d.moveToTrash('exdev.bundle');
    assert.equal(r.mode, 'copy');
    assert.equal(existsSync(target), false);
    assert.ok(existsSync(r.to));
    assert.equal(readFileSync(r.to, 'utf-8'), 'exdev-payload');
  });
});

describe('LocalFsDriver 索引', () => {
  it('writeIndex / readIndex 往返一致且不留 .tmp 残件', async () => {
    const obj = { version: 1, snapshots: [{ fullName: 'owner/repo', commitSha: 'abc' }] };
    await driver.writeIndex(obj);
    assert.deepEqual(await driver.readIndex(), obj);
    assert.equal(existsSync(join(media, '.ghh-index.json.tmp')), false);
  });
  it('崩溃残留 .tmp 不会污染已落盘的索引', async () => {
    const obj = { version: 1, snapshots: [] };
    await driver.writeIndex(obj);
    writeFileSync(join(media, '.ghh-index.json.tmp'), '{"version": 1, "snapsh');
    assert.deepEqual(await driver.readIndex(), obj);
  });
  it('介质无索引时 readIndex 返回 null', async () => {
    assert.equal(await driver.readIndex(), null);
  });
});

describe('BaseDriver 契约兜底', () => {
  it('未实现的契约方法统一抛 GSS_E_NOT_IMPLEMENTED', async () => {
    const base = new BaseDriver();
    assert.equal(base.driverType, 'base');
    await assert.rejects(() => base.ping(), (e) => e.code === DRIVER_ERROR_CODES.GSS_E_NOT_IMPLEMENTED);
    await assert.rejects(() => base.upload('a', 'b'), (e) => e.code === DRIVER_ERROR_CODES.GSS_E_NOT_IMPLEMENTED);
    await assert.rejects(() => base.moveToTrash('a'), (e) => e.code === DRIVER_ERROR_CODES.GSS_E_NOT_IMPLEMENTED);
  });
});
