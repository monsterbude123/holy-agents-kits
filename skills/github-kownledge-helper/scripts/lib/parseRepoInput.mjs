// parseRepoInput.mjs — 解析人类输入（owner/repo / URL / SSH）为规范 {owner, repo}

/**
 * 支持的输入形态：
 *  - "facebook/react"
 *  - "https://github.com/facebook/react"
 *  - "https://github.com/facebook/react.git"
 *  - "git@github.com:facebook/react.git"
 *  - "git://github.com/facebook/react.git"
 * 两侧空白会被 trim。
 *
 * 失败：空 / 缺斜杠 / 多余路径段 / 缺 owner 或 repo。
 */
export function parseRepoInput(input) {
  const trimmed = (input ?? '').trim();
  if (!trimmed) throw new Error('empty repo input');

  let s = trimmed;

  // 1. SSH：git@host:owner/repo(.git)?
  const sshColon = s.match(/^git@[^:]+:(.+)$/);
  if (sshColon) {
    s = sshColon[1] ?? '';
  } else {
    // 2. SSH-URL：ssh://git@host/owner/repo
    s = s.replace(/^ssh:\/\/[^/]+\//, '');
    // 3. http(s) / git 协议：//host/...
    s = s.replace(/^(https?|git):\/\/[^/]+\//, '');
  }

  // 4. 去掉尾部 .git
  s = s.replace(/\.git$/, '');

  // 5. 必须恰好 owner/repo 两段，且都不为空（不接受尾斜杠产生的空段）
  const parts = s.split('/');
  if (parts.length !== 2) {
    throw new Error(
      `invalid repo input: ${input}（期望 owner/repo 形式）`
    );
  }
  if (parts.some((p) => !p)) {
    throw new Error(
      `invalid repo input: ${input}（owner 或 repo 为空）`
    );
  }

  const [owner, repo] = parts;

  return { owner, repo };
}
