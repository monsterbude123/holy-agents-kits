// local_driver.mjs — 本地物理盘 / 移动硬盘 / 盘符挂载 / SMB-NFS 已挂载目录驱动
// 铁律：淘汰一律走 .trash/ 软删除；物理删除只发生在 purge()（由 lifecycle 冷却期满后调用）。
import { createReadStream, createWriteStream, constants as FS } from 'node:fs';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { BaseDriver, DriverError, DRIVER_ERROR_CODES as E } from './driver_spi.mjs';
import { loadEnv } from './env.mjs';

const ABS_RE = /^(?:\/|[A-Za-z]:\/)/;
const INDEX_NAME = '.ghh-index.json';
const PART = '.gss-part';
const dirOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? '.' : i === 0 ? '/' : p.slice(0, i); };
const baseOf = (p) => { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); };
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const sha256 = async (p) => { const h = createHash('sha256'); for await (const c of createReadStream(p)) h.update(c); return h.digest('hex'); };
const mediaErr = (op, p, err) => new DriverError(err?.code === 'ENOENT' ? E.GSS_E_NOT_FOUND : E.GSS_E_IO, `${op} failed: ${p}`, err);

export class LocalFsDriver extends BaseDriver {
  constructor(options = {}) {
    super(options);
    if (!this.root) this.root = this.norm(loadEnv().STORAGE_BUFFER_SPACE || '');
  }
  get driverType() { return 'local'; }
  /** 介质内路径解析：绝对路径原样，相对路径挂到介质根下 */
  resolveTarget(p) {
    const n = this.norm(p);
    return !n ? this.root : ABS_RE.test(n) ? n : this.joinPath(this.root, n);
  }
  indexPath() { return this.joinPath(this.root, INDEX_NAME); }

  /** 连通性探活：根目录存在且可读写 */
  async ping() {
    if (!this.root) throw new DriverError(E.GSS_E_CONFIG, 'local driver requires root');
    try { await access(this.root, FS.R_OK | FS.W_OK); } catch (err) {
      throw new DriverError(E.GSS_E_NOT_FOUND, `media root not accessible: ${this.root}`, err);
    }
    if (!(await stat(this.root)).isDirectory()) throw new DriverError(E.GSS_E_CONFIG, 'media root is not a directory');
    return { ok: true, driverType: this.driverType, root: this.root };
  }

  /** 流式复制（绝不整文件入内存）：边写边算 SHA-256 并回报进度 */
  async _copyStream(srcPath, dstPath, { onProgress, signal } = {}) {
    const hash = createHash('sha256');
    const total = (await stat(srcPath)).size;
    let sent = 0;
    const report = (n) => { try { onProgress?.(n, total); } catch { /* 回调异常不打断传输 */ } };
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        sent += chunk.length;
        hash.update(chunk);
        report(sent);
        cb(null, chunk);
      },
    });
    const ac = new AbortController(), onAbort = () => ac.abort();
    if (signal) { this.throwIfAborted(signal); signal.addEventListener('abort', onAbort, { once: true }); }
    try {
      await pipeline(createReadStream(srcPath), meter, createWriteStream(dstPath), { signal: ac.signal });
    } catch (err) {
      await rm(dstPath, { force: true, maxRetries: 5 }).catch(() => {}); // 只清自己刚建的临时体
      if (signal?.aborted || err?.name === 'AbortError' || err?.code === 'ABORT_ERR') throw new DriverError(E.GSS_E_ABORTED, `transfer aborted: ${srcPath}`, err);
      throw new DriverError(E.GSS_E_IO, `transfer failed: ${srcPath} -> ${dstPath}`, err);
    } finally { signal?.removeEventListener('abort', onAbort); }
    report(sent);
    return { bytesWritten: sent, sha256: hash.digest('hex') };
  }
  /** 传输落盘：先写 .gss-part 再 rename，杜绝半截文件污染介质 */
  async _transfer(src, dst, options) {
    await mkdir(dirOf(dst), { recursive: true });
    const part = `${dst}${PART}`;
    const res = await this._copyStream(src, part, options);
    await this._rename(part, dst);
    return res;
  }
  /** 上传：本地 → 介质 */
  async _upload(localSrc, remoteDst, options = {}) { return this._transfer(localSrc, this.resolveTarget(remoteDst), options); }
  /** 下载：介质 → 本地 */
  async _download(remoteSrc, localDst, options = {}) { return this._transfer(this.resolveTarget(remoteSrc), localDst, options); }
  async _exists(remotePath) { try { await access(this.resolveTarget(remotePath)); return true; } catch { return false; } }

  async _stat(remotePath) {
    const p = this.resolveTarget(remotePath);
    try {
      const s = await stat(p);
      return { path: p, name: baseOf(p), size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory(), isFile: s.isFile() };
    } catch (err) { throw mediaErr('stat', p, err); }
  }
  async _list(remoteDirPrefix) {
    const dir = this.resolveTarget(remoteDirPrefix || '.');
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch (err) { throw mediaErr('list', dir, err); }
    const out = [];
    for (const e of entries) {
      const p = this.joinPath(dir, e.name);
      let size = 0, mtimeMs = 0;
      try { const s = await stat(p); size = s.size; mtimeMs = s.mtimeMs; } catch { /* 断链条目跳过元数据 */ }
      out.push({ name: e.name, path: p, size, mtimeMs, isDirectory: e.isDirectory(), isFile: e.isFile() });
    }
    return out;
  }
  /** 可覆写点：测试可注入 EXDEV 以验证跨盘兜底 */
  async _rename(from, to) { await rename(from, to); }
  /** 软删除：移入 .trash/<ts>_<原名>，严禁物理 unlink；EXDEV 时降级为复制 → 校验 → 删除源 */
  async _moveToTrash(remotePath, trashPrefix) {
    const src = this.resolveTarget(remotePath);
    const trashDir = this.resolveTarget(trashPrefix);
    await mkdir(trashDir, { recursive: true });
    const name = `${stamp()}_${baseOf(src)}`;
    let dst = this.joinPath(trashDir, name);
    let i = 1;
    while (await this._exists(dst)) dst = this.joinPath(trashDir, `${name}-${i++}`);
    try {
      await this._rename(src, dst);
      return { from: src, to: dst, mode: 'rename' };
    } catch (err) {
      if (err?.code !== 'EXDEV') throw new DriverError(E.GSS_E_TRASH_FAILED, `move to trash failed: ${src}`, err);
      await copyFile(src, dst);
      const [a, b] = await Promise.all([sha256(src), sha256(dst)]);
      if (a !== b) { await rm(dst, { force: true }); throw new DriverError(E.GSS_E_CHECKSUM, `copy verification failed: ${src} -> ${dst}`); }
      await rm(src, { force: true }); // 移动的最后一步：源在回收站已有校验过的副本
      return { from: src, to: dst, mode: 'copy', sha256: a };
    }
  }
  /** 物理抹除：全流程唯一允许物理删除的入口，仅 lifecycle 冷却期满后调用 */
  async _purge(remotePath) {
    const p = this.resolveTarget(remotePath);
    await rm(p, { recursive: true, force: true });
    return { purged: true, path: p };
  }
  async _readIndex() {
    const p = this.indexPath();
    try { return JSON.parse(await readFile(p, 'utf-8')); } catch (err) {
      if (err?.code === 'ENOENT') return null;
      throw mediaErr('index read', p, err);
    }
  }

  /** 原子写：.tmp 落盘 + rename 替换，崩溃后原索引零污染 */
  async _writeIndex(content) {
    const p = this.indexPath();
    const tmp = `${p}.tmp`;
    const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await mkdir(dirOf(p), { recursive: true });
    await writeFile(tmp, text, 'utf-8');
    await this._rename(tmp, p);
    return { path: p, bytes: Buffer.byteLength(text) };
  }
}
