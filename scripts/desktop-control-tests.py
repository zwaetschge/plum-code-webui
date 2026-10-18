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
    body = [n for n in original.body if isinstance(n, ast.FunctionDef) and n.name in methods]
    node = ast.ClassDef(name=name, bases=[], keywords=[], body=body, decorator_list=[], type_params=[])
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    scope = {"time": time, "json": json, "ABORT": ABORT, "save_state": lambda _: None, "log": lambda *a: None,
             "QCursor": Box(pos=lambda: object())}
    exec(compile(module, str(SOURCE), "exec"), scope)
    return scope[name]


App = production_class("App", {"_chat_event", "_finish_turn", "record_step", "describe_action", "_human_input", "set_mode", "_remote_action", "stop_task"})
Tools = production_class("Tools", {"desktop_task", "_text"})


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
    app.overlay = Box(stop_activity=lambda: None, set_note=lambda *a: None, cursor=None)
    widget = Box(hide=lambda: None, isVisible=lambda: False)
    app.dock = Box(present=lambda: None, isVisible=lambda: False, chat_window=widget)
    app.pill = widget
    app.confirm = Box(isVisible=lambda: False, answer=None)
    app.text_card = widget
    app.bridge = Box(send_state=lambda: None)
    app._refresh_tray = lambda: None
    return app


class DesktopControlTests(unittest.TestCase):
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

    def test_physical_input_pauses_and_requires_explicit_resume(self):
        app = fixture()
        app.turn_active = True
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
