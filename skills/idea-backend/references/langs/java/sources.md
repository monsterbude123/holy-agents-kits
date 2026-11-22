# 来源快照（Sources）—— JVM 分册

> 本文件是 `references/langs/java/checklist.json` 与 `idea-settings.json` 的**溯源底账**：
> 每一条的 `source`（URL）与 `quote`（原句）都必须能在这里逐字命中，否则该条在
> `scripts/verify-quotes.mjs --lang java` 的溯源门里判负——**不许凭记忆写引文**。
>
> 抓取时间：2026-11-22。文档版本：**IntelliJ IDEA 2026.2**（版本化 URL：
> `https://www.jetbrains.com/help/idea/2026.2/<page>.html`；`2026.3` 是当前在线文档版，
> 与本机 IDEA 2026.2.5 差一个次版本，条目以 2026.2 为准）。
>
> 本机事实（2026-11-22 实测）：IDEA **IdeaIC 2026.2.5**（社区版，`productCode=IC`）、
> JDK **OpenJDK 25.0.5.1 LTS**（`D:/workplace/jdk-25/jdk-25.0.5.1`，JAVA_HOME 已设到用户级环境变量，
> 机器事实记在 `config.json` 的 `toolchains.java`，不入库、不分发）。本机**没有** Maven/Gradle，
> 因此本分册的清单判据全部是**离线可跑**的：JDK 工具链事实 + 文件/状态断言。

---

## [J1] OpenJDK — JDK 25 项目页
- URL: https://openjdk.org/projects/jdk/25/
- 用于条目：`jdk-present`

> JDK 25 reached General Availability on 16 September 2025.

## [J2] JDK 25 — javac 手册（--release 语义；Maven 侧由 maven.compiler.release 属性承载，见 compile-mojo.html）
- URL: https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html
- 用于条目：`jdk-release-matches-project`

> --release release Compiles source code according to the rules of the Java programming language for the specified Java SE release, generating class files which target that release. Source code is compiled against the combined Java SE and JDK API for the specified release.

## [J3] JDK 25 — javac 手册（--release）
- URL: https://docs.oracle.com/en/java/javase/25/docs/specs/man/javac.html
- 用于条目：`javac-release-compiles`

> --release release Compiles source code according to the rules of the Java programming language for the specified Java SE release, generating class files which target that release. Source code is compiled against the combined Java SE and JDK API for the specified release.

## [J4] IDEA 2026.2 — Project structure settings
- URL: https://www.jetbrains.com/help/idea/2026.2/project-settings-and-structure.html
- 用于条目：`idea-project-sdk-declared`、`idea-language-level-matches-release`

> Project structure settings include the SDK, project compiler output paths, and project libraries. These settings are stored together with other project configuration files in the `.idea` directory.

> Language level also affects compilation. If you don't manually configure the target bytecode version for your compiler (`Settings | Build, Execution, Deployment | Compiler | Java Compiler`), it will be the same as the project language level.

## [J5] IDEA 2026.2 — Modules（模块设置与输出路径）
- URL: https://www.jetbrains.com/help/idea/2026.2/configure-modules.html
- 用于条目：`idea-module-inherits-sdk`、`idea-exclude-build-output`

> Module settings apply only to one module and are stored in the `.iml` file. A module can have an SDK and a language level that are different from those configured for a project, and their own libraries.

> Select the Exclude output path checkbox to exclude the output folders from code completion, navigation, and inspections. This helps increase overall IDE performance.

## [J6] IDEA 2026.2 — Content roots（源根与排除）
- URL: https://www.jetbrains.com/help/idea/2026.2/content-roots.html
- 用于条目：`idea-source-roots`、`idea-excluded-folder-semantics`、`source-layout-declared`

> Sources This folder contains production code that should be compiled. ... Note: IntelliJ IDEA compiles the code within the Sources folder. Do not place configuration files (the `.idea` folder or its content and the `.iml` file) to this folder.

> Files in excluded folders are ignored by code completion, navigation and inspection. That is why when you exclude a folder that you don't need at the moment, you can increase the IDE performance. Normally, compilation output folders are marked as excluded.

> Sources This folder contains production code that should be compiled.

## [J7] IDEA 2026.2 — Properties files
- URL: https://www.jetbrains.com/help/idea/2026.2/properties-files.html
- 用于条目：`encoding-properties-utf8`

> In IntelliJ IDEA, the default encoding for properties files is ISO-8859-1. You can also use escape sequences for characters not defined by the selected encoding. Alternatively, you may choose to define a different default encoding for properties files on the project level.

## [J8] IDEA 2026.2 — File encodings
- URL: https://www.jetbrains.com/help/idea/2026.2/file-encodings.html
- 用于条目：`encoding-project-utf8`

> If encoding is not configured for the file or directory, IntelliJ IDEA will use the encoding of the parent directory. If the parent directory encoding is also not configured, IntelliJ IDEA will fall back to the Project Encoding , and if there is no project, to Global Encoding .

## [J9] IDEA 2026.2 — .editorconfig
- URL: https://www.jetbrains.com/help/idea/2026.2/editorconfig.html
- 用于条目：`editorconfig-present`

> This functionality relies on the EditorConfig plugin, which is bundled and enabled in IntelliJ IDEA by default. ... All options from the `.editorconfig` file are applied to the directory where it resides as well as all of its sub-directories on top of the current project code style.

## [J10] IDEA 2026.2 — Annotation processors
- URL: https://www.jetbrains.com/help/idea/2026.2/annotation-processors-support.html
- 用于条目：`annotation-processing-enabled`

> When you add annotation processors through the build scripts in Maven or Gradle projects, IntelliJ IDEA automatically enables the annotation processing and adds the appropriate paths in the annotation processor settings.

## [J11] IDEA 2026.2 — Run/Debug configuration: Java Application
- URL: https://www.jetbrains.com/help/idea/2026.2/run-debug-configuration-java-application.html
- 用于条目：`run-config-application`

> JRE | Specify the runtime environment that IntelliJ IDEA should use to run the application. By default, IntelliJ IDEA uses the latest available JDK from the module dependencies. ... Working directory | Specify the working directory to be used for running the application. This directory is the starting point for all relative input and output paths. By default, the working directory is the project root.

## [J12] IDEA 2026.2 — Run/Debug configuration: JUnit
- URL: https://www.jetbrains.com/help/idea/2026.2/run-debug-configuration-junit.html
- 用于条目：`run-config-junit`

> Use classpath of module | Select the module whose classpath should be used to run the application.

## [J13] IDEA 2026.2 — Maven support
- URL: https://www.jetbrains.com/help/idea/2026.2/maven-support.html
- 用于条目：`build-tool-declared`

> 2. In the dialog that opens, select the `pom.xml` file of the project you want to open. ... IntelliJ IDEA opens and syncs the Maven project in the IDE.

## [J14] IDEA 2026.2 — Inspection profiles
- URL: https://www.jetbrains.com/help/idea/2026.2/code-inspection.html
- 用于条目：`inspection-profile-present`

> Share the same inspection profile, both within the IDE and the CI tool.

## [J15] IDEA 2026.2 — Supported Java versions
- URL: https://www.jetbrains.com/help/idea/2026.2/supported-java-versions.html
- 用于条目：`idea-edition-gate-jvm`

> Java 25: Compact source files, Module imports

## [J16] Gradle — Gradle Wrapper
- URL: https://www.jetbrains.com/help/idea/2026.2/gradle.html
- 用于条目：`wrapper-is-single-source`

> In the Distribution list select one of the following options: Wrapper: this is a recommended default option that uses Gradle wrapper. In this case you delegate the update of Gradle versions to Gradle and get an automatic Gradle download for the build. This option also lets you build with a precise Gradle version.

## [J17] IDEA 2026.2 — Maven runner（委派构建）
- URL: https://www.jetbrains.com/help/idea/2026.2/maven-runner.html
- 用于条目（IDE 侧设置）：`idea-delegate-build-to-maven`

> Delegate IDE build/run actions to Maven | Select this checkbox to build, run, and debug code through Maven. It might be helpful if you have a configuration that changes the compilation on the fly, or your build generates an artifact with a custom layout.

## [J18] IDEA 2026.2 — Maven importing（importer JDK）
- URL: https://www.jetbrains.com/help/idea/2026.2/maven-importing.html
- 用于条目（IDE 侧设置）：`idea-maven-importer-jdk`

> JDK for importer | Use this list to specify which JDK to use when the maven project is imported. You can choose one of the following options: Internal JRE: this is a default option that uses the installation directory for JRE. JDK versions: this option uses your project's JDK. Use JAVA_HOME: this option uses the value that is specified in the user's environment variable settings.

## [J19] IDEA 2026.2 — Maven（.mvn/maven.config）
- URL: https://www.jetbrains.com/help/idea/2026.2/maven.html
- 用于条目（IDE 侧设置）：`idea-maven-config`

> Use settings from .mvn/maven.config | Select this option if you want to use a set of Maven options configured in the maven.config file for your project. In this case, options that you have in this file will override the same options specified in the Maven settings.

## [J20] IDEA 2026.2 — Gradle settings（Gradle JVM）
- URL: https://www.jetbrains.com/help/idea/2026.2/gradle-settings.html
- 用于条目（IDE 侧设置）：`idea-gradle-jvm`

> Gradle JVM | Use this field to specify the JVM under which IntelliJ IDEA will run Gradle when you import the specified Gradle project and when you execute its tasks. The default is set to your project JDK.

## [J21] IDEA 2026.2 — Gradle JVM selection（解析顺序）
- URL: https://www.jetbrains.com/help/idea/2026.2/gradle-jvm-selection.html
- 用于条目（IDE 侧设置）：`idea-gradle-jvm-resolution`

> 1. IntelliJ IDEA checks the `gradle.properties` file for the appropriate Gradle JVM specified in `org.gradle.java.home` and uses it for the project. 2. Then it checks the `JAVA_HOME` environment variable. 3. Then it checks the closest appropriate JDK version for the existing Gradle version.

## [J22] IDEA 2026.2 — Work with Gradle projects（注解处理器 + 委派）
- URL: https://www.jetbrains.com/help/idea/2026.2/work-with-gradle-projects.html
- 用于条目（IDE 侧设置）：`idea-lombok-annotation-processing`

> If you use the annotationProcessors in your project, we recommend that you delegate run and build actions to Gradle, so the annotation processor will be correctly enabled in your project.

---

## 附：本机实测事实（2026-11-22）

- IDEA：`D:/workplace/idea-2026.2.5`，`product-info.json` 的 `productCode` = **IC**（社区版）、
  `version` = 2026.2.5、`buildNumber` = 262.12573.28 → **JVM 语言栈全版本捆绑，社区版即可用**；
  `plugins/` 下有 `java` 与 `kotlin` 目录。
- JDK：**本机原本一个 JDK 都没有**（`JAVA_HOME` 未设、`java` 不在 PATH）。已装
  **OpenJDK 25.0.5.1 LTS**（Oracle 官方 GA 包，2026-11-17 构建）到
  `D:/workplace/jdk-25/jdk-25.0.5.1`，`JAVA_HOME` 已设到**用户级**环境变量，
  用户 PATH 前置了 `<JDK>\bin`（用户 PATH 512 → 549 字符，未触及 setx 的 1024 上限）。
  选 25 的依据：JDK 25 是 LTS，且是 IDEA 2026.x 的 LTS 对齐档（IDEA 2026.2 支持的语言级别
  上探 Java 27，Java 25 这一档带稳定特性）。
  机器事实记在 `config.json` 的 `toolchains.java`（**不入库、不分发**）。
- Maven / Gradle：**本机没装**。因此本分册的清单判据全部做成离线可跑的
  （JDK 工具链事实 + 文件/状态断言），`mvn -v` / `mvn package` 这类需要依赖仓库的动作
  明确写在「不在逐条自证范围内」。
- 下载源的可达性（2026-11-22 实测）：`api.adoptium.net` / `api.azul.com` /
  `corretto.aws` **连不上**（curl 000）；`download.oracle.com` 与
  `maven.aliyun.com`（Maven Central 镜像）可达 —— JDK 取 Oracle 官方 GA 包，
  插件版本取镜像的 `maven-metadata.xml`（maven-compiler-plugin 3.16.0 /
  maven-surefire-plugin 3.6.1 / junit-jupiter 5.14.4），不靠记忆写版本。
- **文档事实更正（重要）**：本仓原先写的「2026.2 起 IDEA 不再捆绑 Lombok 插件」**是错的**——
  Lombok 仍在平台源码树里（`plugins/lombok`，vendor = JetBrains，自 2020.3 起集成）。
  真正决定 Lombok 能不能工作的是**构建有没有跑注解处理**（构建脚本声明处理器 +
  委派构建/开启注解处理），不是装不装插件。相关条目已按此改写。
