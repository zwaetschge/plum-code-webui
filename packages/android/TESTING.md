# Android verification

The Android Builder project is `796aa064-f0bb-4031-bbf2-2da83a4bca94`.
Build, install and device operations in Plum use the `android-builder` MCP.
Pass the session's selected serial to every device tool.

## Build and unit tests

Sync `packages/android` into the project's reported `workspacePath` before
calling `android_build` with `variant: "debug"`. Preserve the builder-owned
`app/src` directory: copy the contents of `app/src/main` into it. On the current
deployment the test sources are copied into `plum-tests` and `plum-ui-tests`
beside `app`, and the builder copy's `app/build.gradle.kts` adds those directories
to the `test` and `androidTest` source sets. These mount-specific paths do not
belong in the portable project configuration.

`assembleDebug` runs the JVM regression suite (`testDebugUnitTest`) and then
builds the Compose/Room instrumentation APK (`assembleDebugAndroidTest`). A
successful build compiles the device tests; it does not execute them. JVM test
results are in `app/build/test-results/testDebugUnitTest`.

The regression suite covers durable drafts and delivery, message identity,
read positions, provider parsing, errors and cancellation, tool-log filtering,
and the bounded diagnostic breadcrumb buffer.

`ChatSynchronizationTest` covers explicit main-thread identity, interrupted
streams, idle reconnects, reconnect snapshot replacement and superseded-history
cancellation handling.

## Device tests and screenshots

Install the debug app and `app-debug-androidTest.apk` with `android_install`,
passing each artifact's absolute builder path as `apkPath`. Clear logcat before
launch. Run the test runner through `adb_shell`:

```text
am instrument -w -r com.claudewebui.app.debug.test/androidx.test.runner.AndroidJUnitRunner
```

`ChatSurfaceTest` checks sending a follow-up while work is active, rejection of
empty sends, explicit permission answers, destructive-action restrictions and
dashboard filter selection. It captures light and dark surfaces and verifies
that the two renders differ. PNGs land in the app's external files directory
under `ui-test-screenshots`. These are render assertions and review artifacts;
they are not pixel-perfect golden comparisons.

`MessagePagingTest` exercises the generated Room PagingSource against real
SQLite: 241 messages across pages, timestamp tie ordering, session/thread/null
isolation, invalidation, retained read anchors and search-window replacement.
It also checks transactional replay-cursor writes and the protocol upgrade from
an unsafe cursor 102 to snapshot 99, followed by the previously missing message 100. Around/older snapshots, failed requests and superseded responses cannot
verify that upgrade; stale read-position writes cannot restore cursor 102.

Inspect an actual screenshot and UI hierarchy after installation. Check a
narrow window and a window with at least 840 dp available to the chat, where
Git, Checkpoints and Notes appear beside it. Check text scaling, the keyboard,
Back, a history/search jump, and background/foreground restoration. A code or
instrumentation pass alone does not establish those visual outcomes.

## Startup profiles and benchmarks

The `baselineprofile` module uses AndroidX `BaselineProfileRule` and
`MacrobenchmarkRule`, following the [Android baseline-profile workflow](https://developer.android.com/topic/performance/baselineprofiles/create-baselineprofile).
The app applies the baseline-profile plugin, imports the generator module and
keeps device generation separate from ordinary builds. The entry task for a
developer's Gradle/IDE run is `:app:generateReleaseBaselineProfile`.

`BaselineProfileGenerator.startup` records the actual launch path. To include
chat scrolling, configure the instrumentation argument `plum.sessionId` with
a session on an already authenticated test installation. The chat test is
explicitly skipped without that input. The generator never embeds credentials
or sends chat messages.

`StartupBenchmark` measures five cold starts with no compilation and five
with the installed baseline profile required. Run it on a physical device and
inspect the resulting timing JSON before claiming a startup improvement.
The checked-in hand-authored profile rules are a starting point, not measured
performance evidence; replace them with reviewed device-generated profiles.
