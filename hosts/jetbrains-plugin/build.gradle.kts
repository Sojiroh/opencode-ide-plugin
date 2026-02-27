plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.2.1"
    kotlin("jvm") version "1.9.23"
}

group = "paviko.opencode"
version = "26.2.27"

val guiOnly = project.findProperty("guiOnly")?.toString()?.toBoolean() ?: false
val webguiDist = project.findProperty("webguiDist")?.toString()

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

java {
    // Align with IntelliJ Platform 2024.3+ requirement
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

kotlin {
    jvmToolchain(21)
}

sourceSets {
    test {
        kotlin {
            srcDir("src/test/kotlin")
        }
    }
    
    // Create a separate source set for unit tests that don't need IntelliJ
    create("unitTest") {
        kotlin {
            srcDir("src/unitTest/kotlin")
        }
        resources {
            srcDir("src/unitTest/resources")
        }
        compileClasspath += sourceSets.main.get().output
        runtimeClasspath += output + compileClasspath
    }
}

dependencies {
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")

    // IntelliJ Platform dependencies
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.plugins.terminal")

        pluginVerifier()
        zipSigner()
    }

    testImplementation("org.junit.jupiter:junit-jupiter:5.10.0")
    testImplementation("org.mockito:mockito-core:5.5.0")
    testImplementation("org.mockito:mockito-inline:5.2.0")
    testImplementation("org.mockito.kotlin:mockito-kotlin:5.1.0")
    testImplementation(kotlin("test"))
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    
    // Unit test dependencies (no IntelliJ, no JUnit)
    "unitTestImplementation"("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.1")
    "unitTestImplementation"(kotlin("stdlib"))
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild.set("243")
        }
        // Provide metadata without setting an upper build bound (no untilBuild)
        description = providers.provider {
            val f = file("description.html")
            if (!f.isFile) {
                return@provider "Runs local OpenCode backend and displays the chat UI."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "Runs local OpenCode backend and displays the chat UI."
            } else {
                text
            }
        }
        changeNotes = providers.provider {
            val f = file("changelog.html")
            if (!f.isFile) {
                return@provider "See CHANGELOG.md for details."
            }

            val text = f.readText().trim()
            if (text.isEmpty()) {
                "See CHANGELOG.md for details."
            } else {
                text
            }
        }
    }
}

tasks {
    processResources {
        val minVersion = project.findProperty("opencode.min.version")?.toString() ?: "1.1.1"
        inputs.property("opencodeMinVersion", minVersion)
        filesMatching("opencode-build.properties") {
            expand("opencodeMinVersion" to minVersion)
        }

        if (guiOnly) {
            // Exclude bundled binaries for gui-only variant
            exclude("bin/**")
        }
    }

    // Copy webgui-dist into resources and generate file-list.txt for gui-only variant
    if (guiOnly) {
        val copyWebgui = register<Copy>("copyWebguiDist") {
            val srcDir = if (webguiDist != null) file(webguiDist!!) else rootProject.rootDir.resolve("packages/opencode/webgui-dist")
            from(srcDir)
            into(layout.buildDirectory.dir("resources/main/webgui-app"))
        }

        val generateFileList = register("generateWebguiFileList") {
            dependsOn(copyWebgui)
            doLast {
                val webguiDir = layout.buildDirectory.dir("resources/main/webgui-app").get().asFile
                val files = webguiDir.walkTopDown()
                    .filter { it.isFile && it.name != "file-list.txt" }
                    .map { it.relativeTo(webguiDir).invariantSeparatorsPath }
                    .sorted()
                    .toList()
                File(webguiDir, "file-list.txt").writeText(files.joinToString("\n") + "\n")
                logger.lifecycle("Generated webgui-app/file-list.txt with ${files.size} entries")
            }
        }

        named("processResources") {
            dependsOn(generateFileList)
        }
    }

    // Ensure no upper build bound is set in plugin.xml so the plugin stays compatible with newer IDEs
    patchPluginXml {
        // keep sinceBuild from pluginConfiguration, but expand upper bound to newer IDE builds
        untilBuild.set("261.*")

        if (guiOnly) {
            pluginId.set("paviko.opencode-ux-plus-gui-only")
            pluginName.set("OpenCode UX+ GUI Only (unofficial)")
        }
    }

    prepareSandbox {
        from(rootProject.rootDir.resolve("LICENSE")) {
            into("${intellijPlatform.projectName.get()}")
        }
    }

    // Rename output archive for gui-only variant
    if (guiOnly) {
        named<Zip>("buildPlugin") {
            archiveBaseName.set("opencode-plugin-gui-only")
        }
    }

    
    // Configure test task for IntelliJ integration tests
    test {
        useJUnitPlatform()
        
        systemProperty("java.awt.headless", "true")
        systemProperty("idea.test.cyclic.buffer.size", "1048576")
        systemProperty("idea.home.path", "")
        
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }
    
    // Create unit test task that runs without IntelliJ dependencies
    register<JavaExec>("unitTest") {
        dependsOn("compileUnitTestKotlin")
        
        mainClass.set("paviko.opencode.ui.StandaloneMessageTestKt")
        classpath = sourceSets["unitTest"].runtimeClasspath
        
        systemProperty("java.awt.headless", "true")
        
        jvmArgs(
            "-Djava.awt.headless=true",
            "--add-opens=java.base/java.lang=ALL-UNNAMED",
            "--add-opens=java.base/java.util=ALL-UNNAMED"
        )
    }
    
    // Make build depend on unit tests
    build {
        dependsOn("unitTest")
    }
}
