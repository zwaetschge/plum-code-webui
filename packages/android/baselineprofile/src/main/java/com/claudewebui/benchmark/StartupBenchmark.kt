package com.claudewebui.benchmark

import android.content.Intent
import android.net.Uri
import androidx.benchmark.macro.BaselineProfileMode
import androidx.benchmark.macro.CompilationMode
import androidx.benchmark.macro.StartupMode
import androidx.benchmark.macro.StartupTimingMetric
import androidx.benchmark.macro.junit4.BaselineProfileRule
import androidx.benchmark.macro.junit4.MacrobenchmarkRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

private const val PACKAGE = "com.claudewebui.app"

@RunWith(AndroidJUnit4::class)
class BaselineProfileGenerator {
    @get:Rule val profile = BaselineProfileRule()

    @Test fun startup() = profile.collect(PACKAGE, includeInStartupProfile = true) {
        pressHome()
        startActivityAndWait()
        device.waitForIdle()
    }

    /** Optional authenticated session, supplied by the developer; never embeds account data. */
    @Test fun chatScroll() {
        val session = InstrumentationRegistry.getArguments().getString("plum.sessionId")
        org.junit.Assume.assumeTrue("Provide plum.sessionId for an authenticated chat journey", !session.isNullOrBlank())
        profile.collect(PACKAGE) {
            startActivityAndWait(Intent(Intent.ACTION_VIEW, Uri.parse("claudewebui://session/$session")).setPackage(PACKAGE))
            device.waitForIdle()
            val x = device.displayWidth / 2
            val bottom = device.displayHeight * 3 / 4
            val top = device.displayHeight / 3
            repeat(3) { device.swipe(x, top, x, bottom, 20); device.waitForIdle() }
        }
    }
}

@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val benchmark = MacrobenchmarkRule()

    @Test fun coldWithoutProfile() = measure(CompilationMode.None())
    @Test fun coldWithProfile() = measure(CompilationMode.Partial(BaselineProfileMode.Require))

    private fun measure(compilation: CompilationMode) = benchmark.measureRepeated(
        packageName = PACKAGE,
        metrics = listOf(StartupTimingMetric()),
        compilationMode = compilation,
        startupMode = StartupMode.COLD,
        iterations = 5,
        setupBlock = { pressHome() },
    ) { startActivityAndWait() }
}
