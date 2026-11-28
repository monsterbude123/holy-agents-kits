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

// 带超时的 fetch。
// 为什么不用 AbortSignal.timeout()：本仓 counter-examples 记着它是不保活的定时器，
// 在顶层 await 里会让进程提前退出（unsettled top-level await）。
// 这里自己拿 AbortController + **ref 定时器**（clearTimeout 在 finally 里，不会泄漏）。
// 没有超时的话，服务端半死不活时 fetch 永不返回，CLI 就停在某个进度刻度上一动不动。
export async function timedFetch(url, init, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new XpanError(`请求超时（${Math.round(timeoutMs / 1000)}s 没等到响应）：${new URL(url).pathname}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// openapi GET
export async function xpanGet(token, endpoint, params = {}) {
  const u = new URL(OPENAPI + endpoint);
  u.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return readJson(await timedFetch(u, {}, 60_000), endpoint);
}

// openapi POST（application/x-www-form-urlencoded）
export async function xpanPost(token, endpoint, body) {
  const u = new URL(OPENAPI + endpoint);
  u.searchParams.set('access_token', token);
  return readJson(
    await timedFetch(u, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form(body) }, 60_000),
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
  const r = await readJson(await timedFetch(u, { method: 'POST', body: fd }, 300_000), 'superfile2');
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

// 查账号会员等级（0 普通 / 1 会员 / 2 超级会员）—— 决定百度允许的切片大小上限。
// 失败时抛错，由调用方决定回落策略（transfer 回落 4MB 安全档）。
export async function getUserVipType(token) {
  const r = await xpanGet(token, '/xpan/nas?method=uinfo', {});
  return Number(r.vip_type || 0);
}

// ---- 宽松 JSON 解析（MCP 返回实测会截断 / 拼块 / 前导换行） ----

// 从一段可能夹杂多个 JSON 的文本里，扫出**第一个 JSON 对象**。
// 按花括号配对计数，跳过字符串字面量里的花括号。
// 返回 { json, depth }：depth > 0 表示文本**被截断**、还缺 depth 个右花括号。
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { json: text.slice(start, i + 1), depth: 0 };
    }
  }
  return { json: text.slice(start), depth };
}

// 宽松解析：MCP 的 file_move 返回实测**末尾少一个 `}`**（花括号 2 vs 1），
// 而且返回可能由多个 content 块拼成、前面还带换行。
// 直接 JSON.parse(整段) 会失败 → 真实 errno/info 全丢，只剩一句「no-info」。
// 修法：按括号配对扫出第一个 JSON 对象；若还缺右括号就补齐再 parse。
export function parseLoose(raw) {
  const got = extractJson(raw);
  if (!got) return null;
  for (const cand of [got.json, raw.trim()]) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch { /* 试补括号 */ }
    const g2 = extractJson(cand);
    if (g2 && g2.depth > 0) {
      try { return JSON.parse(g2.json + '}'.repeat(g2.depth)); } catch { /* 继续 */ }
    }
  }
  return null;
}
