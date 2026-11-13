#!/usr/bin/env bash
# =============================================================================
# gen-admin-secret.sh —— 在服务器本地生成 Jenkins 管理员密码并写入 .env
#
#   * 密码由 /dev/urandom 随机生成（32 位，字符集安全：大小写字母/数字/_/./-）
#   * 只写入 .env，权限 600；本脚本永远不打印密码本身
#   * 幂等：.env 里已有非空密码时不会覆盖（除非显式 --force）
#   * 不改动 .env 里其它已有的键
#
#   用法（在包根目录执行）：
#     bash scripts/gen-admin-secret.sh              # 生成或保留
#     bash scripts/gen-admin-secret.sh --force      # 强制重新生成
#     bash scripts/gen-admin-secret.sh --dry-run    # 只演示，不落盘
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pkg.sh
. "$SCRIPT_DIR/lib/pkg.sh"

PASSWORD_LENGTH=32
FORCE=0
DRY_RUN=0

usage() {
    sed -n '2,16p' "$0"
}

for arg in "$@"; do
    case "$arg" in
        --force)   FORCE=1 ;;
        --dry-run) DRY_RUN=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

# --help 在此之前已退出，所以包目录解析放在参数解析之后
PKG_DIR="$(require_pkg_dir)" || exit 2
ENV_FILE="$PKG_DIR/.env"
ENV_EXAMPLE="$PKG_DIR/.env.example"

[ -f "$ENV_EXAMPLE" ] || { echo "ERROR: 找不到模板: $ENV_EXAMPLE" >&2; exit 1; }

# --- 读取 env 文件里的某个键（值只进变量，不回显）----------------------------
read_env_value() {
    local key="$1" file="$2" line
    [ -f "$file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            "$key"=*)
                printf '%s' "${line#*=}"
                return 0
                ;;
        esac
    done < "$file"
    return 0
}

# --- 生成强密码 --------------------------------------------------------------
generate_password() {
    local pw="" chunk=""
    while [ "${#pw}" -lt "$PASSWORD_LENGTH" ]; do
        chunk="$(LC_ALL=C tr -dc 'A-Za-z0-9_.-' < /dev/urandom 2>/dev/null | dd bs=1 count=64 2>/dev/null || true)"
        pw="${pw}${chunk}"
    done
    printf '%s' "${pw:0:$PASSWORD_LENGTH}"
}

EXISTING_USER="$(read_env_value JENKINS_ADMIN_USER "$ENV_FILE")"
EXISTING_PASSWORD="$(read_env_value JENKINS_ADMIN_PASSWORD "$ENV_FILE")"

if [ -n "$EXISTING_PASSWORD" ] && [ "$FORCE" -ne 1 ]; then
    echo "INFO: .env 里已有密码，保持不变（幂等）；要重新生成请加 --force"
    NEW_PASSWORD="$EXISTING_PASSWORD"
    NEW_PASSWORD_IS_FRESH=0
else
    NEW_PASSWORD="$(generate_password)"
    NEW_PASSWORD_IS_FRESH=1
    echo "INFO: 已生成 ${PASSWORD_LENGTH} 位随机密码"
fi

FINAL_USER="${EXISTING_USER:-admin}"

if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: 不会写入任何文件"
    echo "DRY-RUN: 目标文件 = $ENV_FILE"
    echo "DRY-RUN: 管理员用户名 = $FINAL_USER"
    echo "DRY-RUN: 密码 = （已生成/保留，但本脚本不打印）"
    exit 0
fi

# --- 写 .env：模板为骨架 + 保留 .env 中模板没有的键 ---------------------------
TMP_FILE="$(mktemp "${TMPDIR:-/tmp}/jenkins-env.XXXXXX")"
chmod 600 "$TMP_FILE"
cleanup() { rm -f "$TMP_FILE"; }
trap cleanup EXIT

while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
        JENKINS_ADMIN_PASSWORD=*)
            printf 'JENKINS_ADMIN_PASSWORD=%s\n' "$NEW_PASSWORD" >> "$TMP_FILE"
            ;;
        JENKINS_ADMIN_USER=*)
            printf 'JENKINS_ADMIN_USER=%s\n' "$FINAL_USER" >> "$TMP_FILE"
            ;;
        *)
            printf '%s\n' "$line" >> "$TMP_FILE"
            ;;
    esac
done < "$ENV_EXAMPLE"

if [ -f "$ENV_FILE" ]; then
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            ''|'#'*) continue ;;
            *'=*') ;;
            *) continue ;;
        esac
        key="${line%%=*}"
        case "$key" in
            JENKINS_ADMIN_PASSWORD|JENKINS_ADMIN_USER) continue ;;
        esac
        if ! grep -q "^${key}=" "$ENV_EXAMPLE" 2>/dev/null; then
            printf '%s\n' "$line" >> "$TMP_FILE"
        fi
    done < "$ENV_FILE"
fi

mv -f "$TMP_FILE" "$ENV_FILE"
chmod 600 "$ENV_FILE"
trap - EXIT

echo "OK: 已写入 $ENV_FILE（权限 600）"
echo "OK: 管理员用户名 = $FINAL_USER"
if [ "$NEW_PASSWORD_IS_FRESH" -eq 1 ]; then
    echo "OK: 新密码已生成"
else
    echo "OK: 沿用原有密码，未改动"
fi
echo "INFO: 本脚本不会打印密码；需要时在服务器上自行查看："
echo "      grep '^JENKINS_ADMIN_PASSWORD=' $ENV_FILE"
echo "INFO: 改完密码后重建容器让初始化脚本生效："
echo "      docker compose up -d --force-recreate"
