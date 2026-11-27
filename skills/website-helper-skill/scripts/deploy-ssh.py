#!/usr/bin/env python3
"""website-helper-skill / scripts/deploy-ssh.py — SSH 直推部署编排（通用）

把「本地 docker 镜像 + 本地 compose/.env」经 SSH 推送到目标机并 docker compose up。
用于 registry / hermes 不可用时的一次性临时部署；是通用能力，不绑定任何具体项目，
镜像名 / compose 路径 / 目标目录都由参数传入。

用法: python deploy-ssh.py \\
    --image <name:tag> \\
    --compose <本地 docker-compose.<env>.yml> \\
    --remote-dir <目标机目录, 如 /opt/vvicat-staging> \\
    [--env-file <本地 .env.<env>>] [--project <compose 项目名>] \\
    [--up-only] [--dry-run] [--help]

流程:
  1) SFTP 上传 compose(+env) 到 --remote-dir
  2) docker save |stream| gzip → 远程 docker load（镜像不进 registry）
  3) cd --remote-dir && docker compose -f <compose> <up -d | ps>

SSH 配置复用仓库根 .agents/.env（SSH_HOST/SSH_USER/SSH_PASSWORD/SSH_PORT/SSH_KEY_PATH），
密钥优先、密码兜底（Windows 无需 sshpass，靠 paramiko）。

原则:
  - 一次性临时部署能力放在 skill，不在项目 scripts/ 里硬编码部署流程。
  - 不打印/回显任何 secret 值。
"""
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path
import paramiko

SCRIPT = Path(__file__).resolve()
# 兼容源码/安装两种布局：向上找第一个含 .agents/ 子目录的祖先 = 项目根
ROOT = next(
    (p for p in SCRIPT.parents if (p / ".agents").is_dir()),
    SCRIPT.parents[4],
)
ENV_FILE = ROOT / ".agents" / ".env"


def log(ok, msg):
    tag = "PASS" if ok else "INFO"
    print(f"[{tag}] {msg}", file=sys.stderr)


def load_env(path):
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


def load_key(key_path):
    if not key_path or not os.path.exists(key_path):
        return None
    for cls in (paramiko.Ed25519Key, paramiko.ECDSAKey, paramiko.RSAKey):
        try:
            return cls.from_private_key_file(key_path)
        except Exception:
            continue
    return None


def upload_resume(cli, kw, local, remote, max_attempts=8, label=""):
    """SFTP 断点续传 + 重试。

    - 续传: 远程已存在的字节数作起点(每个 SFTP write 原子, 断在 packet 边界可安全追加)。
    - 重试: 传输异常时 close 重连 cli, 从远程已写长度继续, 不整体重传。
    - keepalive: 每次连接后 set_keepalive(15) 防空闲掉线。
    """
    import time as _t
    local = Path(local)
    size = local.stat().st_size
    batch = 256 * 1024
    for attempt in range(1, max_attempts + 1):
        sftp = None
        fr = None
        try:
            sftp = cli.open_sftp()
            try:
                off = sftp.stat(remote).st_size
            except (FileNotFoundError, IOError):
                off = 0
            if off >= size:
                if sftp:
                    sftp.close()
                if fr:
                    fr.close()
                return True
            if off > 0:
                print(f"ℹ  {label}续传 {off/1024/1024:.0f}/{size/1024/1024:.0f} MB ...", file=sys.stderr)
            fr = sftp.open(remote, "ab")
            with open(local, "rb") as f:
                f.seek(off)
                total, last = off, off
                while True:
                    data = f.read(batch)
                    if not data:
                        break
                    fr.write(data)
                    total += len(data)
                    if total - last > 20 * 1024 * 1024:
                        print(f"ℹ  [XMIT] {total/1024/1024:.0f}/{size/1024/1024:.0f} MB ...", file=sys.stderr)
                        last = total
            if fr:
                fr.close()
            if sftp:
                sftp.close()
            return True
        except Exception as e:
            try:
                if fr:
                    fr.close()
            except Exception:
                pass
            try:
                if sftp:
                    sftp.close()
            except Exception:
                pass
            print(f"⚠  {label}传输中断({type(e).__name__}: {e}), 重试 {attempt}/{max_attempts} ...", file=sys.stderr)
            try:
                cli.close()
            except Exception:
                pass
            _t.sleep(min(2 * attempt, 15))
            cli.connect(**kw)
            tr = cli.get_transport()
            if tr:
                tr.set_keepalive(15)
    return False


def parse_args(argv):
    p = argparse.ArgumentParser(prog="deploy-ssh.py", add_help=False)
    p.add_argument("--image", required=True)
    p.add_argument("--compose", required=True)
    p.add_argument("--remote-dir", required=True)
    p.add_argument("--env-file", default="")
    p.add_argument("--project", default="")
    p.add_argument("--up-only", action="store_true",
                   help="跳过推镜像/传文件，只对已就绪的 remote-dir 执行 compose up")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--help", action="store_true")
    ns, _ = p.parse_known_args(argv)
    return ns


def main() -> int:
    a = parse_args(sys.argv[1:])
    if a.help:
        print(__doc__)
        return 0

    conf = load_env(ENV_FILE)
    host = os.environ.get("SSH_HOST") or conf.get("SSH_HOST", "")
    user = os.environ.get("SSH_USER") or conf.get("SSH_USER", "")
    port = int(os.environ.get("SSH_PORT") or conf.get("SSH_PORT") or 22)
    pwd = os.environ.get("SSH_PASSWORD") or conf.get("SSH_PASSWORD", "")
    key_path = os.environ.get("SSH_KEY_PATH") or conf.get("SSH_KEY_PATH", "")
    if not host or not user:
        print("❌ 缺 SSH_HOST/SSH_USER (.agents/.env)", file=sys.stderr)
        return 1

    compose = Path(a.compose)
    if not compose.exists():
        print(f"❌ compose 不存在: {compose}", file=sys.stderr)
        return 1
    env_f = Path(a.env_file) if a.env_file else None
    if env_f and not env_f.exists():
        print(f"❌ env-file 不存在: {env_f}", file=sys.stderr)
        return 1

    pkey = load_key(key_path)
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    kw = dict(hostname=host, port=port, username=user, timeout=30,
              look_for_keys=False, allow_agent=False)
    kw["pkey"] = pkey or None
    if not pkey:
        kw["password"] = pwd or None
    cli.connect(**kw)
    auth = "key" if pkey else "password"
    print(f"ℹ connected {user}@{host}:{port} ({auth})", file=sys.stderr)
    tr = cli.get_transport()
    if tr:
        tr.set_keepalive(15)

    bdir = a.remote_dir.rstrip("/")
    # cd 远程目录后 compose project name 默认取目录 basename；需显式覆盖时用 -p
    projopt = f"-p {a.project}" if a.project else ""

    # 0) dry-run? 只打印计划
    if a.dry_run:
        print("[DRY] 将: 上传 compose → 推送镜像 → compose up")
        print(f"[DRY] scp {compose.name}, {env_f.name if env_f else ''} -> {bdir}")
        print(f"[DRY] docker save {a.image} | stream | docker load")
        print(f"[DRY] cd {bdir} && docker compose {projopt} -f {compose.name} up -d")
        cli.close(); return 0

    def run(cmd, timeout=600):
        _, out, err = cli.exec_command(cmd, timeout=timeout)
        o = out.read().decode("utf-8", "replace")
        e = err.read().decode("utf-8", "replace")
        if e.strip():
            sys.stderr.write(e)
        return o

    if not a.up_only:
        # 1) 确保远程目录并上传文件(compose/env 小文件, 断点续传 + 重试)
        run(f"mkdir -p {bdir}")
        for f in (compose, env_f):
            if f and not upload_resume(cli, kw, str(f), f"{bdir}/{f.name}", max_attempts=3, label="compose "):
                print(f"❌ 上传 {f.name} 失败", file=sys.stderr); cli.close(); return 2
            if f:
                print(f"ℹ 已上传 {f.name}", file=sys.stderr)

        # 2) 推镜像: 本地 docker save -> Python gzip 压缩成 .tar.gz -> SFTP 断点续传 -> 目标机 gzip -dc | docker load
        #    不用跨进程管道经 paramiko stdin 流式写远程(Windows 下 stdin 流不可靠)，
        #    先本地压缩(SN 自持 tar.gz 写本地文件)，远端固定文件名支持断点续传。
        import gzip as _gz
        tag = a.image.replace(":", "_").replace("/", "_")
        tmpdir = Path(os.environ.get("TEMP", "/tmp"))
        local_gz = tmpdir / f"vvicat-save-{tag}.tar.gz"
        if not local_gz.exists():
            print(f"ℹ 推送镜像 {a.image} ...", file=sys.stderr)
            tmpl = tmpdir / f"vvicat-save-{tag}.tar"
            print(f"ℹ docker save + gzip -> {local_gz.name} ...", file=sys.stderr)
            p0 = subprocess.Popen(["docker", "save", a.image], stdout=subprocess.PIPE)
            try:
                with _gz.open(local_gz, "wb", compresslevel=6) as fo:
                    while True:
                        data = p0.stdout.read(65536)
                        if not data:
                            break
                        fo.write(data)
            finally:
                p0.stdout.close()
            p0.wait()
            if p0.returncode != 0 or not local_gz.exists():
                print("❌ docker save 失败", file=sys.stderr)
                local_gz.unlink(missing_ok=True); tmpl.unlink(missing_ok=True)
                cli.close(); return 2
            tmpl.unlink(missing_ok=True)
        gz_size = local_gz.stat().st_size
        remote_gz = f"/tmp/vvicat-save-{tag}.tar.gz"
        # 大文件用原生 scp: paramiko SFTP 在高延迟链路上受 SSH 窗口限制只有 ~75KB/s,
        # scp(OpenSSH 自带)能到 ~1.3MB/s(快 ~16x)。scp 无断点续传, 但冒烟链路下全量也就 ~3 分钟,
        # 用「scp + keepalive + 重试」兜底即可(断线重传整包, 成本远低于 paramiko 慢传)。
        print(f"ℹ 压缩后 {gz_size/1024/1024:.1f} MB, scp 上传中 ...", file=sys.stderr)
        scp_cmd = ["scp", "-P", str(port),
                   "-o", "StrictHostKeyChecking=no",
                   "-o", "UserKnownHostsFile=NUL",
                   "-o", "ConnectTimeout=30",
                   "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"]
        if key_path and os.path.exists(key_path):
            scp_cmd += ["-i", key_path]
        scp_cmd += [str(local_gz), f"{user}@{host}:{remote_gz}"]
        ok = False
        for attempt in range(1, 6):
            sp = subprocess.run(scp_cmd, capture_output=True, text=True)
            if sp.returncode == 0:
                ok = True
                break
            sys.stderr.write((sp.stderr or sp.stdout) + "\n")
            print(f"⚠  scp 第 {attempt}/5 次失败, 重试 ...", file=sys.stderr)
            time.sleep(min(3 * attempt, 12))
        local_gz.unlink(missing_ok=True)
        if not ok:
            print("❌ scp 镜像上传失败", file=sys.stderr)
            cli.close(); return 2
        print("ℹ [XMIT] scp 上传完成", file=sys.stderr)

        out = run(f"gzip -dc {remote_gz} | docker load && rm -f {remote_gz}",
                  timeout=600)
        sys.stdout.write(out)
        log(True, f"镜像 {a.image} 已 load")
        time.sleep(2)

    # 3) compose up
    bname = os.path.basename(compose.name)
    cmd = f"cd {bdir} && docker compose {projopt} -f {bname} up -d"
    print(f"ℹ $ {cmd}", file=sys.stderr)
    out = run(cmd, timeout=300)
    sys.stdout.write(out)
    cli.close()
    log(True, "compose up 完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())