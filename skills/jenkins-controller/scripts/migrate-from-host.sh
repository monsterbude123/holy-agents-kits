#!/usr/bin/env bash
# =============================================================================
# migrate-from-host.sh —— 把宿主上旧 Jenkins 的 JENKINS_HOME 迁移进 Docker 命名卷
#
#   * 旧数据源: /var/lib/jenkins（宿主 jenkins.service 的 JENKINS_HOME）
#   * 目标    : 命名卷 jenkins-190_jenkins_home（容器内挂到 /var/jenkins_home）
#   * 拷贝方式: 用一次性 alpine 容器执行 `cp -a`（宿主上已装 alpine）
#   * 属主    : 迁移后 chown -R 110:114（容器内 jenkins 用户 = 110:114），
#               JENKINS_HOME 目录权限 700
#   * 源目录保持原样，便于回滚
#   * 幂等    : 卷里已经有 Jenkins home 时直接拒绝，除非 --force
#   * 本脚本不会停/启任何服务，请自行先停旧服务与旧容器
#
#   用法（在包根目录执行）：
#     sudo bash scripts/migrate-from-host.sh --dry-run   # 只看计划
#     sudo bash scripts/migrate-from-host.sh             # 真正迁移
#     sudo bash scripts/migrate-from-host.sh --force     # 卷里已有数据时覆盖
#
#   迁移前请自行停旧服务（脚本不代劳）：
#     sudo systemctl stop jenkins
#     docker compose down
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pkg.sh
. "$SCRIPT_DIR/lib/pkg.sh"

OLD_HOME="${OLD_JENKINS_HOME:-/var/lib/jenkins}"
VOLUME="${JENKINS_VOLUME:-jenkins-190_jenkins_home}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/jenkins-migration}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:latest}"
CONTAINER_NAME="${CONTAINER_NAME:-jenkins-190}"
TARGET_UID="${TARGET_UID:-110}"     # 容器内 jenkins 用户 uid
TARGET_GID="${TARGET_GID:-114}"     # 容器内 jenkins 组 gid
FORCE=0
DRY_RUN=0

usage() {
    sed -n '2,30p' "$0"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --force)   FORCE=1; shift ;;
        --dry-run) DRY_RUN=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "未知参数: $1" >&2; usage >&2; exit 2 ;;
    esac
done

# --help 在此之前已退出，所以包目录解析放在参数解析之后
PKG_DIR="$(require_pkg_dir)" || exit 2

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: $*"
    else
        "$@"
    fi
}

# --- 前置检查 ----------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "ERROR: 找不到 docker 命令" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: 无法连接 docker daemon" >&2; exit 1; }

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: 需要 root 权限读取 $OLD_HOME，请用 sudo bash $0" >&2
    exit 1
fi

[ -d "$OLD_HOME" ] || { echo "ERROR: 旧的 JENKINS_HOME 不存在: $OLD_HOME" >&2; exit 1; }

if ! docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1; then
    echo "ERROR: 宿主机上没有辅助镜像 $HELPER_IMAGE" >&2
    echo "       先执行: docker pull $HELPER_IMAGE" >&2
    exit 1
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null || echo false)" = "true" ]; then
    if [ "$FORCE" -ne 1 ]; then
        echo "ERROR: 容器 $CONTAINER_NAME 正在运行" >&2
        echo "       先停掉: docker compose down（然后重跑本脚本）" >&2
        exit 1
    fi
    echo "WARNING: 传了 --force，但容器 $CONTAINER_NAME 仍在运行"
fi

# --- 卷检查 ------------------------------------------------------------------
if ! docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    echo "INFO: 创建命名卷 $VOLUME"
    run docker volume create "$VOLUME"
else
    echo "INFO: 命名卷 $VOLUME 已存在"
fi

volume_has_home() {
    docker run --rm -v "$VOLUME":/jh "$HELPER_IMAGE" \
        sh -c 'test -e /jh/config.xml' >/dev/null 2>&1
}

if volume_has_home; then
    if [ "$FORCE" -ne 1 ]; then
        echo "ERROR: 卷 $VOLUME 里已经有 Jenkins home" >&2
        echo "       确认要覆盖请加 --force" >&2
        exit 1
    fi
    echo "WARNING: 传了 --force，卷 $VOLUME 里已有内容，将被覆盖"
fi

# --- 备份 --------------------------------------------------------------------
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/jenkins-home-${STAMP}.tar.gz"
echo "INFO: 备份 $OLD_HOME -> $BACKUP_FILE"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: tar -czf $BACKUP_FILE -C $OLD_HOME ."
else
    mkdir -p "$BACKUP_DIR"
    tar -czf "$BACKUP_FILE" -C "$OLD_HOME" .
    chmod 600 "$BACKUP_FILE"
    echo "INFO: 备份完成 ($(du -h "$BACKUP_FILE" | cut -f1))"
fi

# --- 拷贝进卷 ----------------------------------------------------------------
echo "INFO: 用 alpine 辅助容器把 $OLD_HOME 拷进卷 $VOLUME（cp -a 保留权限）"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: docker run --rm -v $VOLUME:/dst -v $OLD_HOME:/src:ro $HELPER_IMAGE sh -c 'cp -a /src/. /dst/; chown -R ${TARGET_UID}:${TARGET_GID} /dst; chmod 700 /dst'"
else
    docker run --rm \
        -v "$VOLUME":/dst \
        -v "$OLD_HOME":/src:ro \
        "$HELPER_IMAGE" \
        sh -c "set -e; cp -a /src/. /dst/; chown -R ${TARGET_UID}:${TARGET_GID} /dst; chmod 700 /dst"
    echo "INFO: 拷贝完成"
fi

# --- 同步 init.groovy.d ------------------------------------------------------
# 官方镜像只在 $JENKINS_HOME/init.groovy.d 不存在时才从 ref 拷贝，
# 迁移过来的卷里该目录已经存在，所以必须显式同步。
if [ -d "$PKG_DIR/init.groovy.d" ]; then
    echo "INFO: 同步 init.groovy.d 到卷内 $VOLUME"
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: docker run --rm -v $VOLUME:/dst -v $PKG_DIR/init.groovy.d:/init:ro $HELPER_IMAGE sh -c 'cp -f /init/*.groovy /dst/init.groovy.d/; chown -R ${TARGET_UID}:${TARGET_GID} /dst/init.groovy.d'"
    else
        docker run --rm \
            -v "$VOLUME":/dst \
            -v "$PKG_DIR/init.groovy.d":/init:ro \
            "$HELPER_IMAGE" \
            sh -c "set -e; mkdir -p /dst/init.groovy.d; for f in /init/*.groovy; do [ -f \"\$f\" ] || continue; cp -f \"\$f\" /dst/init.groovy.d/; done; chown -R ${TARGET_UID}:${TARGET_GID} /dst/init.groovy.d"
        echo "INFO: init 脚本已同步"
    fi
else
    echo "WARNING: 找不到 $PKG_DIR/init.groovy.d，跳过同步"
fi

# --- 校验 --------------------------------------------------------------------
echo "INFO: 校验卷内状态"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: stat 卷内 /dst 与 /dst/config.xml，确认属主为 ${TARGET_UID}:${TARGET_GID}"
else
    docker run --rm -v "$VOLUME":/dst "$HELPER_IMAGE" sh -c '
        set -e
        test -f /dst/config.xml
        stat -c "%u:%g %a %n" /dst
        stat -c "%u:%g %a %n" /dst/config.xml
    '
fi

echo "OK: 迁移流程完成（DRY_RUN=$DRY_RUN）"
echo "INFO: 源目录 $OLD_HOME 未做任何改动，回滚时可继续使用"
echo "INFO: 下一步: cd $PKG_DIR && bash $SCRIPT_DIR/deploy.sh"
echo "INFO: 备份文件: $BACKUP_FILE"
