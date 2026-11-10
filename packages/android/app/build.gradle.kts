import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.ksp)
    alias(libs.plugins.baselineprofile)
}

// Optional, git-ignored release signing file in the Android project root.
val keystoreProperties = Properties().also { props ->
    val source = rootProject.file("keystore.properties")
    if (source.isFile) source.inputStream().use { stream -> props.load(stream) }
}

android {
    namespace = "com.claudewebui.app"
    if (projectDir.absolutePath.startsWith("/app/projects/")) {
        sourceSets.getByName("androidTest").java.srcDir(rootProject.file("plum-ui-tests/java"))
    }
    compileSdk = 35

    // ---------------------------------------------------------------------------
    // Signing — a real release keystore produces a properly signed, R8-shrunk
    // release APK. Supply the keystore out of band (NEVER commit passwords):
    //   gradle.properties (or ~/.gradle/gradle.properties / -P flags):
    //     PLUM_RELEASE_STORE_FILE      — path to your .jks / .keystore file
    //     PLUM_RELEASE_STORE_PASSWORD  — store password
    //     PLUM_RELEASE_KEY_ALIAS       — key alias inside the keystore
    //     PLUM_RELEASE_KEY_PASSWORD    — key password
    //   or the matching environment variables KEYSTORE_PATH / KEYSTORE_PASS /
    //   KEY_ALIAS / KEY_PASS,
    //   or a git-ignored keystore.properties in the Android project root
    //   (storeFile, storePassword, keyAlias, keyPassword; a relative storeFile
    //   resolves against that root).
    // When none of these are set the release buildType falls back to the debug
    // signing key so the build still succeeds (useful for CI / local smoke
    // builds). TODO: set the PLUM_RELEASE_* gradle.properties keys above (or the
    // KEYSTORE_* env vars) on the publishing host so shipped updates are signed
    // with the production release key instead of the debug key.
    // ---------------------------------------------------------------------------
    fun releaseSecret(propKey: String, envKey: String, fileKey: String): String? =
        (project.findProperty(propKey) as? String)?.takeIf { it.isNotBlank() }
            ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }
            ?: keystoreProperties.getProperty(fileKey)?.trim()?.takeIf { it.isNotBlank() }

    // A property/env path keeps resolving against this module as before; the
    // keystore.properties path resolves against the file's own directory.
    val releaseStoreFile = releaseSecret("PLUM_RELEASE_STORE_FILE", "KEYSTORE_PATH", "")?.let { file(it) }
        ?: keystoreProperties.getProperty("storeFile")?.trim()?.takeIf { it.isNotBlank() }?.let { rootProject.file(it) }
    val hasReleaseKeystore = releaseStoreFile?.exists() == true

    signingConfigs {
        create("release") {
            if (hasReleaseKeystore) {
                storeFile = releaseStoreFile
                storePassword = releaseSecret("PLUM_RELEASE_STORE_PASSWORD", "KEYSTORE_PASS", "storePassword")
                keyAlias = releaseSecret("PLUM_RELEASE_KEY_ALIAS", "KEY_ALIAS", "keyAlias")
                keyPassword = releaseSecret("PLUM_RELEASE_KEY_PASSWORD", "KEY_PASS", "keyPassword")
            }
        }

        // See wear/build.gradle.kts: a container that mounts the ADB identity
        // into ~/.android leaves that directory unwritable for Gradle.
        val projectDebugKeystore = rootProject.file(".android/debug.keystore")
        if (projectDebugKeystore.exists()) {
            getByName("debug") {
                storeFile = projectDebugKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    defaultConfig {
        applicationId = "com.claudewebui.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 74
        versionName = "1.9.22"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Use the real release key when one is configured; otherwise fall
            // back to the debug key so the release build still assembles (it is
            // then NOT upload-ready — see the signingConfigs TODO above).
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
            isDebuggable = true
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
            excludes += "/META-INF/INDEX.LIST"
            excludes += "/META-INF/io.netty.versions.properties"
        }
    }
}

dependencies {
    implementation(project(":swarm"))
    baselineProfile(project(":baselineprofile"))
    // Compose BOM
    val composeBom = platform(libs.compose.bom)
    implementation(composeBom)
    androidTestImplementation(composeBom)

    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.extended)
    implementation(libs.compose.animation)
    implementation(libs.compose.foundation)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)

    // Navigation
    implementation(libs.navigation.compose)

    // AndroidX Core
    implementation(libs.core.ktx)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.activity.compose)
    // Splash screen API — themed cold-start window that hands off to the
    // Compose content on the first draw (Theme.Plum.Starting).
    implementation(libs.core.splashscreen)
    // Installs src/main/baseline-prof.txt on devices so the cold-start path is
    // AOT-compiled instead of interpreted for the first runs after install.
    implementation(libs.profileinstaller)

    // Room
    implementation(libs.room.runtime)
    implementation(libs.room.ktx)
    implementation(libs.room.paging)
    implementation(libs.paging.runtime)
    implementation(libs.paging.compose)
    ksp(libs.room.compiler)

    // Security
    implementation(libs.security.crypto)
    implementation(libs.biometric)
    implementation(libs.fragment.ktx)

    // Ktor Client
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content.negotiation)
    implementation(libs.ktor.client.logging)
    implementation(libs.ktor.client.auth)
    implementation(libs.ktor.serialization.kotlinx.json)

    // Socket.IO
    implementation(libs.socketio.client)

    // Koin DI
    val koinBom = platform(libs.koin.bom)
    implementation(koinBom)
    implementation(libs.koin.core)
    implementation(libs.koin.android)
    implementation(libs.koin.compose)
    implementation(libs.koin.compose.viewmodel)

    // Serialization
    implementation(libs.kotlinx.serialization.json)

    // WorkManager — periodic home-screen widget refresh
    implementation(libs.work.runtime.ktx)

    // Wear OS data layer (phone side of the watch bridge)
    implementation(libs.play.services.wearable)

    // Frosted glass (backdrop blur) for the floating nav bar
    implementation(libs.haze)

    // Coil Image Loading
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)

    // Markwon Markdown
    implementation(libs.markwon.core)
    implementation(libs.markwon.html)
    implementation(libs.markwon.image.coil)
    implementation(libs.markwon.linkify)
    implementation(libs.markwon.strikethrough)
    implementation(libs.markwon.tables)

    // Testing
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(libs.junit.ext)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.uiautomator)
    androidTestImplementation(libs.compose.ui.test.junit4)
}

// The shared Android Builder invokes `clean assembleDebug` on an Unraid/FUSE
// project mount where recursive Gradle deletes can observe directory entries
// reappearing mid-delete. Keep normal local clean behaviour; only make the
// builder's redundant pre-build clean a no-op so assemble can update outputs.
if (project.projectDir.absolutePath.startsWith("/app/projects/")) {
    tasks.named<org.gradle.api.tasks.Delete>("clean") {
        setDelete(emptyList<Any>())
    }
}

// The MCP builder's assembleDebug must verify draft/send race regressions too.
tasks.matching { it.name == "assembleDebug" }.configureEach {
    dependsOn("testDebugUnitTest")
    dependsOn(":swarm:testDebugUnitTest")
    finalizedBy("assembleDebugAndroidTest")
}

baselineProfile {
    // Device runs are explicit; ordinary debug builds never start profiling.
    automaticGenerationDuringBuild = false
    saveInSrc = true
    mergeIntoMain = true
    filter { include("com.claudewebui.app.**") }
}
