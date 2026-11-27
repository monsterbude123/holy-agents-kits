#!/usr/bin/env bash
# =============================================================================
# deploy.sh —— 构建镜像、启动 compose、等待健康、校验加固效果
#
#   流程:
#     1) docker build -t jenkins-190:2.568.2 .
#     2) 把 init.groovy.d/ 同步进命名卷（官方镜像只在卷内没有该目录时才从
#        ref 拷贝；迁移过来的卷里已经存在，不同步则安全脚本永远不执行）
#     3) docker compose up -d
#     4) 等待 healthcheck 变为 healthy
#     5) 校验：匿名访问 / 与 /api/json 必须不是 200；/login 必须 200
#     6) 打印人工验证命令
#
#   用法（在包根目录执行）:
#     bash scripts/deploy.sh                 # 完整部署
#     bash scripts/deploy.sh --dry-run       # 只打印计划，不执行
#     bash scripts/deploy.sh --verify-only   # 跳过构建与启动，只做校验
#     bash scripts/deploy.sh --auth-check    # 额外做一次带认证的校验#
#   本脚本不会打印密码：带认证的校验用 --auth-check 触发，
#   密码从 .env 读出后经 stdin 交给 curl，不会出现在命令行参数里。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/pkg.sh
. "$SCRIPT_DIR/lib/pkg.sh"

IMAGE="${IMAGE:-jenkins-190:2.568.2}"
CONTAINER_NAME="${CONTAINER_NAME:-jenkins-190}"
VOLUME="${JENKINS_VOLUME:-jenkins-190_jenkins_home}"
WEB_URL="${WEB_URL:-http://127.0.0.1:28080}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-600}"
HELPER_IMAGE="${HELPER_IMAGE:-alpine:latest}"
SERVICE_NAME="${SERVICE_NAME:-jenkins}"

VERIFY_ONLY=0
AUTH_CHECK=0
DRY_RUN=0
FAILED=0

usage() {
    sed -n '2,22p' "$0"
}

for arg in "$@"; do
    case "$arg" in
        --verify-only) VERIFY_ONLY=1 ;;
        --auth-check)  AUTH_CHECK=1 ;;
        --dry-run)     DRY_RUN=1 ;;
        -h|--help)     usage; exit 0 ;;
        *) echo "未知参数: $arg" >&2; usage >&2; exit 2 ;;
    esac
done

# --help 在此之前已退出，所以包目录解析放在参数解析之后
PKG_DIR="$(require_pkg_dir)" || exit 2
cd "$PKG_DIR"

run() {
    if [ "$DRY_RUN" -eq 1 ]; then
        echo "DRY-RUN: $*"
    else
        "$@"
    fi
}

fail() {
    echo "FAIL: $*" >&2
    FAILED=1
}

# --- 前置检查 ----------------------------------------------------------------
command -v docker >/dev/null 2>&1 || { echo "ERROR: 找不到 docker 命令" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: 无法连接 docker daemon" >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: 缺少 docker compose 插件" >&2; exit 1; }

compose() {
    docker compose -f "$PKG_DIR/docker-compose.yml" "$@"
}

# 读取 .env 里的某个键（值只进变量，不回显）
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

http_code() {
    local out
    out="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$1" 2>/dev/null)" || out="000"
    printf '%s' "${out:-000}"
}

# --- 1) 构建 -----------------------------------------------------------------
if [ "$VERIFY_ONLY" -eq 0 ]; then
    if [ ! -f "$PKG_DIR/.env" ]; then
        echo "ERROR: 缺少 $PKG_DIR/.env" >&2
        echo "       执行: cp .env.example .env && bash $SCRIPT_DIR/gen-admin-secret.sh" >&2
        exit 1
    fi

    echo "INFO: 构建镜像 $IMAGE"
    run docker build -t "$IMAGE" "$PKG_DIR"

    # 同步 init.groovy.d 到卷内
    if [ -d "$PKG_DIR/init.groovy.d" ]; then
        if docker volume inspect "$VOLUME" >/dev/null 2>&1 && docker image inspect "$HELPER_IMAGE" >/dev/null 2>&1; then
            echo "INFO: 同步 init.groovy.d 到卷 $VOLUME"
            run docker run --rm \
                -v "$VOLUME":/dst \
                -v "$PKG_DIR/init.groovy.d":/init:ro \
                "$HELPER_IMAGE" \
                sh -c 'set -e; mkdir -p /dst/init.groovy.d; for f in /init/*.groovy; do [ -f "$f" ] || continue; cp -f "$f" /dst/init.groovy.d/; done; chown -R 110:114 /dst/init.groovy.d'
        else
            echo "WARN: 卷 $VOLUME 或辅助镜像 $HELPER_IMAGE 不存在，跳过 init.groovy.d 同步"
        fi
    fi

    echo "INFO: 启动 compose"
    run compose up -d
    echo "INFO: compose up 完成"
else
    echo "INFO: --verify-only，跳过构建与启动"
fi

# --- 2) 等待健康 -------------------------------------------------------------
echo "INFO: 等待 $CONTAINER_NAME 健康（超时 ${HEALTH_TIMEOUT}s）"
if [ "$DRY_RUN" -eq 1 ]; then
    echo "DRY-RUN: 轮询 docker inspect 健康状态与 ${WEB_URL}/login"
else
    deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
    healthy=0
    while [ "$(date +%s)" -lt "$deadline" ]; do
        status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$CONTAINER_NAME" 2>/dev/null || echo missing)"
        case "$status" in
            healthy)
                healthy=1
                break
                ;;
            missing)
                fail "容器 $CONTAINER_NAME 不存在（是不是忘了 docker compose up -d？）"
                break
                ;;
            none)
                # 没有 healthcheck 定义时退化为直接探测 HTTP
                if [ "$(http_code "$WEB_URL/login")" = "200" ]; then
                    healthy=1
                    break
                fi
                ;;
            unhealthy)
                echo "INFO: 目前还不健康，继续等待 ..."
                ;;
        esac
        sleep 5
    done

    if [ "$healthy" -ne 1 ]; then
        fail "容器在 ${HEALTH_TIMEOUT}s 内没有变健康"
        docker logs --tail=50 "$CONTAINER_NAME" 2>&1 | sed 's/^/    /' || true
    else
        echo "OK: 容器 $CONTAINER_NAME 已健康"
    fi
fi

# --- 3) 校验加固效果 ---------------------------------------------------------
code_root="$(http_code "$WEB_URL/")"
code_api="$(http_code "$WEB_URL/api/json")"
code_login="$(http_code "$WEB_URL/login")"

echo "INFO: 匿名访问状态码 -> / = $code_root, /api/json = $code_api, /login = $code_login"

if [ "$code_api" = "200" ]; then
    fail "匿名 GET /api/json 返回 200 —— 匿名只读并没有被禁止"
else
    echo "OK: 匿名 GET /api/json 已被拒绝 ($code_api)"
fi

if [ "$code_root" = "200" ]; then
    fail "匿名 GET / 返回 200 —— 匿名只读并没有被禁止"
else
    echo "OK: 匿名 GET / 已被拒绝 ($code_root)"
fi

if [ "$code_login" = "200" ]; then
    echo "OK: 登录页可访问 (200)"
else
    fail "匿名 GET /login 返回 $code_login —— 登录页必须可访问，否则无法登录"
fi

if [ "$DRY_RUN" -ne 1 ]; then
    if docker logs "$CONTAINER_NAME" 2>&1 | grep -q 'jenkins-init'; then
        echo "OK: 初始化安全脚本已执行（有 jenkins-init 日志）"
    else
        echo "WARN: 没找到 'jenkins-init' 日志，请检查 docker logs $CONTAINER_NAME"
    fi
fi

# --- 4) 带认证的校验 ---------------------------------------------------------
if [ "$AUTH_CHECK" -eq 1 ]; then
    admin_user="$(read_env_value JENKINS_ADMIN_USER "$PKG_DIR/.env")"
    admin_pass="$(read_env_value JENKINS_ADMIN_PASSWORD "$PKG_DIR/.env")"
    if [ -z "$admin_user" ] || [ -z "$admin_pass" ]; then
        fail "无法执行带认证的校验：.env 里没有 JENKINS_ADMIN_USER / JENKINS_ADMIN_PASSWORD"
    else
        # 密码走 stdin（curl 的 -K 配置文件），不出现在进程参数里
        auth_code="$(printf 'user = "%s:%s"\n' "$admin_user" "$admin_pass" \
            | curl -sS -K - -o /dev/null -w '%{http_code}' --max-time 15 "$WEB_URL/api/json" 2>/dev/null || echo 000)"
        if [ "$auth_code" = "200" ]; then
            echo "OK: 带认证 GET /api/json 返回 200"
        else
            fail "带认证 GET /api/json 返回 $auth_code（期望 200）"
        fi
    fi
else
    echo "INFO: 带认证的校验留给运维人工执行（脚本不会打印密码）："
    echo "      cd $PKG_DIR && set -a && . ./.env && set +a && \\"
    echo "        printf 'user = \"%s:%s\"\\n' \"\$JENKINS_ADMIN_USER\" \"\$JENKINS_ADMIN_PASSWORD\" | \\"
    echo "        curl -sS -K - -o /dev/null -w '%{http_code}\\n' $WEB_URL/api/json"
    echo "      期望输出: 200"
    echo "      （也可以直接用本脚本的 --auth-check）"
fi

# --- 5) 结果 -----------------------------------------------------------------
echo
echo "人工验证命令:"
echo "  docker compose ps"
echo "  docker compose logs -f --tail=200 $SERVICE_NAME"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' $WEB_URL/            # 期望 403"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' $WEB_URL/api/json    # 期望 403"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' $WEB_URL/login       # 期望 200"
echo "  docker exec $CONTAINER_NAME id jenkins                        # 期望 uid=110 gid=114"
echo "  docker exec $CONTAINER_NAME node --version                    # 期望 v24.15.0"
echo "  docker exec $CONTAINER_NAME sudo -n -l                        # 期望能看到业务服务 sudoers 规则"

if [ "$FAILED" -ne 0 ]; then
    echo "RESULT: FAILED"
    exit 1
fi

echo "RESULT: OK"
