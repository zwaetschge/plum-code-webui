#!/usr/bin/env python3
"""Stable Plum Vocarium audio API helper with GPU preflight checks.

This script intentionally uses only the Python standard library so it can run
from Codex shells without installing dependencies.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any


API_URL = os.environ.get("VOCARIUM_API_URL", "http://localhost:8280").rstrip("/")
API_CONTAINER = os.environ.get("VOCARIUM_API_CONTAINER", "vocarium-api")
TTS_CONTAINER = os.environ.get("VOCARIUM_TTS_CONTAINER", "qwen3-tts")
GPUTASKS_URL = os.environ.get("GPUTASKS_URL", "http://host.docker.internal:3080").rstrip("/")
GPUTASKS_CONTAINER = os.environ.get("GPUTASKS_CONTAINER", "gpu-task-manager")
REMOTE_USER = os.environ.get("VOCARIUM_USER", "plum-cli")
STACK_DIR = os.environ.get("VOCARIUM_STACK_DIR", "/mnt/user/AI/plum-code/voxtral")
MCP_SERVER = os.environ.get("VOCARIUM_MCP_SERVER", "/app/scripts/mcp-servers/vocarium.mjs")
MAINTENANCE_ENABLED = os.environ.get("VOCARIUM_MAINTENANCE_ENABLED", "").lower() in {
    "1",
    "true",
    "yes",
    "on",
}
TRANSPORT = os.environ.get("VOCARIUM_TRANSPORT", "auto").lower()
if TRANSPORT not in {"auto", "http", "docker"}:
    raise RuntimeError("VOCARIUM_TRANSPORT must be auto, http, or docker")

CORE_MCP_TOOLS = {
    "vocarium_health",
    "vocarium_gpu_status",
    "vocarium_preflight",
    "vocarium_voices",
    "vocarium_tts",
    "vocarium_sfx",
    "vocarium_music",
    "vocarium_transcribe",
}

MAINTENANCE_MCP_TOOLS = {
    "vocarium_stack_status",
    "vocarium_tts_worker_smoke",
    "vocarium_podcast_smoke",
    "vocarium_integration_check",
}

EXPECTED_MCP_TOOLS = CORE_MCP_TOOLS | (
    MAINTENANCE_MCP_TOOLS if MAINTENANCE_ENABLED else set()
)

ESTIMATED_MIB = {
    # OmniVoice (Qwen3-TTS, which needed ~8.5 GB, is retired).
    "tts": 4000,
    "asr": 2500,
    "music": 8000,
    "sfx": 7000,
}

SERVICE_CONTAINERS = {
    "tts": {"omnivoice-tts", "qwen3-tts"},
    "asr": {"whisper-stt", "qwen3-asr"},
    "music": {"acestep"},
    "sfx": {"mmaudio"},
}


def _json_dump(data: Any) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=True))


def require_maintenance() -> None:
    if not MAINTENANCE_ENABLED:
        raise RuntimeError(
            "administrative maintenance is disabled; set "
            "VOCARIUM_MAINTENANCE_ENABLED=1 in the server environment"
        )


def _http_request(
    url: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = 600,
) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, data=body, method=method)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read()


def _docker_gateway_request(
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = 600,
) -> tuple[int, dict[str, str], bytes]:
    code = r"""
import base64, json, sys, urllib.error, urllib.request
payload = json.loads(sys.stdin.read())
method = payload["method"]
path = payload["path"]
body = base64.b64decode(payload.get("body_b64", ""))
headers = payload.get("headers", {})
req = urllib.request.Request(
    "http://127.0.0.1:8280" + path,
    data=body if body else None,
    method=method,
)
for key, value in headers.items():
    req.add_header(key, value)
try:
    with urllib.request.urlopen(req, timeout=float(payload.get("timeout", 600))) as resp:
        status, out_headers, out_body = resp.status, dict(resp.headers), resp.read()
except urllib.error.HTTPError as exc:
    status, out_headers, out_body = exc.code, dict(exc.headers), exc.read()
print(json.dumps({
    "status": status,
    "headers": out_headers,
    "body_b64": base64.b64encode(out_body).decode("ascii"),
}))
"""
    payload = {
        "method": method,
        "path": path,
        "body_b64": base64.b64encode(body or b"").decode("ascii"),
        "headers": headers or {},
        "timeout": timeout,
    }
    proc = subprocess.run(
        ["docker", "exec", "-i", API_CONTAINER, "python", "-c", code],
        capture_output=True,
        input=json.dumps(payload),
        text=True,
        timeout=timeout + 10,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    data = json.loads(proc.stdout)
    return data["status"], data["headers"], base64.b64decode(data["body_b64"])


def _docker_container_request(
    container: str,
    base_url: str,
    path: str,
    *,
    method: str = "GET",
    headers: dict[str, str] | None = None,
    body: bytes | None = None,
    timeout: int = 600,
) -> tuple[int, dict[str, str], bytes]:
    code = r"""
import base64, json, sys, urllib.error, urllib.request
payload = json.loads(sys.stdin.read())
body = base64.b64decode(payload.get("body_b64", ""))
req = urllib.request.Request(
    payload["base_url"].rstrip("/") + payload["path"],
    data=body if body else None,
    method=payload["method"],
)
for key, value in payload.get("headers", {}).items():
    req.add_header(key, value)
try:
    with urllib.request.urlopen(req, timeout=float(payload.get("timeout", 600))) as resp:
        status, out_headers, out_body = resp.status, dict(resp.headers), resp.read()
except urllib.error.HTTPError as exc:
    status, out_headers, out_body = exc.code, dict(exc.headers), exc.read()
print(json.dumps({
    "status": status,
    "headers": out_headers,
    "body_b64": base64.b64encode(out_body).decode("ascii"),
}))
"""
    payload = {
        "base_url": base_url,
        "method": method,
        "path": path,
        "body_b64": base64.b64encode(body or b"").decode("ascii"),
        "headers": headers or {},
        "timeout": timeout,
    }
    proc = subprocess.run(
        ["docker", "exec", "-i", container, "python", "-c", code],
        capture_output=True,
        input=json.dumps(payload),
        text=True,
        timeout=timeout + 10,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    data = json.loads(proc.stdout)
    return data["status"], data["headers"], base64.b64decode(data["body_b64"])


def gateway_request(
    path: str,
    *,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    body: bytes | None = None,
    content_type: str | None = None,
    timeout: int = 600,
) -> tuple[int, dict[str, str], bytes]:
    headers = {"Remote-User": REMOTE_USER}
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    elif content_type:
        headers["Content-Type"] = content_type

    if TRANSPORT == "docker":
        return _docker_gateway_request(
            path,
            method=method,
            headers=headers,
            body=body,
            timeout=timeout,
        )
    try:
        return _http_request(
            API_URL + path,
            method=method,
            headers=headers,
            body=body,
            timeout=timeout,
        )
    except Exception:
        if TRANSPORT == "http":
            raise
        # Fixed API proxy only; this never accepts an arbitrary command.
        return _docker_gateway_request(
            path,
            method=method,
            headers=headers,
            body=body,
            timeout=timeout,
        )


def _docker_gputasks(path: str = "/api/v1/status") -> dict[str, Any]:
    js = (
        "fetch('http://127.0.0.1:3000" + path + "')"
        ".then(r=>r.text().then(t=>{console.log(t); if(!r.ok) process.exit(2)}))"
        ".catch(e=>{console.error(e); process.exit(1)})"
    )
    proc = subprocess.run(
        ["docker", "exec", "-i", GPUTASKS_CONTAINER, "node", "-e", js],
        capture_output=True,
        text=True,
        timeout=20,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
    return json.loads(proc.stdout)


def gpu_status() -> dict[str, Any]:
    if TRANSPORT != "docker" and GPUTASKS_URL:
        try:
            status, _, body = _http_request(GPUTASKS_URL + "/api/v1/status", timeout=10)
            if status < 400:
                return json.loads(body)
        except Exception:
            if TRANSPORT == "http":
                raise
    # Fixed read-only status proxy; arbitrary Docker commands remain maintenance-only.
    return _docker_gputasks("/api/v1/status")


def _is_5060(gpu: dict[str, Any]) -> bool:
    return "5060" in (gpu.get("name") or "")


def _is_3060(gpu: dict[str, Any]) -> bool:
    return "3060" in (gpu.get("name") or "")


def _comfy_active(gpu: dict[str, Any]) -> bool:
    for proc in gpu.get("processes", []):
        container = proc.get("container") or {}
        haystack = " ".join(
            str(x)
            for x in [
                container.get("name"),
                container.get("image"),
                proc.get("command"),
                proc.get("name"),
            ]
            if x
        ).lower()
        if "comfyui" in haystack:
            return True
    return False


def _container_name(proc: dict[str, Any]) -> str:
    container = proc.get("container") or {}
    return str(container.get("name") or proc.get("containerName") or "").lower()


def _service_used_mib(gpu: dict[str, Any], kind: str) -> int:
    containers = SERVICE_CONTAINERS.get(kind, set())
    total = 0
    for proc in gpu.get("processes", []):
        if _container_name(proc) in containers:
            total += int(proc.get("gpu_memory") or proc.get("gpuMemoryUsed") or 0)
    return total


def _service_resident(gpu: dict[str, Any], kind: str) -> bool:
    """The engine already holds its VRAM on this GPU (OmniVoice stays loaded)."""
    containers = SERVICE_CONTAINERS.get(kind, set())
    return any(_container_name(proc) in containers for proc in gpu.get("processes", []))


def preflight(kind: str, target: str = "auto") -> dict[str, Any]:
    data = gpu_status()
    gpus = data.get("gpus", [])
    need = ESTIMATED_MIB[kind]
    candidates = []

    for gpu in gpus:
        memory = gpu.get("memory") or {}
        free = int(memory.get("free") or 0)
        used = int(memory.get("used") or 0)
        reclaimable = _service_used_mib(gpu, kind)
        effective_free = free + reclaimable
        protected = _is_5060(gpu) and (_comfy_active(gpu) or used > 1024)
        reasons = []
        if protected:
            reasons.append("RTX 5060 Ti is protected because ComfyUI or other VRAM use is active")
        resident = _service_resident(gpu, kind)
        if effective_free < need and not resident:
            reasons.append(
                f"only {free} MiB free plus {reclaimable} MiB reclaimable, "
                f"estimated need is {need} MiB"
            )
        allowed = not reasons
        candidates.append(
            {
                "index": gpu.get("index"),
                "name": gpu.get("name"),
                "free_mib": free,
                "effective_free_mib": effective_free,
                "reclaimable_mib": reclaimable,
                "resident": resident,
                "used_mib": used,
                "comfy_active": _comfy_active(gpu),
                "allowed": allowed,
                "reasons": reasons,
            }
        )

    if target != "auto":
        selected = [
            c for c in candidates
            if str(c["index"]) == target
            or (target == "3060" and "3060" in c["name"])
            or (target == "5060" and "5060" in c["name"])
        ]
    else:
        selected = sorted(
            candidates,
            key=lambda c: (
                not ("3060" in c["name"]),
                not c["allowed"],
                -int(c["free_mib"]),
            ),
        )[:1]

    chosen = selected[0] if selected else None
    return {
        "kind": kind,
        "estimated_need_mib": need,
        "allowed": bool(chosen and chosen["allowed"]),
        "selected": chosen,
        "gpus": candidates,
    }


def require_preflight(kind: str) -> None:
    decision = preflight(kind)
    if not decision["allowed"]:
        _json_dump(decision)
        raise SystemExit(2)


def parse_json_response(status: int, body: bytes) -> Any:
    text = body.decode("utf-8", errors="replace")
    if status >= 400:
        raise RuntimeError(f"HTTP {status}: {text[:1000]}")
    return json.loads(text)


def write_binary_response(status: int, headers: dict[str, str], body: bytes, out: str) -> None:
    if status >= 400:
        raise RuntimeError(f"HTTP {status}: {body.decode(errors='replace')[:1000]}")
    Path(out).write_bytes(body)
    print(json.dumps({"out": out, "bytes": len(body), "content_type": headers.get("Content-Type")}))


def gateway_json(
    path: str,
    *,
    method: str = "GET",
    payload: dict[str, Any] | None = None,
    timeout: int = 600,
    allow_error: bool = False,
) -> tuple[int, Any]:
    status, _, body = gateway_request(path, method=method, json_body=payload, timeout=timeout)
    text = body.decode("utf-8", errors="replace")
    try:
        parsed: Any = json.loads(text)
    except Exception:
        parsed = text
    if status >= 400 and not allow_error:
        raise RuntimeError(f"HTTP {status}: {text[:1000]}")
    return status, parsed


def multipart_body(fields: dict[str, str], files: dict[str, Path]) -> tuple[bytes, str]:
    boundary = "----vocarium-" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        chunks.append(str(value).encode())
        chunks.append(b"\r\n")
    for name, path in files.items():
        data = path.read_bytes()
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        chunks.append(f"--{boundary}\r\n".encode())
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"; filename="{path.name}"\r\n'.encode()
        )
        chunks.append(f"Content-Type: {ctype}\r\n\r\n".encode())
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def cmd_health(_: argparse.Namespace) -> None:
    checks = {}
    for path in [
        "/api/health",
        "/api/queue/status",
        "/api/resources/status",
        "/api/music/health",
        "/api/sfx/health",
    ]:
        status, _, body = gateway_request(path, timeout=30)
        try:
            checks[path] = {"status": status, "body": json.loads(body)}
        except Exception:
            checks[path] = {"status": status, "body": body.decode(errors="replace")}
    _json_dump(checks)


def cmd_stack_status(_: argparse.Namespace) -> None:
    require_maintenance()
    proc = subprocess.run(
        ["docker", "compose", "ps"],
        cwd=STACK_DIR,
        capture_output=True,
        text=True,
        timeout=30,
    )
    _json_dump(
        {
            "cwd": STACK_DIR,
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
        }
    )
    if proc.returncode != 0:
        raise SystemExit(proc.returncode)


def _run_check(
    cmd: list[str],
    *,
    timeout: int = 30,
    env: dict[str, str] | None = None,
    input_text: str | None = None,
) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            input=input_text,
            timeout=timeout,
            env=env,
        )
        return {
            "cmd": cmd,
            "returncode": proc.returncode,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
            "passed": proc.returncode == 0,
        }
    except Exception as exc:
        return {"cmd": cmd, "error": str(exc), "passed": False}


def _mcp_handshake_check(mcp_path: Path) -> dict[str, Any]:
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        {"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ]
    input_text = "\n".join(json.dumps(item) for item in messages) + "\n"
    result = _run_check(["node", str(mcp_path)], timeout=15, input_text=input_text)
    parsed: list[dict[str, Any]] = []
    for line in str(result.get("stdout") or "").splitlines():
        try:
            parsed.append(json.loads(line))
        except Exception:
            pass
    tools: set[str] = set()
    for msg in parsed:
        body = msg.get("result") or {}
        if isinstance(body, dict) and isinstance(body.get("tools"), list):
            tools = {str(tool.get("name")) for tool in body["tools"] if tool.get("name")}
    missing = sorted(EXPECTED_MCP_TOOLS - tools)
    result.update(
        {
            "tools": sorted(tools),
            "missing_tools": missing,
            "passed": bool(result.get("passed")) and not missing,
        }
    )
    return result


def cmd_integration_check(args: argparse.Namespace) -> None:
    require_maintenance()
    helper_path = Path(__file__).resolve()
    mcp_path = Path(args.mcp_path or MCP_SERVER)
    config_paths = [
        Path("/home/node/.claude/settings.json"),
        Path("/home/node/.codex/config.toml"),
    ]

    pycache_dir = tempfile.mkdtemp(prefix="vocarium-pycache-")
    py_env = os.environ.copy()
    py_env["PYTHONPYCACHEPREFIX"] = pycache_dir
    try:
        python_syntax = _run_check(
            [sys.executable, "-m", "py_compile", str(helper_path)],
            timeout=30,
            env=py_env,
        )
    finally:
        shutil.rmtree(pycache_dir, ignore_errors=True)

    configs: dict[str, Any] = {}
    for path in config_paths:
        if not path.exists():
            configs[str(path)] = {"exists": False, "passed": True}
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        checks = {
            "exists": True,
            "has_vocarium": "vocarium" in text,
            "has_mcp_path": "vocarium.mjs" in text,
        }
        checks["passed"] = all(checks.values())
        configs[str(path)] = checks

    result = {
        "paths": {
            "helper": {"path": str(helper_path), "exists": helper_path.exists()},
            "mcp_server": {"path": str(mcp_path), "exists": mcp_path.exists()},
        },
        "python_syntax": python_syntax,
        "node_syntax": _run_check(["node", "--check", str(mcp_path)], timeout=30)
        if mcp_path.exists()
        else {"passed": False, "error": "MCP server missing"},
        "configs": configs,
        "mcp_handshake": _mcp_handshake_check(mcp_path)
        if mcp_path.exists()
        else {"passed": False, "error": "MCP server missing"},
    }
    result["passed"] = (
        result["paths"]["helper"]["exists"]
        and result["paths"]["mcp_server"]["exists"]
        and result["python_syntax"].get("passed")
        and result["node_syntax"].get("passed")
        and all(item.get("passed") for item in configs.values())
        and result["mcp_handshake"].get("passed")
    )
    _json_dump(result)
    if not result["passed"]:
        raise SystemExit(2)


def cmd_gpu_status(_: argparse.Namespace) -> None:
    _json_dump(gpu_status())


def cmd_preflight(args: argparse.Namespace) -> None:
    decision = preflight(args.kind, args.target)
    _json_dump(decision)
    if not decision["allowed"]:
        raise SystemExit(2)


def cmd_voices(args: argparse.Namespace) -> None:
    query = ""
    if args.source:
        query = "?source=" + urllib.parse.quote(args.source)
    status, _, body = gateway_request("/v1/voices" + query, timeout=60)
    _json_dump(parse_json_response(status, body))


def cmd_tts(args: argparse.Namespace) -> None:
    require_preflight("tts")
    endpoint = {
        "clone": "/v1/audio/speech",
        "custom": "/v1/audio/speech/custom",
        "designed": "/v1/audio/speech/designed",
    }[args.source]
    payload = {
        "model": args.model,
        "input": args.text,
        "voice": args.voice,
        "response_format": args.format,
    }
    status, headers, body = gateway_request(endpoint, method="POST", json_body=payload)
    write_binary_response(status, headers, body, args.out)


def cmd_tts_worker_smoke(args: argparse.Namespace) -> None:
    require_maintenance()
    if not args.skip_preflight and not args.invalid_format_check:
        require_preflight("tts")

    response_format = "invalid-format" if args.invalid_format_check else args.format
    payload = {
        "text": args.text,
        "speaker": args.speaker,
        "language": args.language,
        "instruct": args.instruct or None,
        "response_format": response_format,
    }
    body = json.dumps(payload).encode("utf-8")
    status, headers, resp = _docker_container_request(
        TTS_CONTAINER,
        "http://127.0.0.1:8880",
        "/v1/audio/speech/custom",
        method="POST",
        headers={"Content-Type": "application/json"},
        body=body,
        timeout=args.timeout,
    )
    if args.invalid_format_check:
        _json_dump(
            {
                "status": status,
                "expected_status": 400,
                "passed": status == 400,
                "body": resp.decode("utf-8", errors="replace")[:1000],
            }
        )
        if status != 400:
            raise SystemExit(2)
        return
    write_binary_response(status, headers, resp, args.out)


def cmd_sfx(args: argparse.Namespace) -> None:
    require_preflight("sfx")
    payload = {
        "prompt": args.prompt,
        "negative_prompt": args.negative_prompt,
        "duration": args.duration,
        "cfg_strength": args.cfg_strength,
        "num_steps": args.num_steps,
    }
    status, headers, body = gateway_request("/api/sfx/generate", method="POST", json_body=payload)
    write_binary_response(status, headers, body, args.out)


def cmd_podcast_smoke(args: argparse.Namespace) -> None:
    require_maintenance()
    host_id = ""
    podcast_id = ""
    result: dict[str, Any] = {"user": REMOTE_USER, "steps": []}

    try:
        status, host = gateway_json(
            "/api/hosts",
            method="POST",
            payload={
                "name": args.host_name,
                "role": "host",
                "personality": "Temporary integration-smoke host.",
                "speaking_style": "Clear and concise.",
            },
            timeout=60,
        )
        host_id = host["id"]
        result["steps"].append({"create_host": status, "id": host_id})

        status, podcast = gateway_json(
            "/api/podcasts",
            method="POST",
            payload={
                "topic": args.topic,
                "format": "dialog",
                "duration": "short",
                "language": "English",
                "audio_format": "wav",
                "disfluency_level": 0,
                "host_ids": [host_id],
            },
            timeout=60,
        )
        podcast_id = podcast["id"]
        result["steps"].append({"create_podcast": status, "id": podcast_id})

        status, invalid = gateway_json(
            f"/api/podcasts/{podcast_id}",
            method="PATCH",
            payload={"audio_format": "flac"},
            timeout=60,
            allow_error=True,
        )
        result["steps"].append(
            {
                "invalid_audio_format_status": status,
                "passed": status == 400,
                "body": invalid,
            }
        )
        if status != 400:
            raise RuntimeError(f"expected invalid audio_format to return 400, got {status}")
    finally:
        cleanup: list[dict[str, Any]] = []
        if podcast_id:
            status, body = gateway_json(
                f"/api/podcasts/{podcast_id}",
                method="DELETE",
                timeout=60,
                allow_error=True,
            )
            cleanup.append({"delete_podcast": status, "body": body})
        if host_id:
            status, body = gateway_json(
                f"/api/hosts/{host_id}",
                method="DELETE",
                timeout=60,
                allow_error=True,
            )
            cleanup.append({"delete_host": status, "body": body})
        result["cleanup"] = cleanup

    result["passed"] = all(
        step.get("passed", True) for step in result["steps"]
    ) and all(int(item.get("delete_podcast", item.get("delete_host", 200))) < 500 for item in result["cleanup"])
    _json_dump(result)


def _music_result_path(data: dict[str, Any]) -> str:
    result = data.get("result", data)
    items = result.get("data", []) if isinstance(result, dict) else []
    if not items:
        raise RuntimeError(f"music result has no data: {data}")
    raw = items[0].get("result")
    parsed = json.loads(raw) if isinstance(raw, str) else raw
    first = parsed[0] if isinstance(parsed, list) else parsed
    file_ref = first.get("file") if isinstance(first, dict) else None
    if not file_ref:
        raise RuntimeError(f"music result missing file: {first}")
    if file_ref.startswith("/v1/audio?"):
        return urllib.parse.parse_qs(urllib.parse.urlparse(file_ref).query)["path"][0]
    return file_ref


def cmd_music(args: argparse.Namespace) -> None:
    require_preflight("music")
    payload = {
        "prompt": args.prompt,
        "lyrics": args.lyrics,
        "audio_duration": args.duration,
        "thinking": args.thinking,
        "audio_format": args.format,
        "batch_size": 1,
    }
    status, _, body = gateway_request("/api/music/generate", method="POST", json_body=payload, timeout=1200)
    data = parse_json_response(status, body)
    path = _music_result_path(data)
    query = urllib.parse.urlencode({"path": path})
    status, headers, audio = gateway_request("/api/music/audio?" + query, timeout=300)
    write_binary_response(status, headers, audio, args.out)


def cmd_transcribe(args: argparse.Namespace) -> None:
    require_preflight("asr")
    body, content_type = multipart_body(
        {"model": args.model, "response_format": args.response_format},
        {"file": Path(args.file)},
    )
    status, _, resp = gateway_request(
        "/v1/audio/transcriptions",
        method="POST",
        body=body,
        content_type=content_type,
        timeout=900,
    )
    if args.response_format == "text":
        text = resp.decode("utf-8", errors="replace")
    else:
        text = json.dumps(parse_json_response(status, resp), indent=2, ensure_ascii=True)
    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(json.dumps({"out": args.out, "chars": len(text)}))
    else:
        print(text)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Vocarium audio API helper",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent(
            """\
            Environment:
              VOCARIUM_API_URL       default http://localhost:8280
              VOCARIUM_API_CONTAINER default vocarium-api
              VOCARIUM_USER          session-derived by the MCP; fallback plum-cli
              GPUTASKS_URL           default http://host.docker.internal:3080
              GPUTASKS_CONTAINER     default gpu-task-manager
              VOCARIUM_TRANSPORT     auto, http, or docker (default auto)
              VOCARIUM_MAINTENANCE_ENABLED=1 enables direct Docker/admin commands
            """
        ),
    )
    sub = parser.add_subparsers(required=True)

    p = sub.add_parser("health")
    p.set_defaults(func=cmd_health)

    p = sub.add_parser("stack-status")
    p.set_defaults(func=cmd_stack_status)

    p = sub.add_parser("integration-check")
    p.add_argument("--mcp-path", default=MCP_SERVER)
    p.set_defaults(func=cmd_integration_check)

    p = sub.add_parser("gpu-status")
    p.set_defaults(func=cmd_gpu_status)

    p = sub.add_parser("preflight")
    p.add_argument("--kind", choices=sorted(ESTIMATED_MIB), required=True)
    p.add_argument("--target", default="auto", help="auto, 3060, 5060, or GPU index")
    p.set_defaults(func=cmd_preflight)

    p = sub.add_parser("voices")
    p.add_argument("--source", choices=["clone", "custom", "design"])
    p.set_defaults(func=cmd_voices)

    p = sub.add_parser("tts")
    p.add_argument("--text", required=True)
    p.add_argument("--voice", default="default")
    p.add_argument("--source", choices=["clone", "custom", "designed"], default="clone")
    p.add_argument("--model", default="tts-1")
    p.add_argument("--format", default="wav")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_tts)

    p = sub.add_parser("tts-worker-smoke")
    p.add_argument("--text", default="Kurzer Test.")
    p.add_argument("--speaker", default="Vivian")
    p.add_argument("--language", default="German")
    p.add_argument("--instruct", default="")
    p.add_argument("--format", default="wav")
    p.add_argument("--out", default="/tmp/vocarium-tts-worker-smoke.wav")
    p.add_argument("--timeout", type=int, default=900)
    p.add_argument("--invalid-format-check", action="store_true")
    p.add_argument("--skip-preflight", action="store_true")
    p.set_defaults(func=cmd_tts_worker_smoke)

    p = sub.add_parser("sfx")
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative-prompt", default="speech, music")
    p.add_argument("--duration", type=float, default=2.0)
    p.add_argument("--cfg-strength", type=float, default=4.5)
    p.add_argument("--num-steps", type=int, default=25)
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_sfx)

    p = sub.add_parser("podcast-smoke")
    p.add_argument("--topic", default="Plum Code integration smoke")
    p.add_argument("--host-name", default="Plum Smoke Host")
    p.set_defaults(func=cmd_podcast_smoke)

    p = sub.add_parser("music")
    p.add_argument("--prompt", required=True)
    p.add_argument("--lyrics", default="")
    p.add_argument("--duration", type=int, default=10)
    p.add_argument("--thinking", action=argparse.BooleanOptionalAction, default=False)
    p.add_argument("--format", default="wav")
    p.add_argument("--out", required=True)
    p.set_defaults(func=cmd_music)

    p = sub.add_parser("transcribe")
    p.add_argument("--file", required=True)
    p.add_argument("--model", default="whisper-1")
    p.add_argument("--response-format", choices=["json", "text"], default="json")
    p.add_argument("--out")
    p.set_defaults(func=cmd_transcribe)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
        return 0
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
