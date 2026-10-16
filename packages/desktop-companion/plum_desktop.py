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
marks only) and Pausiert. While Plum acts, a "Plum steuert · Stopp" pill sits
at the top of the screen; Stopp pauses at once.

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
    QIcon,
    QImage,
    QImageReader,
    QPainter,
    QPainterPath,
    QPen,
    QPixmap,
    QPolygonF,
)
from PySide6.QtWidgets import QApplication, QHBoxLayout, QLabel, QMenu, QPushButton, QSystemTrayIcon, QVBoxLayout, QWidget

import websockets

VERSION = "0.3.0"
CONFIG_DIR = os.path.expanduser("~/.config/plum-desktop")
CONFIG = os.path.join(CONFIG_DIR, "config.json")
STATE = os.path.join(CONFIG_DIR, "state.json")
SHOT_MAX_EDGE = 1568
MARK_TTL_S = 15 * 60
CURSOR_IDLE_S = 120
PILL_IDLE_S = 4
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


def pump(seconds):
    """Wait while keeping the overlay painting and DBus replies flowing."""
    end = time.time() + seconds
    while True:
        QApplication.processEvents()
        left = end - time.time()
        if left <= 0:
            return
        time.sleep(min(0.01, left))


def ease(t):
    return 1 - (1 - t) ** 3


# --------------------------------------------------------------------------- KWin


class KWin(QObject):
    """Runs one-shot KWin scripts; they answer through our DBus service."""

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
var list = workspace.windowList ? workspace.windowList() : workspace.clientList();
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

    def paintEvent(self, _event):
        painter = QPainter(self)
        painter.setRenderHint(QPainter.Antialiasing)
        for mark in self.marks:
            self._paint_mark(painter, mark)
        if self.cursor and not self.hide_cursor:
            self._paint_cursor(painter, *self.cursor)

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


class Pill(Floating):
    """'Plum steuert · Stopp' at the top of the screen while Plum acts."""

    def __init__(self, on_stop):
        super().__init__()
        row = QHBoxLayout(self.card)
        row.setContentsMargins(14, 8, 8, 8)
        self.label = QLabel("Plum steuert")
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


def take_screenshot(path):
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
            if self.s.mode == "paused" and tool != "desktop_status":
                raise RuntimeError("Plum Desktop ist pausiert. Bitte den Nutzer, es im Tray-Symbol fortzusetzen.")
            if self.s.mode == "guide" and tool in INPUT_TOOLS:
                raise RuntimeError(
                    "Plum Desktop ist im Modus „Nur zeigen“: Eingaben sind gesperrt. "
                    "Zeige mit desktop_point, desktop_annotate oder desktop_guide_step, der Nutzer bedient selbst."
                )
            self.session = session or {}
            content = handler(args or {})
            self.s.bridge.send({"type": "result", "id": call_id, "ok": True, "content": content})
        except Exception as error:  # noqa: BLE001 - every failure goes back to the agent
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
        self.s.pill.flash(self._screen_of(local), f"Plum steuert · {what}")

    def _label(self):
        name = str(self.session.get("name") or "").strip()
        return name[:40] if name else "Plum"

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
        ]
        if self.s.mode == "guide":
            lines.append("Nur zeigen: Eingabe-Werkzeuge sind gesperrt.")
        return [self._text("\n".join(lines))]

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

    def desktop_windows(self, _args):
        windows = self.s.kwin.windows()
        if not windows:
            return [self._text("Keine Fenster")]
        lines = []
        for w in windows:
            x, y = self.overlay.to_shot(self.overlay.local_point(QPointF(w["x"], w["y"])))
            size = f"{round(w['width'] * self.overlay.factor)}×{round(w['height'] * self.overlay.factor)}"
            flags = " · aktiv" if w["active"] else (" · minimiert" if w["minimized"] else "")
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
        where = args.get("ref") or f"{args.get('x')},{args.get('y')}"
        return [self._text(f"{what} bei {where}")]

    def desktop_hover(self, args):
        local = self._point(args)
        self._acting(local, "Zeiger")
        self._pointer_to(local)
        pump(0.3)
        where = args.get("ref") or f"{args.get('x')},{args.get('y')}"
        return [self._text(f"Zeiger auf {where}")]

    def desktop_drag(self, args):
        start = self._point(args, "fromX", "fromY")
        end = self._point(args, "toX", "toY")
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
            self._acting(local, "Scrollen")
            self._pointer_to(local)
        direction = str(args.get("direction") or "down")
        amount = max(1, min(int(float(args.get("amount") or 3)), 30))
        dx, dy = {"down": (0, -1), "up": (0, 1), "left": (-1, 0), "right": (1, 0)}.get(direction, (0, -1))
        for _ in range(amount):
            self.s.input.wheel(dx, dy)
            pump(0.03)
        pump(0.2)
        return [self._text(f"{amount}× gescrollt ({direction})")]

    def desktop_press_key(self, args):
        keys = str(args.get("keys") or "").strip()
        if not keys:
            raise RuntimeError('keys fehlt, z. B. "Enter", "ctrl+s" oder "Tab Tab Enter"')
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

    def send(self, frame):
        if self.loop and self.socket:
            asyncio.run_coroutine_threadsafe(self.socket.send(json.dumps(frame)), self.loop)

    def send_state(self):
        self.send({"type": "state", "paused": self.s.mode == "paused"})

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
                elif frame.get("type") == "call":
                    self.s.tools.call.emit(
                        frame["id"], frame.get("tool", ""), frame.get("args") or {}, frame.get("session") or {}
                    )
            self.socket = None
            self.s.connected.emit(False)


# --------------------------------------------------------------------------- app


class App(QObject):
    connected = Signal(bool)
    update = Signal(object)

    def __init__(self, config):
        super().__init__()
        self.state = load_state()
        self.mode = self.state.get("mode") if self.state.get("mode") in MODE_LABELS else "control"
        self.overlay = Overlay(self.state.get("factor"))
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
        self._tray()

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

    def set_mode(self, mode):
        self.mode = mode
        self.state["mode"] = mode
        save_state(self.state)
        if mode == "paused":
            self.pill.hide()
            self.overlay.cursor = None
            self.overlay.update()
        self.bridge.send_state()
        self._refresh_tray()
        log("mode:", mode)

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
