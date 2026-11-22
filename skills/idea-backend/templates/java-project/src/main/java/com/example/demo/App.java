package com.example.demo;

/** 模板入口：IDEA 的 Application 运行配置指向它。 */
public final class App {

    private App() {
    }

    public static void main(String[] args) {
        System.out.println(greet("IDEA"));
    }

    public static String greet(String who) {
        return "Hello, " + who + "!";
    }
}
