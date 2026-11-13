#!/usr/bin/env bash
# =============================================================================
# lib/pkg.sh —— 技能脚本公用：定位「部署包」目录
#
# 归属：本文件属于 jenkins-controller 技能，被 scripts/ 下所有 shell 脚本 source。
# 布局：脚本住在 <repo>/.agents/skills/jenkins-controller/scripts/，
#       部署包住在 <repo>/test-190/jenkins/。
#       服务器上二者同根：/opt/deploy-services/{.agents/skills/jenkins-controller,test-190/jenkins}
#
# 解析顺序（先到先得）：
#   1) 调用方已设的 PKG_DIR 环境变量
#   2) 仓库内相对路径（本地开发）
#   3) 服务器默认路径（技能被单独拷贝时的兜底）
# =============================================================================

# 解析并打印部署包目录；找不到返回 1
resolve_pkg_dir() {
    if [ -n "${PKG_DIR:-}" ]; then
        printf '%s' "$PKG_DIR"
        return 0
    fi

    local lib_dir scripts_dir skill_dir repo_root
    lib_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
    scripts_dir="$(dirname -- "$lib_dir")"
    skill_dir="$(dirname -- "$scripts_dir")"
    # skill_dir = <repo>/.agents/skills/jenkins-controller → 上三级 = <repo>
    repo_root="$(cd -- "$skill_dir/../../.." && pwd)"

    if [ -f "$repo_root/test-190/jenkins/docker-compose.yml" ]; then
        printf '%s' "$repo_root/test-190/jenkins"
        return 0
    fi
    if [ -f "/opt/deploy-services/test-190/jenkins/docker-compose.yml" ]; then
        printf '%s' "/opt/deploy-services/test-190/jenkins"
        return 0
    fi
    return 1
}

# 解析失败就直接退出（用法：PKG_DIR="$(require_pkg_dir)"）
require_pkg_dir() {
    local dir
    dir="$(resolve_pkg_dir)" || {
        echo "ERROR: 找不到部署包目录（应为 <repo>/test-190/jenkins）" >&2
        echo "       用 --package-dir <path> 指定，或设置 PKG_DIR 环境变量" >&2
        return 2
    }
    printf '%s' "$dir"
}
