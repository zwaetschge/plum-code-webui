#!/usr/bin/env python3
"""Plum desktop companion.

Lets a Plum session look at the desktop and *show* things over native apps
(Blender, GIMP, Photoshop …) the way the browser extension's guide mode does
in web pages: a cursor, circles, boxes, arrows, underlines, pen strokes and
labels on a transparent, click-through overlay. It never clicks or types.

It dials out to Plum's browser bridge with a `plum_ff_` pairing token, as a
client of kind "desktop"; the `desktop_*` MCP tools are routed to it.

Config: ~/.config/plum-desktop/config.json  {"serverUrl", "token", "label"}
Needs: PySide6, websockets, and spectacle (KDE) or grim for screenshots.
"""

import asyncio
import base64
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

# The overlay is an X11 window (via XWayland on Wayland): only there can a
# client keep itself above other windows and pass clicks through.
os.environ.setdefault("QT_QPA_PLATFORM", "xcb")

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QObject, QPointF, QRectF, Qt, QTimer, Signal
from PySide6.QtGui import QColor, QFont, QFontMetrics, QGuiApplication, QImage, QPainter, QPainterPath, QPen, QPolygonF
from PySide6.QtWidgets import QApplication, QWidget

import websockets

VERSION = "0.1.0"
CONFIG = os.path.expanduser("~/.config/plum-desktop/config.json")
SHOT_MAX_EDGE = 1568
MARK_TTL_S = 15 * 60
COLORS = {
    "purple": "#7a4cff",
    "blue": "#1856ff",
    "red": "#ea2143",
    "green": "#07ca6b",
    "orange": "#e89558",
    "yellow": "#f5c400",
}


def log(*args):
    print("[plum-desktop]", *args, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- overlay


class Overlay(QWidget):
    """Full-desktop, transparent, click-through drawing surface."""

    def __init__(self):
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
        self.hide_cursor = False
        self.factor = 1.0  # screenshot pixels → logical pixels
        geometry = QGuiApplication.primaryScreen().virtualGeometry()
        self.setGeometry(geometry)
        self.show()
        self.raise_()
        timer = QTimer(self)
        timer.timeout.connect(self._expire)
        timer.start(30_000)

    # screenshot pixels → overlay (logical) coordinates
    def to_local(self, x, y):
        return QPointF(float(x) / self.factor, float(y) / self.factor)

    def _expire(self):
        now = time.time()
        kept = [mark for mark in self.marks if now - mark["at"] < MARK_TTL_S]
        if len(kept) != len(self.marks):
            self.marks = kept
            self.update()

    def add(self, mark):
        mark["at"] = time.time()
        self.marks.append(mark)
        self.marks = self.marks[-40:]
        self.raise_()
        self.update()

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


# --------------------------------------------------------------------------- tools


def take_screenshot(path):
    if shutil.which("spectacle"):
        subprocess.run(["spectacle", "-b", "-n", "-f", "-o", path], check=True, timeout=20)
    elif shutil.which("grim"):
        subprocess.run(["grim", path], check=True, timeout=20)
    else:
        raise RuntimeError("Kein Screenshot-Werkzeug (spectacle oder grim) installiert")
    for _ in range(40):
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return
        time.sleep(0.1)
    raise RuntimeError("Screenshot wurde nicht gespeichert")


class Tools(QObject):
    """Runs tool calls on the Qt thread; replies go back through `reply`."""

    call = Signal(str, str, object)

    def __init__(self, overlay, reply):
        super().__init__()
        self.overlay = overlay
        self.reply = reply
        self.call.connect(self._run)

    def _run(self, call_id, tool, args):
        try:
            handler = getattr(self, tool, None)
            if not tool.startswith("desktop_") or handler is None:
                raise RuntimeError(f"Unbekanntes Desktop-Werkzeug: {tool}")
            content = handler(args or {})
            self.reply({"type": "result", "id": call_id, "ok": True, "content": content})
        except Exception as error:  # noqa: BLE001 - every failure goes back to the agent
            self.reply({"type": "result", "id": call_id, "ok": False, "error": str(error)})

    @staticmethod
    def _text(text):
        return {"type": "text", "text": text}

    def _color(self, args):
        return COLORS.get(str(args.get("color") or "").lower(), COLORS["purple"])

    def _rect(self, args):
        top_left = self.overlay.to_local(args["x"], args["y"])
        width = float(args.get("width") or 0) / self.overlay.factor
        height = float(args.get("height") or 0) / self.overlay.factor
        if width and height:
            return QRectF(top_left.x(), top_left.y(), width, height)
        return QRectF(top_left.x(), top_left.y(), 0, 0)

    def desktop_screenshot(self, _args):
        self.overlay.hide_cursor = True
        self.overlay.repaint()
        QApplication.processEvents()
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "shot.png")
            try:
                take_screenshot(path)
            finally:
                self.overlay.hide_cursor = False
                self.overlay.update()
            image = QImage(path)
        if image.isNull():
            raise RuntimeError("Screenshot konnte nicht gelesen werden")
        logical = self.overlay.geometry()
        scale = min(1.0, SHOT_MAX_EDGE / max(image.width(), image.height()))
        shot = image.scaled(
            round(image.width() * scale), round(image.height() * scale), Qt.KeepAspectRatio, Qt.SmoothTransformation
        )
        # Tool coordinates are screenshot pixels; the overlay works in logical ones.
        self.overlay.factor = shot.width() / max(1, logical.width())
        data = QByteArray()
        buffer = QBuffer(data)
        buffer.open(QIODevice.WriteOnly)
        shot.save(buffer, "JPEG", 80)
        return [
            {"type": "image", "data": base64.b64encode(bytes(data)).decode(), "mimeType": "image/jpeg"},
            self._text(
                f"Desktop {shot.width()}×{shot.height()} (Bildschirm {image.width()}×{image.height()}). "
                "x/y für desktop_point/annotate/draw in diesen Screenshot-Pixeln."
            ),
        ]

    def desktop_point(self, args):
        point = self.overlay.to_local(args["x"], args["y"])
        self.overlay.cursor = (point, str(args.get("label") or "Plum")[:200])
        self.overlay.raise_()
        self.overlay.update()
        return [self._text(f"Zeigt auf {args['x']},{args['y']}")]

    def desktop_annotate(self, args):
        shape = str(args.get("shape") or ("box" if args.get("width") else "circle"))
        rect = self._rect(args)
        mark = {"kind": shape, "color": self._color(args), "rect": rect, "label": str(args.get("label") or "")[:300]}
        self.overlay.add(mark)
        self.overlay.cursor = (rect.center() + QPointF(8, 8), None)
        return [self._text(f"Markiert ({shape}) bei {args['x']},{args['y']}")]

    def desktop_draw(self, args):
        points = [
            self.overlay.to_local(p[0], p[1])
            for p in (args.get("points") or [])[:400]
            if isinstance(p, (list, tuple)) and len(p) >= 2
        ]
        if len(points) < 2:
            raise RuntimeError("points braucht mindestens zwei [x, y]-Punkte")
        mark = {"kind": "stroke", "color": self._color(args), "points": [], "label": ""}
        self.overlay.add(mark)
        # Drawn progressively, so the user sees the pen move.
        steps = list(range(1, len(points) + 1))
        label = str(args.get("label") or "")[:300]

        def advance():
            if not steps:
                mark["label"] = label
                self.overlay.update()
                return
            count = steps.pop(0)
            mark["points"] = points[:count]
            self.overlay.cursor = (points[count - 1], None)
            self.overlay.update()
            QTimer.singleShot(12, advance)

        advance()
        return [self._text(f"Gezeichnet ({len(points)} Punkte)")]

    def desktop_clear(self, _args):
        self.overlay.clear()
        return [self._text("Desktop-Markierungen entfernt")]


# --------------------------------------------------------------------------- bridge connection


def socket_urls(server_url):
    base = server_url.rstrip("/")
    if base.endswith("/mobile"):
        base = base[: -len("/mobile")]
    ws = "wss" + base[5:] if base.startswith("https") else "ws" + base[4:]
    return [f"{ws}/mobile/api/browser-bridge/ws", f"{ws}/api/browser-bridge/ws"]


class Bridge(threading.Thread):
    def __init__(self, config, tools_holder):
        super().__init__(daemon=True)
        self.config = config
        self.tools_holder = tools_holder
        self.loop = None
        self.socket = None

    def send(self, frame):
        if self.loop and self.socket:
            asyncio.run_coroutine_threadsafe(self.socket.send(json.dumps(frame)), self.loop)

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
                    log("connected:", url)
                elif frame.get("type") == "error":
                    raise RuntimeError(frame.get("message") or "rejected")
                elif frame.get("type") == "call":
                    self.tools_holder[0].call.emit(frame["id"], frame.get("tool", ""), frame.get("args") or {})
            self.socket = None


def main():
    with open(CONFIG, encoding="utf-8") as handle:
        config = json.load(handle)
    app = QApplication(sys.argv)
    app.setQuitOnLastWindowClosed(False)
    overlay = Overlay()
    holder = [None]
    bridge = Bridge(config, holder)
    holder[0] = Tools(overlay, bridge.send)
    bridge.start()
    log(f"running {VERSION}, overlay {overlay.geometry().width()}×{overlay.geometry().height()}")
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
