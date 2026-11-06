"""Behavior regressions for desktop handover/live events, without a display.

Load the production methods from its AST so CI needs neither Qt nor evdev.
The UI itself is checked separately with Qt and on the connected desktop.
"""
import ast
import json
import time
import unittest
from pathlib import Path
from types import SimpleNamespace as Box

SOURCE = Path(__file__).resolve().parents[1] / "packages/desktop-companion/plum_desktop.py"
TREE = ast.parse(SOURCE.read_text())
ABORT = {"set": False}


def production_class(name, methods):
    original = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == name)
    # Plain class constants come along; Qt signal declarations do not.
    constants = [n for n in original.body if isinstance(n, ast.Assign)
                 and isinstance(n.value, ast.Constant)]
    body = constants + [n for n in original.body if isinstance(n, ast.FunctionDef) and n.name in methods]
    node = ast.ClassDef(name=name, bases=[], keywords=[], body=body, decorator_list=[], type_params=[])
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    scope = {"time": time, "json": json, "ABORT": ABORT, "save_state": lambda _: None, "log": lambda *a: None,
             "QCursor": Box(pos=lambda: object())}
    exec(compile(module, str(SOURCE), "exec"), scope)
    return scope[name]


App = production_class("App", {"_chat_event", "_finish_turn", "record_step", "describe_action", "_human_input", "set_mode", "_remote_action", "stop_task"})
Tools = production_class("Tools", {"desktop_task", "_text"})
tail_node = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "tail_text")
tail_scope = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=[tail_node], type_ignores=[])), str(SOURCE), "exec"), tail_scope)
tail_text = tail_scope["tail_text"]
layout_node = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == "screenshot_layout")
layout_scope = {}
exec(compile(ast.fix_missing_locations(ast.Module(body=[layout_node], type_ignores=[])), str(SOURCE), "exec"), layout_scope)
screenshot_layout = layout_scope["screenshot_layout"]


mapping_scope = {}
for name in ("display_rect_at", "map_display_point"):
    node = next(n for n in TREE.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(SOURCE), "exec"), mapping_scope)
map_display_point = mapping_scope["map_display_point"]


def fixture():
    app = App()
    app.activity_state = {"sessionId": "ours", "sessionName": "Test", "status": "Bereit", "action": "", "progress": "",
                          "history": [], "result": "", "resultTarget": ""}
    app.chat_lines = []
    app.stream = ""
    app.mode = "control"
    app.state = {}
    app.turn_active = False
    app.selection_pending = False
    app.recorder = Box(active=False)
    app.tools = Box(busy=False)
    app.published = 0
    app.released = 0
    app.publish_activity = lambda: setattr(app, "published", app.published + 1)
    app.input = Box(release_all=lambda: setattr(app, "released", app.released + 1))
    app.overlay = Box(stop_activity=lambda: None, set_note=lambda *a, **k: None, cursor=None)
    widget = Box(hide=lambda: None, isVisible=lambda: False)
    app.dock = Box(present=lambda: None, isVisible=lambda: False, chat_window=widget)
    app.pill = widget
    app.confirm = Box(isVisible=lambda: False, answer=None)
    app.text_card = widget
    app.bridge = Box(send_state=lambda: None)
    app._refresh_tray = lambda: None
    return app


class DesktopControlTests(unittest.TestCase):
    def test_screenshot_origins_match_input_coordinates_at_different_monitor_scales(self):
        size, targets = screenshot_layout([(0, 0, 3440, 1440), (1688, 1440, 1280, 720)], [(6880, 2880), (2560, 1440)])
        self.assertEqual(size, (6880, 4320))
        self.assertEqual(targets[1], (3376, 2880, 2560, 1440))
        # The old exported collage put this monitor at (2252,1920), causing
        # visible positions to differ from input even outside the JPEG bounds.
        tool_factor = 1568 / 3440
        screenshot_factor = 1568 / size[0]
        self.assertAlmostEqual(1688 * tool_factor, targets[1][0] * screenshot_factor)
        self.assertAlmostEqual(1440 * tool_factor, targets[1][1] * screenshot_factor)

    def test_capture_layout_handles_negative_origins_and_mixed_native_sizes(self):
        size, targets = screenshot_layout([(0, 0, 3440, 1440), (-1280, 200, 1280, 720)], [(6880, 2880), (1280, 720)])
        self.assertEqual(size, (9440, 2880))
        self.assertEqual(targets, [(2560, 0, 6880, 2880), (0, 400, 2560, 1440)])

    def test_xwayland_origins_map_to_native_kwin_input_and_back(self):
        mapping = [((840, 2160, 1963, 1227), (560, 1440, 1963, 1227)),
                   ((0, 0, 3440, 1440), (0, 0, 3440, 1440))]
        self.assertEqual(map_display_point((2780, 2367), mapping), (2500, 1647))
        self.assertEqual(map_display_point((2500, 1647), mapping, False), (2780, 2367))
        self.assertEqual(map_display_point((500, 1000), mapping), (500, 1000))
        self.assertEqual(map_display_point((-100, 200), []), (-100, 200))

    def test_screenshot_coordinates_survive_xwayland_window_repositioning(self):
        class Point:
            def __init__(self, x=0, y=None):
                self._x, self._y = (x.x(), x.y()) if y is None and hasattr(x, "x") else (x, y or 0)
            def x(self): return self._x
            def y(self): return self._y
            def __add__(self, other): return Point(self.x() + other.x(), self.y() + other.y())
            def __sub__(self, other): return Point(self.x() - other.x(), self.y() - other.y())
        Overlay = production_class("Overlay", {"to_local", "to_shot", "global_point", "local_point"})
        scope = Overlay.to_local.__globals__
        scope["QPointF"] = Point
        scope["QGuiApplication"] = Box(primaryScreen=lambda: Box(virtualGeometry=lambda: Box(topLeft=lambda: Point(0, 0))))
        overlay = Overlay()
        overlay.factor = 1568 / 3440
        overlay.geometry = lambda: Box(x=lambda: 280, y=lambda: 720)
        local = overlay.to_local(1267, 1079)
        global_point = overlay.global_point(local)
        self.assertAlmostEqual(global_point.x(), 1267 / overlay.factor)
        self.assertAlmostEqual(global_point.y(), 1079 / overlay.factor)
        self.assertEqual(overlay.to_shot(local), (1267, 1079))

    def test_mapping_preserves_negative_origins_and_per_output_scales(self):
        mapping = [((-1280, 0, 1280, 720), (-640, 0, 640, 360)),
                   ((0, 0, 1920, 1080), (0, 0, 1920, 1080))]
        point = (-1000, 300)
        native = map_display_point(point, mapping)
        self.assertEqual(native, (-500, 150))
        self.assertEqual(map_display_point(native, mapping, False), point)

    def test_live_chat_is_isolated_and_stream_becomes_final_once(self):
        app = fixture()
        app._chat_event({"event": "session:output", "payload": {"sessionId": "other", "content": "private"}})
        self.assertEqual(app.stream, "")
        for part in ["Öffne ", "das Fenster"]:
            app._chat_event({"event": "session:output", "payload": {"sessionId": "ours", "content": part}})
        self.assertEqual(app.stream, "Öffne das Fenster")
        app._chat_event({"event": "session:message", "payload": {"sessionId": "ours", "role": "assistant", "content": "Fenster geöffnet"}})
        app._chat_event({"event": "session:lifecycle", "payload": {"sessionId": "ours", "busy": False}})
        self.assertEqual(app.activity_state["status"], "Abgeschlossen")
        self.assertEqual(app.activity_state["result"], "Fenster geöffnet")
        self.assertEqual(len(app.chat_lines), 1)

    def test_status_line_starts_at_a_sentence_never_mid_word(self):
        stream = ("Ich prüfe den Zustand am Palma und nehme A/B zunächst aus der Auswahl. "
                  "Die ausgegebenen Moduswerte haben ihre sichtbare Funktion nicht belegt. "
                  "Danach kläre ich, welche zusätzliche Ansteuerung der Originaltreiber dafür benötigt.")
        line = tail_text(stream, 160)
        self.assertTrue(line.startswith("Die ausgegebenen") or line.startswith("Danach"), line)
        self.assertTrue(line.endswith("benötigt."))
        words = tail_text("wort " * 80, 100)
        self.assertTrue(words.startswith("… wort"), words)
        self.assertEqual(tail_text("kurz"), "kurz")

    def test_input_does_not_pause_a_turn_that_is_not_steering_the_desktop(self):
        app = fixture()
        app.turn_active = True
        app.last_action = 0.0
        app._human_input()
        self.assertEqual(app.mode, "control")

    def test_physical_input_pauses_and_requires_explicit_resume(self):
        app = fixture()
        app.turn_active = True
        app.last_action = time.time()
        app._human_input()
        self.assertEqual(app.mode, "paused")
        self.assertTrue(ABORT["set"])
        self.assertEqual(app.released, 1)
        self.assertEqual(app.activity_state["status"], "Du übernimmst gerade")
        app._chat_event({"event": "session:output", "payload": {"sessionId": "ours", "content": "Noch eine Meldung"}})
        app._chat_event({"event": "session:lifecycle", "payload": {"sessionId": "ours", "busy": False}})
        self.assertEqual(app.mode, "paused")
        self.assertEqual(app.activity_state["status"], "Du übernimmst gerade")
        app.set_mode("control")
        self.assertFalse(ABORT["set"])

    def test_recording_and_context_selection_do_not_interrupt_the_user(self):
        for attribute in ["recording", "selection"]:
            app = fixture()
            app.turn_active = True
            if attribute == "recording":
                app.recorder.active = True
            else:
                app.selection_pending = True
            app._human_input()
            self.assertEqual(app.mode, "control")

    def test_errors_and_questions_never_become_success(self):
        for event in ["session:error", "session:question_request", "session:permission_request"]:
            app = fixture()
            app.turn_active = True
            app._chat_event({"event": event, "payload": {"sessionId": "ours", "error": "Fenster fehlt"}})
            app._chat_event({"event": "session:lifecycle", "payload": {"sessionId": "ours", "busy": False}})
            self.assertNotEqual(app.activity_state["status"], "Abgeschlossen")

    def test_stop_releases_input_and_interrupts_the_attached_session(self):
        app = fixture()
        calls = []
        app.bridge.rpc = lambda method, params: calls.append((method, params))
        app.turn_active = True
        app.stop_task()
        self.assertEqual(app.mode, "paused")
        self.assertFalse(app.turn_active)
        self.assertEqual(app.released, 1)
        self.assertEqual(calls, [("chat.interrupt", {"sessionId": "ours"})])
        app._chat_event({"event": "session:lifecycle", "payload": {"sessionId": "ours", "busy": False}})
        self.assertEqual(app.activity_state["status"], "Gestoppt")

    def test_history_is_bounded_and_does_not_echo_input_text(self):
        app = fixture()
        for i in range(20):
            app.record_step(str(i))
        self.assertEqual(len(app.activity_state["history"]), 12)
        summary = app.describe_action("desktop_type", {"text": "top-secret-value"})
        self.assertNotIn("top-secret", summary)
        self.assertIn("16 Zeichen", summary)

    def test_progress_waiting_and_verified_result(self):
        app = fixture()
        tools = Tools()
        tools.s = app
        tools.overlay = app.overlay
        tools.desktop_task({"title": "Datei speichern", "steps": ["Öffnen", "Speichern"], "current": 1, "status": "waiting"})
        self.assertIn("2 von 2", app.activity_state["progress"])
        self.assertEqual(app.activity_state["status"], "Wartet")
        tools.desktop_task({"status": "completed", "result": "Datei vorhanden", "target": "/tmp/report.pdf"})
        self.assertEqual(app.activity_state["progress"], "Alle Schritte erledigt")
        self.assertEqual(app.activity_state["resultTarget"], "/tmp/report.pdf")
        self.assertFalse(app.turn_active)
        with self.assertRaises(RuntimeError):
            tools.desktop_task({"target": "javascript:alert(1)"})

    def test_no_instance_attribute_shadows_an_app_method(self):
        node = next(n for n in TREE.body if isinstance(n, ast.ClassDef) and n.name == "App")
        methods = {n.name for n in node.body if isinstance(n, ast.FunctionDef)}
        for n in ast.walk(node):
            if isinstance(n, ast.Attribute) and isinstance(n.ctx, ast.Store) and isinstance(n.value, ast.Name) and n.value.id == "self":
                self.assertNotIn(n.attr, methods, f"Instance attribute shadows method {n.attr}")


if __name__ == "__main__":
    unittest.main()
