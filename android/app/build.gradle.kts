// Docs: docs/02 - Tech/Android App.md
// Purpose: the Android TV app: the web build bundled in a WebView, version from VERSION, release signing from outside the repo.
import java.io.File
import java.util.Properties

plugins {
    id("com.android.application")
}

// VERSION is the only source of truth: MAJOR.MEDIUM.MINOR+BUILD. BUILD only grows, so it is Android's versionCode.
val dholphinVersion = File(rootDir, "../VERSION").readText().trim()
val buildNumber = dholphinVersion.substringAfter('+').toInt()

// The release key never enters the repository: ~/.config/dholphin/signing.properties points to it.
val signing = File(System.getProperty("user.home"), ".config/dholphin/signing.properties")
    .takeIf { it.isFile }?.let { f -> Properties().apply { f.inputStream().use(::load) } }

android {
    namespace = "app.dholphin.tv"
    compileSdk = 37

    defaultConfig {
        applicationId = "app.dholphin.tv"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNumber
        versionName = dholphinVersion
    }

    signingConfigs {
        if (signing != null) create("release") {
            storeFile = File(signing.getProperty("storeFile"))
            storePassword = signing.getProperty("storePassword")
            keyAlias = signing.getProperty("keyAlias")
            keyPassword = signing.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures { buildConfig = true }
}

// The web build (web/dist, from tools/build_web.sh) is bundled as assets/web.
abstract class CopyWebTask : DefaultTask() {
    @get:InputDirectory abstract val dist: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val src = dist.get().asFile
        if (!File(src, "index.html").exists()) throw GradleException("Build the web app first: tools/build_web.sh")
        val dest = File(outputDir.get().asFile, "web")
        dest.deleteRecursively()
        src.copyRecursively(dest, overwrite = true)
        // No keys travel in the APK: a config.json left by a keyed build is dropped.
        File(dest, "config.json").delete()
    }
}

val copyWeb = tasks.register<CopyWebTask>("copyWeb") {
    dist.set(File(rootDir, "../web/dist"))
    outputDir.set(layout.buildDirectory.dir("generated/web-assets"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyWeb, CopyWebTask::outputDir)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.1")
    implementation("androidx.webkit:webkit:1.18.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("com.google.zxing:core:3.5.3")
}
