"""SSL certificate management via certbot on remote host."""

from dataclasses import dataclass
from datetime import datetime

from publish.ssh.client import SshClient


@dataclass
class CertInfo:
    status: str  # valid, expiring, expired, absent
    issuer: str
    not_before: str
    not_after: str
    days_remaining: int


def _ensure_certbot(ssh: SshClient) -> None:
    """Ensure certbot and nginx plugin are installed."""
    exit_code, _, _ = ssh.exec_command("which certbot")
    if exit_code != 0:
        ssh.exec_command("apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx")


def request_cert(ssh: SshClient, subdomain: str) -> str:
    """Request SSL certificate via certbot --nginx. Raises on failure."""
    _ensure_certbot(ssh)

    exit_code, stdout, stderr = ssh.exec_command(
        f"certbot --nginx -d {subdomain} --non-interactive --agree-tos "
        f"--email admin@{subdomain.split('.', 1)[1]} 2>&1"
    )
    output = stdout + stderr

    if exit_code != 0:
        if "DNS problem" in output or "NXDOMAIN" in output or "no valid A records" in output:
            raise RuntimeError(
                f"证书申请失败：DNS 尚未解析到服务器 IP。"
                f"请确认 DNS 记录已生效后重试: publish cert renew {subdomain}"
            )
        raise RuntimeError(f"证书申请失败:\n{output}")

    return output


def get_cert_status(ssh: SshClient, subdomain: str) -> CertInfo:
    """Query certificate status on remote host."""
    exit_code, stdout, stderr = ssh.exec_command("certbot certificates 2>&1")
    output = stdout + stderr
    if exit_code != 0:
        return CertInfo(status="absent", issuer="", not_before="", not_after="", days_remaining=0)

    # Parse certbot output
    lines = output.split("\n")
    in_cert = False
    cert_data = {}

    for line in lines:
        if subdomain in line:
            in_cert = True
        elif in_cert and line.startswith("  Certificate Name:"):
            break
        elif in_cert:
            if "Domains:" in line:
                cert_data["domains"] = line.split(":", 1)[1].strip()
            elif "Expiry Date:" in line:
                date_str = line.split(":", 1)[1].strip().split(" ")[0]  # 2026-09-27
                cert_data["expiry"] = date_str
            elif "VALID:" in line:
                cert_data["status"] = "valid"

    if "expiry" not in cert_data:
        return CertInfo(status="absent", issuer="", not_before="", not_after="", days_remaining=0)

    try:
        expiry = datetime.strptime(cert_data["expiry"], "%Y-%m-%d")
        days_left = (expiry - datetime.now()).days
    except ValueError:
        days_left = 0

    status = "valid"
    if days_left <= 0:
        status = "expired"
    elif days_left <= 30:
        status = "expiring"

    return CertInfo(
        status=status,
        issuer="Let's Encrypt",
        not_before="",
        not_after=cert_data.get("expiry", ""),
        days_remaining=days_left,
    )


def renew_cert(ssh: SshClient, subdomain: str) -> str:
    """Force renew certificate for subdomain."""
    exit_code, stdout, stderr = ssh.exec_command(
        f"certbot renew --cert-name {subdomain} --force-renewal 2>&1"
    )
    output = stdout + stderr
    if exit_code != 0:
        raise RuntimeError(f"证书续期失败:\n{output}")
    return output
