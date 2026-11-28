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
 * 位置参数（第一个非 -- 开头的 token）视为 repo。
 */
export function parseQueryFlags(args) {
  const f = { ...DEFAULT_FLAGS };

  for (const a of args) {
    if (!a.startsWith('--') && !f.repo) {
      f.repo = a;
      break;
    }
  }

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
        i++;
        break;
      case '--show':
        f.mode = 'show';
        f.show = next ?? '';
        i++;
        break;
      case '--grab':
        f.mode = 'grab';
        f.grab = next ?? '';
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
        i++;
        break;
      case '--since':
        f.since = next ?? '';
        i++;
        break;
      case '--until':
        f.until = next ?? '';
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
        i++;
        break;
      case '--top':
        f.top = parseInt(next ?? '15', 10);
        i++;
        break;
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
