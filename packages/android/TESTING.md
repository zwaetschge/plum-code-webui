# Android verification

The Android Builder project is `796aa064-f0bb-4031-bbf2-2da83a4bca94`.
Build, install and device operations in Plum use the `android-builder` MCP.
Pass the session's selected serial to every device tool.

## Swarm library source sync

The assistant integration includes `swarm/` as an Android library. Copy that
whole directory together with `settings.gradle.kts`, root `build.gradle.kts`,
`gradle/libs.versions.toml` and the updated app manifest/build script into the
builder workspace before the next authorised build. Never copy the former
Schwarm app's keystore, keystore properties or APK outputs. Preserve the
builder-owned `app/src` tree. Native Matrix sign-in and device registrations are
new for the Plum installation; they cannot be copied from another app sandbox.

The imported module's unit tests belong to `:swarm:testDebugUnitTest`. The usual
app build/test suite does not automatically execute library tests. Run them via
the builder-supported test workflow, followed by device parity checks S01–S37.

## Bundled assistant workspace (1.6.0)

Build the current frontend with its local Vite tool, then run
`node scripts/sync-android-web.mjs` from the repository root before source sync.
The generated `app/src/main/assets/plum-web` directory is part of the APK; its
`bundle-manifest.json` records every asset hash. Include that directory when
copying `app/src/main` into the builder project. Do not deploy the WebUI as part
of an APK-only request.

Browser verification commands from the repository root:

```sh
plum-python packages/frontend/scripts/android-shell-browser-tests.py
PLUM_FIXTURE_URL=http://127.0.0.1:5189 PLUM_PRODUCTION_BUNDLE=1 plum-python packages/frontend/scripts/android-shell-browser-tests.py
plum-python packages/frontend/scripts/android-bootstrap-browser-tests.py
```

The source fixture must run on 5188 and the current production preview on 5189.
All API calls in these browser checks are isolated fixtures. They verify mobile
API prefixing, transient authentication, responsive pages, native screen
handoff and blob-download/media cleanup contracts. They do not test an installed
Android WebView, SAF, hardware permissions or the live backend. Add the actual
selected-device checks only when installation/launch is authorised.

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

`WorkspaceHttpCleanupTest` keeps an actual HTTP connection pooled, disposes its
client from a cancelled screen scope, and verifies that socket closure runs on
a different thread and releases the pool and dispatcher. This guards the 1.6.2
`NetworkOnMainThreadException` during chat/task navigation: closing a TLS socket
can write network data, so both cancellation and pool eviction run on IO in a
scope that survives screen disposal. Device acceptance should repeatedly enter
and leave Chat/Task after HTTPS requests, with no new `AndroidRuntime` crashes.

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

`SystemNotificationsTest` posts replies, errors, approvals and questions while an
Activity is visible, then checks Android's active notifications, deep-link intents
and inline actions. It also checks that the user's notification switch suppresses
all four types. The test grants Android 13+ notification permission for the test
app. It replaces the old in-app-banner layout test: session events now use system
notifications in both foreground and background. Manually verify delivery from a
real session, notification shade, lock screen and inline actions; OS channel and
Do Not Disturb preferences remain authoritative.

`AndroidQualityTest.sessionToolsKeepWorkVisibleAndConfigurationReachable` checks
that Tasks, active/waiting agents and model settings remain reachable in the
compact session tools menu. It requires a device run; compiling it is not a pass.

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

## Chat/Task functional regression (1.6.4)

`packages/frontend/scripts/android-auth-recovery-browser-tests.py` checks native
Chat/Task boot with a temporary 503, automatic verification retry on the original
route, and a true 401 returning to login. Retaining a token alone never authorises
protected content.

`packages/frontend/scripts/assistant-task-progress-browser-tests.py` checks that
starting a task keeps its details visible, its progress updates even when it
leaves the filtered list, and its actual result can be accepted at 390/1440 px.
Run these against the source fixture or the built production preview by setting
`PLUM_FIXTURE_URL`. These browser checks do not execute native Android WebView.

A live missing `/api/assistant/personalization` or
`/api/assistant/memory-system/status` route requires the corresponding backend
rollout. Rebuilding the APK does not add those routes to the server.
