// 文件哈希与分块工具 —— 传输层的地基。
//
// 两级哈希，各司其职（别混用）：
//   · **片级 md5**：百度上传协议的 block_list 就是它，**必须是标准 md5**，
//     服务端拿它逐片校验，自己改算法会被拒收。
//   · **文件级 sha256**：我们自己的账本真值。百度网盘返回的 md5 是**闭源变种**
//     （实测 ≠ 标准 md5，20+ 种常见变换全部对不上），复现不出来，
//     所以**不能**拿它当本地校验尺子，只能当网盘侧身份标识。
//
// 全部同步流式读：大模型备份包动辄 1.8GB，整文件读进内存会炸。
// 同步而非异步：这些函数只在 CLI 里用，块读本来就是阻塞的，
// 异步包装只会多一层状态机。

import { createHash } from 'node:crypto';
import { closeSync, openSync, readSync, statSync } from 'node:fs';

const CHUNK = 1 << 20; // 1 MiB

// 百度按会员等级限制单片大小（普通 4M / 会员 16M / 超级会员 32M）。
export const SLICE_BYTES = { free: 4 * 1024 ** 2, vip: 16 * 1024 ** 2, svip: 32 * 1024 ** 2 };

// vip_type：0 普通 / 1 会员 / 2 超级会员
export function sliceSizeFor(vipType) {
  if (Number(vipType) >= 2) return SLICE_BYTES.svip;
  if (Number(vipType) === 1) return SLICE_BYTES.vip;
  return SLICE_BYTES.free;
}

// 一次流式读，同时算：整文件 sha256 + 每片 md5 + 每片 sha256。
// 为什么不分三次读：1.8GB 的包读三遍就是三倍 IO。
// 返回 { size, sha256, md5, sliceSize, blocks:[{index,size,md5,sha256}], blockList:[md5...] }
export function digestFile(path, sliceSize = SLICE_BYTES.svip) {
  const size = statSync(path).size;
  const fileSha = createHash('sha256');
  const fileMd5 = createHash('md5');
  const blocks = [];
  let index = 0;
  let sliceHash = createHash('md5');
  let sliceSha = createHash('sha256');
  let sliceLen = 0;

  const flush = () => {
    if (sliceLen === 0) return;
    blocks.push({ index, size: sliceLen, md5: sliceHash.digest('hex'), sha256: sliceSha.digest('hex') });
    index++;
    sliceHash = createHash('md5');
    sliceSha = createHash('sha256');
    sliceLen = 0;
  };

  const buf = Buffer.alloc(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) {
      fileSha.update(buf.subarray(0, n));
      fileMd5.update(buf.subarray(0, n));
      // 一个 chunk 可能跨多片：按字节边界切开，逐片喂给分片哈希
      let pos = 0;
      while (pos < n) {
        const take = Math.min(sliceSize - sliceLen, n - pos);
        // take 必为正：sliceLen < sliceSize 恒成立（满了就 flush）。
        // 万一被改坏，这里要报错而不是死循环——哈希函数卡死比抛错难查得多。
        if (take <= 0) throw new Error(`分片大小非法：sliceSize=${sliceSize} sliceLen=${sliceLen}`);
        const part = buf.subarray(pos, pos + take);
        sliceHash.update(part);
        sliceSha.update(part);
        sliceLen += take;
        pos += take;
        if (sliceLen === sliceSize) flush();
      }
    }
  } finally {
    closeSync(fd);
  }
  flush();

  return {
    size,
    sha256: fileSha.digest('hex'),
    md5: fileMd5.digest('hex'),
    sliceSize,
    blocks,
    blockList: blocks.map((b) => b.md5),
  };
}

// 只算整文件 sha256（大文件校验的常用路径，省掉分块开销）
export function sha256File(path) {
  const h = createHash('sha256');
  const buf = Buffer.alloc(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

// 只算整文件 md5
export function md5File(path) {
  const h = createHash('md5');
  const buf = Buffer.alloc(CHUNK);
  const fd = openSync(path, 'r');
  try {
    let n;
    while ((n = readSync(fd, buf, 0, CHUNK, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}
