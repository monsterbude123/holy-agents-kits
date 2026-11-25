"""Configuration store — read/write ~/.publish/config.yaml + .env fallback."""

import os
from pathlib import Path
from typing import Optional

import yaml

from publish.models import SshConfig, DnsConfig, DnsProvider

DEFAULT_CONFIG_DIR = Path.home() / ".publish"
DEFAULT_CONFIG_PATH = DEFAULT_CONFIG_DIR / "config.yaml"

# 环境变量文件统一指向仓库根的 .agents/.env（SSH / DNS 凭据 SSOT），
# 不再用 cwd 下的 .env。若需要指向别处，可用 PUBLISH_ENV_FILE 环境变量覆盖。
_ENV_FILE_OVERRIDE = os.environ.get("PUBLISH_ENV_FILE")
if _ENV_FILE_OVERRIDE:
    ENV_FILE = Path(_ENV_FILE_OVERRIDE)
else:
    # 本文件位于 <repo>/.agents/skills/website-helper-skill/publish/config/store.py
    _SKILL_ROOT = Path(__file__).resolve().parents[2]  # .../skills/website-helper-skill/
    _PROJECT_ROOT = _SKILL_ROOT.parents[2]             # .../.agents/ 再上一级 = 仓库根
    ENV_FILE = _PROJECT_ROOT / ".agents" / ".env"


def _parse_env_file(path: Path) -> dict:
    """Minimal .env parser: KEY=VALUE, ignore comments and blank lines.

    VR-008: PowerShell 的 Out-File 会给值加引号；只剥「成对包裹」的外层引号，
    不匹配的引号原样保留（Windows 路径里的合法单引号不能被吃掉）。
    """
    env = {}
    if not path.exists():
        return env
    with open(path, "r", encoding="utf-8-sig") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            env[key.strip()] = value
    return env


def _get_env_value(key: str) -> Optional[str]:
    """Get value from .env file in current dir, fallback to os.environ."""
    env = _parse_env_file(ENV_FILE)
    if key in env and env[key]:
        return env[key]
    return os.environ.get(key)


def _ensure_dir() -> None:
    DEFAULT_CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    """Load config from ~/.publish/config.yaml. Returns empty dict if not exists.

    Note: .env is NOT auto-loaded into YAML config — it only fills missing values
    when loading SshConfig/DnsConfig via dedicated helpers.
    """
    if not DEFAULT_CONFIG_PATH.exists():
        return {}
    with open(DEFAULT_CONFIG_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return data


def save_config(data: dict) -> None:
    """Save config to ~/.publish/config.yaml."""
    _ensure_dir()
    with open(DEFAULT_CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, allow_unicode=True, default_flow_style=False)
    # Set secure permissions (Unix only)
    if os.name != "nt":
        os.chmod(DEFAULT_CONFIG_PATH, 0o600)


def load_ssh_config() -> Optional[SshConfig]:
    """Load SSH config from .env (.agents/.env), fallback to YAML.

    Priority: .env (ENV_FILE) > ~/.publish/config.yaml > os.environ.
    .env 是 SSOT，把 SSH_HOST/SSH_USER/SSH_PASSWORD 放在 .agents/.env 即可直接生效。
    """
    data = load_config().get("ssh") or {}
    host = _get_env_value("SSH_HOST") or (data or {}).get("host")
    user = _get_env_value("SSH_USER") or (data or {}).get("user")
    if not host or not user:
        return None
    port_str = _get_env_value("SSH_PORT") or (data or {}).get("port")
    key_path = _get_env_value("SSH_KEY_PATH") or (data or {}).get("key_path")
    password = _get_env_value("SSH_PASSWORD") or (data or {}).get("password")
    return SshConfig(
        host=host,
        user=user,
        port=int(port_str) if port_str else 22,
        key_path=Path(key_path) if key_path else None,
        password=password if password else None,
    )


def save_ssh_config(config: SshConfig) -> None:
    """Save SSH config to file."""
    data = load_config()
    data["ssh"] = {
        "host": config.host,
        "user": config.user,
        "port": config.port,
    }
    if config.key_path:
        data["ssh"]["key_path"] = str(config.key_path)
    if config.password:
        data["ssh"]["password"] = config.password
    save_config(data)


def load_dns_config() -> Optional[DnsConfig]:
    """Load DNS config from YAML, fallback to .env (only for aliyun fields).

    Priority: ~/.publish/config.yaml > .env (project root) > os.environ
    """
    data = load_config().get("dns")
    if not data:
        return None
    provider = DnsProvider(data["provider"])

    # Fallback fields from .env (only for aliyun currently; cloudflare/dnspod need interactive)
    api_token = data.get("api_token") or _get_env_value("CLOUDFLARE_API_TOKEN")
    zone_id = data.get("zone_id") or _get_env_value("CLOUDFLARE_ZONE_ID")
    domain = data.get("domain") or _get_env_value("ALIYUN_DOMAIN") or _get_env_value("DNSPOD_DOMAIN")
    access_key_id = data.get("access_key_id") or _get_env_value("ALIYUN_ACCESS_KEY_ID")
    access_key_secret = data.get("access_key_secret") or _get_env_value("ALIYUN_ACCESS_KEY_SECRET")
    secret_id = data.get("secret_id") or _get_env_value("DNSPOD_SECRET_ID")
    secret_key = data.get("secret_key") or _get_env_value("DNSPOD_SECRET_KEY")

    return DnsConfig(
        provider=provider,
        api_token=api_token or "",
        zone_id=zone_id,
        domain=domain,
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        secret_id=secret_id,
        secret_key=secret_key,
    )


def save_dns_config(config: DnsConfig) -> None:
    """Save DNS config to file."""
    data = load_config()
    dns_data = {"provider": config.provider.value}
    if config.api_token:
        dns_data["api_token"] = config.api_token
    if config.zone_id:
        dns_data["zone_id"] = config.zone_id
    if config.domain:
        dns_data["domain"] = config.domain
    if config.access_key_id:
        dns_data["access_key_id"] = config.access_key_id
    if config.access_key_secret:
        dns_data["access_key_secret"] = config.access_key_secret
    if config.secret_id:
        dns_data["secret_id"] = config.secret_id
    if config.secret_key:
        dns_data["secret_key"] = config.secret_key
    data["dns"] = dns_data
    save_config(data)
