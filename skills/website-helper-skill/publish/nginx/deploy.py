"""Nginx deployment — upload, backup, rollback."""

import time
from pathlib import Path

from publish.nginx.config import (
    generate_proxy_server_block,
    generate_server_block,
    validate_nginx_config,
)
from publish.nginx.vhost_probe import detect_vhost_target
from publish.ssh.client import SshClient

MAX_BACKUPS = 5  # VR-007


def _install_config(
    ssh: SshClient, subdomain: str, config_content: str, is_redeploy: bool
) -> None:
    """Backup (if redeploying), upload config to the probed vhost dir, validate, reload.

    VR-010: 目标目录必须探测，不能假定 sites-enabled——宝塔等面板会静默吞配置（138B 404）。
    """
    target = detect_vhost_target(ssh)
    config_path, enabled_path, _ = target.paths_for(subdomain)
    different_dirs = config_path != enabled_path

    if is_redeploy:
        backup(ssh, subdomain)

    tmp_path = f"/tmp/nginx-{subdomain}.conf"
    ssh.exec_command(f"cat > {tmp_path} << 'NGINXEOF'\n{config_content}\nNGINXEOF")
    ssh.exec_command(f"mv {tmp_path} {config_path}")
    if different_dirs:
        ssh.exec_command(f"ln -sf {config_path} {enabled_path}")

    ok, output = validate_nginx_config(ssh)
    if not ok:
        raise RuntimeError(f"Nginx 配置语法错误（{target.family}: {config_path}）:\n{output}")

    ssh.exec_command("systemctl reload nginx")


def deploy_proxy(
    ssh: SshClient,
    subdomain: str,
    upstream: str,
    with_ssl: bool = False,
) -> None:
    """VR-009: Point a subdomain at an existing backend (no file upload)."""
    config_path = f"/etc/nginx/sites-available/{subdomain}"
    exit_code, _, _ = ssh.exec_command(f"test -f {config_path}")
    _install_config(
        ssh,
        subdomain,
        generate_proxy_server_block(subdomain, upstream, with_ssl=with_ssl),
        is_redeploy=exit_code == 0,
    )


def deploy_webroot(
    ssh: SshClient,
    subdomain: str,
    local_webroot: Path,
    with_ssl: bool = False,
) -> None:
    """Deploy webroot and Nginx config to remote server."""
    remote_webroot = f"/var/www/{subdomain}"
    config_path = f"/etc/nginx/sites-available/{subdomain}"

    # If redeploying, backup first
    exit_code, _, _ = ssh.exec_command(f"test -f {config_path}")
    is_redeploy = exit_code == 0

    # Upload web files as compressed tarball
    if is_redeploy:
        ssh.exec_command(f"rm -rf {remote_webroot}")
    ssh.upload_tarball(local_webroot, remote_webroot)

    _install_config(
        ssh,
        subdomain,
        generate_server_block(subdomain, remote_webroot, with_ssl=False),
        is_redeploy=is_redeploy,
    )


def backup(ssh: SshClient, subdomain: str) -> str:
    """Backup current Nginx config and webroot. Returns backup timestamp."""
    timestamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    backup_dir = f"/var/backups/{subdomain}"
    ts_dir = f"{backup_dir}/{timestamp}"
    config_path = f"/etc/nginx/sites-available/{subdomain}"
    webroot_path = f"/var/www/{subdomain}"

    ssh.exec_command(f"mkdir -p {ts_dir}")
    ssh.exec_command(f"cp -a {config_path} {ts_dir}/ 2>/dev/null || true")
    ssh.exec_command(f"cp -a {webroot_path} {ts_dir}/webroot 2>/dev/null || true")

    # Enforce max backups (VR-007)
    exit_code, stdout, _ = ssh.exec_command(f"ls -1 {backup_dir} 2>/dev/null | sort")
    if exit_code == 0:
        backups = [b for b in stdout.strip().split("\n") if b]
        while len(backups) > MAX_BACKUPS:
            oldest = backups.pop(0)
            ssh.exec_command(f"rm -rf {backup_dir}/{oldest}")

    return timestamp


def rollback(ssh: SshClient, subdomain: str) -> str:
    """Rollback to previous version. Returns the restored timestamp."""
    backup_dir = f"/var/backups/{subdomain}"
    config_path = f"/etc/nginx/sites-available/{subdomain}"
    webroot_path = f"/var/www/{subdomain}"

    # Get list of backups, sorted by name (timestamp)
    exit_code, stdout, _ = ssh.exec_command(f"ls -1dt {backup_dir}/*/ 2>/dev/null")
    if exit_code != 0 or not stdout.strip():
        raise RuntimeError(f"无可用备份: {subdomain}")

    dirs = [d.rstrip("/") for d in stdout.strip().split("\n")]
    if len(dirs) < 2:
        # Only current backup (just made), need the one before that
        # Actually, the backup dirs include all versions
        raise RuntimeError(f"无可回滚版本（仅当前版本）: {subdomain}")

    # The backup list is sorted by time desc; [0] is current, [1] is previous
    # But we just backed up current, so the list is: current_backup, old_backup, ...
    target_backup = dirs[1]
    timestamp = Path(target_backup).name

    # Restore config
    ssh.exec_command(f"cp {target_backup}/{subdomain} {config_path}")
    # Restore webroot
    ssh.exec_command(f"rm -rf {webroot_path}")
    ssh.exec_command(f"cp -a {target_backup}/webroot {webroot_path}")

    # Validate and reload
    ok, output = validate_nginx_config(ssh)
    if not ok:
        raise RuntimeError(f"Nginx 配置语法错误（回滚后）:\n{output}")

    ssh.exec_command("systemctl reload nginx")
    return timestamp
