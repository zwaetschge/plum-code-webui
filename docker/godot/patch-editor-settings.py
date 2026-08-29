#!/usr/bin/env python3
"""Point Godot's editor settings at the SDK and keystore baked into this image.

The Android exporter reads the SDK location from editor settings only -- there
is no CLI flag and no project-level override -- and the settings filename is
version-scoped (editor_settings-4.tres in some releases, -4.7.tres in others).
So rather than guessing the name, we let Godot create the file and patch
whatever it produced, falling back to writing a minimal one ourselves.
"""
import glob
import os

CONFIG_DIR = os.path.join(os.environ["XDG_CONFIG_HOME"], "godot")
SETTINGS = {
    "export/android/android_sdk_path": '"/opt/android-sdk"',
    "export/android/java_sdk_path": '"/opt/java/openjdk"',
    "export/android/debug_keystore": '"/opt/godot/debug.keystore"',
    "export/android/debug_keystore_user": '"androiddebugkey"',
    "export/android/debug_keystore_pass": '"android"',
}

os.makedirs(CONFIG_DIR, exist_ok=True)
targets = sorted(glob.glob(os.path.join(CONFIG_DIR, "editor_settings-*.tres")))
if not targets:
    targets = [os.path.join(CONFIG_DIR, "editor_settings-4.tres")]
    with open(targets[0], "w") as handle:
        handle.write('[gd_resource type="EditorSettings" format=3]\n\n[resource]\n')

for path in targets:
    with open(path) as handle:
        body = handle.read()
    for key, value in SETTINGS.items():
        if key not in body:
            body = body.rstrip("\n") + f"\n{key} = {value}\n"
    with open(path, "w") as handle:
        handle.write(body)
    print(f"patched {path}")
