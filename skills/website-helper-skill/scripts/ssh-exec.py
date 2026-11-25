#!/usr/bin/env python3
"""website-helper-skill / scripts/ssh-exec.py — 远程 SSH 命令执行器

在目标云机器上执行一条或多条命令，并把 stdout/stderr 打回本地。
复用仓库根 .agents/.env 的 SSH 配置（host/user/port/password/key_path），
密钥优先、密码兜底，与 push-image-ssh.sh / install-server.sh 同一套凭据 SSOT。

用法:
    python ssh-exec.py "<remote command>"
    python ssh-exec.py "docker ps -a" "docker compose ls"   # 依次执行多条

前置:
    .agents/.env 已配置 SSH_HOST / SSH_USER，以及 SSH_PASSWORD 或 SSH_KEY_PATH。
    python3 + paramiko（跨平台，Windows 无需 sshpass）。

说明:
    - 本脚本只用于"查询/诊断"类命令。部署命令请在确认目标与影响后再执行。
    - 密钥优先于密码；密钥缺失时回退密码。
    - 不在输出中打印任何 secret（SSH 配置只在本地解析）。
"""
import os
import sys
from pathlib import Path
import paramiko

# 自发现仓库根：本文件位于 <repo>/.agents/skills/website-helper-skill/scripts/ssh-exec.py
_SCRIPT = Path(__file__).resolve()
# parents: [0]=scripts [1]=website-helper-skill [2]=skills [3]=.agents [4]=repo 根
_ROOT = _SCRIPT.parents[4]
ENV_FILE = _ROOT / ".agents" / ".env"


def _load_env(path: Path) -> dict:
    conf = {}
    if not path.exists():
        return conf
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        conf[k] = v.strip().strip('"')
    return conf


def _load_key(key_path):
    if not key_path or not os.path.exists(key_path):
        return None
    for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return cls.from_private_key_file(key_path)
        except Exception:
            continue
    return None


def main() -> int:
    conf = _load_env(ENV_FILE)
    if not conf:
        print(f"❌ 未找到 {ENV_FILE}，请先配置 SSH_HOST/SSH_USER 等", file=sys.stderr)
        return 1

    host = os.environ.get("SSH_HOST") or conf.get("SSH_HOST", "")
    user = os.environ.get("SSH_USER") or conf.get("SSH_USER", "")
    port = int(os.environ.get("SSH_PORT") or conf.get("SSH_PORT") or 22)
    pwd = os.environ.get("SSH_PASSWORD") or conf.get("SSH_PASSWORD", "")
    key_path = os.environ.get("SSH_KEY_PATH") or conf.get("SSH_KEY_PATH", "")

    if not host or not user:
        print("❌ 缺 SSH_HOST / SSH_USER", file=sys.stderr)
        return 1

    pkey = _load_key(key_path)
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = dict(hostname=host, port=port, username=user, timeout=30,
              look_for_keys=False, allow_agent=False)
    if pkey:
        kw["pkey"] = pkey
        auth = "key"
    else:
        kw["password"] = pwd or None
        auth = "password"
    try:
        cli.connect(**kw)
    except Exception as e:
        print(f"❌ SSH 连接失败 ({auth}): {e}", file=sys.stderr)
        return 2
    print(f"ℹ connected {user}@{host}:{port} ({auth})", file=sys.stderr)

    cmds = sys.argv[1:] or ["echo no command"]
    for cmd in cmds:
        print(f"\n==== $ {cmd} ====")
        _, out, err = cli.exec_command(cmd, timeout=600)
        sys.stdout.write(out.read().decode("utf-8", "replace"))
        e = err.read().decode("utf-8", "replace")
        if e.strip():
            sys.stdout.write("[stderr]\n" + e)
    cli.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())