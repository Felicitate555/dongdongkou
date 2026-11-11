import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class StartupScriptTests(unittest.TestCase):
    def test_startup_script_is_cmd_compatible(self):
        raw = (ROOT / "启动.bat").read_bytes()

        self.assertEqual(raw.count(b"\n"), raw.count(b"\r\n"))
        raw.decode("ascii")

    def test_browser_opens_after_service_readiness_check(self):
        script = (ROOT / "启动.bat").read_text(encoding="ascii")

        wait_position = script.index("Waiting for the service")
        browser_position = script.index('start "" http://127.0.0.1:8787', wait_position)
        self.assertGreater(browser_position, wait_position)

    def test_startup_prefers_the_known_project_environment(self):
        script = (ROOT / "启动.bat").read_text(encoding="ascii")

        preferred = 'set "PYEXE=%~dp0.venv\\Scripts\\python.exe"'
        fallback = 'set "PYEXE=%~dp0venv\\Scripts\\python.exe"'
        self.assertLess(script.index(preferred), script.index(fallback))


if __name__ == "__main__":
    unittest.main()
