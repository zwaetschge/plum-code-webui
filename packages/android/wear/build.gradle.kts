import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Release signing: the same optional, git-ignored keystore.properties in the
// Android project root that app/build.gradle.kts reads (storeFile resolves
// against that root), or the same PLUM_RELEASE_* properties / KEYSTORE_* env.
val keystoreProperties = Properties().also { props ->
    val source = rootProject.file("keystore.properties")
    if (source.isFile) source.inputStream().use { stream -> props.load(stream) }
}

android {
    namespace = "com.claudewebui.wear"
    compileSdk = 35

    defaultConfig {
        // Must match the phone app's applicationId — the Wear data layer only
        // bridges apps with the same package AND the same signing certificate.
        // Debug: com.claudewebui.app.debug, signed with the debug key on both
        // sides. Release: com.claudewebui.app, signed with the plum-release key
        // on both sides (keystore.properties, see signingConfigs below).
        applicationId = "com.claudewebui.app"
        minSdk = 30
        targetSdk = 34
        versionCode = 5
        versionName = "1.3.1"
    }

    // Docker bind-mounts the ADB identity into ~/.android, which makes Docker
    // create that directory as root — Gradle then cannot write the default
    // debug keystore and signing fails. Use a project-local keystore when one
    // is present; elsewhere the default path keeps working untouched.
    fun releaseSecret(propKey: String, envKey: String, fileKey: String): String? =
        (project.findProperty(propKey) as? String)?.takeIf { it.isNotBlank() }
            ?: System.getenv(envKey)?.takeIf { it.isNotBlank() }
            ?: keystoreProperties.getProperty(fileKey)?.trim()?.takeIf { it.isNotBlank() }

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

    buildTypes {
        release {
            isMinifyEnabled = false
            // Same key as the phone release, or the debug key when none is
            // configured (then not installable next to a release phone app).
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
        }
        debug {
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
    }
}

dependencies {
    implementation(libs.core.ktx)
    implementation(libs.play.services.wearable)
    implementation(libs.wear)
    implementation(libs.wear.tiles)
    implementation(libs.wear.complications.data.source)
    implementation(libs.concurrent.futures)

    // Watch UI: Compose for Wear OS on the phone app's Compose line.
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.wear.compose.foundation)
    implementation(libs.wear.compose.material)
    implementation(libs.wear.compose.navigation)
    implementation(libs.navigation.compose)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.runtime.ktx)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.wear.input)

    // Own bridge connection to Plum, pairing token storage, background refresh.
    implementation(libs.okhttp)
    implementation(libs.security.crypto)
    implementation(libs.work.runtime.ktx)
}
