// queryFlags.mjs — query CLI 的参数解析（纯函数，无 IO）
//
// 模式：--log / --tag / --show / --grab / --freshness / --recent (--all)

/** @typedef {'log' | 'tag' | 'show' | 'grab' | 'freshness' | 'recent'} QueryMode */

const DEFAULT_FLAGS = {
  repo: null,
  mode: 'log',
  limit: 20,
  tag: null,
  show: null,
  grab: null,
  since: null,
  until: null,
  all: false,
  json: false,
  patch: false,
  noCrossCheck: false,
  context: 3,
  top: 15,
};

/**
 * 解析 query 的 argv 片段为 QueryFlags。
 * 位置参数（第一个非 -- 开头、且不是字符串 flag 消费的值的 token）视为 repo。
 */
export function parseQueryFlags(args) {
  const f = { ...DEFAULT_FLAGS };
  const consumed = new Set(); // 字符串 flag 消费掉的值 token，不参与 repo 扫描

  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    const next = args[i + 1];
    switch (a) {
      case '--log':
        f.mode = 'log';
        break;
      case '--tag':
        f.mode = 'tag';
        f.tag = next ?? '';
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--show':
        f.mode = 'show';
        f.show = next ?? '';
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--grab':
        f.mode = 'grab';
        f.grab = next ?? '';
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--freshness':
        f.mode = 'freshness';
        break;
      case '--recent':
        f.mode = 'recent';
        break;
      case '--all':
        f.all = true;
        break;
      case '--limit':
        f.limit = parseInt(next ?? '20', 10);
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--since':
        f.since = next ?? '';
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--until':
        f.until = next ?? '';
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--json':
        f.json = true;
        break;
      case '--patch':
        f.patch = true;
        break;
      case '--no-cross-check':
        f.noCrossCheck = true;
        break;
      case '--context':
        f.context = parseInt(next ?? '3', 10);
        if (next !== undefined) consumed.add(next);
        i++;
        break;
      case '--top':
        f.top = parseInt(next ?? '15', 10);
        if (next !== undefined) consumed.add(next);
        i++;
        break;
    }
  }

  // repo 扫描：优先取第一个非 -- 开头且未被字符串 flag 消费的 token；
  // 全部被消费（如 `query myrepo --tag myrepo`，flag 值与 repo 同名）时回退第一个非 -- token
  for (const a of args) {
    if (!a.startsWith('--') && !consumed.has(a) && !f.repo) {
      f.repo = a;
      break;
    }
  }
  if (!f.repo) {
    for (const a of args) {
      if (!a.startsWith('--') && !f.repo) {
        f.repo = a;
        break;
      }
    }
  }

  if (f.all && f.mode !== 'recent') {
    throw new Error('--all 仅支持 --recent 模式');
  }
  if (!f.all && !f.repo && f.mode !== 'recent') {
    throw new Error('query <repo> 缺少 <repo> 参数，或加 --all 进入全仓模式');
  }
  return f;
}
