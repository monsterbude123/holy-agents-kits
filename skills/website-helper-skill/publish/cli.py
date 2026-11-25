"""CLI entry point — publish command."""

import sys
from pathlib import Path
from typing import Optional

import typer

# Force UTF-8 stdout/stderr on Windows so emojis in typer.echo() don't crash
# with UnicodeEncodeError against the default cp1252 console encoding.
# Only patch when stdout is a real console (skip pytest-captured streams).
if sys.platform == "win32":
    for _sn in ("stdout", "stderr"):
        _s = getattr(sys, _sn, None)
        if _s is None:
            continue
        try:
            # Only wrap real console streams, not test captures
            if not hasattr(_s, "buffer") or _s.buffer.closed:
                continue
            _s.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, Exception):
            pass

from publish.config.store import (
    ENV_FILE,
    _get_env_value,
    load_dns_config,
    load_ssh_config,
    save_dns_config,
    save_ssh_config,
)
from publish.cli_helpers import get_dns_provider
from publish.models import (
    DnsConfig,
    DnsProvider,
    PublishOperation,
    PublishStatus,
    SshConfig,
)
from publish.nginx.deploy import (
    deploy_proxy,
    deploy_webroot,
    rollback as nginx_rollback,
)
from publish.certs.cert_manager import request_cert, get_cert_status, renew_cert
from publish.cockpit.logger import log_publish, list_published
from publish.ssh.client import SshClient, SshConnectionError
from publish.utils.validators import (
    validate_subdomain,
    validate_ipv4,
    validate_upstream,
    validate_webroot,
    validate_publish_name,
    validate_dns_provider,
)

app = typer.Typer(
    name="publish",
    help="自动网页发布平台 — 一键部署子域名到 Nginx + SSL",
    no_args_is_help=True,
)

# ── config ──────────────────────────────────────
config_app = typer.Typer(help="配置管理")
app.add_typer(config_app, name="config")


@config_app.command("init")
def config_init():
    """从仓库根 .agents/.env 文件自动生成 DNS + SSH 配置（无需交互）."""
    if not ENV_FILE.exists():
        typer.echo(f"❌ 未找到 {ENV_FILE}，请先复制 references/.env.example 为 .agents/.env 并填值", err=True)
        raise typer.Exit(code=1)

    typer.echo(f"📄 读取 {ENV_FILE} ...")

    # DNS
    provider = _get_env_value("DNS_PROVIDER")
    if not provider:
        typer.echo("❌ .env 缺少 DNS_PROVIDER", err=True)
        raise typer.Exit(code=1)

    try:
        provider_enum = validate_dns_provider(provider)
    except ValueError as e:
        typer.echo(f"❌ {e}", err=True)
        raise typer.Exit(code=1)

    if provider_enum == DnsProvider.ALIYUN:
        dns_cfg = DnsConfig(
            provider=provider_enum,
            api_token="",
            domain=_get_env_value("ALIYUN_DOMAIN") or "",
            access_key_id=_get_env_value("ALIYUN_ACCESS_KEY_ID") or "",
            access_key_secret=_get_env_value("ALIYUN_ACCESS_KEY_SECRET") or "",
        )
        if not dns_cfg.domain or not dns_cfg.access_key_id or not dns_cfg.access_key_secret:
            typer.echo("❌ 阿里云需要 ALIYUN_DOMAIN / ALIYUN_ACCESS_KEY_ID / ALIYUN_ACCESS_KEY_SECRET", err=True)
            raise typer.Exit(code=1)
        save_dns_config(dns_cfg)
    elif provider_enum == DnsProvider.CLOUDFLARE:
        dns_cfg = DnsConfig(
            provider=provider_enum,
            api_token=_get_env_value("CLOUDFLARE_API_TOKEN") or "",
            zone_id=_get_env_value("CLOUDFLARE_ZONE_ID") or "",
        )
        if not dns_cfg.api_token or not dns_cfg.zone_id:
            typer.echo("❌ Cloudflare 需要 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID", err=True)
            raise typer.Exit(code=1)
        save_dns_config(dns_cfg)
    elif provider_enum == DnsProvider.DNSPOD:
        dns_cfg = DnsConfig(
            provider=provider_enum,
            api_token="",
            domain=_get_env_value("DNSPOD_DOMAIN") or "",
            secret_id=_get_env_value("DNSPOD_SECRET_ID") or "",
            secret_key=_get_env_value("DNSPOD_SECRET_KEY") or "",
        )
        if not dns_cfg.domain or not dns_cfg.secret_id or not dns_cfg.secret_key:
            typer.echo("❌ DNSPod 需要 DNSPOD_DOMAIN / DNSPOD_SECRET_ID / DNSPOD_SECRET_KEY", err=True)
            raise typer.Exit(code=1)
        save_dns_config(dns_cfg)

    typer.echo(f"✅ DNS: {provider} 已配置")

    # SSH
    host = _get_env_value("SSH_HOST")
    user = _get_env_value("SSH_USER")
    if host and user:
        key_path = _get_env_value("SSH_KEY_PATH")
        ssh_cfg = SshConfig(
            host=host,
            user=user,
            port=int(_get_env_value("SSH_PORT") or "22"),
            key_path=Path(key_path) if key_path else None,
            password=_get_env_value("SSH_PASSWORD"),
        )
        save_ssh_config(ssh_cfg)
        typer.echo(f"✅ SSH: {user}@{host}")
    else:
        typer.echo("ℹ️  .env 未配置 SSH_HOST/SSH_USER，跳过 SSH 配置")

    typer.echo("\n🎉 初始化完成！可以运行:")
    typer.echo("  publish deploy app -d app.yourdomain.com -w ./dist")


@config_app.command("dns")
def config_dns(
    provider: str = typer.Option(
        ..., "--provider", "-p", help="DNS 提供商: cloudflare, aliyun, dnspod"
    ),
):
    """配置 DNS 提供商凭据."""
    provider_enum = validate_dns_provider(provider)

    print(f"\n🔧 配置 {provider_enum.value} DNS\n")

    if provider_enum == DnsProvider.CLOUDFLARE:
        print("获取 Cloudflare API Token:")
        print("  1. 登录 https://dash.cloudflare.com")
        print("  2. 右上角头像 → My Profile → API Tokens")
        print('  3. Create Token → "Edit zone DNS" 模板')
        print("  4. Zone Resources 选择你的域名")
        print("  5. 复制生成的 Token\n")
        print("获取 Zone ID:")
        print("  1. 进入域名 Overview 页面")
        print("  2. 右侧 API 段复制 Zone ID\n")

        api_token = typer.prompt("API Token", hide_input=True)
        zone_id = typer.prompt("Zone ID")
        config = DnsConfig(provider=provider_enum, api_token=api_token, zone_id=zone_id)

    elif provider_enum == DnsProvider.ALIYUN:
        print("获取阿里云 AccessKey:")
        print("  1. 登录 https://ram.console.aliyun.com")
        print("  2. 用户 → 创建用户 → 编程访问")
        print("  3. 添加 AliyunDNSFullAccess 权限")
        print("  4. 复制 AccessKey ID 和 Secret\n")

        access_key_id = typer.prompt("AccessKey ID", hide_input=True)
        access_key_secret = typer.prompt("AccessKey Secret", hide_input=True)
        domain = typer.prompt("域名（如 example.com）")
        config = DnsConfig(
            provider=provider_enum,
            api_token="",
            domain=domain,
            access_key_id=access_key_id,
            access_key_secret=access_key_secret,
        )

    elif provider_enum == DnsProvider.DNSPOD:
        print("获取 DNSPod SecretId/SecretKey:")
        print("  1. 登录 https://console.dnspod.cn")
        print("  2. 账号中心 → API 密钥管理")
        print("  3. 创建密钥 → 复制 SecretId 和 SecretKey\n")

        secret_id = typer.prompt("SecretId", hide_input=True)
        secret_key = typer.prompt("SecretKey", hide_input=True)
        domain = typer.prompt("域名（如 example.com）")
        config = DnsConfig(
            provider=provider_enum,
            api_token="",
            domain=domain,
            secret_id=secret_id,
            secret_key=secret_key,
        )

    save_dns_config(config)
    print(f"✅ DNS 配置已保存 ({provider_enum.value})")


@config_app.command("ssh")
def config_ssh(
    host: str = typer.Option(..., "--host", help="云机器 IP 或域名"),
    user: str = typer.Option(..., "--user", help="SSH 用户名"),
    key: Optional[Path] = typer.Option(None, "--key", "-k", help="SSH 私钥路径"),
    port: int = typer.Option(22, "--port", help="SSH 端口"),
):
    """配置 SSH 连接信息."""
    config = SshConfig(host=host, user=user, port=port, key_path=key)
    if not key:
        password = typer.prompt("SSH 密码（留空使用密钥）", default="", hide_input=True, show_default=False)
        if password:
            config.password = password
    save_ssh_config(config)
    print("\n✅ SSH 配置已保存")
    print(f"  主机: {host}")
    print(f"  用户: {user}")
    auth_method = "密钥" if key else "密码"
    print(f"  认证: {auth_method}")


@config_app.command("show")
def config_show():
    """显示当前配置（密钥字段掩码，永不打印明文）."""
    dns_config = load_dns_config()
    if dns_config:
        typer.echo(f"DNS: {dns_config.provider.value}  domain={dns_config.domain or '-'}")
        typer.echo(f"  access_key_id={_mask(dns_config.access_key_id)}")
        typer.echo(f"  access_key_secret={_mask(dns_config.access_key_secret)}")
        typer.echo(f"  api_token={_mask(dns_config.api_token)}")
        typer.echo(f"  secret_id={_mask(dns_config.secret_id)}")
        typer.echo(f"  secret_key={_mask(dns_config.secret_key)}")
    else:
        typer.echo("DNS: 未配置")
    ssh_config = load_ssh_config()
    if ssh_config:
        typer.echo(f"SSH: {ssh_config.user}@{ssh_config.host}:{ssh_config.port}")
        typer.echo(f"  password={_mask(ssh_config.password)}")
        typer.echo(f"  key_path={ssh_config.key_path or '-'}")
    else:
        typer.echo("SSH: 未配置")


def _mask(value: Optional[str]) -> str:
    """Show presence, never the value."""
    if not value:
        return "-"
    return f"***(已设置, {len(value)} 字符)"


# ── deploy ──────────────────────────────────────

@app.command("deploy")
def deploy(
    name: str = typer.Argument(..., help="发布名称（如 app、blog）"),
    domain: str = typer.Option(..., "--domain", "-d", help="完整子域名"),
    webroot: Optional[Path] = typer.Option(
        None, "--webroot", "-w", help="本地网页文件目录（静态模式，与 --upstream 互斥）"
    ),
    upstream: Optional[str] = typer.Option(
        None, "--upstream", help="后端地址（反代模式，如 http://127.0.0.1:8088）"
    ),
    ip: Optional[str] = typer.Option(None, "--ip", help="云机器 IP（DNS A 记录指向）"),
    ssl: bool = typer.Option(True, "--ssl/--no-ssl", help="是否申请 SSL 证书"),
    force: bool = typer.Option(False, "--force", "-f", help="覆盖已有 DNS 记录"),
):
    """完整发布网页到子域名（DNS + Nginx + SSL）；--webroot 静态 / --upstream 反代。"""
    # Validate
    name = validate_publish_name(name)
    domain = validate_subdomain(domain)
    if (webroot is None) == (upstream is None):
        typer.echo("❌ 必须且只能给一个：--webroot（静态）或 --upstream（反代）", err=True)
        raise typer.Exit(code=1)
    if webroot is not None:
        webroot = validate_webroot(str(webroot))
    else:
        upstream = validate_upstream(upstream or "")
    if ip:
        ip = validate_ipv4(ip)

    # Load configs
    dns_config = load_dns_config()
    if not dns_config:
        typer.echo("❌ 缺少 DNS 配置，请先执行: publish config dns", err=True)
        raise typer.Exit(code=1)

    ssh_config = load_ssh_config()
    if not ssh_config:
        typer.echo("❌ 缺少 SSH 配置，请先执行: publish config ssh", err=True)
        raise typer.Exit(code=1)

    results = []
    all_ok = True
    partial = False

    # Step 1: DNS
    try:
        dns = get_dns_provider(dns_config)
        server_ip = ip or ssh_config.host
        try:
            dns.create_record(domain, server_ip)
            typer.echo(f"✅ DNS: A 记录 {domain} → {server_ip}")
            results.append(("DNS", "ok"))
        except ValueError as e:
            if "已存在" in str(e) and not force:
                typer.echo(f"ℹ️  {e}")
                results.append(("DNS", "skipped"))
            else:
                raise
    except Exception as e:
        typer.echo(f"❌ DNS 注册失败: {e}", err=True)
        results.append(("DNS", "failed"))
        all_ok = False

    if not all_ok:
        log_publish(domain, PublishOperation.DEPLOY, PublishStatus.FAILED)
        raise typer.Exit(code=1)

    # Step 2: Nginx
    try:
        with SshClient(ssh_config) as ssh:
            if upstream is not None:
                deploy_proxy(ssh, domain, upstream, with_ssl=ssl)
            else:
                deploy_webroot(ssh, domain, webroot, with_ssl=ssl)
        target = f"反代 → {upstream}" if upstream else f"文件上传到 /var/www/{domain}/"
        typer.echo(f"✅ Nginx: 配置已部署，{target}")
        results.append(("Nginx", "ok"))
    except SshConnectionError as e:
        typer.echo(f"❌ SSH 连接失败: {e}", err=True)
        results.append(("Nginx", "failed"))
        log_publish(domain, PublishOperation.DEPLOY, PublishStatus.FAILED)
        raise typer.Exit(code=1)
    except Exception as e:
        typer.echo(f"❌ Nginx 部署失败: {e}", err=True)
        results.append(("Nginx", "failed"))
        partial = True

    # Step 3: SSL
    if ssl and not partial:
        try:
            with SshClient(ssh_config) as ssh:
                request_cert(ssh, domain)
                cert_info = get_cert_status(ssh, domain)
            typer.echo(f"✅ SSL: Let's Encrypt 证书已申请 (有效期至 {cert_info.not_after})")
            results.append(("SSL", "ok"))
        except RuntimeError as e:
            if "DNS 尚未解析" in str(e):
                typer.echo(f"⚠️  SSL: {e}")
                results.append(("SSL", "skipped (DNS 未解析)"))
            else:
                typer.echo(f"❌ SSL 失败: {e}", err=True)
                results.append(("SSL", "failed"))
                partial = True
        except Exception as e:
            typer.echo(f"❌ SSL 失败: {e}", err=True)
            results.append(("SSL", "failed"))
            partial = True

    # Step 4: Cockpit
    status = PublishStatus.PARTIAL if partial else PublishStatus.SUCCESS
    log_publish(domain, PublishOperation.DEPLOY, status)
    typer.echo("📝 驾驶舱已更新")

    # Summary
    status_icon = "🚀" if not partial else "⚠️"
    typer.echo(f"\n{status_icon} 发布{'完成' if not partial else '（部分成功）'}: {domain}")
    typer.echo(f"  🌐 访问: {'https://' if ssl and not partial else 'http://'}{domain}")


# ── rollback ────────────────────────────────────

@app.command("rollback")
def rollback_cmd(
    subdomain: str = typer.Argument(..., help="目标子域名"),
):
    """回滚到上一版本."""
    subdomain = validate_subdomain(subdomain)

    ssh_config = load_ssh_config()
    if not ssh_config:
        typer.echo("❌ 缺少 SSH 配置", err=True)
        raise typer.Exit(code=1)

    try:
        with SshClient(ssh_config) as ssh:
            timestamp = nginx_rollback(ssh, subdomain)
        typer.echo(f"↩️  已回滚: {subdomain} → {timestamp} 版本")
        log_publish(subdomain, PublishOperation.ROLLBACK, PublishStatus.SUCCESS, f"回滚到 {timestamp}")
    except SshConnectionError as e:
        typer.echo(f"❌ SSH 连接失败: {e}", err=True)
        raise typer.Exit(code=1)
    except RuntimeError as e:
        typer.echo(f"❌ 回滚失败: {e}", err=True)
        log_publish(subdomain, PublishOperation.ROLLBACK, PublishStatus.FAILED, str(e))
        raise typer.Exit(code=1)


# ── cert ────────────────────────────────────────

cert_app = typer.Typer(help="SSL 证书管理")
app.add_typer(cert_app, name="cert")


@cert_app.command("status")
def cert_status(
    subdomain: str = typer.Argument(..., help="子域名"),
):
    """查看子域名 SSL 证书状态."""
    subdomain = validate_subdomain(subdomain)
    ssh_config = load_ssh_config()
    if not ssh_config:
        typer.echo("❌ 缺少 SSH 配置", err=True)
        raise typer.Exit(code=1)

    try:
        with SshClient(ssh_config) as ssh:
            info = get_cert_status(ssh, subdomain)
    except SshConnectionError as e:
        typer.echo(f"❌ SSH 连接失败: {e}", err=True)
        raise typer.Exit(code=1)

    if info.status == "absent":
        typer.echo(f"🔒 {subdomain}\n  状态: 无证书")
    else:
        status_label = {"valid": "✅ 有效", "expiring": "⚠️ 即将过期", "expired": "❌ 已过期"}
        typer.echo(f"🔒 {subdomain}")
        typer.echo(f"  状态: {status_label.get(info.status, info.status)}")
        typer.echo(f"  颁发者: {info.issuer}")
        typer.echo(f"  有效期至: {info.not_after}")
        typer.echo(f"  剩余: {info.days_remaining} 天")
        typer.echo("  自动续期: ✅ 已启用")


@cert_app.command("renew")
def cert_renew(
    subdomain: str = typer.Argument(..., help="子域名"),
):
    """手动强制续期证书."""
    subdomain = validate_subdomain(subdomain)
    ssh_config = load_ssh_config()
    if not ssh_config:
        typer.echo("❌ 缺少 SSH 配置", err=True)
        raise typer.Exit(code=1)

    try:
        with SshClient(ssh_config) as ssh:
            renew_cert(ssh, subdomain)
            info = get_cert_status(ssh, subdomain)
        typer.echo(f"♻️  证书已续期: {subdomain}")
        typer.echo(f"  新有效期至: {info.not_after}")
        log_publish(subdomain, PublishOperation.RENEW, PublishStatus.SUCCESS)
    except SshConnectionError as e:
        typer.echo(f"❌ SSH 连接失败: {e}", err=True)
        raise typer.Exit(code=1)
    except RuntimeError as e:
        typer.echo(f"❌ 续期失败: {e}", err=True)
        raise typer.Exit(code=1)


# ── list ────────────────────────────────────────

@app.command("list")
def list_cmd():
    """查看所有已发布子域名."""
    records = list_published()
    if not records:
        typer.echo("暂无发布记录")
        return

    typer.echo("\n📋 已发布子域名:")
    typer.echo("| 子域名 | 最后部署时间 | 操作 | 状态 |")
    typer.echo("|--------|-------------|------|------|")
    seen = set()
    for r in records:
        if r.subdomain not in seen:
            seen.add(r.subdomain)
            status_icon = {"success": "✅", "partial": "⚠️", "failed": "❌"}
            icon = status_icon.get(r.status.value, "?")
            typer.echo(f"| {r.subdomain} | {r.timestamp} | {r.operation.value} | {icon} {r.status.value} |")
    typer.echo("")


# ── helpers ─────────────────────────────────────

if __name__ == "__main__":
    app()
