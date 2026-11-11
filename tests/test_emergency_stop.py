from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class EmergencyStopTests(unittest.TestCase):
    def test_escape_and_window_blur_stop_system_cursor_control(self):
        source = (ROOT / "static" / "js" / "console.js").read_text(encoding="utf-8")

        self.assertIn('e.key === "Escape"', source)
        self.assertIn('window.addEventListener("blur"', source)
        self.assertIn("runtime.emergencyStop()", source)

    def test_console_exposes_a_visible_emergency_stop_button(self):
        source = (ROOT / "static" / "console.html").read_text(encoding="utf-8")

        self.assertIn('id="btn-emergency-stop"', source)
        self.assertIn("紧急停止", source)

    def test_system_cursor_maps_to_the_full_physical_screen(self):
        source = (ROOT / "static" / "js" / "cursor-controller.js").read_text(encoding="utf-8")
        mapping = source.split("  _screenPoint(screen) {", 1)[1].split("\n  async _screen(", 1)[0]

        self.assertIn("this.x * Math.max(0, screen[0] - 1)", mapping)
        self.assertIn("this.y * Math.max(0, screen[1] - 1)", mapping)
        self.assertNotIn("window.screenX", mapping)


if __name__ == "__main__":
    unittest.main()
