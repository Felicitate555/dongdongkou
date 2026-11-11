"""Behavior tests use an in-memory mouse; never send physical input."""
import unittest
from server.control_safety import ControlSafety, ControlStopped


class FakeMouse:
    def __init__(self):
        self.pos = (100, 100)
        self.releases = 0

    def position(self):
        return self.pos

    def release_all(self):
        self.releases += 1


class ControlSafetyTests(unittest.TestCase):
    def setUp(self):
        self.mouse = FakeMouse()
        self.now = 1.0
        self.guard = ControlSafety(self.mouse, clock=lambda: self.now)

    def test_stopped_session_rejects_late_down_and_cannot_stop_new_session(self):
        token = self.guard.start()
        self.guard.stop(token)
        fresh = self.guard.start()
        self.guard.stop(token)
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 1, lambda: self.fail("late down executed"))
        self.assertEqual(self.guard.execute(fresh, 1, lambda: {"success": True}), {"success": True})

    def test_timeout_releases_drag_without_browser_request(self):
        token = self.guard.start()
        self.guard.execute(token, 1, lambda: {"success": True})
        self.now += 1.0
        self.guard.check()
        self.assertGreater(self.mouse.releases, 0)
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 2, lambda: self.fail("expired action executed"))

    def test_physical_mouse_takes_over_before_next_head_move(self):
        token = self.guard.start()
        self.mouse.pos = (150, 100)
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 1, lambda: self.fail("pointer stolen back"))
        self.assertEqual(self.mouse.pos, (150, 100))
        self.assertGreater(self.mouse.releases, 0)

    def test_programmatic_move_updates_expected_position(self):
        token = self.guard.start()
        def move():
            self.mouse.pos = (300, 400)
            return {"success": True}
        self.guard.execute(token, 1, move)
        self.guard.execute(token, 2, lambda: {"success": True})

    def test_one_pixel_physical_move_stops_before_head_can_override_it(self):
        token = self.guard.start()
        self.mouse.pos = (101, 100)
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 1, lambda: self.fail("small movement overwritten"))
        self.assertEqual(self.mouse.pos, (101, 100))

    def test_reordered_or_replayed_request_cannot_apply(self):
        token = self.guard.start()
        self.guard.execute(token, 3, lambda: {"success": True})
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 2, lambda: self.fail("old move applied"))

    def test_input_error_revokes_session_and_releases_buttons(self):
        token = self.guard.start()
        self.guard.execute(token, 1, lambda: {"success": False, "detail": "failsafe"})
        with self.assertRaises(ControlStopped):
            self.guard.execute(token, 2, lambda: self.fail("continued after failsafe"))
        self.assertGreater(self.mouse.releases, 0)

    def test_missing_session_cannot_operate(self):
        with self.assertRaises(ControlStopped):
            self.guard.execute(None, 1, lambda: self.fail("unleased input"))


if __name__ == "__main__":
    unittest.main()
