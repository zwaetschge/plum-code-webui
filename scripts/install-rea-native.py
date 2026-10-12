#!/usr/bin/env python3
"""Install the pinned REA native backend into Plum's persistent npm volume.

Run inside the Linux x86-64 Alpine Plum container:
    python3 scripts/install-rea-native.py
Then add GHIDRA_INSTALL_DIR and JAVA_HOME to the shared rea MCP environment.
"""

import concurrent.futures
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = Path("/home/node/.npm-global/tools/rea-native")
DOWNLOADS = (
    (
        "ghidra_12.1.4_PUBLIC_20260921.zip",
        "https://github.com/NationalSecurityAgency/ghidra/releases/download/"
        "Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20260921.zip",
        "ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db",
    ),
    (
        "zulu21.52.203-ca-jdk21.0.12.1-linux_musl_x64.tar.gz",
        "https://cdn.azul.com/zulu/bin/"
        "zulu21.52.203-ca-jdk21.0.12.1-linux_musl_x64.tar.gz",
        "f2b26df82d22910cdd7e5171517edbc10e5fc22657bfe85dd0aa75cbdaec01fd",
    ),
)


def download(item):
    name, url, expected = item
    archive = ROOT / "downloads" / name
    if not archive.exists():
        temporary = archive.with_name(name + ".partial")
        with urllib.request.urlopen(url, timeout=60) as response:
            with temporary.open("wb") as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
        temporary.rename(archive)
    with archive.open("rb") as source:
        actual = hashlib.file_digest(source, "sha256").hexdigest()
    if actual != expected:
        raise RuntimeError(f"SHA-256 mismatch for {name}")
    print(f"Verified {name}", flush=True)
    return archive


def extract(archive):
    if archive.suffix == ".zip":
        with zipfile.ZipFile(archive) as source:
            for member in source.infolist():
                target = (ROOT / member.filename).resolve()
                if not target.is_relative_to(ROOT.resolve()):
                    raise RuntimeError(f"Invalid archive member: {member.filename}")
                source.extract(member, ROOT)
                mode = member.external_attr >> 16
                if mode:
                    os.chmod(target, mode)
    else:
        with tarfile.open(archive) as source:
            source.extractall(ROOT, filter="data")
    print(f"Extracted {archive.name}", flush=True)


def install_procps():
    # REA verifies ownership through procps' ps flags, which BusyBox lacks.
    # apk fetch validates the distro packages without changing the container OS.
    packages = ROOT / "procps-packages"
    packages.mkdir(exist_ok=True)
    subprocess.run(
        ["apk", "fetch", "--no-cache", "--recursive", "--output", str(packages),
         "procps-ng=4.0.6-r0", "libproc2=4.0.6-r0"],
        check=True,
    )
    destination = ROOT / "procps"
    (destination / "bin").mkdir(parents=True, exist_ok=True)
    (destination / "lib").mkdir(exist_ok=True)
    for archive, member, target in (
        ("procps-ng-4.0.6-r0.apk", "bin/ps", destination / "ps"),
        ("libproc2-4.0.6-r0.apk", "usr/lib/libproc2.so.1.0.1",
         destination / "lib/libproc2.so.1"),
    ):
        with tarfile.open(packages / archive) as source:
            with source.extractfile(member) as content, target.open("wb") as output:
                shutil.copyfileobj(content, output)
    (destination / "ps").chmod(0o755)
    wrapper = destination / "bin/ps"
    wrapper.write_text(
        '#!/bin/sh\n'
        f'LD_LIBRARY_PATH="{destination / "lib"}'
        '${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" '
        f'exec "{destination / "ps"}" "$@"\n'
    )
    wrapper.chmod(0o755)
    subprocess.run([str(wrapper), "--version"], check=True)


def main():
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise RuntimeError("This installer targets Plum's Linux x86-64 container")
    if not Path("/lib/ld-musl-x86_64.so.1").exists():
        raise RuntimeError("This JDK build requires Alpine/musl")
    (ROOT / "downloads").mkdir(parents=True, exist_ok=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        archives = list(pool.map(download, DOWNLOADS))
    for archive in archives:
        extract(archive)
    install_procps()
    print(f"GHIDRA_INSTALL_DIR={ROOT / 'ghidra_12.1.4_PUBLIC'}")
    print(f"JAVA_HOME={ROOT / 'zulu21.52.203-ca-jdk21.0.12.1-linux_musl_x64'}")
    print(f"Prepend to REA's PATH: {ROOT / 'procps/bin'}")


if __name__ == "__main__":
    main()
