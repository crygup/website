"""Regression tests for static-server path confinement."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
# serve.py accepts an optional positional port; hide unittest's arguments while
# importing it so the helper methods can be exercised without binding a socket.
_argv = sys.argv
sys.argv = [sys.argv[0]]
from serve import Handler  # noqa: E402

sys.argv = _argv


def _handler() -> Handler:
    # Path helpers do not require a live socket or HTTP server.
    return object.__new__(Handler)


class StaticPathSecurityTests(unittest.TestCase):
    def test_blocked_or_traversal_paths_are_not_resolved(self) -> None:
        for path in (
            "/../api.py",
            "/%2e%2e/api.py",
            "/foo/../api.py",
            "//api.py",
            "/API.PY",
            "//server/secret",
            "/server%2fsecret",
            "/.%2fapi.py",
            "/%00",
        ):
            with self.subTest(path=path):
                self.assertIsNone(_handler()._safe_full_path(path))

    def test_double_encoded_traversal_is_literal_and_confined(self) -> None:
        resolved = _handler()._safe_full_path("/%252e%252e/api.py")
        assert resolved is not None
        self.assertTrue(
            str(Path(resolved)).startswith(str(Path(__file__).parents[1] / "src"))
        )

    def test_head_and_get_path_preparation_share_confinement(self) -> None:
        handler = _handler()
        handler.path = "/dashboard"
        self.assertTrue(handler._prepare_path())
        self.assertEqual(handler.path, "/dashboard.html")

        # SimpleHTTPRequestHandler invokes translate_path with the complete
        # request target; a query must not become part of the filesystem name.
        self.assertTrue(
            handler.translate_path("/dashboard.html?tab=settings").endswith(
                "/dashboard.html"
            )
        )
