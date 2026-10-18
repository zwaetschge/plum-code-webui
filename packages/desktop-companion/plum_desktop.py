#!/usr/bin/env python3
"""Plum desktop companion.

Gives a Plum session the browser extension's abilities over the whole desktop
and its native apps (Blender, GIMP, Photoshop, file manager …):

- look: screenshots, also zoomed regions; window list and the active window;
  the accessibility tree (AT-SPI) of a window as an outline with refs, search
  by text, window text, waiting for text or windows;
- show: a gliding Plum cursor, circles, boxes, arrows, underlines, pen strokes,
  labels and guide steps with an "Erledigt" button, on a transparent,
  click-through overlay above every window;
- act: real clicks, double and right clicks, typing, key combinations,
  scrolling, dragging, focusing windows and opening apps, files or URLs.

Input goes through virtual uinput devices, so it works on Wayland. KWin
scripts report the real pointer position and the window list back over DBus.
AT-SPI positions are relative to the window's client area; adding KWin's
client geometry turns them into desktop coordinates, so refs can be clicked.

The tray icon switches between Steuern (Plum may act), Nur zeigen (guide mode:
marks only) and Pausiert; Plum can switch it remotely too. While Plum acts, a
"Plum steuert · Esc stoppt" pill sits at the top; Escape on the real keyboard
or Stopp pauses at once. Per-app rules from Plum block apps (no input, blacked
out in screenshots) or ask before every input.

The tray also records demonstrations (clicks with the element under the
pointer, keys, screenshots) and sends them to the session; saved as macros
they replay by element name. Text recognition (tesseract) finds text in apps
without accessibility data.

It dials out to Plum's browser bridge with a `plum_ff_` pairing token, as a
client of kind "desktop"; the `desktop_*` MCP tools are routed to it.

Config: ~/.config/plum-desktop/config.json  {"serverUrl", "token", "label"}
Needs: PySide6, websockets, python-evdev with write access to /dev/uinput,
wl-clipboard, and spectacle (KDE) or grim for screenshots.
"""

import asyncio
import base64
import hashlib
import json
import math
import os
import platform
import select
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

# The overlay is an X11 window (via XWayland on Wayland): only there can a
# client keep itself above other windows and pass clicks through. Child
# processes (spectacle, launched apps) must not inherit that: under XWayland
# spectacle captures a different layout and apps would lose native Wayland.
CHILD_ENV = dict(os.environ)
os.environ.setdefault("QT_QPA_PLATFORM", "xcb")

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QObject, QPointF, QRect, QRectF, Qt, QTimer, Signal, Slot
from PySide6.QtDBus import QDBusConnection, QDBusInterface
from PySide6.QtGui import (
    QAction,
    QActionGroup,
    QColor,
    QFont,
    QFontMetrics,
    QGuiApplication,
    QCursor,
    QIcon,
    QImage,
    QImageReader,
    QLinearGradient,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
    QPolygonF,
)
from PySide6.QtWidgets import QApplication, QHBoxLayout, QLabel, QLineEdit, QMenu, QPushButton, QSystemTrayIcon, QVBoxLayout, QWidget, QPlainTextEdit, QComboBox, QScrollArea, QSpinBox

import websockets

VERSION = "0.6.2"
CONFIG_DIR = os.path.expanduser("~/.config/plum-desktop")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
STATE = os.path.join(CONFIG_DIR, "state.json")
SHOT_MAX_EDGE = 1568
MARK_TTL_S = 15 * 60
CURSOR_IDLE_S = 120
PILL_IDLE_S = 4
# Edge glow while Plum uses the computer: band width (logical px) and how long
# it lingers after the last tool call.
GLOW_WIDTH = 26
GLOW_LINGER_S = 4.0
# How long the agent's status line stays next to the cursor.
NOTE_TTL_S = 45
DBUS_SERVICE = "ch.zwaetschge.PlumDesktop"
COLORS = {
    "purple": "#7a4cff",
    "blue": "#1856ff",
    "red": "#ea2143",
    "green": "#07ca6b",
    "orange": "#e89558",
    "yellow": "#f5c400",
}
MODE_LABELS = {"control": "Steuern", "guide": "Nur zeigen", "paused": "Pausiert"}
# Tools that change something; blocked in guide mode.
INPUT_TOOLS = {
    "desktop_click",
    "desktop_type",
    "desktop_press_key",
    "desktop_scroll",
    "desktop_hover",
    "desktop_drag",
    "desktop_activate_window",
    "desktop_open",
    "desktop_macro_run",
}
TERMINALS = {"konsole", "org.kde.konsole", "alacritty", "kitty", "foot", "wezterm", "org.wezfurlong.wezterm", "gnome-terminal-server", "xterm", "yakuake", "ghostty", "com.mitchellh.ghostty"}


def log(*args):
    print("[plum-desktop]", *args, file=sys.stderr, flush=True)


def load_state():
    try:
        with open(STATE, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_state(state):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(STATE, "w", encoding="utf-8") as handle:
            json.dump(state, handle)
    except OSError as error:
        log("state not saved:", error)


class Stopped(RuntimeError):
    """The user pressed Escape while Plum was acting."""


# Set by the Escape key; every wait inside a running tool call checks it.
ABORT = {"set": False}


def pump(seconds):
    """Wait while keeping the overlay painting and DBus replies flowing."""
    end = time.time() + seconds
    while True:
        QApplication.processEvents()
        if ABORT["set"]:
            raise Stopped("Gestoppt: Die Desktop-Steuerung wurde pausiert oder vom Nutzer übernommen. Erst nach Weiter fortsetzen.")
        left = end - time.time()
        if left <= 0:
            return
        time.sleep(min(0.01, left))


def pump_safe(seconds):
    end = time.time() + seconds
    while time.time() < end:
        QApplication.processEvents()
        time.sleep(0.01)


def ease(t):
    return 1 - (1 - t) ** 3


# --------------------------------------------------------------------------- KWin


class KWin(QObject):
    """Runs one-shot KWin scripts; they answer through our DBus service."""
    desktop_action = Signal(str)

    def __init__(self):
        super().__init__()
        self.replies = {}
        bus = QDBusConnection.sessionBus()
        self.ok = bus.registerService(DBUS_SERVICE) and bus.registerObject(
            "/", DBUS_SERVICE, self, QDBusConnection.ExportAllSlots
        )
        if not self.ok:
            log("DBus service not registered; pointer check and windows are unavailable")

    @Slot(str, str)
    def report(self, token, payload):
        self.replies[token] = payload

    @Slot(str)
    def desktop(self, action):
        if action in ("toggle_chat", "show_chat", "hide_chat", "pause", "resume", "stop", "context"):
            self.desktop_action.emit(action)

    def run(self, body, timeout=3.0):
        """`body` is JS that ends with `reply(value)`; returns the value."""
        if not self.ok:
            raise RuntimeError("KWin-Anbindung nicht verfügbar")
        token = uuid.uuid4().hex
        script = (
            f"function reply(v) {{ callDBus({json.dumps(DBUS_SERVICE)}, '/', {json.dumps(DBUS_SERVICE)}, "
            f"'report', {json.dumps(token)}, JSON.stringify(v)); }}\n"
            f"try {{ {body} }} catch (e) {{ reply({{error: String(e)}}); }}"
        )
        path = os.path.join(tempfile.gettempdir(), f"plum-kwin-{token}.js")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(script)
        name = f"plum-{token}"
        scripting = QDBusInterface("org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting")
        try:
            answer = scripting.call("loadScript", path, name).arguments()
            if not answer or int(answer[0]) < 0:
                raise RuntimeError("KWin hat das Skript nicht geladen")
            QDBusInterface("org.kde.KWin", f"/Scripting/Script{int(answer[0])}", "org.kde.kwin.Script").call("run")
            end = time.time() + timeout
            while token not in self.replies and time.time() < end:
                pump(0.01)
            payload = self.replies.pop(token, None)
        finally:
            scripting.call("unloadScript", name)
            try:
                os.remove(path)
            except OSError:
                pass
        if payload is None:
            raise RuntimeError("KWin hat nicht geantwortet")
        value = json.loads(payload)
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(f"KWin: {value['error']}")
        return value

    def cursor(self):
        point = self.run("reply({x: workspace.cursorPos.x, y: workspace.cursorPos.y});")
        return QPointF(point["x"], point["y"])

    WINDOWS_JS = """
var list = workspace.stackingOrder || (workspace.windowList ? workspace.windowList() : workspace.clientList());
var out = [];
for (var i = 0; i < list.length; i++) {
  var w = list[i];
  if (!w.normalWindow && !w.dialog) continue;
  if (w.skipTaskbar && !w.dialog) continue;
  var g = w.frameGeometry, c = w.clientGeometry || g;
  out.push({id: String(w.internalId), caption: w.caption, cls: String(w.resourceClass), pid: w.pid,
            x: g.x, y: g.y, width: g.width, height: g.height, cx: c.x, cy: c.y,
            active: w === workspace.activeWindow, minimized: !!w.minimized});
}
"""

    def windows(self):
        return self.run(self.WINDOWS_JS + "reply(out);")

    def active_class(self):
        try:
            return self.run(
                "var w = workspace.activeWindow; reply(w ? {cls: String(w.resourceClass), caption: w.caption} : {});"
            )
        except RuntimeError:
            return {}

    def activate(self, window_id):
        return self.run(
            self.WINDOWS_JS
            + f"""
var target = null;
for (var j = 0; j < list.length; j++) if (String(list[j].internalId) === {json.dumps(window_id)}) target = list[j];
if (!target) {{ reply({{error: 'Fenster nicht gefunden'}}); }}
else {{ target.minimized = false; workspace.activeWindow = target; reply({{caption: target.caption}}); }}
"""
        )


# --------------------------------------------------------------------------- input


KEY_NAMES = {
    "enter": "KEY_ENTER", "return": "KEY_ENTER", "tab": "KEY_TAB", "esc": "KEY_ESC", "escape": "KEY_ESC",
    "backspace": "KEY_BACKSPACE", "delete": "KEY_DELETE", "del": "KEY_DELETE", "insert": "KEY_INSERT",
    "space": "KEY_SPACE", "home": "KEY_HOME", "end": "KEY_END", "pageup": "KEY_PAGEUP", "page_up": "KEY_PAGEUP",
    "prior": "KEY_PAGEUP", "pagedown": "KEY_PAGEDOWN", "page_down": "KEY_PAGEDOWN", "next": "KEY_PAGEDOWN",
    "up": "KEY_UP", "arrowup": "KEY_UP", "down": "KEY_DOWN", "arrowdown": "KEY_DOWN", "left": "KEY_LEFT",
    "arrowleft": "KEY_LEFT", "right": "KEY_RIGHT", "arrowright": "KEY_RIGHT", "menu": "KEY_COMPOSE",
    "contextmenu": "KEY_COMPOSE", "print": "KEY_SYSRQ", "printscreen": "KEY_SYSRQ", "capslock": "KEY_CAPSLOCK",
    "ctrl": "KEY_LEFTCTRL", "control": "KEY_LEFTCTRL", "shift": "KEY_LEFTSHIFT", "alt": "KEY_LEFTALT",
    "altgr": "KEY_RIGHTALT", "meta": "KEY_LEFTMETA", "super": "KEY_LEFTMETA", "win": "KEY_LEFTMETA",
    "cmd": "KEY_LEFTMETA", "command": "KEY_LEFTMETA",
}
MODIFIERS = {"KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_LEFTALT", "KEY_RIGHTALT", "KEY_LEFTMETA"}


def keyboard_layout():
    """First configured xkb layout; Swiss and German swap y and z."""
    try:
        out = subprocess.run(["kreadconfig6", "--file", "kxkbrc", "--group", "Layout", "--key", "LayoutList"],
                             capture_output=True, text=True, timeout=3).stdout.strip()
        if out:
            return out.split(",")[0]
    except (OSError, subprocess.SubprocessError):
        pass
    try:
        out = subprocess.run(["localectl", "status"], capture_output=True, text=True, timeout=3).stdout
        for line in out.splitlines():
            if "X11 Layout" in line:
                return line.split(":")[1].strip().split(",")[0]
    except (OSError, subprocess.SubprocessError):
        pass
    return "us"


class Input:
    """Virtual pointer and keyboard. The pointer is absolute: KWin maps its
    range onto the bounding box of all screens, the same area as the overlay."""

    def __init__(self, area):
        self.area = area  # QRect, logical
        self.pointer = None
        self.keyboard = None
        self.swap_yz = keyboard_layout() in ("ch", "de", "at", "cz", "hu", "sk", "si", "hr", "rs")

    def _devices(self):
        if self.pointer:
            return
        try:
            from evdev import AbsInfo, UInput, ecodes as e
        except ImportError as error:
            raise RuntimeError("python-evdev fehlt (dnf install python3-evdev)") from error
        self.e = e
        try:
            self.pointer = UInput(
                {
                    e.EV_KEY: [e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE],
                    e.EV_ABS: [(e.ABS_X, AbsInfo(0, 0, 65535, 0, 0, 0)), (e.ABS_Y, AbsInfo(0, 0, 65535, 0, 0, 0))],
                    e.EV_REL: [e.REL_WHEEL, e.REL_HWHEEL],
                },
                name="Plum Desktop Pointer",
            )
            keys = [code for name, code in e.ecodes.items() if name.startswith("KEY_") and isinstance(code, int) and code < 256]
            self.keyboard = UInput({e.EV_KEY: keys}, name="Plum Desktop Keyboard")
        except OSError as error:
            self.pointer = None
            raise RuntimeError(f"Kein Schreibzugriff auf /dev/uinput ({error})") from error
        pump(0.6)  # let the compositor pick up the new devices

    def move(self, point):
        self._devices()
        e = self.e
        x = (point.x() - self.area.x()) / max(1, self.area.width() - 1)
        y = (point.y() - self.area.y()) / max(1, self.area.height() - 1)
        self.pointer.write(e.EV_ABS, e.ABS_X, round(min(max(x, 0), 1) * 65535))
        self.pointer.write(e.EV_ABS, e.ABS_Y, round(min(max(y, 0), 1) * 65535))
        self.pointer.syn()

    def button(self, name, down):
        self._devices()
        e = self.e
        code = {"left": e.BTN_LEFT, "right": e.BTN_RIGHT, "middle": e.BTN_MIDDLE}[name]
        self.pointer.write(e.EV_KEY, code, 1 if down else 0)
        self.pointer.syn()

    def wheel(self, dx, dy):
        self._devices()
        e = self.e
        if dy:
            self.pointer.write(e.EV_REL, e.REL_WHEEL, int(dy))
        if dx:
            self.pointer.write(e.EV_REL, e.REL_HWHEEL, int(dx))
        self.pointer.syn()

    def key_code(self, name):
        self._devices()
        raw = name.strip()
        lower = raw.lower()
        if lower in KEY_NAMES:
            return getattr(self.e, KEY_NAMES[lower])
        if len(lower) == 1 and lower.isalpha() and lower.isascii():
            if self.swap_yz and lower in "yz":
                lower = "z" if lower == "y" else "y"
            return getattr(self.e, f"KEY_{lower.upper()}")
        if len(lower) == 1 and lower.isdigit():
            return getattr(self.e, f"KEY_{lower}")
        if lower.startswith("f") and lower[1:].isdigit() and 1 <= int(lower[1:]) <= 24:
            return getattr(self.e, f"KEY_{lower.upper()}")
        raise RuntimeError(f"Unbekannte Taste „{raw}“; Text und Satzzeichen mit desktop_type eingeben")

    def key(self, code, down):
        self.keyboard.write(self.e.EV_KEY, code, 1 if down else 0)
        self.keyboard.syn()

    def combo(self, spec):
        """`ctrl+shift+t`: modifiers down, last key tapped, modifiers up."""
        parts = [part for part in spec.replace(" + ", "+").split("+") if part]
        codes = [self.key_code(part) for part in parts]
        if not codes:
            return
        for code in codes[:-1]:
            self.key(code, True)
            time.sleep(0.02)
        self.key(codes[-1], True)
        time.sleep(0.03)
        self.key(codes[-1], False)
        for code in reversed(codes[:-1]):
            time.sleep(0.02)
            self.key(code, False)

    def release_all(self):
        """After a stop: no button or modifier may stay pressed."""
        if not self.pointer:
            return
        e = self.e
        for code in (e.BTN_LEFT, e.BTN_RIGHT, e.BTN_MIDDLE):
            self.pointer.write(e.EV_KEY, code, 0)
        self.pointer.syn()
        for name in ("KEY_LEFTCTRL", "KEY_LEFTSHIFT", "KEY_LEFTALT", "KEY_RIGHTALT", "KEY_LEFTMETA"):
            self.keyboard.write(e.EV_KEY, getattr(e, name), 0)
        self.keyboard.syn()

    def hold(self, modifiers, down):
        for name in modifiers:
            self.key(self.key_code(name), down)


# --------------------------------------------------------------------------- overlay


class Overlay(QWidget):
    """Full-desktop, transparent, click-through drawing surface."""

    def __init__(self, factor):
        super().__init__(
            None,
            Qt.FramelessWindowHint
            | Qt.WindowStaysOnTopHint
            | Qt.Tool
            | Qt.WindowTransparentForInput
            | Qt.X11BypassWindowManagerHint,
        )
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_TransparentForMouseEvents)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.marks = []  # dicts with kind, color, geometry, label, at
        self.cursor = None  # (QPointF, label)
        self.cursor_at = 0.0
        self.hide_cursor = False
        # Edge glow: lit while Plum uses the computer, fades after GLOW_LINGER_S.
        self.glow_enabled = True
        self.active_until = 0.0
        self.glow_started = 0.0
        self.focus_screen = None
        # What the agent says it is doing: (text, session name, at).
        self.note = None
        self._note_rect = QRectF()
        self.glow_timer = QTimer(self)
        self.glow_timer.timeout.connect(self._glow_tick)
        geometry = QGuiApplication.primaryScreen().virtualGeometry()
        self.setGeometry(geometry)
        # screenshot pixels per logical pixel; the first screenshot measures it
        self.factor = factor or min(1.0, SHOT_MAX_EDGE / max(geometry.width(), geometry.height()))
        self.show()
        self.raise_()
        timer = QTimer(self)
        timer.timeout.connect(self._expire)
        timer.start(5_000)
        self.ripples = QTimer(self)
        self.ripples.timeout.connect(self._tick)

    # screenshot pixels ↔ overlay (logical, relative to the overlay) coordinates
    def to_local(self, x, y):
        return QPointF(float(x) / self.factor, float(y) / self.factor)

    def to_shot(self, point):
        return round(point.x() * self.factor), round(point.y() * self.factor)

    def global_point(self, local):
        return local + QPointF(self.geometry().x(), self.geometry().y())

    def local_point(self, global_point):
        return global_point - QPointF(self.geometry().x(), self.geometry().y())

    def _expire(self):
        now = time.time()
        kept = [mark for mark in self.marks if now - mark["at"] < MARK_TTL_S]
        changed = len(kept) != len(self.marks)
        self.marks = kept
        if self.cursor and now - self.cursor_at > CURSOR_IDLE_S:
            self.cursor = None
            changed = True
        if self.note and now - self.note[2] > NOTE_TTL_S:
            self.note = None
            changed = True
        if changed:
            self.update()

    def _tick(self):
        now = time.time()
        self.marks = [m for m in self.marks if m["kind"] != "ripple" or now - m["at"] < 0.55]
        if not any(m["kind"] == "ripple" for m in self.marks):
            self.ripples.stop()
        self.update()

    def add(self, mark):
        mark["at"] = time.time()
        self.marks.append(mark)
        self.marks = self.marks[-40:]
        self.raise_()
        self.update()

    def ripple(self, point, color="#7a4cff"):
        self.add({"kind": "ripple", "point": point, "color": color})
        self.ripples.start(16)

    def set_cursor(self, point, label=None):
        self.cursor = (point, label)
        self.cursor_at = time.time()
        self.raise_()
        self.update()

    def glide(self, target, label=None, duration=0.32):
        """Move the Plum cursor smoothly, so the user can follow it."""
        start = self.cursor[0] if self.cursor else target - QPointF(60, 40)
        distance = math.hypot(target.x() - start.x(), target.y() - start.y())
        duration = min(0.6, max(0.12, duration * min(2.0, distance / 600 + 0.4)))
        began = time.time()
        while True:
            t = min(1.0, (time.time() - began) / duration)
            k = ease(t)
            self.set_cursor(QPointF(start.x() + (target.x() - start.x()) * k, start.y() + (target.y() - start.y()) * k), label)
            self.repaint()
            if t >= 1.0:
                return
            pump(0.012)

    def clear(self):
        self.marks = []
        self.cursor = None
        self.update()

    # ---- edge glow and the agent's status line

    def activity(self, seconds=GLOW_LINGER_S):
        """Plum is using the computer: light the screen edges for a while."""
        now = time.time()
        if now >= self.active_until:
            self.glow_started = now
        self.active_until = max(self.active_until, now + seconds)
        if not self.glow_timer.isActive():
            self.glow_timer.start(33)
        self.raise_()

    def stop_activity(self):
        self.active_until = 0.0
        self.note = None
        self.glow_timer.stop()
        self.update()

    def set_note(self, text, name=None):
        text = " ".join(str(text or "").split())
        if not text:
            return
        self.note = (text[:220], (name or "Plum")[:40], time.time())
        self.update(self._note_rect.toAlignedRect().adjusted(-4, -4, 4, 4))
        self.update(self._note_box().toAlignedRect().adjusted(-4, -4, 4, 4))

    def glowing(self):
        return self.glow_enabled and time.time() < self.active_until

    def _screens_local(self):
        origin = QPointF(self.geometry().x(), self.geometry().y())
        return [QRectF(screen.geometry()).translated(-origin) for screen in QGuiApplication.screens()]

    def _glow_tick(self):
        now = time.time()
        done = now >= self.active_until
        # Repaint only the edge bands (and the note), not the whole desktop.
        band = GLOW_WIDTH + 6
        for r in self._screens_local():
            rect = r.toAlignedRect()
            self.update(QRect(rect.left(), rect.top(), rect.width(), band))
            self.update(QRect(rect.left(), rect.bottom() - band, rect.width(), band + 1))
            self.update(QRect(rect.left(), rect.top(), band, rect.height()))
            self.update(QRect(rect.right() - band, rect.top(), band + 1, rect.height()))
        if done:
            self.glow_timer.stop()
            self.update(self._note_rect.toAlignedRect().adjusted(-4, -4, 4, 4))

    def _paint_glow(self, painter):
        now = time.time()
        fade_in = min(1.0, (now - self.glow_started) / 0.35)
        fade_out = min(1.0, max(0.0, (self.active_until - now) / 1.2))
        strength = min(fade_in, fade_out)
        if strength <= 0:
            return
        pulse = 0.72 + 0.28 * math.sin(now * 3.2)
        alpha = strength * pulse
        # Drift between Plum violet and blue.
        mix = (math.sin(now * 1.1) + 1) / 2
        violet, blue = QColor("#7a4cff"), QColor("#1856ff")
        base = QColor(
            round(violet.red() + (blue.red() - violet.red()) * mix),
            round(violet.green() + (blue.green() - violet.green()) * mix),
            round(violet.blue() + (blue.blue() - violet.blue()) * mix),
        )

        def shade(a):
            color = QColor(base)
            color.setAlphaF(max(0.0, min(1.0, a)))
            return color

        w = GLOW_WIDTH
        painter.setPen(Qt.NoPen)
        for r in self._screens_local():
            screen_alpha = alpha * (1.0 if self.focus_screen is None or r.contains(self.focus_screen) else 0.22)
            bands = (
                (QRectF(r.left(), r.top(), r.width(), w), QPointF(0, r.top()), QPointF(0, r.top() + w)),
                (QRectF(r.left(), r.bottom() - w, r.width(), w), QPointF(0, r.bottom()), QPointF(0, r.bottom() - w)),
                (QRectF(r.left(), r.top(), w, r.height()), QPointF(r.left(), 0), QPointF(r.left() + w, 0)),
                (QRectF(r.right() - w, r.top(), w, r.height()), QPointF(r.right(), 0), QPointF(r.right() - w, 0)),
            )
            for rect, start, end in bands:
                gradient = QLinearGradient(start, end)
                gradient.setColorAt(0.0, shade(screen_alpha * 0.85))
                gradient.setColorAt(0.35, shade(screen_alpha * 0.32))
                gradient.setColorAt(1.0, shade(0.0))
                painter.fillRect(rect, gradient)
            painter.setBrush(Qt.NoBrush)
            painter.setPen(QPen(shade(screen_alpha), 3))
            painter.drawRect(r.adjusted(1.5, 1.5, -1.5, -1.5))
            painter.setPen(Qt.NoPen)

    def _note_box(self):
        """Where the status line goes: under the Plum cursor, else bottom right."""
        if not self.note:
            return QRectF()
        text, name, _at = self.note
        font = QFont("Sans", 11)
        metrics = QFontMetrics(font)
        body = metrics.boundingRect(0, 0, 340, 400, Qt.TextWordWrap, text)
        width = max(body.width(), QFontMetrics(QFont("Sans", 9, QFont.DemiBold)).horizontalAdvance(name) + 40) + 28
        height = body.height() + 40
        cursor_fresh = self.cursor and not self.hide_cursor and time.time() - self.cursor_at < 30
        if cursor_fresh:
            point = self.cursor[0] + QPointF(16, 58)
            box = QRectF(point.x(), point.y(), width, height)
        else:
            active_screen = (QGuiApplication.screenAt(self.global_point(self.focus_screen).toPoint())
                             if self.focus_screen is not None else None) or QGuiApplication.primaryScreen()
            screen = QRectF(active_screen.geometry()).translated(
                -self.geometry().x(), -self.geometry().y()
            )
            box = QRectF(screen.right() - width - 28, screen.bottom() - height - 28, width, height)
        # Keep it on the screen the box is mostly on.
        for r in self._screens_local():
            if r.contains(box.topLeft()):
                if box.right() > r.right() - 12:
                    box.moveRight(r.right() - 12)
                if box.bottom() > r.bottom() - 12:
                    box.moveBottom(r.bottom() - 12)
                break
        return box

    def _paint_note(self, painter):
        if not self.note:
            return
        text, name, at = self.note
        age = time.time() - at
        if age > NOTE_TTL_S:
            self.note = None
            return
        box = self._note_box()
        self._note_rect = box
        fade = min(1.0, max(0.0, (NOTE_TTL_S - age) / 3.0))
        background = QColor(24, 22, 38)
        background.setAlphaF(0.92 * fade)
        border = QColor("#7a4cff")
        border.setAlphaF(0.85 * fade)
        painter.setPen(QPen(border, 1.5))
        painter.setBrush(background)
        painter.drawRoundedRect(box, 12, 12)
        dot = QColor("#07ca6b" if self.glowing() else "#8a8a98")
        dot.setAlphaF(fade)
        painter.setPen(Qt.NoPen)
        painter.setBrush(dot)
        painter.drawEllipse(QPointF(box.left() + 16, box.top() + 17), 4, 4)
        head = QColor(255, 255, 255)
        head.setAlphaF(0.66 * fade)
        painter.setPen(head)
        painter.setFont(QFont("Sans", 9, QFont.DemiBold))
        painter.drawText(QRectF(box.left() + 26, box.top() + 8, box.width() - 34, 18), Qt.AlignLeft | Qt.AlignVCenter,
                         f"{name} · macht gerade")
        body = QColor(255, 255, 255)
        body.setAlphaF(fade)
        painter.setPen(body)
        painter.setFont(QFont("Sans", 11))
        painter.drawText(box.adjusted(14, 28, -14, -10), Qt.TextWordWrap, text)

    def paintEvent(self, _event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        for mark in self.marks:
            self._paint_mark(painter, mark)
        if self.glowing():
            self._paint_glow(painter)
        if self.cursor and not self.hide_cursor:
            self._paint_cursor(painter, *self.cursor)
        self._paint_note(painter)

    def _pen(self, color, width=4):
        pen = QPen(QColor(color), width)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        return pen

    def _paint_label(self, painter, point, text, color):
        if not text:
            return
        font = QFont("Sans", 11, QFont.DemiBold)
        painter.setFont(font)
        metrics = QFontMetrics(font)
        rect = metrics.boundingRect(0, 0, 320, 400, Qt.TextWordWrap, text)
        box = QRectF(point.x() + 12, point.y() - rect.height() / 2 - 7, rect.width() + 20, rect.height() + 14)
        painter.setPen(Qt.NoPen)
        painter.setBrush(QColor(color))
        painter.drawRoundedRect(box, 10, 10)
        painter.setPen(QColor("#ffffff"))
        painter.drawText(box.adjusted(10, 7, -10, -7), Qt.TextWordWrap, text)

    def _paint_mark(self, painter, mark):
        color = mark["color"]
        kind = mark["kind"]
        painter.setBrush(Qt.NoBrush)
        if kind == "ripple":
            age = min(1.0, (time.time() - mark["at"]) / 0.55)
            ring = QColor(color)
            ring.setAlphaF(max(0.0, 0.9 * (1 - age)))
            painter.setPen(QPen(ring, 3))
            painter.drawEllipse(mark["point"], 8 + 30 * ease(age), 8 + 30 * ease(age))
            return
        if kind == "stroke":
            points = mark["points"]
            if len(points) >= 2:
                painter.setPen(self._pen(color, 5))
                path = QPainterPath(points[0])
                for point in points[1:]:
                    path.lineTo(point)
                painter.drawPath(path)
                self._paint_label(painter, points[-1], mark.get("label"), color)
            return
        rect = mark["rect"]
        center = rect.center()
        if kind == "box":
            fill = QColor(color)
            fill.setAlpha(36)
            painter.setBrush(fill)
            painter.setPen(self._pen(color, 4))
            painter.drawRoundedRect(rect, 10, 10)
            self._paint_label(painter, QPointF(rect.right(), center.y()), mark.get("label"), color)
        elif kind == "underline":
            painter.setPen(self._pen(color, 5))
            path = QPainterPath(QPointF(rect.left(), rect.bottom() + 4))
            path.quadTo(QPointF(center.x(), rect.bottom() + 11), QPointF(rect.right(), rect.bottom() + 3))
            painter.drawPath(path)
            self._paint_label(painter, QPointF(rect.right(), rect.bottom()), mark.get("label"), color)
        elif kind == "arrow":
            start = mark.get("from") or QPointF(center.x() - 120, center.y() - 90)
            angle = math.atan2(center.y() - start.y(), center.x() - start.x())
            inset = min(rect.width(), rect.height()) / 2 + 6 if rect.width() else 6
            tip = QPointF(center.x() - math.cos(angle) * inset, center.y() - math.sin(angle) * inset)
            painter.setPen(self._pen(color, 5))
            painter.drawLine(start, tip)
            for spread in (0.45, -0.45):
                painter.drawLine(
                    tip,
                    QPointF(tip.x() - math.cos(angle - spread) * 22, tip.y() - math.sin(angle - spread) * 22),
                )
            self._paint_label(painter, start - QPointF(0, 18), mark.get("label"), color)
        else:  # circle
            painter.setPen(self._pen(color, 4))
            rx = max(rect.width() / 2 + 14, 28)
            ry = max(rect.height() / 2 + 14, 28)
            painter.drawEllipse(center, rx, ry)
            self._paint_label(painter, QPointF(center.x() + rx, center.y()), mark.get("label"), color)

    def _paint_cursor(self, painter, point, label):
        arrow = QPolygonF(
            [QPointF(0, 0), QPointF(0, 21), QPointF(5.5, 16), QPointF(9, 24), QPointF(12.5, 22.5), QPointF(9, 15), QPointF(16, 15)]
        )
        arrow.translate(point)
        painter.setPen(self._pen("#ffffff", 2))
        painter.setBrush(QColor("#7a4cff"))
        painter.drawPolygon(arrow)
        self._paint_label(painter, point + QPointF(14, 26), label or "Plum", "#1856ff")


# --------------------------------------------------------------------------- pill, guide card, tray


CARD_STYLE = """
QWidget#card { background: rgba(24, 22, 38, 235); border: 1px solid rgba(255,255,255,0.18); border-radius: 14px; }
QLabel { color: #ffffff; }
QLabel#title { font-weight: 600; font-size: 13px; }
QLabel#text { color: rgba(255,255,255,0.86); font-size: 12px; }
QPushButton { background: #1856ff; color: white; border: none; border-radius: 9px; padding: 6px 14px; font-weight: 600; }
QPushButton:hover { background: #3a6dff; }
QPushButton#ghost { background: transparent; color: rgba(255,255,255,0.75); padding: 6px 8px; }
QPushButton#stop { background: #ea2143; }
QPushButton#stop:hover { background: #ff3b5c; }
QPushButton:disabled { background: #343044; color: #8e899e; }
QLineEdit, QComboBox, QPlainTextEdit { background: #211e33; color: #f6f4ff; border: 1px solid #4c455f; border-radius: 7px; padding: 6px; }
QLineEdit:focus, QComboBox:focus { border: 1px solid #9b7bff; }
QComboBox QAbstractItemView { background: #211e33; color: #f6f4ff; selection-background-color: #5137a0; }
QScrollArea { background: transparent; border: 0; }
"""


class Floating(QWidget):
    """A small clickable window above everything (unlike the overlay)."""

    def __init__(self):
        super().__init__(None, Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool | Qt.X11BypassWindowManagerHint)
        self.setAttribute(Qt.WA_TranslucentBackground)
        self.setAttribute(Qt.WA_ShowWithoutActivating)
        self.setStyleSheet(CARD_STYLE)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        self.card = QWidget(self)
        self.card.setObjectName("card")
        outer.addWidget(self.card)


class DesktopDock(Floating):
    """Movable desktop controls, live chat, task result and recent actions."""

    def __init__(self, app):
        super().__init__()
        self.s = app
        self.drag_origin = None
        self.placed = False
        self.compact = False
        self.setFixedWidth(460)
        layout = QVBoxLayout(self.card)
        layout.setContentsMargins(16, 12, 16, 12)
        self.header = QLabel("Plum Desktop · Ziehen zum Verschieben")
        self.header.setTextFormat(Qt.PlainText)
        self.header.setObjectName("title")
        self.header.mousePressEvent = self._drag_start
        self.header.mouseMoveEvent = self._drag_move
        self.header.mouseReleaseEvent = self._drag_end
        layout.addWidget(self.header)
        self.status = QLabel("Bereit")
        self.status.setTextFormat(Qt.PlainText)
        self.status.setWordWrap(True)
        layout.addWidget(self.status)
        controls = QHBoxLayout()
        self.pause = QPushButton("Pause")
        self.pause.clicked.connect(lambda: self.s.set_mode("paused"))
        controls.addWidget(self.pause)
        self.resume = QPushButton("Weiter")
        self.resume.clicked.connect(lambda: self.s.set_mode("control"))
        controls.addWidget(self.resume)
        stop = QPushButton("Stoppen")
        stop.setObjectName("stop")
        stop.clicked.connect(self.s.stop_task)
        controls.addWidget(stop)
        self.toggle = QPushButton("−")
        self.toggle.setAccessibleName("Details ein- oder ausklappen")
        self.toggle.clicked.connect(self.toggle_compact)
        controls.addWidget(self.toggle)
        layout.addLayout(controls)
        self.chat_window = Floating()
        self.chat_window.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.chat_window.setWindowTitle("Plum Chat")
        chat_font = self.chat_window.font()
        chat_font.setPointSize(12)
        self.chat_window.setFont(chat_font)
        self.chat_window.resize(460, 600)
        outer_chat = QVBoxLayout(self.chat_window.card)
        outer_chat.setContentsMargins(0, 0, 0, 0)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        self.details = QWidget()
        self.details.setStyleSheet("background: transparent;")
        scroll.setWidget(self.details)
        outer_chat.addWidget(scroll)
        body = QVBoxLayout(self.details)
        body.setContentsMargins(16, 12, 16, 12)
        header_row = QHBoxLayout()
        chat_header = QLabel("Plum Chat")
        chat_header.mousePressEvent = self._chat_drag_start
        chat_header.mouseMoveEvent = self._chat_drag_move
        chat_header.mouseReleaseEvent = self._chat_drag_end
        self.chat_drag = None
        header_row.addWidget(chat_header, 1)
        hide_chat = QPushButton("Deck")
        hide_chat.setAccessibleName("Chat ausblenden und Deck anzeigen")
        hide_chat.setObjectName("ghost")
        hide_chat.clicked.connect(lambda: self.s.set_layout({"chatVisible": False}))
        header_row.addWidget(hide_chat)
        self.layout_settings = QWidget()
        layout_options = QVBoxLayout(self.layout_settings)
        layout_options.setContentsMargins(0, 0, 0, 0)
        layout_button = QPushButton("Anordnung")
        layout_button.setObjectName("ghost")
        layout_button.clicked.connect(lambda: self.layout_settings.setVisible(not self.layout_settings.isVisible()))
        header_row.addWidget(layout_button)
        body.addLayout(header_row)
        body.addWidget(self.layout_settings)
        self.layout_settings.hide()
        self.screen_choice = QComboBox()
        self.screen_choice.setAccessibleName("Bildschirm für den Chat")
        layout_options.addWidget(self.screen_choice)
        self.placement_choice = QComboBox()
        self.placement_choice.setAccessibleName("Chat-Anordnung")
        for key, label in [("floating", "Frei verschiebbar"), ("left", "Linke Bildschirmhälfte"), ("right", "Rechte Bildschirmhälfte"), ("full", "Ganze Bildschirmfläche")]:
            self.placement_choice.addItem(label, key)
        self.screen_choice.activated.connect(self._layout_changed)
        self.placement_choice.activated.connect(self._layout_changed)
        layout_options.addWidget(self.placement_choice)
        self.zoom_choice = QComboBox()
        self.zoom_choice.setAccessibleName("Schrift und Bedienelemente vergrössern")
        for zoom in (100, 125, 150, 175, 200, 250):
            self.zoom_choice.addItem(f"Schrift und Bedienung: {zoom} %", zoom)
        self.zoom_choice.activated.connect(self._layout_changed)
        layout_options.addWidget(self.zoom_choice)
        self.top_space = QSpinBox()
        self.top_space.setAccessibleName("Platz oben für Dock und Taskleiste")
        self.top_space.setRange(0, 200)
        self.top_space.setSingleStep(8)
        self.top_space.setPrefix("Platz oben: ")
        self.top_space.setSuffix(" px")
        self.top_space.valueChanged.connect(self._layout_changed)
        layout_options.addWidget(self.top_space)
        self.sessions = QComboBox()
        self.sessions.setAccessibleName("Plum-Sitzung")
        self.sessions.activated.connect(self._choose_session)
        body.addWidget(self.sessions)
        self.progress = QLabel()
        self.progress.setTextFormat(Qt.PlainText)
        self.progress.setWordWrap(True)
        body.addWidget(self.progress)
        self.chat = QPlainTextEdit()
        self.chat.setReadOnly(True)
        self.chat.setAccessibleName("Live-Chat")
        self.chat.setMinimumHeight(100)
        self.chat.setStyleSheet("background:#211e33; color:#f6f4ff; border:0; border-radius:8px; padding:8px;")
        body.addWidget(self.chat, 1)
        self.message = QLineEdit()
        self.message.setPlaceholderText("Nachricht an Plum …")
        self.message.setAccessibleName("Nachricht an Plum")
        self.message.returnPressed.connect(self.send)
        body.addWidget(self.message)
        actions = QHBoxLayout()
        for label, callback in [("Senden", self.send), ("Hier weitermachen", self.s.select_context),
                                ("Nachbessern", lambda: self.message.setFocus())]:
            button = QPushButton(label)
            button.clicked.connect(callback)
            actions.addWidget(button)
        body.addLayout(actions)
        self.result = QPlainTextEdit()
        self.result.setReadOnly(True)
        self.result.setAccessibleName("Ergebnis")
        self.result.setFixedHeight(100)
        body.addWidget(self.result)
        self.open_result = QPushButton("Ergebnis öffnen")
        self.open_result.clicked.connect(self.s.open_result)
        body.addWidget(self.open_result)
        self.history_button = QPushButton("Letzte Schritte anzeigen")
        self.history_button.clicked.connect(lambda: self.history.setVisible(not self.history.isVisible()))
        chat_controls = QHBoxLayout()
        self.chat_pause = QPushButton("Pause")
        self.chat_pause.clicked.connect(lambda: self.s.set_mode("control" if self.s.mode == "paused" else "paused"))
        chat_controls.addWidget(self.chat_pause)
        chat_stop = QPushButton("Stoppen")
        chat_stop.setObjectName("stop")
        chat_stop.clicked.connect(self.s.stop_task)
        chat_controls.addWidget(chat_stop)
        chat_controls.addWidget(self.history_button)
        body.addLayout(chat_controls)
        self.history = QPlainTextEdit()
        self.history.setReadOnly(True)
        self.history.setAccessibleName("Letzte Schritte")
        self.history.setFixedHeight(100)
        self.history.hide()
        body.addWidget(self.history)

    def _layout_changed(self, _index):
        self.s.set_layout({"chatScreen": self.screen_choice.currentData(),
                           "chatPlacement": self.placement_choice.currentData(),
                           "chatZoom": self.zoom_choice.currentData(), "chatInsetTop": self.top_space.value()})

    def _chat_drag_start(self, event):
        if event.button() == Qt.LeftButton:
            self.chat_drag = event.globalPosition().toPoint() - self.chat_window.pos()

    def _chat_drag_move(self, event):
        if self.chat_drag is not None:
            self.chat_window.move(event.globalPosition().toPoint() - self.chat_drag)

    def _chat_drag_end(self, _event):
        self.chat_drag = None
        self.s.state["chatPosition"] = [self.chat_window.x(), self.chat_window.y()]
        screen = QGuiApplication.screenAt(self.chat_window.geometry().center()) or QGuiApplication.primaryScreen()
        self.s.set_layout({"chatPlacement": "floating", "chatScreen": screen.name()}, reposition=False)

    def place_chat(self):
        layout = self.s.layout
        screens = QGuiApplication.screens()
        wanted = layout.get("chatScreen")
        screen = next((s for s in screens if s.name() == wanted), None)
        if wanted == "secondary":
            screen = next((s for s in sorted(screens, key=lambda s: s.geometry().width() * s.geometry().height())
                           if s != QGuiApplication.primaryScreen()), None)
        screen = screen or QGuiApplication.primaryScreen()
        zoom = int(layout.get("chatZoom", 100))
        font = self.chat_window.font()
        font.setPointSizeF(12 * zoom / 100)
        self.chat_window.setFont(font)
        # QTextDocument can retain its own default font despite widget font
        # inheritance. Apply the chosen size explicitly to content and controls.
        for widget in self.chat_window.findChildren(QWidget):
            widget.setFont(font)
            if isinstance(widget, (QPushButton, QLineEdit, QComboBox, QSpinBox)):
                widget.setMinimumHeight(max(36, round(24 * zoom / 100)))
        for edit in (self.chat, self.result, self.history):
            edit.document().setDefaultFont(font)
        rect = screen.availableGeometry().adjusted(16, 16 + int(layout.get("chatInsetTop", 0)), -16, -16)
        placement = layout.get("chatPlacement", "floating")
        width = rect.width() if placement == "full" else (min(rect.width(), max(320, rect.width() // 2 - 8)) if placement != "floating" else min(round(560 * zoom / 100), rect.width()))
        height = min(700, rect.height()) if placement == "floating" else rect.height()
        self.chat_window.resize(width, height)
        x = rect.right() - width + 1 if placement == "right" else rect.left()
        y = rect.top()
        pos = self.s.state.get("chatPosition")
        if placement == "floating" and isinstance(pos, list) and len(pos) == 2 and rect.contains(QPointF(*pos).toPoint()):
            x, y = pos
        self.chat_window.move(max(rect.left(), min(x, rect.right() - width + 1)),
                              max(rect.top(), min(y, rect.bottom() - height + 1)))
        self.screen_choice.blockSignals(True)
        self.screen_choice.clear()
        self.screen_choice.addItem("Hauptbildschirm", "primary")
        self.screen_choice.addItem("Kleiner Zusatzbildschirm", "secondary")
        for item in screens:
            self.screen_choice.addItem(item.name(), item.name())
        self.screen_choice.setCurrentIndex(max(0, self.screen_choice.findData(wanted)))
        self.screen_choice.blockSignals(False)
        self.placement_choice.setCurrentIndex(max(0, self.placement_choice.findData(placement)))
        self.zoom_choice.setCurrentIndex(max(0, self.zoom_choice.findData(zoom)))
        self.top_space.blockSignals(True)
        self.top_space.setValue(int(layout.get("chatInsetTop", 0)))
        self.top_space.blockSignals(False)
        self.chat_window.setVisible(layout.get("chatVisible", True))
        self.toggle.setText("−" if layout.get("chatVisible", True) else "+")

    def _drag_start(self, event):
        if event.button() == Qt.LeftButton:
            self.drag_origin = event.globalPosition().toPoint() - self.pos()

    def _drag_move(self, event):
        if self.drag_origin is not None:
            self.move(event.globalPosition().toPoint() - self.drag_origin)

    def _drag_end(self, _event):
        self.drag_origin = None
        self.clamp()
        self.s.state["dockPosition"] = [self.x(), self.y()]
        save_state(self.s.state)

    def clamp(self):
        screen = QGuiApplication.screenAt(self.geometry().center()) or QGuiApplication.primaryScreen()
        rect = screen.availableGeometry()
        self.move(max(rect.left(), min(self.x(), rect.right() - self.width() + 1)),
                  max(rect.top(), min(self.y(), rect.bottom() - self.height() + 1)))

    def present(self):
        if not self.placed:
            self.adjustSize()
            rect = QGuiApplication.primaryScreen().availableGeometry()
            pos = self.s.state.get("dockPosition")
            self.move(*(pos if isinstance(pos, list) and len(pos) == 2 else [rect.right() - self.width() - 24, rect.top() + 40]))
            self.placed = True
        self.clamp()
        self.show()
        self.raise_()

    def toggle_compact(self):
        visible = not self.chat_window.isVisible()
        self.s.set_layout({"chatVisible": visible})
        self.toggle.setText("−" if visible else "+")

    def _choose_session(self, index):
        session_id = self.sessions.itemData(index)
        name = self.sessions.itemText(index)
        if session_id:
            self.s.attach_session({"id": session_id, "name": name})

    def send(self):
        text = self.message.text().strip()
        if text and self.s.send_message(text):
            self.message.clear()

    def render(self):
        a = self.s.activity_state
        self.status.setText(("● " if self.s.online else "○ Offline · ") + a["status"] +
                            (" · " + a["action"] if a["action"] else ""))
        self.header.setText(a["sessionName"] + " · Ziehen zum Verschieben")
        self.pause.setEnabled(self.s.mode != "paused")
        self.resume.setEnabled(self.s.mode == "paused" and self.s.online)
        self.chat_pause.setText("Weiter" if self.s.mode == "paused" else "Pause")
        self.chat_pause.setEnabled(self.s.mode != "paused" or self.s.online)
        self.progress.setText(a["progress"])
        self.progress.setVisible(bool(a["progress"]))
        if self.result.toPlainText() != a["result"]:
            self.result.setPlainText(a["result"])
        self.result.setVisible(bool(a["result"]))
        self.open_result.setVisible(bool(a["resultTarget"]))
        content = "\n\n".join(self.s.chat_lines[-16:])
        if self.s.stream:
            content += "\n\nPlum: " + self.s.stream[-6000:]
        if self.chat.toPlainText() != content:
            bar = self.chat.verticalScrollBar()
            follow = bar.value() >= bar.maximum() - 12
            old = bar.value()
            self.chat.setPlainText(content)
            bar.setValue(bar.maximum() if follow else old)
        history = "\n".join(a["history"])
        if self.history.toPlainText() != history:
            self.history.setPlainText(history)


class Pill(Floating):
    """'Plum steuert · Stopp' at the top of the screen while Plum acts."""

    def __init__(self, on_stop):
        super().__init__()
        row = QHBoxLayout(self.card)
        row.setContentsMargins(14, 8, 8, 8)
        self.label = QLabel("Plum steuert · Esc stoppt")
        self.label.setObjectName("title")
        row.addWidget(self.label)
        stop = QPushButton("Stopp")
        stop.setObjectName("stop")
        stop.clicked.connect(on_stop)
        row.addWidget(stop)
        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.timeout.connect(self.hide)

    def flash(self, screen_rect, text):
        self.label.setText(text)
        self.adjustSize()
        self.move(screen_rect.center().x() - self.width() // 2, screen_rect.top() + 14)
        self.show()
        self.raise_()
        self.timer.start(PILL_IDLE_S * 1000)


class GuideCard(Floating):
    """One step of a desktop tutorial with an 'Erledigt' button."""

    def __init__(self, on_done):
        super().__init__()
        self.setFixedWidth(340)
        column = QVBoxLayout(self.card)
        column.setContentsMargins(16, 14, 16, 12)
        self.title = QLabel()
        self.title.setObjectName("title")
        self.title.setWordWrap(True)
        self.text = QLabel()
        self.text.setObjectName("text")
        self.text.setWordWrap(True)
        column.addWidget(self.title)
        column.addWidget(self.text)
        row = QHBoxLayout()
        row.addStretch(1)
        close = QPushButton("Schliessen")
        close.setObjectName("ghost")
        close.clicked.connect(self.hide)
        done = QPushButton("Erledigt")
        done.clicked.connect(lambda: (self.hide(), on_done(self.step)))
        row.addWidget(close)
        row.addWidget(done)
        column.addLayout(row)
        self.step = None

    def present(self, step, target, screen_rect):
        """Next to `target` (global logical rect): right of it, else left, else below."""
        self.step = step
        label = f"{step['step']}/{step['total']}" if step.get("total") else str(step.get("step", 1))
        self.title.setText(f"Schritt {label}: {step['title']}")
        self.text.setText(step["instruction"])
        self.adjustSize()
        gap = 28
        x = target.right() + gap
        y = target.center().y() - self.height() / 2
        if x + self.width() > screen_rect.right():
            x = target.left() - self.width() - gap
        if x < screen_rect.left():
            x = target.center().x() - self.width() / 2
            y = target.bottom() + gap
        x = max(screen_rect.left() + 8, min(x, screen_rect.right() - self.width() - 8))
        y = max(screen_rect.top() + 8, min(y, screen_rect.bottom() - self.height() - 8))
        self.move(round(x), round(y))
        self.show()
        self.raise_()


def plum_icon(color):
    pixmap = QPixmap(64, 64)
    pixmap.fill(Qt.transparent)
    painter = QPainter(pixmap)
    painter.setRenderHint(QPainter.Antialiasing)
    painter.setBrush(QColor(color))
    painter.setPen(Qt.NoPen)
    painter.drawEllipse(6, 6, 52, 52)
    painter.setBrush(QColor("#ffffff"))
    painter.drawPolygon(QPolygonF([QPointF(24, 18), QPointF(24, 46), QPointF(31, 39), QPointF(36, 49), QPointF(41, 47), QPointF(36, 37), QPointF(45, 37)]))
    painter.end()
    return QIcon(pixmap)


# --------------------------------------------------------------------------- accessibility


try:
    import gi

    gi.require_version("Atspi", "2.0")
    from gi.repository import Atspi

    Atspi.set_timeout(2000, 8000)  # a hung app must not freeze the companion
except (ImportError, ValueError):
    Atspi = None

INTERACTIVE_ROLES = {
    "push button", "toggle button", "check box", "radio button", "menu item", "check menu item",
    "radio menu item", "menu", "combo box", "entry", "password text", "text", "link", "page tab",
    "list item", "tree item", "slider", "spin button", "icon", "split button", "button", "toolbar button",
    "table cell", "terminal",
}
SKIP_ROLES = {"redundant object", "invalid", "filler", "unknown"}
MAX_WALK = 8000


def a11y_frame(window):
    """The AT-SPI frame of a KWin window: same process, then same title."""
    if Atspi is None:
        raise RuntimeError("AT-SPI fehlt (python3-gobject mit Atspi)")
    desktop = Atspi.get_desktop(0)
    candidates = []
    for index in range(desktop.get_child_count()):
        app = desktop.get_child_at_index(index)
        try:
            if app is None or app.get_process_id() != window["pid"]:
                continue
            for frame_index in range(app.get_child_count()):
                frame = app.get_child_at_index(frame_index)
                if frame is not None:
                    candidates.append(frame)
        except Exception:  # noqa: BLE001 - apps vanish while we look
            continue
    if not candidates:
        raise RuntimeError(f"„{window['caption']}“ hat keine Barrierefreiheits-Daten; nutze Screenshot-Koordinaten")
    caption = window["caption"]
    for frame in candidates:
        name = frame.get_name() or ""
        if name and (name == caption or name in caption or caption in name):
            return frame
    for frame in candidates:
        if frame.get_state_set().contains(Atspi.StateType.ACTIVE):
            return frame
    return candidates[0]


def a11y_text(node):
    try:
        text = node.get_text_iface()
        if text:
            return Atspi.Text.get_text(text, 0, min(Atspi.Text.get_character_count(text), 4000)) or ""
    except Exception:  # noqa: BLE001
        pass
    return ""


def a11y_walk(root, interactive_only):
    """Yield (node, depth, role, name, rect) for visible nodes, depth-first."""
    stack = [(root, 0)]
    seen = 0
    while stack and seen < MAX_WALK:
        node, depth = stack.pop()
        seen += 1
        try:
            states = node.get_state_set()
            if not states.contains(Atspi.StateType.SHOWING) and depth > 0:
                continue
            role = node.get_role_name()
            name = (node.get_name() or "").strip()
            rect = node.get_extents(Atspi.CoordType.WINDOW)
            count = node.get_child_count()
        except Exception:  # noqa: BLE001
            continue
        if role not in SKIP_ROLES and rect.width > 0 and rect.height > 0 and rect.x >= -2 and rect.y >= -2:
            if not interactive_only or role in INTERACTIVE_ROLES or states.contains(Atspi.StateType.FOCUSABLE):
                yield node, depth, role, name, rect, states
        for index in reversed(range(min(count, 400))):
            try:
                child = node.get_child_at_index(index)
            except Exception:  # noqa: BLE001
                continue
            if child is not None:
                stack.append((child, depth + 1))


# --------------------------------------------------------------------------- tools


def screenshot_layout(rectangles, sizes):
    """One uniform pixel scale, including monitor origins and negative positions."""
    left = min(r[0] for r in rectangles)
    top = min(r[1] for r in rectangles)
    right = max(r[0] + r[2] for r in rectangles)
    bottom = max(r[1] + r[3] for r in rectangles)
    scale = max(max(w / r[2], h / r[3]) for r, (w, h) in zip(rectangles, sizes))
    targets = [(round((x - left) * scale), round((y - top) * scale), round(w * scale), round(h * scale))
               for x, y, w, h in rectangles]
    return (round((right - left) * scale), round((bottom - top) * scale)), targets


def screenshot_helper():
    """Grant only this private busctl copy the same capture API as Spectacle."""
    busctl = shutil.which("busctl")
    if not busctl:
        raise RuntimeError("busctl fehlt für die Bildschirmaufnahme")
    helper = os.path.expanduser("~/.local/libexec/plum-desktop/plum-screencap")
    desktop_dir = os.path.join(os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "applications")
    entry = os.path.join(desktop_dir, "ch.zwaetschge.plum-screencap.desktop")
    content = ("[Desktop Entry]\nType=Application\nName=Plum Desktop Bildschirmaufnahme\n"
               f"Exec={helper}\nNoDisplay=true\nX-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2\n")
    changed = False
    if not os.path.exists(helper) or os.path.getsize(helper) != os.path.getsize(busctl):
        os.makedirs(os.path.dirname(helper), exist_ok=True)
        shutil.copy2(busctl, helper)
        changed = True
    old = ""
    if os.path.exists(entry):
        with open(entry, encoding="utf-8") as handle:
            old = handle.read()
    if old != content:
        os.makedirs(desktop_dir, exist_ok=True)
        with open(entry, "w", encoding="utf-8") as handle:
            handle.write(content)
        changed = True
    if changed:
        tool = shutil.which("kbuildsycoca6") or shutil.which("kbuildsycoca5")
        if tool:
            subprocess.run([tool], capture_output=True, timeout=20, check=True, env=CHILD_ENV)
    return helper


def capture_screen(helper, name):
    read_fd, write_fd = os.pipe()
    proc = None
    try:
        proc = subprocess.Popen(
            [helper, "--user", "--json=short", "call", "org.kde.KWin", "/org/kde/KWin/ScreenShot2",
             "org.kde.KWin.ScreenShot2", "CaptureScreen", "sa{sv}h", name,
             "1", "native-resolution", "b", "true", str(write_fd)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL,
            pass_fds=(write_fd,), env=CHILD_ENV)
        os.close(write_fd)
        write_fd = None
        chunks, deadline = [], time.monotonic() + 15
        while time.monotonic() < deadline:
            ready, _, _ = select.select([read_fd], [], [], 0.1)
            if not ready:
                if proc.poll() is not None and proc.returncode != 0:
                    break
                continue
            data = os.read(read_fd, 1 << 20)
            if not data:
                break
            chunks.append(data)
        else:
            raise RuntimeError(f"Bildschirmaufnahme von {name} dauert zu lange")
        out, err = proc.communicate(timeout=3)
        if proc.returncode:
            raise RuntimeError(f"Bildschirmaufnahme von {name} fehlgeschlagen: {err.decode(errors='replace')[:300]}")
        meta = {key: value["data"] for key, value in json.loads(out)["data"][0].items()}
        width, height, stride, fmt = (int(meta[key]) for key in ("width", "height", "stride", "format"))
        raw = b"".join(chunks)
        if width <= 0 or height <= 0 or stride <= 0 or len(raw) < stride * height:
            raise RuntimeError(f"Unvollständige Bildschirmaufnahme von {name}")
        return QImage(raw, width, height, stride, QImage.Format(fmt)).copy()
    finally:
        os.close(read_fd)
        if write_fd is not None:
            os.close(write_fd)
        if proc is not None and proc.poll() is None:
            proc.kill()
            proc.communicate()


def capture_desktop():
    helper = screenshot_helper()
    screens = QGuiApplication.screens()
    images = [capture_screen(helper, screen.name()) for screen in screens]
    rectangles = [(s.geometry().x(), s.geometry().y(), s.geometry().width(), s.geometry().height()) for s in screens]
    size, targets = screenshot_layout(rectangles, [(i.width(), i.height()) for i in images])
    image = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
    image.fill(Qt.black)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.SmoothPixmapTransform)
    for shot, target in zip(images, targets):
        painter.drawImage(QRect(*target), shot)
    painter.end()
    return image


def take_screenshot(path):
    # Spectacle's exported collage can mix native pixels and logical origins.
    # Capture each named output and compose it in our actual input coordinates.
    if QDBusInterface("org.kde.KWin", "/KWin", "org.kde.KWin").isValid():
        return capture_desktop()
    if shutil.which("spectacle"):
        subprocess.run(["spectacle", "-b", "-n", "-f", "-o", path], check=True, timeout=20, env=CHILD_ENV)
    elif shutil.which("grim"):
        subprocess.run(["grim", path], check=True, timeout=20, env=CHILD_ENV)
    else:
        raise RuntimeError("Kein Screenshot-Werkzeug (spectacle oder grim) installiert")
    # A running spectacle takes the request over and returns at once, so the
    # file can still be growing: wait until its size holds still and it loads.
    last, steady = -1, 0
    for _ in range(100):
        size = os.path.getsize(path) if os.path.exists(path) else 0
        steady = steady + 1 if size and size == last else 0
        last = size
        if steady >= 2:
            image = QImage(path)
            if not image.isNull():
                return image
        time.sleep(0.08)
    raise RuntimeError("Screenshot wurde nicht vollständig gespeichert")


class Tools(QObject):
    """Runs tool calls on the Qt thread; replies go back through `reply`."""

    call = Signal(str, str, object, object)

    def __init__(self, app_state):
        super().__init__()
        self.s = app_state
        self.overlay = app_state.overlay
        self.session = {}
        self.refs = {}  # "d12" -> (accessible, client origin QPointF, window id)
        # Waiting on KWin or an animation processes events, which would start the
        # next queued call inside the current one; calls run strictly one by one.
        self.busy = False
        self.waiting = []
        self.call.connect(self._enqueue)

    def _enqueue(self, call_id, tool, args, session):
        self.waiting.append((call_id, tool, args, session))
        if not self.busy:
            self._drain()

    def _drain(self):
        self.busy = True
        try:
            while self.waiting:
                self._run(*self.waiting.pop(0))
        finally:
            self.busy = False

    def _run(self, call_id, tool, args, session):
        try:
            handler = getattr(self, tool, None)
            if not tool.startswith("desktop_") or handler is None:
                raise RuntimeError(f"Unbekanntes Desktop-Werkzeug: {tool} (Plum Desktop {VERSION})")
            if self.s.mode == "paused" and tool not in ("desktop_status", "desktop_task", "desktop_layout"):
                raise RuntimeError("Plum Desktop ist pausiert. Bitte den Nutzer, es im Tray-Symbol fortzusetzen.")
            if self.s.mode == "guide" and tool in INPUT_TOOLS:
                raise RuntimeError(
                    "Plum Desktop ist im Modus „Nur zeigen“: Eingaben sind gesperrt. "
                    "Zeige mit desktop_point, desktop_annotate oder desktop_guide_step, der Nutzer bedient selbst."
                )
            self.session = session or {}
            self.s.attach_session(self.session)
            # Light the screen edges and show what the agent says it is doing.
            self.overlay.activity(GLOW_LINGER_S + 2)
            note = str(self.session.get("note") or "").strip()
            if note:
                self.overlay.set_note(note, self._label())
            if self.session.get("id") and self.session.get("id") != self.s.last_session.get("id"):
                self.s.last_session = self.session
                self.s.state["session"] = {"id": self.session.get("id"), "name": self.session.get("name")}
                save_state(self.s.state)
            ABORT["set"] = False
            if tool in INPUT_TOOLS:
                self.s.last_action = time.time()
                self.s.preview(tool, args or {})
            content = handler(args or {})
            if tool != "desktop_status":
                self.s.record_step(self.s.describe_action(tool, args or {}))
            if not (tool == "desktop_task" and (args or {}).get("status") in ("completed", "error")):
                self.overlay.activity(GLOW_LINGER_S)
            self.s.bridge.send({"type": "result", "id": call_id, "ok": True, "content": content})
        except Stopped as error:
            self.s.input.release_all()
            self.s.bridge.send({"type": "result", "id": call_id, "ok": False, "error": str(error)})
        except Exception as error:  # noqa: BLE001 - every failure goes back to the agent
            self.s.activity_state.update(status="Braucht deine Antwort", action=str(error)[:240])
            self.s.publish_activity()
            self.s.bridge.send({"type": "result", "id": call_id, "ok": False, "error": str(error)})

    # ---- helpers

    @staticmethod
    def _text(text):
        return {"type": "text", "text": text}

    def _color(self, args):
        return COLORS.get(str(args.get("color") or "").lower(), COLORS["purple"])

    def _rect(self, args):
        top_left = self.overlay.to_local(args["x"], args["y"])
        width = float(args.get("width") or 0) / self.overlay.factor
        height = float(args.get("height") or 0) / self.overlay.factor
        return QRectF(top_left.x(), top_left.y(), width, height)

    def _point(self, args, x="x", y="y"):
        if args.get("ref") and x == "x":
            return self._ref_center(str(args["ref"]))
        if args.get("text") and x == "x" and args.get(x) is None:
            hits = self._find_text(str(args["text"]))
            if not hits:
                raise RuntimeError(f"Text „{args['text']}“ nicht auf dem Bildschirm gefunden")
            return self.overlay.to_local(hits[0][1], hits[0][2])
        if args.get(x) is None or args.get(y) is None:
            raise RuntimeError(f"{x} und {y} (Screenshot-Pixel) oder ref fehlen")
        return self.overlay.to_local(args[x], args[y])

    def _target_window(self, args):
        windows = self.s.kwin.windows()
        query = str(args.get("window") or "").strip().lower()
        if query:
            match = next((w for w in windows if w["id"].lower() == query), None) or next(
                (w for w in windows if query in w["caption"].lower() or query == w["cls"].lower()), None
            )
        else:
            match = next((w for w in windows if w["active"]), None)
        if not match:
            raise RuntimeError("Kein passendes Fenster; desktop_windows listet alle")
        rule = self._rule(match)
        if rule and rule["mode"] == "block":
            raise RuntimeError(f"„{match['caption']}“ ist für Plum gesperrt (Regel „{rule['match']}“)")
        self.overlay.focus_screen = self.overlay.local_point(QPointF(match["x"] + match["width"] / 2, match["y"] + 40))
        return match

    def _ref_center(self, ref):
        entry = self.refs.get(ref)
        if not entry:
            raise RuntimeError(f"Unbekannte Referenz {ref}; erst desktop_read_ui oder desktop_find aufrufen")
        node, origin, _window = entry
        try:
            rect = node.get_extents(Atspi.CoordType.WINDOW)
        except Exception as error:  # noqa: BLE001
            raise RuntimeError(f"Element {ref} ist nicht mehr da; neu lesen") from error
        if rect.width <= 0 or rect.height <= 0:
            raise RuntimeError(f"Element {ref} ist nicht sichtbar")
        return self.overlay.local_point(QPointF(origin.x() + rect.x + rect.width / 2, origin.y() + rect.y + rect.height / 2))

    def _shot_rect(self, origin, rect):
        x, y = self.overlay.to_shot(self.overlay.local_point(QPointF(origin.x() + rect.x, origin.y() + rect.y)))
        return x, y, round(rect.width * self.overlay.factor), round(rect.height * self.overlay.factor)

    def _describe(self, ref, role, name, origin, rect, states, extra=""):
        x, y, w, h = self._shot_rect(origin, rect)
        flags = []
        if states.contains(Atspi.StateType.FOCUSED):
            flags.append("fokussiert")
        if states.contains(Atspi.StateType.CHECKED):
            flags.append("an")
        if states.contains(Atspi.StateType.SELECTED):
            flags.append("ausgewählt")
        if not states.contains(Atspi.StateType.ENABLED) and not states.contains(Atspi.StateType.SENSITIVE):
            flags.append("inaktiv")
        label = f" „{name[:80]}“" if name else ""
        extra = f" = „{extra[:80]}“" if extra and extra != name else ""
        tail = f" ({', '.join(flags)})" if flags else ""
        return f"[{ref}] {role}{label}{extra} @ {x + w // 2},{y + h // 2} ({w}×{h}){tail}"

    def _screen_of(self, local):
        screen = QGuiApplication.screenAt(self.overlay.global_point(local).toPoint()) or QGuiApplication.primaryScreen()
        return screen.geometry()

    def _acting(self, local, what):
        self.s.last_action = time.time()
        previous = self.overlay.focus_screen
        self.overlay.focus_screen = local
        if previous is not None and self._screen_of(previous) != self._screen_of(local):
            self.overlay.set_note("Wechsle auf diesen Bildschirm", self._label())
            self.overlay.set_cursor(local, self._label())
            pump(0.35)
        self.s.pill.flash(self._screen_of(local), f"Plum steuert · {what} · Esc stoppt")

    def _label(self):
        name = str(self.session.get("name") or "").strip()
        return name[:40] if name else "Plum"

    # ---- app rules

    def _rule(self, window):
        haystack = f"{window.get('cls', '')} {window.get('caption', '')}".lower()
        for rule in self.s.rules:
            if str(rule.get("match", "")).lower() in haystack:
                return rule
        return None

    def _window_at(self, windows, local):
        point = self.overlay.global_point(local)
        hits = [
            w for w in windows
            if not w.get("minimized")
            and w["x"] <= point.x() < w["x"] + w["width"]
            and w["y"] <= point.y() < w["y"] + w["height"]
        ]
        return hits[-1] if hits else None  # stacking order: topmost last

    def _guard(self, local, what):
        """App rules before any input: blocked apps refuse, 'ask' apps confirm at the desktop."""
        if not self.s.rules:
            return
        windows = self.s.kwin.windows()
        targets = [w for w in windows if w.get("active")]
        if local is not None:
            under = self._window_at(windows, local)
            if under:
                targets.insert(0, under)
        for window in targets:
            rule = self._rule(window)
            if not rule:
                continue
            if rule["mode"] == "block":
                raise RuntimeError(
                    f"„{window['caption']}“ ({window['cls']}) ist für Plum gesperrt (Regel „{rule['match']}“). "
                    "Bitte den Nutzer, das selbst zu erledigen."
                )
            if self.s.allowed_until.get(window["id"], 0) > time.time():
                continue
            anchor = (
                self.overlay.global_point(local)
                if local is not None
                else QPointF(window["x"] + window["width"] / 2, window["y"] + 40)
            )
            screen = QGuiApplication.screenAt(anchor.toPoint()) or QGuiApplication.primaryScreen()
            answer = self.s.confirm.ask(
                f"Plum möchte {what}",
                f"in „{window['caption'][:80]}“. Die Regel „{rule['match']}“ verlangt deine Bestätigung.",
                anchor,
                screen.geometry(),
            )
            if answer == "deny":
                raise RuntimeError(f"Der Nutzer hat abgelehnt: {what} in „{window['caption']}“.")
            if answer == "window":
                self.s.allowed_until[window["id"]] = time.time() + 300

    def _pointer_to(self, local):
        """Glide the Plum cursor, move the real pointer and check where it landed."""
        self.overlay.glide(local, self._label())
        target = self.overlay.global_point(local)
        self.s.input.move(target)
        pump(0.05)
        try:
            landed = self.s.kwin.cursor()
            error = QPointF(target.x() - landed.x(), target.y() - landed.y())
            if abs(error.x()) > 2 or abs(error.y()) > 2:
                self.s.input.move(target + error)
                pump(0.05)
        except RuntimeError:
            pass  # no KWin readback: trust the mapping

    # ---- look

    def desktop_status(self, _args):
        screens = []
        for screen in QGuiApplication.screens():
            local = self.overlay.local_point(QPointF(screen.geometry().topLeft()))
            x, y = self.overlay.to_shot(local)
            w = round(screen.geometry().width() * self.overlay.factor)
            h = round(screen.geometry().height() * self.overlay.factor)
            screens.append(f"{screen.name()} bei {x},{y} {w}×{h}")
        active = self.s.kwin.active_class()
        lines = [
            f"Plum Desktop {VERSION} · Modus {MODE_LABELS[self.s.mode]} ({self.s.mode})",
            "Bildschirme in Screenshot-Pixeln: " + "; ".join(screens),
            f"Aktives Fenster: {active.get('caption', '?')} ({active.get('cls', '?')})",
            "Aktivität: " + json.dumps(self.s.activity_state, ensure_ascii=False),
            "Chat-Anordnung: " + json.dumps({"layout": self.s.layout, "screens": self.s.screen_info()}, ensure_ascii=False),
        ]
        if self.s.mode == "guide":
            lines.append("Nur zeigen: Eingabe-Werkzeuge sind gesperrt.")
        return [self._text("\n".join(lines))]

    def desktop_task(self, args):
        """Explicit task progress and verified result supplied by the agent."""
        title = str(args.get("title") or "")[:160]
        steps = [str(step)[:160] for step in (args.get("steps") or [])[:30]]
        if steps:
            self.s.task_steps = steps
        steps = getattr(self.s, "task_steps", [])
        current = max(0, min(int(args.get("current") or 0), len(steps)))
        status = args.get("status", "working")
        labels = {"working": "Arbeitet", "waiting": "Wartet", "needs_input": "Braucht deine Antwort",
                  "completed": "Abgeschlossen", "error": "Fehler"}
        if status not in labels:
            raise RuntimeError("status: working, waiting, needs_input, completed oder error")
        if status == "completed":
            current = len(steps)
        progress = (f"{current + 1} von {len(steps)} · {steps[current]}" if current < len(steps) else "Alle Schritte erledigt") if steps else title
        self.s.activity_state.update(status=labels[status], action=title, progress=progress[:240])
        if args.get("result"):
            self.s.activity_state["result"] = str(args["result"])[:2000]
        if args.get("target"):
            target = str(args["target"])[:2000]
            if not target.startswith(("https://", "http://", "/", "file:///")):
                raise RuntimeError("Ergebnisziel muss eine Datei oder HTTP(S)-Adresse sein")
            self.s.activity_state["resultTarget"] = target
        if status in ("completed", "error"):
            self.s.turn_active = False
            self.overlay.stop_activity()
        self.s.dock.present()
        self.s.publish_activity()
        return [self._text(json.dumps(self.s.activity_state, ensure_ascii=False))]

    def desktop_layout(self, args):
        self.s.set_layout(args)
        self.s.dock.present()
        return [self._text(json.dumps({"layout": self.s.layout, "screens": self.s.screen_info()}, ensure_ascii=False))]

    def desktop_screenshot(self, args):
        # The Plum cursor and the pill would cover what the agent needs to see.
        pill = self.s.pill.isVisible()
        self.s.pill.hide()
        self.overlay.hide_cursor = True
        self.overlay.repaint()
        pump(0.05)
        with tempfile.TemporaryDirectory() as tmp:
            try:
                image = take_screenshot(os.path.join(tmp, "shot.png"))
            finally:
                self.overlay.hide_cursor = False
                self.overlay.update()
                if pill:
                    self.s.pill.show()
        logical = self.overlay.geometry()
        self._black_out(image, logical)
        scale = min(1.0, SHOT_MAX_EDGE / max(image.width(), image.height()))
        full_w, full_h = round(image.width() * scale), round(image.height() * scale)
        # Tool coordinates are screenshot pixels; the overlay works in logical ones.
        factor = full_w / max(1, logical.width())
        if abs(factor - self.overlay.factor) > 1e-6:
            self.overlay.factor = factor
            self.s.state["factor"] = factor
            save_state(self.s.state)
        if args.get("width") and args.get("height"):
            # Zoom: crop at full resolution, coordinates stay those of the whole screenshot.
            ratio = image.width() / full_w
            x, y, w, h = (float(args.get(k) or 0) for k in ("x", "y", "width", "height"))
            crop = image.copy(QRect(round(x * ratio), round(y * ratio), round(w * ratio), round(h * ratio)))
            zoom = min(1.0, SHOT_MAX_EDGE / max(crop.width(), crop.height(), 1))
            shot = crop.scaled(round(crop.width() * zoom), round(crop.height() * zoom), Qt.KeepAspectRatio, Qt.SmoothTransformation)
            note = (
                f"Ausschnitt {round(x)},{round(y)} {round(w)}×{round(h)} vergrössert auf {shot.width()}×{shot.height()}. "
                f"Für Klicks: Screenshot-Pixel = {round(x)} + Bild-x × {w / max(1, shot.width()):.3f}, "
                f"{round(y)} + Bild-y × {h / max(1, shot.height()):.3f}."
            )
        else:
            shot = image.scaled(full_w, full_h, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            note = (
                f"Desktop {shot.width()}×{shot.height()} (Bildschirm {image.width()}×{image.height()}). "
                "x/y für alle desktop_*-Werkzeuge in diesen Screenshot-Pixeln. Für kleine Schrift: "
                "desktop_screenshot mit x/y/width/height vergrössert einen Ausschnitt."
            )
        data = QByteArray()
        buffer = QBuffer(data)
        buffer.open(QIODevice.WriteOnly)
        shot.save(buffer, "JPEG", 82)
        return [
            {"type": "image", "data": base64.b64encode(bytes(data)).decode(), "mimeType": "image/jpeg"},
            self._text(note),
        ]

    def _black_out(self, image, logical):
        """Blocked apps never leave the computer, not even as pixels."""
        if not any(rule.get("mode") == "block" for rule in self.s.rules):
            return
        try:
            windows = self.s.kwin.windows()
        except RuntimeError:
            return
        ratio = image.width() / max(1, logical.width())
        painter = None
        for window in windows:
            rule = self._rule(window)
            if window.get("minimized") or not rule or rule["mode"] != "block":
                continue
            if painter is None:
                painter = QPainter(image)
            rect = QRect(
                round((window["x"] - logical.x()) * ratio), round((window["y"] - logical.y()) * ratio),
                round(window["width"] * ratio), round(window["height"] * ratio),
            )
            painter.fillRect(rect, QColor("#1d1b26"))
            painter.setPen(QColor("#ffffff"))
            font = QFont("Sans")
            font.setPixelSize(max(14, round(22 * ratio)))
            painter.setFont(font)
            painter.drawText(rect, Qt.AlignCenter, f"Für Plum gesperrt: {window['cls']}")
        if painter:
            painter.end()

    def desktop_windows(self, _args):
        windows = self.s.kwin.windows()
        if not windows:
            return [self._text("Keine Fenster")]
        lines = []
        for w in windows:
            x, y = self.overlay.to_shot(self.overlay.local_point(QPointF(w["x"], w["y"])))
            size = f"{round(w['width'] * self.overlay.factor)}×{round(w['height'] * self.overlay.factor)}"
            flags = " · aktiv" if w["active"] else (" · minimiert" if w["minimized"] else "")
            rule = self._rule(w)
            if rule:
                flags += " · gesperrt" if rule["mode"] == "block" else " · fragt vor Eingaben"
            lines.append(f"{w['id']} · {w['caption']} ({w['cls']}) bei {x},{y} {size}{flags}")
        return [self._text("\n".join(lines))]

    def desktop_read_ui(self, args):
        window = self._target_window(args)
        frame = a11y_frame(window)
        origin = QPointF(window["cx"], window["cy"])
        interactive = str(args.get("filter") or "interactive") != "all"
        limit = max(20, min(int(args.get("max") or 250), 600))
        self.refs = {}
        lines = [f"Fenster „{window['caption']}“ ({window['cls']}), Koordinaten in Screenshot-Pixeln:"]
        for node, depth, role, name, rect, states in a11y_walk(frame, interactive):
            if not interactive and not name and role not in INTERACTIVE_ROLES:
                continue
            ref = f"d{len(self.refs) + 1}"
            self.refs[ref] = (node, origin, window["id"])
            value = a11y_text(node) if role in ("entry", "text", "password text", "combo box", "spin button") else ""
            indent = "  " * min(depth, 12) if not interactive else ""
            lines.append(indent + self._describe(ref, role, name, origin, rect, states, value if role != "password text" else ""))
            if len(self.refs) >= limit:
                lines.append(f"… gekürzt nach {limit} Elementen; desktop_find sucht gezielt.")
                break
        if len(lines) == 1:
            lines.append("Keine sichtbaren Elemente gefunden; nutze desktop_screenshot.")
        return [self._text("\n".join(lines))]

    def desktop_find(self, args):
        query = str(args.get("query") or "").strip().lower()
        if not query:
            raise RuntimeError("query fehlt: sichtbarer Text, Beschriftung oder Rolle")
        window = self._target_window(args)
        frame = a11y_frame(window)
        origin = QPointF(window["cx"], window["cy"])
        hits = []
        for node, _depth, role, name, rect, states in a11y_walk(frame, False):
            try:
                description = (node.get_description() or "").lower()
            except Exception:  # noqa: BLE001
                description = ""
            text = a11y_text(node) if not name and role in ("label", "static", "text", "paragraph", "heading") else ""
            haystack = f"{name} {description} {text}".lower()
            if query in haystack or query == role:
                # Exact names and controls first: those are what the agent wants to click.
                rank = (0 if name.lower() == query else 1) + (0 if role in INTERACTIVE_ROLES else 2)
                hits.append((rank, len(hits), node, role, name or text.strip()[:80], rect, states))
                if len(hits) >= 60:
                    break
        if not hits:
            return [self._text(f"Nichts zu „{query}“ in „{window['caption']}“ gefunden")]
        lines = []
        for _rank, _order, node, role, name, rect, states in sorted(hits, key=lambda hit: hit[:2])[:25]:
            ref = f"d{len(self.refs) + 1}"
            self.refs[ref] = (node, origin, window["id"])
            lines.append(self._describe(ref, role, name, origin, rect, states))
        return [self._text("\n".join(lines))]

    def desktop_get_text(self, args):
        window = self._target_window(args)
        frame = a11y_frame(window)
        if args.get("ref"):
            entry = self.refs.get(str(args["ref"]))
            if not entry:
                raise RuntimeError("Unbekannte Referenz; erst desktop_read_ui oder desktop_find")
            frame = entry[0]
        limit = max(500, min(int(args.get("maxChars") or 20000), 60000))
        parts, size, last = [], 0, ""
        for node, _depth, role, name, _rect, _states in a11y_walk(frame, False):
            text = a11y_text(node).strip() or (name if role in ("label", "heading", "link", "push button", "menu item") else "")
            if not text or text == last:
                continue
            last = text
            parts.append(text)
            size += len(text) + 1
            if size >= limit:
                parts.append("… gekürzt")
                break
        body = "\n".join(parts) if parts else "(kein Text über Barrierefreiheit verfügbar)"
        return [self._text(f"„{window['caption']}“\n\n{body}")]

    def desktop_wait_for(self, args):
        text = str(args.get("text") or "").strip().lower()
        title = str(args.get("window") or "").strip().lower()
        gone = bool(args.get("gone"))
        if not text and not title:
            raise RuntimeError("text oder window angeben")
        end = time.time() + max(1, min(float(args.get("seconds") or 10), 60))
        while True:
            windows = self.s.kwin.windows()
            present = True
            if title:
                present = any(title in w["caption"].lower() or title == w["cls"].lower() for w in windows)
            if present and text:
                present = False
                try:
                    window = self._target_window({"window": args.get("window")} if title else {})
                    for node, _d, role, name, _r, _s in a11y_walk(a11y_frame(window), False):
                        if text in name.lower() or (role in ("label", "text", "paragraph", "heading", "static") and text in a11y_text(node).lower()):
                            present = True
                            break
                except RuntimeError:
                    present = False
            if present != gone:
                return [self._text(("Verschwunden: " if gone else "Gefunden: ") + (text or title))]
            if time.time() >= end:
                raise RuntimeError(f"Zeit abgelaufen: „{text or title}“ {'noch da' if gone else 'nicht erschienen'}")
            pump(0.4)

    def desktop_clipboard(self, args):
        if args.get("text") is not None:
            subprocess.run(["wl-copy", "--type", "text/plain"], input=str(args["text"]).encode(), check=True, timeout=5, env=CHILD_ENV)
            return [self._text(f"In die Zwischenablage gelegt: {len(str(args['text']))} Zeichen")]
        got = subprocess.run(["wl-paste", "--no-newline", "--type", "text/plain"], capture_output=True, timeout=3, env=CHILD_ENV)
        if got.returncode != 0:
            return [self._text("Zwischenablage ist leer oder enthält keinen Text")]
        return [self._text(got.stdout.decode("utf-8", "replace")[:20000])]

    def _capture(self):
        """Full-resolution screenshot without Plum's own cursor, blocked apps blacked out."""
        self.overlay.hide_cursor = True
        self.overlay.repaint()
        pump(0.03)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                image = take_screenshot(os.path.join(tmp, "shot.png"))
        finally:
            self.overlay.hide_cursor = False
            self.overlay.update()
        self._black_out(image, self.overlay.geometry())
        return image

    def _ocr(self, image, region=None):
        """Words with boxes in screenshot pixels, via tesseract."""
        if not shutil.which("tesseract"):
            raise RuntimeError("Texterkennung fehlt (dnf install tesseract tesseract-langpack-deu)")
        ratio = image.width() / max(1, self.overlay.geometry().width()) / self.overlay.factor  # image px per shot px
        ox = oy = 0
        if region:
            ox, oy = region[0], region[1]
            image = image.copy(QRect(round(region[0] * ratio), round(region[1] * ratio), round(region[2] * ratio), round(region[3] * ratio)))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "ocr.png")
            image.save(path)
            out = subprocess.run(["tesseract", path, "-", "-l", "deu+eng", "--psm", "11", "tsv"],
                                 capture_output=True, text=True, timeout=60, env=CHILD_ENV).stdout
        words = []
        for line in out.splitlines()[1:]:
            cols = line.split("\t")
            if len(cols) < 12 or not cols[11].strip() or float(cols[10] or -1) < 40:
                continue
            left, top, width, height = (int(cols[i]) for i in (6, 7, 8, 9))
            words.append({
                "text": cols[11].strip(), "block": (cols[2], cols[3], cols[4]),
                "x": ox + left / ratio, "y": oy + top / ratio, "w": width / ratio, "h": height / ratio,
            })
        return words

    @staticmethod
    def _lines(words):
        lines = {}
        for word in words:
            line = lines.setdefault(word["block"], {"words": []})
            line["words"].append(word)
        out = []
        for line in lines.values():
            ws = line["words"]
            x0, y0 = min(w["x"] for w in ws), min(w["y"] for w in ws)
            x1, y1 = max(w["x"] + w["w"] for w in ws), max(w["y"] + w["h"] for w in ws)
            out.append({"text": " ".join(w["text"] for w in ws), "x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0, "words": ws})
        return sorted(out, key=lambda l: (round(l["y"] / 8), l["x"]))

    def _find_text(self, query, region=None):
        """Lines (or word runs) containing query: [(text, cx, cy)] in screenshot pixels."""
        needle = query.lower()
        hits = []
        for line in self._lines(self._ocr(self._capture(), region)):
            if needle not in line["text"].lower():
                continue
            ws = line["words"]
            # Narrow to the words that make up the match, so the click lands on them.
            for start in range(len(ws)):
                for end in range(start + 1, len(ws) + 1):
                    if needle in " ".join(w["text"] for w in ws[start:end]).lower():
                        part = ws[start:end]
                        x0, y0 = min(w["x"] for w in part), min(w["y"] for w in part)
                        x1, y1 = max(w["x"] + w["w"] for w in part), max(w["y"] + w["h"] for w in part)
                        hits.append((line["text"], round((x0 + x1) / 2), round((y0 + y1) / 2)))
                        break
                else:
                    continue
                break
        return hits

    def desktop_ocr(self, args):
        region = None
        if args.get("width") and args.get("height"):
            region = tuple(float(args.get(k) or 0) for k in ("x", "y", "width", "height"))
        query = str(args.get("query") or "").strip()
        if query:
            hits = self._find_text(query, region)
            if not hits:
                return [self._text(f"„{query}“ nicht auf dem Bildschirm gefunden")]
            return [self._text("\n".join(f"„{text[:100]}“ @ {x},{y}" for text, x, y in hits[:20]))]
        lines = self._lines(self._ocr(self._capture(), region))
        if not lines:
            return [self._text("Kein Text erkannt")]
        return [self._text("\n".join(f"@ {round(l['x'] + l['w'] / 2)},{round(l['y'] + l['h'] / 2)}  {l['text'][:160]}" for l in lines[:300]))]

    def desktop_wait_change(self, args):
        """Wait until a region (or the whole desktop) changes, or with still=true stops changing."""
        region = None
        if args.get("width") and args.get("height"):
            region = tuple(float(args.get(k) or 0) for k in ("x", "y", "width", "height"))
        still = bool(args.get("still"))
        end = time.time() + max(1, min(float(args.get("seconds") or 20), 120))

        def sample():
            image = self._capture()
            if region:
                ratio = image.width() / max(1, self.overlay.geometry().width()) / self.overlay.factor
                image = image.copy(QRect(*(round(v * ratio) for v in region)))
            return image.scaled(160, 90, Qt.IgnoreAspectRatio, Qt.SmoothTransformation).convertToFormat(QImage.Format_Grayscale8)

        def differs(a, b):
            changed = sum(1 for y in range(90) for x in range(160) if abs(a.pixelColor(x, y).value() - b.pixelColor(x, y).value()) > 18)
            return changed > 160 * 90 * 0.004

        previous = sample()
        calm = 0
        while time.time() < end:
            pump(1.0)
            current = sample()
            moved = differs(previous, current)
            previous = current
            if not still and moved:
                return [self._text("Der Bereich hat sich geändert")]
            calm = 0 if moved else calm + 1
            if still and calm >= 2:
                return [self._text("Der Bereich ist zur Ruhe gekommen")]
        raise RuntimeError("Zeit abgelaufen: " + ("noch in Bewegung" if still else "keine Änderung"))

    # ---- macros

    def desktop_macros(self, _args):
        macros = load_macros()
        if not macros:
            return [self._text("Keine Desktop-Makros. Der Nutzer nimmt sie im Tray unter „Vorführung aufnehmen“ auf.")]
        return [self._text("\n".join(f"„{m['name']}“ · {len(m['steps'])} Schritte · {m.get('created', '')}" for m in macros))]

    def desktop_macro_run(self, args):
        name = str(args.get("name") or "").strip().lower()
        macro = next((m for m in load_macros() if m["name"].lower() == name), None) or next(
            (m for m in load_macros() if name and name in m["name"].lower()), None)
        if not macro:
            raise RuntimeError(f"Kein Makro „{name}“; desktop_macros listet alle")
        log_lines = []
        for number, step in enumerate(macro["steps"], 1):
            try:
                self._replay(step)
            except Stopped:
                raise
            except Exception as error:  # noqa: BLE001
                log_lines.append(f"{number}. fehlgeschlagen: {error}")
                return [self._text(
                    f"Makro „{macro['name']}“ bei Schritt {number} von {len(macro['steps'])} angehalten. "
                    "Mach von hier aus von Hand weiter.\n" + "\n".join(log_lines))]
            log_lines.append(f"{number}. ok")
            pump(0.35)
        return [self._text(f"Makro „{macro['name']}“ abgespielt ({len(macro['steps'])} Schritte)")]

    def _replay(self, step):
        if step["kind"] == "click":
            local = None
            if step.get("window"):
                windows = self.s.kwin.windows()
                window = next((w for w in windows if w["cls"] == step["window"] and w["caption"] == step.get("caption")), None) \
                    or next((w for w in windows if w["cls"] == step["window"]), None)
                if not window:
                    raise RuntimeError(f"Fenster {step['window']} ist nicht offen")
                if not window["active"]:
                    self.s.kwin.activate(window["id"])
                    pump(0.3)
                if step.get("name"):
                    try:
                        frame = a11y_frame(window)
                        origin = QPointF(window["cx"], window["cy"])
                        for node, _d, role, name, rect, _st in a11y_walk(frame, False):
                            if name[:120] == step["name"] and role == step.get("role"):
                                local = self.overlay.local_point(QPointF(origin.x() + rect.x + rect.width / 2, origin.y() + rect.y + rect.height / 2))
                                break
                    except RuntimeError:
                        pass
                if local is None and step.get("rx") is not None:
                    local = self.overlay.local_point(QPointF(window["cx"] + step["rx"], window["cy"] + step["ry"]))
            if local is None:
                local = self.overlay.local_point(QPointF(step["x"], step["y"]))
            x, y = self.overlay.to_shot(local)
            self.desktop_click({"x": x, "y": y, "button": step.get("button", "left")})
        elif step["kind"] == "type":
            self._guard(None, "Text einzugeben")
            for code, shift in step["codes"]:
                if shift:
                    self.s.input.key(self.s.input.key_code("shift"), True)
                self.s.input.key(code, True)
                self.s.input.key(code, False)
                if shift:
                    self.s.input.key(self.s.input.key_code("shift"), False)
                pump(0.015)
        else:
            self._guard(None, f"Tasten zu drücken ({step['keys']})")
            mods = [self.s.input.key_code(m if m != "altgr" else "altgr") for m in step.get("mods", [])]
            for code in mods:
                self.s.input.key(code, True)
            for code in step["codes"]:
                self.s.input.key(code, True)
                self.s.input.key(code, False)
            for code in reversed(mods):
                self.s.input.key(code, False)

    # ---- act

    def desktop_activate_window(self, args):
        query = str(args.get("window") or "").strip()
        if not query:
            raise RuntimeError("window fehlt: Kennung aus desktop_windows, Titel oder Programmklasse")
        windows = self.s.kwin.windows()
        needle = query.lower()
        match = next((w for w in windows if w["id"] == query), None) or next(
            (w for w in windows if needle == w["cls"].lower() or needle in w["caption"].lower() or needle in w["cls"].lower()),
            None,
        )
        if not match:
            raise RuntimeError(f"Kein Fenster passt zu „{query}“; desktop_windows listet alle")
        result = self.s.kwin.activate(match["id"])
        center = self.overlay.local_point(QPointF(match["x"] + match["width"] / 2, match["y"] + 24))
        self._acting(center, "Fenster")
        self.overlay.glide(center, self._label())
        return [self._text(f"Fenster aktiviert: {result.get('caption', match['caption'])}")]

    def desktop_click(self, args):
        local = self._point(args)
        button = str(args.get("button") or "left")
        if button not in ("left", "right", "middle"):
            raise RuntimeError("button: left, right oder middle")
        count = 2 if args.get("double") else 1
        modifiers = [str(m) for m in (args.get("modifiers") or [])]
        self._guard(local, "zu klicken")
        self._acting(local, "Doppelklick" if count == 2 else ("Rechtsklick" if button == "right" else "Klick"))
        self._pointer_to(local)
        self.s.input.hold(modifiers, True)
        try:
            for index in range(count):
                self.s.input.button(button, True)
                pump(0.04)
                self.s.input.button(button, False)
                if index + 1 < count:
                    pump(0.08)
        finally:
            self.s.input.hold(list(reversed(modifiers)), False)
        self.overlay.ripple(local)
        pump(0.25)
        what = "Doppelklick" if count == 2 else {"left": "Klick", "right": "Rechtsklick", "middle": "Mittelklick"}[button]
        where = args.get("ref") or (f"„{args['text']}“" if args.get("text") and args.get("x") is None else f"{args.get('x')},{args.get('y')}")
        return [self._text(f"{what} bei {where}")]

    def desktop_hover(self, args):
        local = self._point(args)
        self._guard(local, "den Zeiger zu bewegen")
        self._acting(local, "Zeiger")
        self._pointer_to(local)
        pump(0.3)
        where = args.get("ref") or f"{args.get('x')},{args.get('y')}"
        return [self._text(f"Zeiger auf {where}")]

    def desktop_drag(self, args):
        start = self._point(args, "fromX", "fromY")
        end = self._point(args, "toX", "toY")
        self._guard(start, "zu ziehen")
        self._acting(start, "Ziehen")
        self._pointer_to(start)
        self.s.input.button("left", True)
        try:
            steps = 24
            for index in range(1, steps + 1):
                k = ease(index / steps)
                local = QPointF(start.x() + (end.x() - start.x()) * k, start.y() + (end.y() - start.y()) * k)
                self.s.input.move(self.overlay.global_point(local))
                self.overlay.set_cursor(local, self._label())
                self.overlay.repaint()
                pump(0.018)
            pump(0.08)
        finally:
            self.s.input.button("left", False)
        self.overlay.ripple(end)
        return [self._text(f"Gezogen von {args['fromX']},{args['fromY']} nach {args['toX']},{args['toY']}")]

    def desktop_scroll(self, args):
        if args.get("ref") or (args.get("x") is not None and args.get("y") is not None):
            local = self._point(args)
            self._guard(local, "zu scrollen")
            self._acting(local, "Scrollen")
            self._pointer_to(local)
        direction = str(args.get("direction") or "down")
        amount = max(1, min(int(float(args.get("amount") or 3)), 30))
        dx, dy = {"down": (0, -1), "up": (0, 1), "left": (-1, 0), "right": (1, 0)}.get(direction, (0, -1))
        point = self.overlay.cursor[0] if self.overlay.cursor else self.overlay.local_point(self.s.kwin.cursor())
        symbol = {"down": "↓", "up": "↑", "left": "←", "right": "→"}.get(direction, "↓")
        self.overlay.set_cursor(point, f"{symbol} Scrollen")
        self.overlay.ripple(point, COLORS["blue"])
        for _ in range(amount):
            self.s.input.wheel(dx, dy)
            pump(0.03)
        pump(0.2)
        return [self._text(f"{amount}× gescrollt ({direction})")]

    def desktop_press_key(self, args):
        keys = str(args.get("keys") or "").strip()
        if not keys:
            raise RuntimeError('keys fehlt, z. B. "Enter", "ctrl+s" oder "Tab Tab Enter"')
        self._guard(None, f"Tasten zu drücken ({keys})")
        if self.overlay.cursor:
            self._acting(self.overlay.cursor[0], keys)
        for spec in keys.split():
            self.s.input.combo(spec)
            pump(0.06)
        return [self._text(f"Gedrückt: {keys}")]

    def desktop_type(self, args):
        text = str(args.get("text") or "")
        if not text:
            raise RuntimeError("text fehlt")
        if args.get("ref") or (args.get("x") is not None and args.get("y") is not None):
            self.desktop_click({k: args[k] for k in ("x", "y", "ref") if args.get(k) is not None})
        self._guard(None, f"Text einzugeben ({len(text)} Zeichen)")
        if self.overlay.cursor:
            self._acting(self.overlay.cursor[0], "Tippen")
        if not shutil.which("wl-copy"):
            raise RuntimeError("wl-clipboard fehlt (dnf install wl-clipboard)")
        # Paste through the clipboard: exact for every character and layout.
        previous = None
        try:
            got = subprocess.run(["wl-paste", "--no-newline", "--type", "text/plain"], capture_output=True, timeout=2, env=CHILD_ENV)
            if got.returncode == 0:
                previous = got.stdout
        except (OSError, subprocess.SubprocessError):
            pass
        subprocess.run(["wl-copy", "--type", "text/plain"], input=text.encode(), check=True, timeout=5, env=CHILD_ENV)
        pump(0.08)
        active = self.s.kwin.active_class()
        terminal = str(active.get("cls", "")).lower() in TERMINALS
        self.s.input.combo("ctrl+shift+v" if terminal else "ctrl+v")
        pump(0.15)
        if args.get("submit"):
            self.s.input.combo("Enter")
        if previous is not None:
            QTimer.singleShot(
                1200, lambda: subprocess.run(["wl-copy", "--type", "text/plain"], input=previous, timeout=5, env=CHILD_ENV)
            )
        return [self._text(f"Eingefügt: {len(text)} Zeichen{' + Enter' if args.get('submit') else ''}")]

    def desktop_open(self, args):
        target = str(args.get("target") or "").strip()
        if not target:
            raise RuntimeError("target fehlt: App-Name, Datei oder URL")
        if "://" in target or target.startswith("mailto:") or os.path.exists(os.path.expanduser(target)):
            subprocess.Popen(["xdg-open", os.path.expanduser(target)], start_new_session=True, env=CHILD_ENV,
                             stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return [self._text(f"Geöffnet: {target}")]
        entry = find_desktop_entry(target)
        if not entry:
            raise RuntimeError(f"Keine App „{target}“ gefunden")
        command = ["kioclient", "exec", entry[0]] if shutil.which("kioclient") else ["gtk-launch", os.path.basename(entry[0])[:-8]]
        subprocess.Popen(command, start_new_session=True, env=CHILD_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return [self._text(f"Gestartet: {entry[1]}. Danach desktop_screenshot oder desktop_windows.")]

    def desktop_wait(self, args):
        seconds = max(0.1, min(float(args.get("seconds") or 1), 60))
        pump(seconds)
        return [self._text(f"{seconds:g} s gewartet")]

    # ---- show

    def desktop_point(self, args):
        point = self._point(args)
        self.overlay.glide(point, str(args.get("label") or self._label())[:200])
        return [self._text(f"Zeigt auf {args['x']},{args['y']}")]

    def desktop_annotate(self, args):
        shape = str(args.get("shape") or ("box" if args.get("width") else "circle"))
        rect = self._rect(args)
        mark = {"kind": shape, "color": self._color(args), "rect": rect, "label": str(args.get("label") or "")[:300]}
        self.overlay.glide(rect.center() + QPointF(8, 8), self._label())
        self.overlay.add(mark)
        return [self._text(f"Markiert ({shape}) bei {args['x']},{args['y']}")]

    def desktop_draw(self, args):
        points = [
            self.overlay.to_local(p[0], p[1])
            for p in (args.get("points") or [])[:400]
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
        if len(points) < 2:
            raise RuntimeError("points braucht mindestens zwei [x, y]-Punkte")
        self.overlay.glide(points[0], self._label())
        mark = {"kind": "stroke", "color": self._color(args), "points": [], "label": ""}
        self.overlay.add(mark)
        for count in range(1, len(points) + 1):
            mark["points"] = points[:count]
            self.overlay.set_cursor(points[count - 1], self._label())
            self.overlay.repaint()
            pump(0.012)
        mark["label"] = str(args.get("label") or "")[:300]
        self.overlay.update()
        return [self._text(f"Gezeichnet ({len(points)} Punkte)")]

    def desktop_guide_step(self, args):
        title = str(args.get("title") or "").strip()
        instruction = str(args.get("instruction") or "").strip()
        if not title or not instruction:
            raise RuntimeError("title und instruction fehlen")
        rect = self._rect(args) if args.get("x") is not None and args.get("y") is not None else None
        if rect is not None:
            shape = "box" if rect.width() else "circle"
            self.overlay.glide(rect.center() + QPointF(8, 8), self._label())
            self.overlay.add({"kind": shape, "color": COLORS["purple"], "rect": rect, "label": ""})
            target = rect.translated(self.overlay.global_point(QPointF(0, 0)))
            if not rect.width():
                target = QRectF(target.x() - 30, target.y() - 30, 60, 60)
        else:
            center = QPointF(QGuiApplication.primaryScreen().geometry().center())
            target = QRectF(center.x() - 200, center.y(), 0, 0)
        step = {
            "step": int(args.get("step") or 1),
            "total": int(args["total"]) if args.get("total") else None,
            "title": title,
            "instruction": instruction,
            "session": self.session.get("id"),
        }
        screen = QGuiApplication.screenAt(target.center().toPoint()) or QGuiApplication.primaryScreen()
        self.s.card.present(step, target, screen.geometry())
        return [self._text("Schritt angezeigt. Klickt der Nutzer „Erledigt“, kommt „✓ Schritt … erledigt“ als Nachricht.")]

    def desktop_clear(self, _args):
        self.overlay.clear()
        self.s.card.hide()
        return [self._text("Desktop-Markierungen entfernt")]


def find_desktop_entry(name):
    """(path, display name) of the .desktop file that best matches `name`."""
    dirs = [
        os.path.expanduser("~/.local/share/applications"),
        "/usr/share/applications",
        "/usr/local/share/applications",
        os.path.expanduser("~/.local/share/flatpak/exports/share/applications"),
        "/var/lib/flatpak/exports/share/applications",
    ]
    needle = name.lower().removesuffix(".desktop")
    best = None
    for directory in dirs:
        try:
            files = os.listdir(directory)
        except OSError:
            continue
        for file in files:
            if not file.endswith(".desktop"):
                continue
            path = os.path.join(directory, file)
            display, hidden = file[:-8], False
            try:
                with open(path, encoding="utf-8", errors="replace") as handle:
                    for line in handle:
                        if line.startswith("Name=") and display == file[:-8]:
                            display = line[5:].strip()
                        elif line.strip() in ("NoDisplay=true", "Hidden=true"):
                            hidden = True
            except OSError:
                continue
            stem = file[:-8].lower()
            score = (
                3 if needle in (stem, display.lower()) or stem.endswith("." + needle)
                else 2 if display.lower().startswith(needle)
                else 1 if needle in display.lower() or needle in stem
                else 0
            )
            if score and not hidden:
                score += 0.5
            if score and (not best or score > best[0]):
                best = (score, path, display)
    return (best[1], best[2]) if best else None


# --------------------------------------------------------------------------- bridge connection


def socket_urls(server_url):
    base = server_url.rstrip("/")
    if base.endswith("/mobile"):
        base = base[: -len("/mobile")]
    ws = "wss" + base[5:] if base.startswith("https") else "ws" + base[4:]
    return [f"{ws}/mobile/api/browser-bridge/ws", f"{ws}/api/browser-bridge/ws"]


class Bridge(threading.Thread):
    def __init__(self, config, app_state):
        super().__init__(daemon=True)
        self.config = config
        self.s = app_state
        self.loop = None
        self.socket = None
        self.pending_rpc = {}

    def rpc(self, method, params, timeout=40):
        """Call Plum (chat.send, sessions.list …) from the Qt thread and wait for the answer."""
        if not self.socket:
            raise RuntimeError("Nicht mit Plum verbunden")
        rpc_id = f"rpc-{uuid.uuid4().hex}"
        box = {}
        self.pending_rpc[rpc_id] = box
        self.send({"type": "rpc", "id": rpc_id, "method": method, "params": params})
        end = time.time() + timeout
        try:
            while "reply" not in box and time.time() < end:
                QApplication.processEvents()
                time.sleep(0.02)
        finally:
            self.pending_rpc.pop(rpc_id, None)
        reply = box.get("reply")
        if not reply:
            raise RuntimeError("Plum antwortet nicht")
        if not reply.get("ok"):
            raise RuntimeError(reply.get("error") or "Plum hat abgelehnt")
        return reply.get("data")

    def send(self, frame):
        if self.loop and self.socket:
            asyncio.run_coroutine_threadsafe(self.socket.send(json.dumps(frame)), self.loop)

    def send_state(self):
        self.send({"type": "state", "paused": self.s.mode == "paused", "mode": self.s.mode,
                   "desktopActivity": {**self.s.activity_state, "layout": self.s.layout, "screens": self.s.screen_info(),
                                       "chat": (self.s.stream or "\n\n".join(self.s.chat_lines[-2:]))[-4000:]},
                   "recording": bool(getattr(self.s, "recorder", None) and self.s.recorder.active)})

    def run(self):
        self.loop = asyncio.new_event_loop()
        self.loop.run_until_complete(self._forever())

    async def _forever(self):
        delay = 2
        while True:
            for url in socket_urls(self.config["serverUrl"]):
                try:
                    await self._session(url)
                    delay = 2
                except Exception as error:  # noqa: BLE001
                    log("connection failed:", url, error)
                finally:
                    self.socket = None
                    self.s.connected.emit(False)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60)

    async def _session(self, url):
        async with websockets.connect(url, max_size=48 * 1024 * 1024, ping_interval=20) as socket:
            await socket.send(
                json.dumps(
                    {
                        "type": "hello",
                        "token": self.config["token"],
                        "client": {
                            "kind": "desktop",
                            "name": "Desktop",
                            "version": VERSION,
                            "extensionVersion": VERSION,
                            "platform": f"{platform.system()} {os.environ.get('XDG_CURRENT_DESKTOP', '')}".strip(),
                            "label": self.config.get("label") or platform.node(),
                        },
                    }
                )
            )
            async for raw in socket:
                frame = json.loads(raw)
                if frame.get("type") == "welcome":
                    self.socket = socket
                    self.send_state()
                    self.s.connected.emit(True)
                    log("connected:", url)
                elif frame.get("type") == "error":
                    raise RuntimeError(frame.get("message") or "rejected")
                elif frame.get("type") == "update":
                    self.s.update.emit(frame)
                elif frame.get("type") == "rules":
                    self.s.rules_changed.emit(frame.get("rules") or [])
                elif frame.get("type") == "event":
                    self.s.chat_event.emit(frame)
                elif frame.get("type") == "control" and frame.get("action"):
                    self.s.remote_action.emit(frame)
                elif frame.get("type") == "control" and frame.get("mode") in MODE_LABELS:
                    self.s.remote_mode.emit(frame["mode"])
                elif frame.get("type") == "control" and frame.get("record") in ("start", "stop", "cancel"):
                    self.s.remote_record.emit(frame["record"])
                elif frame.get("type") == "rpcResult":
                    box = self.pending_rpc.get(frame.get("id"))
                    if box is not None:
                        box["reply"] = frame
                elif frame.get("type") == "call":
                    self.s.tools.call.emit(
                        frame["id"], frame.get("tool", ""), frame.get("args") or {}, frame.get("session") or {}
                    )
            self.socket = None
            self.s.connected.emit(False)


# --------------------------------------------------------------------------- confirm, record, chat


class ConfirmCard(Floating):
    """'Plum möchte …' for apps whose rule asks before every input."""

    def __init__(self):
        super().__init__()
        self.setFixedWidth(380)
        column = QVBoxLayout(self.card)
        column.setContentsMargins(16, 14, 16, 12)
        self.title = QLabel()
        self.title.setObjectName("title")
        self.title.setWordWrap(True)
        self.text = QLabel()
        self.text.setObjectName("text")
        self.text.setWordWrap(True)
        column.addWidget(self.title)
        column.addWidget(self.text)
        row = QHBoxLayout()
        row.addStretch(1)
        self.answer = None
        for label, value, name in (("Ablehnen", "deny", "ghost"), ("5 Min. erlauben", "window", "ghost"), ("Erlauben", "once", "")):
            button = QPushButton(label)
            if name:
                button.setObjectName(name)
            button.clicked.connect(lambda _c=False, v=value: setattr(self, "answer", v))
            row.addWidget(button)
        column.addLayout(row)

    def ask(self, title, text, anchor_global, screen_rect):
        self.title.setText(title)
        self.text.setText(text)
        self.answer = None
        self.adjustSize()
        x = max(screen_rect.left() + 8, min(anchor_global.x() + 30, screen_rect.right() - self.width() - 8))
        y = max(screen_rect.top() + 8, min(anchor_global.y() - self.height() / 2, screen_rect.bottom() - self.height() - 8))
        self.move(round(x), round(y))
        self.show()
        self.raise_()
        end = time.time() + 120
        try:
            while self.answer is None and time.time() < end:
                pump(0.05)
        finally:
            self.hide()
        return self.answer or "deny"


class RecordPill(Floating):
    """'● Vorführung · n Schritte · Beenden' while a demonstration is recorded."""

    def __init__(self, on_stop, on_cancel):
        super().__init__()
        row = QHBoxLayout(self.card)
        row.setContentsMargins(14, 8, 8, 8)
        self.label = QLabel()
        self.label.setObjectName("title")
        row.addWidget(self.label)
        cancel = QPushButton("Verwerfen")
        cancel.setObjectName("ghost")
        cancel.clicked.connect(on_cancel)
        stop = QPushButton("Beenden")
        stop.setObjectName("stop")
        stop.clicked.connect(on_stop)
        row.addWidget(cancel)
        row.addWidget(stop)

    def show_count(self, count):
        self.label.setText(f"● Vorführung · {count} Schritte")
        self.adjustSize()
        screen = QGuiApplication.primaryScreen().geometry()
        self.move(screen.center().x() - self.width() // 2, screen.top() + 14)
        self.show()
        self.raise_()


class TextCard(Floating):
    """A small input at the desktop: message to Plum, or a name for a macro."""

    def __init__(self):
        super().__init__()
        self.setFixedWidth(420)
        column = QVBoxLayout(self.card)
        column.setContentsMargins(16, 14, 16, 12)
        self.title = QLabel()
        self.title.setObjectName("title")
        self.title.setWordWrap(True)
        column.addWidget(self.title)
        self.edit = QLineEdit()
        self.edit.setStyleSheet("QLineEdit { background: rgba(255,255,255,0.08); color: white; border: 1px solid rgba(255,255,255,0.25); border-radius: 8px; padding: 7px; }")
        self.edit.returnPressed.connect(self._ok)
        column.addWidget(self.edit)
        row = QHBoxLayout()
        row.addStretch(1)
        cancel = QPushButton("Abbrechen")
        cancel.setObjectName("ghost")
        cancel.clicked.connect(self.hide)
        self.ok = QPushButton("Senden")
        self.ok.clicked.connect(self._ok)
        row.addWidget(cancel)
        row.addWidget(self.ok)
        column.addLayout(row)
        self.callback = None
        # Unlike the other cards this one takes keyboard focus.
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool)
        self.setAttribute(Qt.WA_ShowWithoutActivating, False)

    def _ok(self):
        text = self.edit.text().strip()
        self.hide()
        if text and self.callback:
            self.callback(text)

    def prompt(self, title, button, callback, preset=""):
        self.title.setText(title)
        self.ok.setText(button)
        self.callback = callback
        self.edit.setText(preset)
        self.adjustSize()
        screen = QGuiApplication.primaryScreen().geometry()
        self.move(screen.center().x() - self.width() // 2, screen.top() + screen.height() // 4)
        self.show()
        self.raise_()
        self.activateWindow()
        self.edit.setFocus()


# Real keyboard and mouse: Escape stops Plum, and demonstrations are recorded.

KEY_CHARS = {f"KEY_{c}": c.lower() for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"}
KEY_CHARS.update({f"KEY_{d}": d for d in "0123456789"})
KEY_CHARS.update({"KEY_SPACE": " ", "KEY_MINUS": "-", "KEY_DOT": ".", "KEY_COMMA": ",", "KEY_SLASH": "/"})
KEY_LABELS = {
    "KEY_ENTER": "Enter", "KEY_TAB": "Tab", "KEY_ESC": "Escape", "KEY_BACKSPACE": "Backspace", "KEY_DELETE": "Delete",
    "KEY_UP": "Up", "KEY_DOWN": "Down", "KEY_LEFT": "Left", "KEY_RIGHT": "Right", "KEY_HOME": "Home", "KEY_END": "End",
    "KEY_PAGEUP": "PageUp", "KEY_PAGEDOWN": "PageDown",
}
MOD_KEYS = {"KEY_LEFTCTRL": "ctrl", "KEY_RIGHTCTRL": "ctrl", "KEY_LEFTSHIFT": "shift", "KEY_RIGHTSHIFT": "shift",
            "KEY_LEFTALT": "alt", "KEY_RIGHTALT": "altgr", "KEY_LEFTMETA": "meta", "KEY_RIGHTMETA": "meta"}


class InputWatcher(QObject):
    """Reads the physical keyboards and mice (not Plum's own virtual devices)."""

    escape = Signal()
    clicked = Signal(str)  # button
    key = Signal(int, str, object)  # code, name, held modifiers
    human = Signal(bool)
    context_click = Signal()

    def __init__(self):
        super().__init__()
        self.recording = False
        self.running = True
        threading.Thread(target=self._run, daemon=True).start()

    def _devices(self):
        from evdev import InputDevice, ecodes as e, list_devices
        out = []
        for path in list_devices():
            try:
                device = InputDevice(path)
            except OSError:
                continue
            if device.name.startswith("Plum Desktop"):
                continue
            keys = device.capabilities().get(e.EV_KEY, [])
            if e.KEY_ESC in keys or e.BTN_LEFT in keys:
                out.append(device)
            else:
                device.close()
        return out

    def _run(self):
        try:
            from evdev import ecodes as e
            import selectors
        except ImportError:
            log("python-evdev missing: no Escape stop and no demonstrations")
            return
        while self.running:
            devices = self._devices()
            if not devices:
                log("no readable keyboard/mouse (udev rule 70-plum-desktop.rules missing?); retry in 60 s")
                time.sleep(60)
                continue
            selector = selectors.DefaultSelector()
            for device in devices:
                selector.register(device, selectors.EVENT_READ)
            held = set()
            from evdev import list_devices
            known = sorted(list_devices())
            rescan = time.time() + 5
            last_human = 0.0
            try:
                while self.running:
                    # Keyboards plugged in later (Bluetooth, docks) join after a few seconds.
                    if time.time() > rescan:
                        rescan = time.time() + 5
                        if sorted(list_devices()) != known:
                            break
                    for key, _mask in selector.select(timeout=2):
                        for event in key.fileobj.read():
                            if ((event.type == e.EV_KEY and event.value == 1) or
                                    event.type in (e.EV_REL, e.EV_ABS)) and time.time() - last_human > 0.15:
                                last_human = time.time()
                                self.human.emit(event.type == e.EV_KEY and event.code < e.BTN_MISC)
                            if event.type != e.EV_KEY:
                                continue
                            name = e.KEY.get(event.code) or e.BTN.get(event.code)
                            name = name[0] if isinstance(name, list) else name
                            if not name:
                                continue
                            if name in MOD_KEYS:
                                (held.add if event.value else held.discard)(MOD_KEYS[name])
                                continue
                            if event.value != 1:
                                continue
                            if name == "KEY_ESC" and not held:
                                self.escape.emit()
                            if name == "BTN_LEFT":
                                self.context_click.emit()
                            if not self.recording:
                                continue
                            if name in ("BTN_LEFT", "BTN_RIGHT", "BTN_MIDDLE"):
                                self.clicked.emit({"BTN_LEFT": "left", "BTN_RIGHT": "right", "BTN_MIDDLE": "middle"}[name])
                            elif name.startswith("KEY_"):
                                self.key.emit(event.code, name, sorted(held))
            except OSError:
                time.sleep(2)  # a device went away; rescan
            finally:
                selector.close()
                for device in devices:
                    try:
                        device.close()
                    except OSError:
                        pass


class Recorder(QObject):
    """A demonstration: steps with the clicked element, screenshots, keys and text."""

    def __init__(self, app_state):
        super().__init__()
        self.s = app_state
        self.steps = []
        self.shots = []
        self.active = False

    def start(self):
        self.steps, self.shots = [], []
        self.active = True
        self.s.watcher.recording = True
        self.s.record_pill.show_count(0)
        self.s.bridge.send_state()

    def stop(self):
        self.active = False
        self.s.watcher.recording = False
        self.s.record_pill.hide()
        self.s.bridge.send_state()

    def _flush_text(self):
        if self.steps and self.steps[-1]["kind"] == "type" and not self.steps[-1].get("closed"):
            self.steps[-1]["closed"] = True

    def on_click(self, button):
        if not self.active:
            return
        self._flush_text()
        try:
            point = self.s.kwin.cursor()
            windows = self.s.kwin.windows()
        except RuntimeError:
            return
        tools = self.s.tools
        local = self.s.overlay.local_point(point)
        window = tools._window_at(windows, local)
        if window and window["id"] == "":
            window = None
        step = {"kind": "click", "button": button, "x": point.x(), "y": point.y()}
        if window:
            if self.s.record_pill.geometry().contains(point.toPoint()):
                return  # the pill's own buttons
            rule = tools._rule(window)
            step.update(window=window["cls"], caption=window["caption"],
                        rx=point.x() - window["cx"], ry=point.y() - window["cy"])
            if not (rule and rule["mode"] == "block"):
                element = element_at(window, point)
                if element:
                    step.update(role=element[0], name=element[1])
        self.steps.append(step)
        if len(self.shots) < 40 and not (window and (tools._rule(window) or {}).get("mode") == "block"):
            QTimer.singleShot(350, lambda s=step, p=point: self._shot(s, p))
        self.s.record_pill.show_count(len(self.steps))

    def _shot(self, step, point):
        try:
            with tempfile.TemporaryDirectory() as tmp:
                image = take_screenshot(os.path.join(tmp, "s.png"))
        except Exception:  # noqa: BLE001
            return
        logical = self.s.overlay.geometry()
        self.s.tools._black_out(image, logical)
        ratio = image.width() / max(1, logical.width())
        # Around the click on its screen, not the whole desktop.
        screen = (QGuiApplication.screenAt(point.toPoint()) or QGuiApplication.primaryScreen()).geometry()
        crop = image.copy(QRect(round((screen.x() - logical.x()) * ratio), round((screen.y() - logical.y()) * ratio),
                                round(screen.width() * ratio), round(screen.height() * ratio)))
        painter = QPainter(crop)
        painter.setRenderHint(QPainter.Antialiasing)
        painter.setPen(QPen(QColor("#ea2143"), max(4, round(4 * ratio))))
        cx, cy = (point.x() - screen.x()) * ratio, (point.y() - screen.y()) * ratio
        painter.drawEllipse(QPointF(cx, cy), 28 * ratio, 28 * ratio)
        painter.end()
        scale = min(1.0, 1280 / max(crop.width(), crop.height()))
        small = crop.scaled(round(crop.width() * scale), round(crop.height() * scale), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        data = QByteArray()
        buffer = QBuffer(data)
        buffer.open(QIODevice.WriteOnly)
        small.save(buffer, "JPEG", 72)
        step["shot"] = len(self.shots) + 1
        self.shots.append({"data": base64.b64encode(bytes(data)).decode(), "mimeType": "image/jpeg",
                           "filename": f"schritt-{self.steps.index(step) + 1}.jpg"})

    def on_key(self, code, name, held):
        if not self.active:
            return
        mods = [m for m in held if m != "shift"]
        char = KEY_CHARS.get(name)
        if char is not None and not mods:
            if self.s.input.swap_yz and char in "yz":
                char = "z" if char == "y" else "y"
            if "shift" in held:
                char = char.upper()
            last = self.steps[-1] if self.steps else None
            if not last or last["kind"] != "type" or last.get("closed"):
                last = {"kind": "type", "text": "", "codes": []}
                self.steps.append(last)
            last["text"] += char
            last["codes"].append([code, "shift" in held])
        else:
            self._flush_text()
            label = KEY_LABELS.get(name) or name.removeprefix("KEY_").lower()
            self.steps.append({"kind": "key", "keys": "+".join([*held, label]), "codes": [code], "mods": list(held)})
        self.s.record_pill.show_count(len(self.steps))

    def describe(self):
        lines = []
        for number, step in enumerate(self.steps, 1):
            if step["kind"] == "click":
                where = f" in „{step['caption'][:60]}“ ({step['window']})" if step.get("window") else ""
                what = f"{step['role']} „{step['name']}“" if step.get("name") else (step.get("role") or "Stelle")
                button = {"left": "Klick", "right": "Rechtsklick", "middle": "Mittelklick"}[step["button"]]
                shot = f" [Bild {step['shot']}]" if step.get("shot") else ""
                lines.append(f"{number}. {button} auf {what}{where}{shot}")
            elif step["kind"] == "type":
                lines.append(f"{number}. Getippt: „{step['text']}“ (Tastatur ohne Sonderzeichen erkannt)")
            else:
                lines.append(f"{number}. Taste {step['keys']}")
        return lines


def element_at(window, point):
    """(role, name) of the innermost named accessible under a global point."""
    if Atspi is None:
        return None
    try:
        frame = a11y_frame(window)
    except RuntimeError:
        return None
    rx, ry = point.x() - window["cx"], point.y() - window["cy"]
    best = None
    for _node, _depth, role, name, rect, _states in a11y_walk(frame, False):
        if rect.x <= rx < rect.x + rect.width and rect.y <= ry < rect.y + rect.height and name:
            area = rect.width * rect.height
            if role in INTERACTIVE_ROLES:
                area /= 4  # prefer the control over the label inside it
            if best is None or area <= best[0]:
                best = (area, role, name[:120])
    return (best[1], best[2]) if best else None


MACROS = os.path.join(CONFIG_DIR, "macros.json")


def load_macros():
    try:
        with open(MACROS, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return []


def save_macros(macros):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    with open(MACROS, "w", encoding="utf-8") as handle:
        json.dump(macros, handle, ensure_ascii=False, indent=1)


# --------------------------------------------------------------------------- app


class App(QObject):
    connected = Signal(bool)
    update = Signal(object)
    rules_changed = Signal(object)
    remote_mode = Signal(str)
    remote_record = Signal(str)
    chat_event = Signal(object)
    remote_action = Signal(object)

    def __init__(self, config):
        super().__init__()
        self.state = load_state()
        self.mode = self.state.get("mode") if self.state.get("mode") in MODE_LABELS else "control"
        self.overlay = Overlay(self.state.get("factor"))
        self.overlay.glow_enabled = self.state.get("edgeGlow", True) is not False
        self.input = Input(self.overlay.geometry())
        self.kwin = KWin()
        self.pill = Pill(lambda: self.set_mode("paused"))
        self.card = GuideCard(self.guide_done)
        self.bridge = Bridge(config, self)
        self.tools = Tools(self)
        self.online = False
        self.connected.connect(self._on_connected)
        self.update.connect(self._self_update)
        self.config = config
        self.rules = self.state.get("rules") if isinstance(self.state.get("rules"), list) else []
        self.allowed_until = {}
        self.last_action = 0.0
        self.last_session = self.state.get("session") or {}
        self.activity_state = {"sessionId": "", "sessionName": "Plum", "status": "Bereit", "action": "",
                               "progress": "", "history": [], "result": "", "resultTarget": ""}
        self.layout = {"chatScreen": "primary", "chatPlacement": "floating", "chatVisible": True, "chatZoom": 100, "chatInsetTop": 0,
                       **self.state.get("layout", {})}
        self.chat_lines = []
        self.stream = ""
        self.turn_active = False
        self.selection_pending = False
        self.pending_context = None
        self.dock = DesktopDock(self)
        self.confirm = ConfirmCard()
        self.text_card = TextCard()
        self.record_pill = RecordPill(self.stop_recording, self.cancel_recording)
        self.watcher = InputWatcher()
        self.recorder = Recorder(self)
        self.watcher.escape.connect(self._escape)
        self.watcher.clicked.connect(self.recorder.on_click)
        self.watcher.key.connect(self.recorder.on_key)
        self.watcher.human.connect(self._human_input)
        self.watcher.context_click.connect(self._context_click)
        self.rules_changed.connect(self._set_rules)
        self.remote_mode.connect(self.set_mode)
        self.remote_record.connect(self._remote_record)
        self.remote_action.connect(self._remote_action)
        self.kwin.desktop_action.connect(lambda action: self._remote_action({"action": action}))
        self.chat_event.connect(self._chat_event)
        self._tray()
        self._install_chat_launcher()
        self.render_timer = QTimer(self)
        self.activity_dirty = False
        self.render_timer.timeout.connect(self._flush_activity)
        self.render_timer.start(250)
        QGuiApplication.instance().screenAdded.connect(lambda _screen: self._screens_changed())
        QGuiApplication.instance().screenRemoved.connect(lambda _screen: QTimer.singleShot(100, self._screens_changed))

    def publish_activity(self):
        self.dock.render()
        self.activity_dirty = True

    def _flush_activity(self):
        self.dock.render()
        if self.activity_dirty:
            self.activity_dirty = False
            self.bridge.send_state()

    @staticmethod
    def screen_info():
        return [{"name": s.name(), "width": s.geometry().width(), "height": s.geometry().height(),
                 "primary": s == QGuiApplication.primaryScreen()} for s in QGuiApplication.screens()]

    @staticmethod
    def _install_chat_launcher():
        directory = os.path.expanduser("~/.local/share/applications")
        try:
            os.makedirs(directory, exist_ok=True)
            with open(os.path.join(directory, "ch.zwaetschge.plum-chat.desktop"), "w", encoding="utf-8") as handle:
                handle.write("[Desktop Entry]\nType=Application\nName=Plum Chat\nComment=Desktop-Chat ein- oder ausblenden\n"
                             "Icon=system-users\nExec=gdbus call --session --dest ch.zwaetschge.PlumDesktop --object-path / "
                             "--method ch.zwaetschge.PlumDesktop.desktop toggle_chat\nCategories=Utility;\n")
        except OSError as error:
            log("chat launcher not saved:", error)

    def _screens_changed(self):
        geometry = QGuiApplication.primaryScreen().virtualGeometry()
        if self.overlay.geometry() != geometry:
            self.set_mode("paused")
            self.overlay.setGeometry(geometry)
            self.input.area = geometry
            self.overlay.factor = min(1.0, SHOT_MAX_EDGE / max(geometry.width(), geometry.height()))
            self.overlay.clear()
            self.overlay.focus_screen = None
            self.tools.refs.clear()
            self.activity_state.update(status="Pausiert", action="Bildschirmaufteilung geändert · Weiter setzt fort")
        self.dock.place_chat()
        self.dock.clamp()
        self.publish_activity()

    def set_layout(self, changes, reposition=True):
        for key in ("chatScreen", "chatPlacement", "chatVisible", "chatZoom", "chatInsetTop"):
            if key in changes:
                self.layout[key] = changes[key]
        self.layout["chatZoom"] = max(100, min(250, int(self.layout.get("chatZoom") or 100)))
        self.layout["chatInsetTop"] = max(0, min(200, int(self.layout.get("chatInsetTop") or 0)))
        self.state["layout"] = self.layout
        save_state(self.state)
        if reposition:
            self.dock.place_chat()
        self.publish_activity()

    def attach_session(self, session):
        session_id = session.get("id")
        if not session_id or session_id == self.activity_state["sessionId"]:
            return
        old = self.activity_state["sessionId"]
        self.last_session = {"id": session_id, "name": str(session.get("name") or "Plum")[:100]}
        self.state["session"] = self.last_session
        save_state(self.state)
        self.activity_state.update(sessionId=session_id, sessionName=self.last_session["name"],
                                   status="Verbinde Chat", action="", progress="", history=[], result="", resultTarget="")
        self.chat_lines = []
        self.stream = ""
        self.turn_active = False
        self.dock.present()
        self.dock.place_chat()
        QTimer.singleShot(0, lambda: self._load_chat(session_id, old))

    def _load_chat(self, session_id, old=""):
        try:
            if old:
                self.bridge.rpc("chat.close", {"sessionId": old})
            data = self.bridge.rpc("chat.open", {"sessionId": session_id, "limit": 16}) or {}
            if self.activity_state["sessionId"] != session_id:
                return
            history = [f"{'Du' if m.get('role') == 'user' else 'Plum'}: {str(m.get('content') or '')[-4000:]}"
                       for m in data.get("messages", []) if m.get("role") in ("user", "assistant")]
            self.chat_lines = (history + self.chat_lines)[-16:]
            self.turn_active = bool(data.get("session", {}).get("busy"))
            self.activity_state["status"] = "Arbeitet" if self.turn_active else "Bereit"
            sessions = self.bridge.rpc("sessions.list", {}) or []
            self.dock.sessions.clear()
            for item in sessions:
                self.dock.sessions.addItem(str(item.get("name") or item["id"]), item["id"])
            self.dock.sessions.setCurrentIndex(max(0, self.dock.sessions.findData(session_id)))
        except RuntimeError as error:
            self.activity_state.update(status="Chat nicht verbunden", action=str(error)[:240])
        self.publish_activity()

    def record_step(self, text):
        self.activity_state["history"] = (self.activity_state["history"] +
            [time.strftime("%H:%M:%S") + " · " + str(text)[:280]])[-12:]
        self.publish_activity()

    @staticmethod
    def describe_action(tool, args):
        labels = {"desktop_click": "Klicke", "desktop_type": f"Gebe {len(str(args.get('text', '')))} Zeichen ein",
                  "desktop_press_key": "Drücke Tasten", "desktop_scroll": "Scrolle", "desktop_hover": "Bewege Zeiger",
                  "desktop_drag": "Ziehe Element", "desktop_activate_window": "Öffne Fenster",
                  "desktop_open": "Öffne Programm oder Datei", "desktop_screenshot": "Schaue auf den Bildschirm",
                  "desktop_read_ui": "Lese Fensterelemente", "desktop_find": "Suche Element", "desktop_wait": "Warte",
                  "desktop_macro_run": "Führe Vorführung aus"}
        text = labels.get(tool, "Prüfe Desktop")
        # Never echo typed text, clipboard contents or full URL query parameters.
        target = args.get("window") or args.get("ref")
        return (text + (" · " + str(target)[:100] if target else ""))[:240]

    def preview(self, tool, args):
        text = self.describe_action(tool, args)
        self.activity_state.update(status="Arbeitet", action=text, result="", resultTarget="")
        self.turn_active = True
        self.overlay.set_note(text, self.activity_state["sessionName"])
        self.dock.present()
        self.publish_activity()
        pump(0.5)

    def _chat_event(self, frame):
        data = frame.get("payload") or {}
        if data.get("sessionId") != self.activity_state["sessionId"]:
            return
        event = frame.get("event")
        if event == "session:output" and isinstance(data.get("content"), str):
            self.stream = (self.stream + data["content"])[-12000:]
            if self.mode != "paused":
                self.overlay.set_note(self.stream[-220:], self.activity_state["sessionName"])
            self.turn_active = True
            if self.mode != "paused":
                self.activity_state["status"] = "Arbeitet"
        elif event == "session:message":
            role, content = data.get("role"), data.get("content")
            if role in ("user", "assistant") and isinstance(content, str) and content:
                self.chat_lines = (self.chat_lines + [f"{'Du' if role == 'user' else 'Plum'}: {content[-6000:]}"])[-16:]
                if role == "assistant":
                    self.stream = ""
                    self.overlay.set_note(content[-220:], self.activity_state["sessionName"])
        elif event == "session:tool_use":
            summary = str(data.get("actionSummary") or data.get("toolName") or "Arbeitet")[:240]
            if data.get("status") in ("completed", "error"):
                self.record_step(("Fehler: " if data.get("status") == "error" else "") + summary)
            elif self.mode != "paused":
                self.activity_state.update(status="Arbeitet", action=summary)
            self.turn_active = True
        elif event in ("session:permission_request", "session:question_request"):
            self.activity_state.update(status="Braucht deine Antwort", action="Bitte im Chat antworten")
        elif event == "session:error":
            self.activity_state.update(status="Fehler", result=str(data.get("error") or "Auftrag unterbrochen")[:2000])
            self.turn_active = False
        elif event == "session:lifecycle":
            if data.get("busy"):
                self.turn_active = True
                if self.mode != "paused":
                    self.activity_state["status"] = "Arbeitet"
            elif self.turn_active:
                self._finish_turn()
        elif event == "session:status" and data.get("status") not in (None, "running") and self.turn_active:
            self._finish_turn()
        elif event == "session:thinking" and data.get("isThinking") and self.mode != "paused":
            self.activity_state.update(status="Arbeitet", action="Überlegt den nächsten Schritt")
        self.publish_activity()

    def _finish_turn(self):
        self.turn_active = False
        if self.stream:
            self.chat_lines = (self.chat_lines + ["Plum: " + self.stream])[-16:]
            self.stream = ""
        result = next((line[6:] for line in reversed(self.chat_lines) if line.startswith("Plum: ")), "Turn beendet")
        if self.activity_state["status"] not in ("Gestoppt", "Fehler", "Du übernimmst gerade", "Braucht deine Antwort"):
            self.activity_state.update(status="Abgeschlossen", action="", result=self.activity_state["result"] or result[-2000:])
        self.overlay.stop_activity()

    def send_message(self, text):
        try:
            session_id = self._session_id()
            self.attach_session({"id": session_id, "name": self.last_session.get("name")})
            params = {"sessionId": session_id, "message": text, "activeFollowupMode": "steer",
                      "clientMessageId": f"desktop-{uuid.uuid4().hex}"}
            if self.pending_context:
                params["message"] = self.pending_context["description"] + "\n\n" + text
                params["images"] = self.pending_context["images"]
            reply = self.bridge.rpc("chat.send", params)
            if isinstance(reply, dict) and (reply.get("success") is False or reply.get("error")):
                raise RuntimeError(str(reply.get("error") or "Senden fehlgeschlagen"))
            self.pending_context = None
            self.turn_active = True
            self.activity_state.update(status="Arbeitet" if self.mode != "paused" else "Pausiert", result="", resultTarget="")
            self.publish_activity()
            return True
        except RuntimeError as error:
            self.activity_state.update(status="Senden fehlgeschlagen", action=str(error)[:240])
            self.publish_activity()
            return False

    def stop_task(self):
        self.set_mode("paused")
        self.turn_active = False
        self.activity_state.update(status="Gestoppt", action="", result="Auftrag gestoppt. Mit einer Nachricht neu ansetzen.")
        self.selection_pending = False
        try:
            if self.activity_state["sessionId"]:
                self.bridge.rpc("chat.interrupt", {"sessionId": self.activity_state["sessionId"]})
        except RuntimeError as error:
            self.activity_state["result"] = f"Desktop gestoppt; Chat-Stopp fehlgeschlagen: {error}"[:2000]
        self.publish_activity()

    def _human_input(self, keyboard=False):
        if self.mode == "paused" or self.recorder.active or self.selection_pending:
            return
        # Typing into Plum's own chat must remain possible during agent work.
        if keyboard:
            focus = QApplication.focusWidget()
            if focus and (self.dock.chat_window.isAncestorOf(focus) or self.text_card.isAncestorOf(focus)):
                return
        point = QCursor.pos()
        if any(w.isVisible() and w.geometry().contains(point) for w in
               (self.dock, self.dock.chat_window, self.confirm, self.text_card)):
            return
        if self.tools.busy or self.turn_active:
            self.set_mode("paused")
            self.activity_state.update(status="Du übernimmst gerade", action="Mit Weiter die Desktop-Steuerung zurückgeben")
            self.publish_activity()

    def select_context(self):
        self.set_mode("paused")
        self.selection_pending = True
        self.activity_state.update(status="Wähle eine Stelle", action="Klicke in das gewünschte Fenster · Esc bricht ab")
        self.publish_activity()

    def _context_click(self):
        if not self.selection_pending:
            return
        QTimer.singleShot(120, self._capture_context)

    def _capture_context(self):
        if not self.selection_pending:
            return
        try:
            point = self.kwin.cursor()
            if any(w.isVisible() and w.geometry().contains(point.toPoint()) for w in (self.dock, self.dock.chat_window)):
                return
            self.selection_pending = False
            local = self.overlay.local_point(point)
            windows = self.kwin.windows()
            window = self.tools._window_at(windows, local) or {}
            if (self.tools._rule(window) or {}).get("mode") == "block":
                raise RuntimeError("Dieses Fenster ist für Plum gesperrt")
            x, y = self.overlay.to_shot(local)
            self.pending_context = {"description": f"Hier weitermachen: Fenster {window.get('caption', '?')}, Stelle {x},{y} in Screenshot-Pixeln.",
                                    "images": []}
            image = self.tools._capture()
            image = image.scaledToWidth(min(1568, image.width()), Qt.SmoothTransformation)
            raw = QByteArray()
            buffer = QBuffer(raw)
            buffer.open(QIODevice.WriteOnly)
            image.save(buffer, "JPEG", 75)
            self.pending_context["images"] = [{"data": base64.b64encode(bytes(raw)).decode(),
                "mimeType": "image/jpeg", "filename": "desktop-context.jpg"}]
            self.overlay.ripple(local)
            self.activity_state.update(status="Stelle ausgewählt", action="Beschreibe im Plum-Chat, was hier passieren soll")
            self.set_layout({"chatVisible": True})
            self.dock.message.setFocus()
        except Exception as error:
            self.activity_state.update(status="Auswahl fehlgeschlagen", action=str(error)[:240])
        self.publish_activity()

    def open_result(self):
        target = self.activity_state["resultTarget"]
        if target:
            subprocess.Popen(["xdg-open", target], env=CHILD_ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def _remote_action(self, frame):
        action = frame.get("action")
        if action == "stop":
            self.stop_task()
        elif action == "message":
            self.send_message(str(frame.get("message") or "")[:4000])
        elif action == "context":
            self.select_context()
        elif action == "open_result":
            self.open_result()
        elif action == "layout":
            self.set_layout(frame.get("layout") or {})
        elif action in ("toggle_chat", "show_chat", "hide_chat"):
            self.set_layout({"chatVisible": not self.layout.get("chatVisible", True) if action == "toggle_chat" else action == "show_chat"})
        elif action in ("pause", "resume"):
            self.set_mode("paused" if action == "pause" else "control")

    def _tray(self):
        self.tray = QSystemTrayIcon(plum_icon("#7a4cff"))
        menu = QMenu()
        self.status_action = QAction("Verbinde …")
        self.status_action.setEnabled(False)
        menu.addAction(self.status_action)
        menu.addSeparator()
        group = QActionGroup(menu)
        self.mode_actions = {}
        for mode, label in MODE_LABELS.items():
            action = QAction(label, menu, checkable=True)
            action.setChecked(mode == self.mode)
            action.triggered.connect(lambda _checked=False, m=mode: self.set_mode(m))
            group.addAction(action)
            menu.addAction(action)
            self.mode_actions[mode] = action
        menu.addSeparator()
        self.record_action = QAction("Vorführung aufnehmen", menu)
        self.record_action.triggered.connect(self.toggle_recording)
        menu.addAction(self.record_action)
        message = QAction("Nachricht an Plum …", menu)
        message.triggered.connect(self.message_prompt)
        menu.addAction(message)
        menu.addSeparator()
        self.glow_action = QAction("Bildschirmrand leuchten, wenn Plum steuert", menu, checkable=True)
        self.glow_action.setChecked(self.overlay.glow_enabled)
        self.glow_action.triggered.connect(self._toggle_glow)
        menu.addAction(self.glow_action)
        clear = QAction("Markierungen entfernen", menu)
        clear.triggered.connect(lambda: (self.overlay.clear(), self.card.hide()))
        menu.addAction(clear)
        quit_action = QAction("Beenden", menu)
        quit_action.triggered.connect(QApplication.quit)
        menu.addAction(quit_action)
        self.tray.setContextMenu(menu)
        self.menu = menu
        self._refresh_tray()
        self.tray.show()

    def _toggle_glow(self, checked):
        self.overlay.glow_enabled = bool(checked)
        self.state["edgeGlow"] = bool(checked)
        save_state(self.state)
        self.overlay.update()

    def _refresh_tray(self):
        color = {"control": "#7a4cff", "guide": "#1856ff", "paused": "#8a8a98"}[self.mode]
        self.tray.setIcon(plum_icon(color))
        link = "verbunden" if self.online else "nicht verbunden"
        self.status_action.setText(f"Plum Desktop {VERSION} · {link}")
        self.tray.setToolTip(f"Plum Desktop · {MODE_LABELS[self.mode]} · {link}")
        for mode, action in self.mode_actions.items():
            action.setChecked(mode == self.mode)

    def _on_connected(self, online):
        self.online = online
        self._refresh_tray()
        if online:
            self.dock.present()
            self.dock.place_chat()
            if self.activity_state["sessionId"]:
                QTimer.singleShot(0, lambda: self._load_chat(self.activity_state["sessionId"]))
            elif self.last_session.get("id"):
                self.attach_session(self.last_session)
        else:
            ABORT["set"] = True
            self.input.release_all()
            self.overlay.stop_activity()
            self.activity_state.update(status="Verbindung unterbrochen", action="Verbinde erneut …")
        self.dock.render()

    def set_mode(self, mode):
        self.mode = mode
        self.state["mode"] = mode
        save_state(self.state)
        if mode == "paused":
            ABORT["set"] = True
            self.input.release_all()
            self.confirm.answer = "deny"
            self.pill.hide()
            self.overlay.cursor = None
            self.overlay.stop_activity()
        else:
            ABORT["set"] = False
        self.activity_state.update(status="Pausiert" if mode == "paused" else ("Arbeitet" if self.turn_active else "Bereit"), action="")
        self.dock.present()
        self.bridge.send_state()
        self._refresh_tray()
        log("mode:", mode)

    def _set_rules(self, rules):
        self.rules = [r for r in rules if isinstance(r, dict) and r.get("match") and r.get("mode") in ("block", "ask")]
        self.state["rules"] = self.rules
        save_state(self.state)
        log("rules:", len(self.rules))

    def _escape(self):
        """Escape on the real keyboard stops Plum while it acts."""
        if self.selection_pending:
            self.selection_pending = False
            self.activity_state.update(status="Pausiert", action="Auswahl abgebrochen")
            self.publish_activity()
            return
        acting = self.tools.busy or time.time() - self.last_action < 4 or self.confirm.isVisible()
        if not acting or self.mode == "paused":
            return
        ABORT["set"] = True
        self.confirm.answer = "deny"
        self.set_mode("paused")
        self.overlay.cursor = None
        self.overlay.stop_activity()
        self.pill.flash(QGuiApplication.primaryScreen().geometry(), "Plum gestoppt · Tray: Steuern setzt fort")
        log("stopped by Escape")

    def _session_id(self):
        if self.last_session.get("id"):
            return self.last_session["id"]
        sessions = self.bridge.rpc("sessions.list", {}) or []
        busy = [s for s in sessions if s.get("busy")]
        pick = (busy or sessions or [None])[0]
        if not pick:
            raise RuntimeError("Keine Plum-Sitzung gefunden")
        return pick["id"]

    def toggle_recording(self):
        if self.recorder.active:
            self.stop_recording()
        else:
            self.recorder.start()
            self.record_action.setText("Vorführung beenden")

    def _remote_record(self, action):
        if action == "start" and not self.recorder.active:
            self.toggle_recording()
        elif action == "stop" and self.recorder.active:
            self.stop_recording()
        elif action == "cancel":
            self.cancel_recording()

    def cancel_recording(self):
        self.recorder.stop()
        self.record_action.setText("Vorführung aufnehmen")

    def stop_recording(self):
        self.recorder.stop()
        self.record_action.setText("Vorführung aufnehmen")
        pump_safe(0.5)  # the last screenshot
        steps, shots = self.recorder.steps, self.recorder.shots
        if not steps:
            return
        lines = self.recorder.describe()
        body = "\n".join(
            [f"🎬 **Vorführung vom Desktop** – {len(steps)} Schritte" + (f", {len(shots)} Bilder" if shots else ""), "", *lines,
             "", "Lerne die Aufgabe daraus und spiele sie mit den desktop_*-Werkzeugen nach, wenn ich darum bitte."]
        )
        # Spread up to 20 screenshots over the whole demonstration.
        if len(shots) > 20:
            shots = [shots[round(i * (len(shots) - 1) / 19)] for i in range(20)]
        try:
            self.bridge.rpc("chat.send", {
                "sessionId": self._session_id(), "message": body, "images": shots,
                "clientMessageId": f"desktop-demo-{int(time.time() * 1000)}",
            }, timeout=60)
            self.tray.showMessage("Plum Desktop", "Vorführung an die Sitzung gesendet")
        except RuntimeError as error:
            self.tray.showMessage("Plum Desktop", f"Senden fehlgeschlagen: {error}")
        saved = [dict(step) for step in steps]
        self.text_card.prompt("Als Makro speichern? Name eingeben (leer lassen = nicht speichern)", "Speichern",
                              lambda name: self.save_macro(name, saved))

    def save_macro(self, name, steps):
        macros = [m for m in load_macros() if m.get("name") != name]
        for step in steps:
            step.pop("shot", None)
            step.pop("closed", None)
        macros.append({"name": name[:60], "steps": steps, "created": time.strftime("%Y-%m-%d %H:%M")})
        save_macros(macros)
        self.tray.showMessage("Plum Desktop", f"Makro „{name}“ gespeichert ({len(steps)} Schritte)")

    def message_prompt(self):
        def send(text):
            try:
                self.send_message(text)
            except RuntimeError as error:
                self.tray.showMessage("Plum Desktop", f"Senden fehlgeschlagen: {error}")
        self.text_card.prompt("Nachricht an Plum (an die zuletzt aktive Sitzung)", "Senden", send)

    def _self_update(self, frame):
        """Plum pushes its shipped companion to older ones; replace and restart."""
        if self.config.get("autoUpdate") is False:
            log("update to", frame.get("version"), "available; autoUpdate is off")
            return
        source = str(frame.get("source") or "")
        if hashlib.sha256(source.encode()).hexdigest() != frame.get("sha256"):
            log("update rejected: digest mismatch")
            return
        try:
            compile(source, "plum_desktop.py", "exec")
        except SyntaxError as error:
            log("update rejected:", error)
            return
        if self.tools.busy:
            QTimer.singleShot(5000, lambda: self._self_update(frame))
            return
        path = os.path.abspath(__file__)
        try:
            shutil.copy2(path, path + ".prev")
            with open(path + ".new", "w", encoding="utf-8") as handle:
                handle.write(source)
            os.replace(path + ".new", path)
        except OSError as error:
            log("update failed:", error)
            return
        log(f"updated {VERSION} -> {frame.get('version')}, restarting")
        self.tray.hide()
        os.execv(sys.executable, [sys.executable, path])

    def guide_done(self, step):
        if not step or not step.get("session"):
            return
        label = f"{step['step']}/{step['total']}" if step.get("total") else str(step["step"])
        self.overlay.clear()
        self.bridge.send(
            {
                "type": "rpc",
                "id": f"rpc-{uuid.uuid4().hex}",
                "method": "chat.send",
                "params": {
                    "sessionId": step["session"],
                    "message": f"✓ Schritt {label} „{step['title']}“ auf dem Desktop erledigt. Zeig mir den nächsten Schritt.",
                    "clientMessageId": f"desktop-guide-{int(time.time() * 1000)}",
                },
            }
        )


def main():
    with open(CONFIG, encoding="utf-8") as handle:
        config = json.load(handle)
    QImageReader.setAllocationLimit(0)  # multi-monitor screenshots exceed Qt's 256 MB default
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    plum = App(config)
    plum.bridge.start()
    geometry = plum.overlay.geometry()
    log(f"running {VERSION}, overlay {geometry.width()}×{geometry.height()}, mode {plum.mode}")
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
