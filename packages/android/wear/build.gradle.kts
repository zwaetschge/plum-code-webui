plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.claudewebui.wear"
    compileSdk = 35

    defaultConfig {
        // Must match the phone app's applicationId (incl. the debug suffix
        // below) — the Wear data layer only bridges same-package, same-cert
        // apps.
        applicationId = "com.claudewebui.app"
        minSdk = 30
        targetSdk = 34
        versionCode = 4
        versionName = "1.3.0"
    }

    // Docker bind-mounts the ADB identity into ~/.android, which makes Docker
    // create that directory as root — Gradle then cannot write the default
    // debug keystore and signing fails. Use a project-local keystore when one
    // is present; elsewhere the default path keeps working untouched.
    signingConfigs {
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
