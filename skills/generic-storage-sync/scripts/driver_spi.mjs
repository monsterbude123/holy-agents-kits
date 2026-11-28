// driver_spi.mjs — 统一存储驱动 SPI：BaseDriver 抽象基类 + 路径规整 + 错误码
// 外部驱动（百度网盘 / 夸克网盘）继承 BaseDriver 并实现 _xxx 钩子；公共方法在基类统一
// 完成「路径规整 + 参数校验 + 中断检查」，子类只写介质差异部分。零依赖 / Node >= 18。

/** 驱动错误码清单（与 references/driver-spi.md 逐字一致） */
export const DRIVER_ERROR_CODES = Object.freeze(
  Object.fromEntries(
    [
      'NOT_IMPLEMENTED', 'INVALID_ARG', 'NOT_FOUND', 'EXISTS', 'PERMISSION',
      'NETWORK', 'ABORTED', 'TIMEOUT', 'CHECKSUM', 'CROSS_DEVICE',
      'TRASH_FAILED', 'IO', 'UNSUPPORTED', 'CONFIG', 'RATE_LIMIT',
    ].map((k) => [`GSS_E_${k}`, `GSS_E_${k}`])
  )
);

/** 驱动统一异常：带 code，上层可按错误码分支处理。 */
export class DriverError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'DriverError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/**
 * 路径规整：反斜杠 → POSIX 斜杠；保留 UNC 双斜杠前缀。
 * Windows 的 path.join/normalize 会把 '//nas/share' 压成 '/nas/share'，网络驱动器随即
 * 不可访问，故此处手写，不复用 node:path。
 * @param {string} p
 * @returns {string}
 */
export function normalizeStoragePath(p) {
  if (typeof p !== 'string') return '';
  const raw = p.trim();
  if (!raw) return '';
  const slashed = raw.replace(/\\/g, '/');
  const isUnc = /^\/\/[^/]/.test(slashed);
  const collapsed = slashed.replace(/\/{2,}/g, '/');
  return isUnc ? `/${collapsed}` : collapsed;
}

/**
 * 在规整后的 base 上拼接子路径（同样保护 UNC 前缀）。
 * @param {string} base
 * @param {...string} parts
 * @returns {string}
 */
export function joinStoragePath(base, ...parts) {
  const b = normalizeStoragePath(base).replace(/\/+$/, '');
  const tail = parts.map((s) => normalizeStoragePath(s).replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const joined = [b, ...tail].filter((x) => x !== '').join('/');
  return b.startsWith('//') && !joined.startsWith('//') ? `/${joined}` : joined;
}

/**
 * 统一存储驱动抽象基类。
 * 公共方法是 final 模板：先规整路径 / 校验参数 / 检查中断，再委派给子类 _xxx 钩子。
 */
export class BaseDriver {
  /**
   * @param {{ root?: string, endpoint?: string }} [options] root = 介质根目录（远端路径基准）
   */
  constructor(options = {}) {
    this.options = options ?? {};
    this.root = normalizeStoragePath(this.options.root ?? this.options.endpoint ?? '');
  }

  /** 驱动标识：'local' | 'sftp' | 'smb' | 'baidu' | 'quark' */
  get driverType() { return 'base'; }

  // ---------- 子类可复用工具 ----------
  /** 路径规整 */
  norm(p) { return normalizeStoragePath(p); }
  /** 路径拼接（保护 UNC 前缀） */
  joinPath(base, ...parts) { return joinStoragePath(base, ...parts); }
  /** 介质根目录下的回收站目录 */
  get trashRoot() { return this.joinPath(this.root, '.trash'); }
  /** 未实现错误 */
  notImplemented(name) {
    return new DriverError(DRIVER_ERROR_CODES.GSS_E_NOT_IMPLEMENTED, `${this.driverType}.${name} is not implemented`);
  }
  /** 路径参数校验（必填） */
  requirePath(p, name) {
    const s = this.norm(p);
    if (!s) throw new DriverError(DRIVER_ERROR_CODES.GSS_E_INVALID_ARG, `${name} is required`);
    return s;
  }
  /** 中断检查：signal 已触发时立即抛 GSS_E_ABORTED */
  throwIfAborted(signal) {
    if (signal?.aborted) throw new DriverError(DRIVER_ERROR_CODES.GSS_E_ABORTED, 'operation aborted by signal');
  }

  // ---------- 契约：公共方法（final 模板） ----------
  /** 连通性探活 */
  async ping() { throw this.notImplemented('ping'); }
  /** 上传；options.onProgress 进度回调 + options.signal 中断为强制要求 */
  async upload(localSrc, remoteDst, options = {}) {
    const src = this.requirePath(localSrc, 'localSrc');
    const dst = this.requirePath(remoteDst, 'remoteDst');
    this.throwIfAborted(options.signal);
    return this._upload(src, dst, options);
  }
  /** 下载 */
  async download(remoteSrc, localDst, options = {}) {
    const src = this.requirePath(remoteSrc, 'remoteSrc');
    const dst = this.requirePath(localDst, 'localDst');
    this.throwIfAborted(options.signal);
    return this._download(src, dst, options);
  }
  /** 远端是否存在 */
  async exists(remotePath) { return this._exists(this.requirePath(remotePath, 'remotePath')); }
  /** 远端元数据 */
  async stat(remotePath) { return this._stat(this.requirePath(remotePath, 'remotePath')); }
  /** 列出远端目录（prefix 缺省 = 介质根） */
  async list(remoteDirPrefix = '') { return this._list(this.norm(remoteDirPrefix) || this.root); }
  /** 软删除：移入回收站，严禁物理删除 */
  async moveToTrash(remotePath, trashPrefix = '') {
    const src = this.requirePath(remotePath, 'remotePath');
    const trash = this.norm(trashPrefix) || this.trashRoot;
    return this._moveToTrash(src, trash);
  }
  /** 物理抹除：仅 lifecycle 在冷却期满后调用 */
  async purge(remotePath) { return this._purge(this.requirePath(remotePath, 'remotePath')); }
  /** 读取远端索引 JSON（无索引返回 null） */
  async readIndex() { return this._readIndex(); }
  /** 原子回写远端索引 JSON（content 可为对象或字符串） */
  async writeIndex(content) { return this._writeIndex(content); }

  // ---------- 契约：子类钩子 ----------
  async _upload() { throw this.notImplemented('_upload'); }
  async _download() { throw this.notImplemented('_download'); }
  async _exists() { throw this.notImplemented('_exists'); }
  async _stat() { throw this.notImplemented('_stat'); }
  async _list() { throw this.notImplemented('_list'); }
  async _moveToTrash() { throw this.notImplemented('_moveToTrash'); }
  async _purge() { throw this.notImplemented('_purge'); }
  async _readIndex() { throw this.notImplemented('_readIndex'); }
  async _writeIndex() { throw this.notImplemented('_writeIndex'); }
}
