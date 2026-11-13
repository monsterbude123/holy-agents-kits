# Pipeline 写法与语法速查

> 什么时候读这份：要写 / 改 Jenkinsfile、要选 Declarative / Scripted / Shared Library、查某个语法细节。

## 1 选型

1. 默认 **Declarative**：阶段顺序与行为基本静态，可读、可校验。
2. **Scripted**：仅当需要运行期生成 stage、复杂循环、动态控制流。
3. **Shared Library**：同一套流程要在多仓库复用时抽（`vars/` + `src/` + `resources/`）。
4. 拿不准就 Declarative 起步，表达不下了再换 Scripted。

## 2 声明式模板（本仓库基线）

```groovy
pipeline {
  agent any
  options {
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    timestamps()
  }
  environment {
    GIT_CREDS = credentials('gitlab-pat')   // Username with password = GitLab 用户名 + PAT
    IMAGE_TAG = "${env.GIT_COMMIT?.take(8)}-${env.BUILD_NUMBER}"
  }
  stages {
    stage('Checkout') {
      steps {
        checkout([$class: 'GitSCM',
          branches: [[name: '*/dev']],
          userRemoteConfigs: [[
            url: 'http://<gitlab-host>/<group>/<repo>.git',
            credentialsId: 'gitlab-pat'
          ]]])
      }
    }
    stage('Build image') {
      steps {
        // 显式 sh 优先于 Docker Pipeline 插件：可移植、开发机可复现
        sh 'docker build -t <app>:"$IMAGE_TAG" .'
        sh 'docker tag <app>:"$IMAGE_TAG" <app>:latest'   // latest 仅 dev/main 用
      }
    }
    stage('Deploy') {
      when { branch 'dev'; beforeAgent true }
      steps {
        sh '''
          docker rm -f <app>-run 2>/dev/null || true
          docker run -d --name <app>-run --restart unless-stopped -p <host-port>:<app-port> <app>:latest
        '''
      }
    }
  }
  post {
    always  { sh 'docker image prune -f --filter "until=72h" || true' }  // DooD 产物归宿主，必须回收
    cleanup { cleanWs() }
  }
}
```

要点：

- 凭据经 `environment { X = credentials('id') }` 注入；`sh` 里用**单引号**块让 shell 展开变量，
  Groovy 双引号插值会把密钥写进进程列表 / 构建日志。
- `when { branch ... }` 仅 multibranch 任务生效；`beforeAgent true` 先判分支再占节点。
- `post { cleanup { cleanWs() } }` 清工作区；失败产物放 `post { always }`，通知放 `success/failure`。
- 标签推荐 `${GIT_COMMIT.take(8)}-${BUILD_NUMBER}`，别裸用 `latest`。

## 3 agent 类型

```groovy
agent any                                   // 任意节点
agent { label 'linux && docker' }           // 按标签
agent { docker { image 'maven:3.9-jdk17' } }
agent { kubernetes { yamlFile 'pod.yaml' } } // K8s pod 模板
```

## 4 options 常用项

```groovy
options {
  buildDiscarder(logRotator(numToKeepStr: '10'))
  timeout(time: 1, unit: 'HOURS')
  disableConcurrentBuilds()
  timestamps()
  parallelsAlwaysFailFast()                  // 全局 fail-fast（见 §6）
  durabilityHint('PERFORMANCE_OPTIMIZED')    // 简单流水线提速 2-6x
}
```

## 5 parameters / when / 错误处理 / post / input

### 5.1 parameters（参数化构建）

```groovy
parameters {
  string(name: 'VERSION', defaultValue: '1.0.0')
  choice(name: 'ENV', choices: ['dev', 'staging', 'prod'])
  booleanParam(name: 'SKIP_TESTS', defaultValue: false)
}
// 引用：params.ENV；首次需手动触发一次才生效
```

### 5.2 when 条件

| 条件 | 示例 |
|---|---|
| `branch` | `branch 'main'` / `branch pattern: 'release/*', comparator: 'GLOB'` |
| `tag` | `tag pattern: 'v*', comparator: 'GLOB'` |
| `changeRequest` | `changeRequest target: 'main'` |
| `changeset` | `changeset 'src/**/*.java'` |
| `expression` | `expression { params.DEPLOY == 'true' }` |
| `allOf / anyOf / not` | 组合条件 |

一律加 `beforeAgent true`：条件不满足不占节点。

### 5.3 错误处理

```groovy
catchError(buildResult: 'SUCCESS', stageResult: 'UNSTABLE') { sh '...' } // 容错继续
warnError('msg') { sh '...' }   // 记 UNSTABLE 但继续
unstable('Coverage low')        // 显式 UNSTABLE
error('Config missing')         // 直接失败，无堆栈
```

### 5.4 post 段

```groovy
post {
  always  { junit '**/target/*.xml' }
  success { archiveArtifacts artifacts: '**/*.jar', fingerprint: true }
  failure { echo 'Build failed' }
  cleanup { cleanWs() }
}
```

执行顺序：always → changed → fixed → regression → failure → success → unstable → cleanup。
`archiveArtifacts` 必须带 `fingerprint: true`（制品可追溯）。

### 5.5 input 人工审批

```groovy
stage('Deploy') {
  input { message 'Deploy to production?'; ok 'Deploy'; submitter 'admin,ops' }
  steps { sh './deploy.sh' }
}
```

`input` 必须放 `steps` **外层**，否则审批期间一直占着 agent 节点。

## 6 并行 / Matrix

```groovy
stage('Tests') {
  failFast true                       // 本块 fail-fast；已设 parallelsAlwaysFailFast() 则省略
  parallel {
    stage('Unit') { steps { sh 'npm run test:unit' } }
    stage('E2E')  { steps { sh 'npm run test:e2e' } }
  }
}

stage('Matrix') {
  failFast true
  matrix {
    axes {
      axis { name 'PLATFORM'; values 'linux', 'windows' }
      axis { name 'BROWSER'; values 'chrome', 'firefox' }
    }
    excludes { exclude { axis { name 'PLATFORM'; values 'linux' }; axis { name 'BROWSER'; values 'safari' } } }
    stages { stage('Test') { steps { sh "run-tests $PLATFORM $BROWSER" } } }
  }
}
```

规则：并行块默认 fail-fast（首选 `parallelsAlwaysFailFast()` 全局兜底）。

## 7 Scripted Pipeline 要点

```groovy
node('agent-label') {
  try {
    stage('Build') { sh 'make build' }
    stage('Test')  { sh 'make test' }
  } catch (Exception e) {
    currentBuild.result = 'FAILURE'; throw e
  } finally {
    deleteDir()
  }
}

parallel('Unit': { node { sh 'npm run test:unit' } },
         'E2E':  { node { sh 'npm run test:e2e' } })

withEnv(['VERSION=1.0.0']) { sh 'echo $VERSION' }
withCredentials([string(credentialsId: 'key', variable: 'KEY')]) { sh 'curl -H "Auth: $KEY" ...' }
```

`@NonCPS`：JsonSlurper、正则 Matcher 等不可序列化操作专用；
**内部禁止任何 pipeline step**（`sh` / `echo`）。

## 8 Shared Library

- 结构：`vars/`（全局 step）、`src/`（类）、`resources/`（模板）
- 引用：`@Library('my-lib') _` 或动态 `library 'my-lib@1.0.0'`
- `vars/log.groovy`：`def call(msg) { echo "INFO: ${msg}" }` → 用 `log 'Starting build'`
- 生成脚手架：`python scripts/generate_shared_library.py --name my-lib --package org.example`
  （脚本在本技能 `scripts/` 下；只依赖标准库，`--help` 看用法）
