#!/usr/bin/env bash
# =============================================================================
# cutover.sh —— 把宿主 systemd Jenkins 切成带账密的容器 Jenkins（分阶段）
#
#   阶段:
#     prepare   预检 + 生成 .env（管理员口令在服务器本地随机生成，不打印）
#     migrate   停旧服务 + 把旧 JENKINS_HOME 迁进命名卷（委派 migrate-from-host.sh）
#     deploy    构建镜像 + 起容器 + 等健康 + 校验（委派 deploy.sh）
#     switch    切 nginx upstream（委派 switch-nginx-upstream.sh）
#     finalize  停用旧 systemd 服务，保留数据以便回滚
#     all       按上面顺序全跑
#
#   用法（在技能 scripts 目录执行）:
#     sudo bash scripts/cutover.sh --dry-run           # 只看计划，不动任何东西
#     sudo bash scripts/cutover.sh prepare
#     sudo bash scripts/cutover.sh migrate
#     sudo bash scripts/cutover.sh deploy
#     sudo bash scripts/cutover.sh switch
#     sudo bash scripts/cutover.sh finalize
#     sudo bash scripts/cutover.sh all
#
#   退出码: 0 成功 / 1 某阶段失败 / 2 用法错
#
#   幂等：每个阶段可单独重复执行；--dry-run 只打印计划。
#   凭据：口令只写入包内 .env（600），本脚本任何输出都不含口令。
#   回滚：finalize 之后仍可 `switch-nginx-upstream.sh --rollback` +
#         `systemctl enable --now jenkins`，旧数据留在 /var/lib/jenkins。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pkg.sh
. "$SCRIPT_DIR/lib/pkg.sh"

PHASE="all"
DRY_RUN=0
FORCE=0

usage() { sed -n '2,28p' "$0"; }

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run) DRY_RUN=1; shift ;;
        --force)   FORCE=1; shift ;;
        -h|--help) usage; exit 0 ;;
        prepare|migrate|deploy|switch|finalize|all)
            PHASE="$1"; shift ;;
        *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

# --help 在此之前已退出，所以包目录解析放在参数解析之后
PKG_DIR="$(require_pkg_dir)" || exit 2
cd "$PKG_DIR"

OLD_SVC="${OLD_SVC:-jenkins.service}"
OLD_HOME="${OLD_HOME:-/var/lib/jenkins}"
WEB_PORT="${WEB_PORT:-28080}"
VOLUME="${VOLUME:-jenkins-190_jenkins_home}"

log()  { echo "[$(date +%H:%M:%S)] $*"; }
fail() { echo "[FAIL] $*" >&2; exit 1; }

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: $*"
    else
        "$@"
    fi
}

# --- prepare ----------------------------------------------------------------
phase_prepare() {
    log "=== prepare: 预检 ==="
    for f in docker-compose.yml Dockerfile init.groovy.d/01-security.groovy .env.example; do
        [ -f "$PKG_DIR/$f" ] || fail "缺少包文件: $PKG_DIR/$f"
    done
    for p in /var/run/docker.sock /run/systemd/private; do
        [ -e "$p" ] || fail "宿主路径不存在: $p"
    done
    log "预检通过"

    if [ "$DRY_RUN" -eq 1 ]; then
        if [ -f "$PKG_DIR/.env" ]; then
            echo "DRY-RUN: .env 已存在，保留原有口令"
        else
            echo "DRY-RUN: cp .env.example .env && bash $SCRIPT_DIR/gen-admin-secret.sh"
        fi
    elif [ ! -f "$PKG_DIR/.env" ]; then
        log "生成 .env（管理员口令在服务器本地生成，不回显）"
        cp "$PKG_DIR/.env.example" "$PKG_DIR/.env"
        chmod 600 "$PKG_DIR/.env"
        bash "$SCRIPT_DIR/gen-admin-secret.sh"
    else
        log ".env 已存在，保留原有口令"
    fi

    # 时区 / docker 组 gid 对齐宿主（只改非敏感字段）
    HOST_TZ="$(cat /etc/timezone 2>/dev/null || echo UTC)"
    SOCK_GID="$(stat -c '%g' /var/run/docker.sock)"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: 对齐宿主 TZ=${HOST_TZ} DOCKER_GID=${SOCK_GID}"
    else
        [ -f "$PKG_DIR/.env" ] || fail ".env 不存在"
        sed -i "s|^TZ=.*|TZ=${HOST_TZ}|" "$PKG_DIR/.env"
        sed -i "s|^DOCKER_GID=.*|DOCKER_GID=${SOCK_GID}|" "$PKG_DIR/.env"
        chmod 600 "$PKG_DIR/.env"
        log "对齐宿主: TZ=${HOST_TZ} DOCKER_GID=${SOCK_GID}"
    fi

    # 字段齐全性只查字段名，不打印值
    for k in JENKINS_ADMIN_USER JENKINS_ADMIN_PASSWORD DOCKER_GID TZ; do
        if [ -f "$PKG_DIR/.env" ]; then
            grep -q "^${k}=" "$PKG_DIR/.env" || fail ".env 缺少字段: $k"
        fi
    done
    log ".env 字段齐备"
}

# --- migrate ----------------------------------------------------------------
phase_migrate() {
    log "=== migrate: 停旧服务 + 迁移旧 JENKINS_HOME ==="
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: systemctl stop $OLD_SVC"
        echo "DRY-RUN: bash $SCRIPT_DIR/migrate-from-host.sh --dry-run"
        return 0
    fi
    systemctl stop "$OLD_SVC" || fail "停止 $OLD_SVC 失败"
    log "$OLD_SVC 已停止（数据保留在 $OLD_HOME，可回滚）"
    if [ "$FORCE" -eq 1 ]; then
        bash "$SCRIPT_DIR/migrate-from-host.sh" --force
    else
        bash "$SCRIPT_DIR/migrate-from-host.sh"
    fi
}

# --- deploy -----------------------------------------------------------------
phase_deploy() {
    log "=== deploy: 构建镜像 + 起容器 + 等健康 + 校验 ==="
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: bash $SCRIPT_DIR/deploy.sh --dry-run"
        return 0
    fi
    bash "$SCRIPT_DIR/deploy.sh"
}

# --- switch -----------------------------------------------------------------
phase_switch() {
    log "=== switch: 切 nginx upstream -> 127.0.0.1:${WEB_PORT} ==="
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: bash $SCRIPT_DIR/switch-nginx-upstream.sh --dry-run"
        return 0
    fi
    bash "$SCRIPT_DIR/switch-nginx-upstream.sh"
}

# --- finalize ---------------------------------------------------------------
phase_finalize() {
    log "=== finalize: 停用旧 systemd 服务（数据保留以便回滚） ==="
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: systemctl stop $OLD_SVC && systemctl disable $OLD_SVC"
        return 0
    fi
    systemctl stop "$OLD_SVC" || true
    systemctl disable "$OLD_SVC" || true
    log "旧服务 is-active=$(systemctl is-active "$OLD_SVC" 2>&1 || true) is-enabled=$(systemctl is-enabled "$OLD_SVC" 2>&1 || true)"
    log "旧数据保留: $OLD_HOME"
    log "回滚: bash $SCRIPT_DIR/switch-nginx-upstream.sh --rollback && systemctl enable --now $OLD_SVC"
}

case "$PHASE" in
    prepare)  phase_prepare ;;
    migrate)  phase_migrate ;;
    deploy)   phase_deploy ;;
    switch)   phase_switch ;;
    finalize) phase_finalize ;;
    all)
        phase_prepare
        phase_migrate
        phase_deploy
        phase_switch
        phase_finalize
        ;;
esac
log "阶段 [$PHASE] 完成（DRY_RUN=$DRY_RUN）"
