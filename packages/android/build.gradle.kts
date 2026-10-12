plugins {
    alias(libs.plugins.android.library) apply false
    alias(libs.plugins.android.application) apply false
    alias(libs.plugins.android.test) apply false
    alias(libs.plugins.baselineprofile) apply false
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kotlin.compose) apply false
    alias(libs.plugins.ksp) apply false
}

// The MCP builder prepends clean on its FUSE mount. Apply the same incremental
// build policy as the phone app to Wear, baseline profiles and the swarm library.
if (rootDir.absolutePath.startsWith("/app/projects/")) {
    subprojects {
        tasks.withType<org.gradle.api.tasks.Delete>().configureEach {
            if (name == "clean") enabled = false
        }
    }
}

// The qualified root task :assembleDebug aggregates the phone and its checks.
// An unqualified assembleDebug selector also visits matching Wear tasks.
if (rootDir.absolutePath.startsWith("/app/projects/")) {
    tasks.register("assembleDebug") {
        dependsOn(":app:assembleDebug")
    }
}
