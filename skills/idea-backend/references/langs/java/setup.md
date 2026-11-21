# JVM（Java / Kotlin）分册 —— 把 JVM 项目接进 IntelliJ IDEA

> **本分册的地位**：JVM 是 IDEA **全版本捆绑**的语言栈（社区版即可用）→ edition 门禁 = `community`，
> 是所有语言里门槛最低的一档；它同时是 `idea-backend` 最早的实战场景（审查→修复流水线在
> `ai-ocr-std-services` 上跑出 104 → 0）。
> **通用部分不在这里**：装环境/机器事实见 [../../setup-0to1.md](../../setup-0to1.md) 与 `scripts/setup-env.sh`；
> 运行期能力档位见 [../../capability-matrix.md](../../capability-matrix.md) §3；检视规则与噪声豁免见
> [profile.md](profile.md) 与 [rules/README.md](rules/README.md)。

## 先看版本门禁（它决定后面哪些能做）

- **JVM 不受 edition 门禁限制**：java / kotlin 插件在 IC/IU/WS 全版本捆绑，`setup-env.sh plugins` 会报
  `LANG_PLUGIN java edition-gate=community java=present kotlin=present`。TS / Python 的**语言插件**社区版装不了，
  那两门语言的门禁是 `ultimate`（见 [../../capability-matrix.md](../../capability-matrix.md) §3.1 的逐插件门禁表）。
- **IDEA 2026.2 支持的项目语言级别上探 Java 27**，**Java 25 是这一版的 LTS 对齐档**
  （Compact source files / Module imports）。所以项目 SDK 钉在 **JDK 25** 既稳又与 IDE 的 LTS 档对齐。
- **JDK 25 本身是 LTS**（2025-09-16 GA，多数发行商按 LTS 支持），编译目标用 `release` 而不是
  `-source/-target`——后者只改字节码版本、API 仍按当前 JDK 的库解析，会编出「用高版本 API 却声明低版本
  字节码」的产物，运行时才炸。

本机实测（2026-11-22）：IDEA **IdeaIC 2026.2.5**（社区版）+ **OpenJDK 25.0.5.1 LTS**
（`D:/workplace/jdk-25/jdk-25.0.5.1`，`JAVA_HOME` 已设到用户级环境变量）。本机原无任何 JDK，
是这次为建这一册才装的；机器事实记在 `config.json` 的 `toolchains.java`（**不入库、不分发**）。

随时复查（**通用**入口，任何语言都能问）：

```bash
bash scripts/setup-env.sh plugins <IDEA安装根>   # 各语言插件在位情况 + edition 门禁
bash scripts/setup-env.sh toolchain jdk         # JDK 工具链事实（JAVA_HOME → config.json → PATH）
bash scripts/setup-env.sh probe  <IDEA安装根>   # 机器事实
```

## 三步用法

1. **探测机器**：`bash scripts/setup-env.sh roots` → **问用户** IDEA 装在哪（本仓隐私规则：不全局扫描）→
   `detect <区域>` → `init <安装根>` 写机器本地 `config.json`。复查用 `bash scripts/setup-env.sh check`。
2. **装工具链**：`bash scripts/setup-env.sh install-deps --lang java`。它**不下载任何东西**——JDK 是机器级的
   （装在机器上、不随模板走），构建器是项目级的（靠项目自带 wrapper）。这一步只确认 JDK 在位，并把
   「首次跑 wrapper 会联网取构建器」这件事说清楚。
3. **接项目**：
   - **已有项目** → `node scripts/inspect-project.mjs <项目目录>` 判语言与形态（`LANG=java` + `BUILD_TOOL` /
     `MODULE_COUNT` / `SOURCE_DIRS` / `TEST_FRAMEWORK` / `CONDITIONS`），再按 `--ids` 输出该形态适用的清单条目；
   - **新项目** → `bash scripts/init-project.sh <目标项目目录> --lang java --template java-project --name <包名>`；
   - 然后照 [checklist.json](checklist.json) 逐条配、逐条自证。

## 模板即版本组合（别乱改）

**`templates/java-project`** —— Maven + JDK 25 的最小可跑工程：

| 文件 | 为什么必须有 |
| --- | --- |
| `pom.xml` | `maven.compiler.release=25`（字节码目标 + 可见 API）、`project.build.sourceEncoding=UTF-8`（跨机器一致的中文源码）、junit-jupiter 5.14.4 + surefire 3.6.1（版本钉死，默认版本随 Maven 走会静默跳过 JUnit 5 用例） |
| `src/main/java/.../App.java` | 编译目标的自证样本：`javac --release 25` 真编译它 |
| `src/test/java/.../AppTest.java` | 测试源根与 JUnit 运行配置的目标 |
| `.editorconfig` | 编辑器无关的格式约定，IDEA 原生支持并叠加在 Code Style 之上 |
| `.gitignore` | `target/` 与 IDEA 的**本机噪音**（workspace.xml / tasks.xml / shelf/）；声明式配置（modules / iml / runConfigurations / inspectionProfiles）**要入库** |
| `.idea/misc.xml` | 项目 SDK + `languageLevel="JDK_25"`（与 pom 的 release 同源） |
| `.idea/<module>.iml` | 源根标记、`inheritedJdk`（继承项目 SDK）、`<exclude-output />` + 排除 `target/` |
| `.idea/encodings.xml` | 项目编码 UTF-8 + **properties 文件编码 UTF-8**（IDEA 默认 ISO-8859-1） |
| `.idea/compiler.xml` | 注解处理开启（Lombok / MapStruct 靠它） |
| `.idea/runConfigurations/*.xml` | Application + JUnit 共享运行配置，clone 即用 |
| `.idea/inspectionProfiles/Project_Default.xml` | 团队共用一份检视口径 |

版本组合的来路（不靠记忆）：插件版本取 Maven Central 镜像的 `maven-metadata.xml`
（maven-compiler-plugin 3.16.0 / maven-surefire-plugin 3.6.1 / junit-jupiter 5.14.4）；
JDK 版本取 Oracle 官方 GA 包 OpenJDK 25.0.5.1 LTS。

## 本分册的判据口径（与其他语言不同）

**JVM 分册的清单判据全部是离线可跑的**：JDK 工具链事实 + 文件/状态断言。刻意**不**把
`mvn package` / `gradle build` 这类需要依赖仓库的动作放进逐条自证——那会让清单在离线机器上恒红，
也分不清「配置错了」与「网络不通」。

需要联网的那部分留给 CI 与本地构建（`npm run typecheck` / `mvn -v` 之类由 agent 按需手动跑）。

## Gradle 侧怎么对齐（清单外补充）

- **构建器版本必须来自 wrapper**：Gradle 的 Distribution 选 `gradle-wrapper.properties`（推荐默认项，
  版本记在项目里的 `gradle/wrapper/gradle-wrapper.properties`），这样 IDE 与 CI 用同一个 Gradle 版本。
- **JDK 用 toolchain 钉**：`java { toolchain { languageVersion = JavaLanguageVersion.of(25) } }` 让 Gradle
  自动下载与管理所需 JDK，且**编译与执行都用它**——Gradle 自己的对比表里只有 toolchain 同时保证
  「正确的 JDK」与「自动下载 JDK」，`--release` 只防误用 API。配合 `options.release = 25` 做交叉编译。
- **IDE 侧的 Gradle JVM 要与之一致**：Gradle JVM 决定 IDEA 导入与跑任务时用哪个 JVM 跑 Gradle；
  现有 Gradle 工程的解析顺序是 ①`gradle.properties` 的 `org.gradle.java.home` → ②`JAVA_HOME` →
  ③现有 Gradle 版本可用的最近合适 JDK；都没指定才用项目 SDK。

## 与「审查→修复流水线」的关系

P3C 规则、global 批处理项（unused declaration / DuplicateExpressions …）、`src/main`/`src/test` 分流
**都是 JVM 侧能力**。别的语言照搬会拿到空清单——那门语言该走它自己的分册
（TS 用 `tsc --noEmit` + `eslint`，Python 用 `ruff` + `mypy` + `pytest`）。
