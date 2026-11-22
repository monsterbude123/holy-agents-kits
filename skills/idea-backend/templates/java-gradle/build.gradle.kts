plugins {
    java
    application
}

group = "com.example"
version = "0.1.0"

java {
    // toolchain 钉住 JDK：Gradle 自动下载/管理所需 JDK，且**编译与执行都用它**。
    // 配 options.release 做交叉编译（字节码目标）——两者分工不同，别只写一个。
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}

tasks.withType<JavaCompile>().configureEach {
    options.release = 25
    options.encoding = "UTF-8"
}

application {
    mainClass = "com.example.demo.App"
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.14.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
}
