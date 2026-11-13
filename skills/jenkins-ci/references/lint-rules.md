# Jenkinsfile 校验（lint）规则

> 什么时候读这份：写完 / 改完 Jenkinsfile，要判断"这条规则是必须修还是可以放过"。

## 1 校验流程

1. 识别类型：`pipeline {` → Declarative；`node {` → Scripted；识别不了按 Scripted 保守处理。
2. 语法校验 → 硬编码凭据扫描 → 最佳实践检查。
3. 分级处理：**ERROR 必须修**（流水线会挂）；**WARNING 应当修**；INFO 视情况。
4. 修完重验；只有通过校验的 Jenkinsfile 才交付。

跑校验（脚本在本技能 `scripts/` 下，只依赖标准库）：

```
python scripts/validate_jenkinsfile.py Jenkinsfile
python scripts/validate_jenkinsfile.py --strict Jenkinsfile
python scripts/validate_jenkinsfile.py --syntax-only Jenkinsfile
```

退出码：`0` = 通过；`1` = 有 ERROR；`2` = 用法 / 环境错（文件不存在等）。
stdout 是结果报告，stderr 是过程日志。

## 2 规则清单

| 级别 | 规则 |
|---|---|
| ERROR | 硬编码凭据 / token / 私钥 → 必须走 `credentials()` / `withCredentials` |
| ERROR | Groovy 双引号插值密钥进 `sh` → 改单引号块 + shell 变量 |
| ERROR | 声明式缺 `stages` / `steps`，或 `post` 写在 `stages` 内 |
| ERROR | `input` 放在 `steps` 里（占死 agent）→ 移到 stage 层 |
| WARNING | 缺 `timeout`（可能挂死）/ 缺 `disableConcurrentBuilds`（资源竞争） |
| WARNING | `archiveArtifacts` 无 `fingerprint: true` |
| WARNING | 并行块无 fail-fast（`parallelsAlwaysFailFast()` 或 `failFast true`） |
| WARNING | 裸用 `latest` 标签 / 不清理镜像容器（宿主堆积） |
| WARNING | `catchError` 吞错不记结果、测试无 `junit` 报告归档 |
| INFO | 缺 `buildDiscarder`（磁盘）、缺 `timestamps`（排障）、缺 `cleanWs()` |
| INFO | 生产部署无 `input` 审批门；安全扫描（SonarQube / Trivy / OWASP）缺失 |

## 3 判级边界

- 同一条规则同时命中 ERROR 与 WARNING 时取更严的一级。
- 语法骨架检查只看结构（`pipeline {}` / `stages` / `steps` / `post` 的位置），
  不做完整 Groovy 解析——完整校验交给 Jenkins 自己的 Declarative Linter
  （`https://<jenkins-host>/pipeline-model-converter/validate`）。
- 硬编码凭据扫描按"赋值形态"判定（`password=...`、`token: '...'`、`AKIA...` 等特征串），
  命中后仍需人工确认——形似凭据的占位符（`<token>`、`xxx`、`***`）不算 ERROR。
