plugins {
    alias(libs.plugins.android.test)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.baselineprofile)
}

android {
    namespace = "com.claudewebui.benchmark"
    compileSdk = 35
    defaultConfig {
        minSdk = 28
        targetSdk = 35
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    targetProjectPath = ":app"
    experimentalProperties["android.experimental.self-instrumenting"] = true
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    val projectDebugKeystore = rootProject.file(".android/debug.keystore")
    if (projectDebugKeystore.exists()) {
        signingConfigs.getByName("debug") {
            storeFile = projectDebugKeystore
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }
}

baselineProfile { useConnectedDevices = true }

dependencies {
    implementation(libs.benchmark.macro)
    implementation(libs.junit.ext)
    implementation(libs.uiautomator)
}
