// 百度网盘 openapi 客户端（传输层用）。
//
// 协议来源：百度官方 Go SDK `icode.baidu.com/baidu/xpan/go-sdk` 的
// uploadsdk/upload 三件套（precreate / upload / create）+ 成熟实现 mopler。
//
// 三个坑（都是实测踩出来的）：
//   1. **单步上传 `xpan/file?method=upload` 会 403**（file is not authorized），
//      但**原生分片协议是通的** —— 别被 403 误导成「这个 token 不能上传」。
//   2. **dlink 必须自带 access_token**，否则 403 `user not exists`（不是 UA 问题）。
//   3. dlink 是 **xpan/file?method=filemetas&dlink=1** 给的（不是 multimedia），
//      且 `sign` 有 8 小时有效期。

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = fileURLToPath(new URL('..', import.meta.url));
const OPENAPI = 'https://pan.baidu.com/rest/2.0';
const PCS = 'https://d.pcs.baidu.com/rest/2.0';

// 从机器本地配置里取 access_token：
// ZCODE_CFG 环境变量 → <技能目录>/config.json → ~/.zcode/cli/config.json
// 取的是 ZCode 配置里 baidu-server 这个 MCP server 的 Authorization 头里的 token。
export function resolveToken() {
  let cfg = {};
  const local = (() => { try { return JSON.parse(readFileSync(join(SKILL_DIR, 'config.json'), 'utf8')); } catch { return {}; } })();
  const cfgPath = process.env.ZCODE_CFG || local.zcodeConfig || join(homedir(), '.zcode', 'cli', 'config.json');
  try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch { cfg = {}; }
  const entry = cfg?.mcp?.servers?.['baidu-server'];
  const args = entry?.args || [];
  const hdr = args.find((a) => /^Authorization:/i.test(a)) || '';
  const token = hdr.replace(/^Authorization:\s*Bearer\s*/i, '').trim();
  if (!token) {
    throw new Error(
      '拿不到 access_token：在 ZCode 配置的 mcp.servers.baidu-server 启动参数里应有 ' +
      '"Authorization: Bearer <token>"（或在本技能目录的 config.json 里配 zcodeConfig）',
    );
  }
  return token;
}

// 统一的错误：**把百度的 errno/errmsg 原文带出来**，别只说「上传失败」。
// 实测百度的报错文本经常误导（errno 31024 "app id is empty" 其实是瞬时故障）。
export class XpanError extends Error {
  constructor(msg, detail) {
    super(msg);
    this.name = 'XpanError';
    this.detail = detail || null;
  }
}

async function readJson(res, what) {
  const text = await res.text();
  let j;
  try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!res.ok) {
    throw new XpanError(`${what} HTTP ${res.status}`, j);
  }
  if (j.errno !== undefined && j.errno !== 0) {
    throw new XpanError(`${what} errno=${j.errno} ${j.errmsg || j.error_msg || ''}`.trim(), j);
  }
  return j;
}

const form = (o) => new URLSearchParams(o).toString();

// openapi GET
export async function xpanGet(token, endpoint, params = {}) {
  const u = new URL(OPENAPI + endpoint);
  u.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return readJson(await fetch(u), endpoint);
}

// openapi POST（application/x-www-form-urlencoded）
export async function xpanPost(token, endpoint, body) {
  const u = new URL(OPENAPI + endpoint);
  u.searchParams.set('access_token', token);
  return readJson(
    await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) }),
    endpoint,
  );
}

// ① 预上传：告诉服务端「文件多大、每片 md5 是这些」，服务端回 uploadid 与**还缺哪些片**。
// 带 uploadid 再调 = 续传：服务端会认出已传的片，只回缺的那些。
export async function precreate(token, { path, size, blockList, uploadid }) {
  const body = {
    path, size: String(size), block_list: JSON.stringify(blockList),
    isdir: '0', autoinit: '1', rtype: '2',
  };
  if (uploadid) body.uploadid = uploadid;
  const r = await xpanPost(token, '/xpan/file?method=precreate', body);
  return {
    uploadid: r.uploadid,
    // 需要上传的分片序号（索引从 0 开始）
    missing: Array.isArray(r.block_list) ? r.block_list : [],
    returnType: r.return_type,
    path: r.path,
  };
}

// ② 分片上传：POST 一片，服务端回该片的 md5（与我们提交的一致即校验通过）
export async function uploadSlice(token, { path, uploadid, partseq, buffer }) {
  const u = new URL(PCS + '/pcs/superfile2');
  u.searchParams.set('method', 'upload');
  u.searchParams.set('access_token', token);
  u.searchParams.set('type', 'tmpfile');
  u.searchParams.set('path', path);
  u.searchParams.set('uploadid', uploadid);
  u.searchParams.set('partseq', String(partseq));
  const fd = new FormData();
  fd.append('file', new Blob([buffer]), 'file');
  const r = await readJson(await fetch(u, { method: 'POST', body: fd }), 'superfile2');
  return { md5: r.md5, requestId: r.request_id };
}

// ③ 建档：所有片传完后提交，正式生成网盘文件。
// 返回的 md5 是**网盘侧的闭源变种**，不是我们提交的分片 md5，别拿它当本地校验尺子。
export async function createFile(token, { path, size, blockList, uploadid }) {
  return xpanPost(token, '/xpan/file?method=create', {
    path, size: String(size), isdir: '0',
    block_list: JSON.stringify(blockList), uploadid, rtype: '2',
  });
}

// 取下载链接。**必须带 access_token**，否则 403 user not exists。
export async function downloadLink(token, fsid) {
  const r = await xpanGet(token, '/xpan/file?method=filemetas', { fsids: `[${fsid}]`, dlink: '1' });
  const item = (r.info || r.list || [])[0];
  if (!item) throw new XpanError('filemetas 没返回文件信息', r);
  const d = new URL(item.dlink);
  d.searchParams.set('access_token', token);
  return { dlink: d.toString(), size: Number(item.size || 0), netdiskMd5: item.md5, path: item.path, name: item.server_filename };
}

// 列目录
export async function listDir(token, dir, limit = 100) {
  const r = await xpanGet(token, '/xpan/file?method=list', { dir, order: 'name', limit: String(limit) });
  return r.list || [];
}
