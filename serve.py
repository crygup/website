import http.server
import os
import sys
from urllib.parse import unquote

from server.logging_utils import get_logger

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
logger = get_logger("static")


BLOCKED = {
    "/server",
    "/.venv",
    "/.git",
    "/config",
    "/serve.py",
    "/backup",
    "/logs",
    "/api.py",
    "/logging_utils.py",
    "/test.html",
    "/test",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _blocked(self, path: str) -> bool:
        path = unquote(path)
        for prefix in BLOCKED:
            if path == prefix or path.startswith(prefix + "/"):
                return True
        return False

    def do_GET(self):
        path = self.path.split("?")[0].rstrip("/") or "/index"
        if self._blocked(path):
            self.send_error(404)
            return

        candidates = [path]
        if not path.endswith(".html") and "." not in os.path.basename(path):
            candidates += [path + ".html", path + "/index.html"]

        ROOT_REAL = os.path.realpath(ROOT)
        for p in candidates:
            clean = os.path.normpath(p.lstrip("/"))
            if clean.startswith(".."):
                continue
            full = os.path.realpath(os.path.join(ROOT, clean))
            if not (full.startswith(ROOT_REAL + os.sep) or full == ROOT_REAL):
                continue
            if os.path.isfile(full):
                self.path = p + (
                    "?" + self.path.split("?", 1)[1] if "?" in self.path else ""
                )
                return super().do_GET()

        return super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?")[0].rstrip("/") or "/index"
        if self._blocked(path):
            self.send_error(404)
            return
        return super().do_HEAD()

    def log_request(self, code, size="-"):
        # Never write query strings: OAuth codes, state, and tokens may be in them.
        path = self.path.split("?", 1)[0]
        logger.info(
            "request method=%s path=%s status=%s bytes=%s client=%s",
            self.command,
            path,
            code,
            size,
            self.client_address[0],
        )

    def log_message(self, format, *args):
        # Keep the default server diagnostics out of stdout while avoiding raw
        # request lines (which can contain credentials in a query string).
        logger.warning("server_message=%s", format % args)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src * data:; "
            "connect-src 'self' https://api.crygup.com https://youtube.crygup.com https://lastfm.crygup.com https://www.youtube.com https://raw.githubusercontent.com; "
            "frame-src https://www.youtube.com; "
            "font-src 'self'; "
            "manifest-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'",
        )
        super().end_headers()


if __name__ == "__main__":
    logger.info("server_started root=%s host=0.0.0.0 port=%s", ROOT, PORT)
    http.server.HTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
