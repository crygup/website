import http.server
import os
import posixpath
import sys
from urllib.parse import quote, unquote

from server.logging_utils import get_logger

ROOT = os.path.dirname(os.path.abspath(__file__))
ROOT_REAL = os.path.realpath(ROOT)
try:
    PORT = int(sys.argv[1])
except (IndexError, ValueError):
    PORT = 8080
logger = get_logger("static")


BLOCKED = {
    "/server",
    "/.venv",
    "/.git",
    "/config",
    "/serve.py",
    "/backup",
    "/downloads",
    "/logs",
    "/api.py",
    "/logging_utils.py",
    "/test.html",
    "/test",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    @staticmethod
    def _decode_path(path: str) -> str | None:
        """Decode one URL path layer, rejecting malformed/control input."""
        try:
            decoded = unquote(path, errors="strict")
        except UnicodeDecodeError:
            return None
        if "\x00" in decoded or "\\" in decoded:
            return None
        return decoded

    @staticmethod
    def _blocked_decoded(path: str) -> bool:
        # Treat repeated leading slashes as one URL root.  Otherwise
        # `//api.py` could bypass the `/api.py` deny-list while still resolving
        # to that file after filesystem normalisation.
        path = "/" + path.lstrip("/")
        # Apply dot-segment normalisation for deny-list checks as well; a
        # request such as `/.%2fapi.py` must not resolve to a blocked file.
        path = posixpath.normpath(path)
        path_folded = path.casefold()
        for prefix in BLOCKED:
            prefix_folded = prefix.casefold()
            if path_folded == prefix_folded or path_folded.startswith(
                prefix_folded + "/"
            ):
                return True
        return False

    def _blocked(self, path: str) -> bool:
        decoded = self._decode_path(path)
        return decoded is None or self._blocked_decoded(decoded)

    def _safe_full_path(self, path: str, *, decoded: bool = False) -> str | None:
        """Resolve a URL path while preventing traversal and symlink escapes."""
        # A request target may include a query string.  It is never part of
        # the filesystem path (and must be removed before URL decoding so an
        # encoded ``%3F`` in an actual filename remains a filename).
        if decoded:
            value = path
        else:
            raw_path = path.split("?", 1)[0]
            value = self._decode_path(raw_path)
        if value is None:
            return None
        value = "/" + value.lstrip("/")
        if self._blocked_decoded(value):
            return None

        # Check components before normalisation so `/a/../secret` is rejected
        # rather than silently collapsed into a path inside the document root.
        if any(component == ".." for component in value.split("/")):
            return None
        relative = posixpath.normpath(value.lstrip("/"))
        if relative in {"", "."}:
            return ROOT_REAL
        if relative == ".." or relative.startswith("../"):
            return None
        full = os.path.realpath(os.path.join(ROOT_REAL, *relative.split("/")))
        if full != ROOT_REAL and not full.startswith(ROOT_REAL + os.sep):
            return None
        return full

    def _prepare_path(self) -> bool:
        """Constrain the request and select the extension/index fallback."""
        raw_path, _, query = self.path.partition("?")
        decoded = self._decode_path(raw_path)
        if decoded is None or self._blocked_decoded(decoded):
            return False
        decoded = "/" + decoded.lstrip("/")
        if any(component == ".." for component in decoded.split("/")):
            return False
        normalized = posixpath.normpath(decoded)
        if normalized == "/.":
            normalized = "/"
        path = normalized.rstrip("/") or "/index"

        candidates = [path]
        if not path.endswith(".html") and "." not in posixpath.basename(path):
            candidates.extend((path + ".html", path + "/index.html"))
        chosen: str | None = None
        for candidate in candidates:
            full = self._safe_full_path(candidate, decoded=True)
            if full is not None and os.path.isfile(full):
                chosen = candidate
                break
        if chosen is None:
            # Preserve normal 404/directory handling, but only after checking
            # that the requested path itself remains inside ROOT_REAL.
            if self._safe_full_path(path, decoded=True) is None:
                return False
            chosen = path

        # SimpleHTTPRequestHandler decodes self.path once more.  Quote the
        # already-decoded path so a double-encoded traversal cannot become `..`
        # during that later translation step.
        self.path = quote(chosen, safe="/") + (("?" + query) if query else "")
        return True

    def translate_path(self, path: str) -> str:
        """Keep every SimpleHTTPRequestHandler filesystem lookup confined."""
        # ``SimpleHTTPRequestHandler`` passes the complete request target
        # (including ``?query``) here.  The query is not part of the file
        # name; stripping it before decoding also preserves normal static
        # routes such as ``/dashboard?tab=settings``.
        raw_path = path.split("?", 1)[0]
        full = self._safe_full_path(raw_path)
        return full if full is not None else os.devnull

    def do_GET(self):
        raw_path = self.path.split("?", 1)[0]
        decoded = self._decode_path(raw_path)
        if decoded == "/healthz":
            self.send_response(204)
            self.end_headers()
            return
        if not self._prepare_path():
            self.send_error(404)
            return
        return super().do_GET()

    def do_HEAD(self):
        raw_path = self.path.split("?", 1)[0]
        decoded = self._decode_path(raw_path)
        if decoded == "/healthz":
            self.send_response(204)
            self.end_headers()
            return
        if not self._prepare_path():
            self.send_error(404)
            return
        return super().do_HEAD()

    def log_request(self, code="-", size="-"):
        # Never write query strings: OAuth codes, state, and tokens may be in them.
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            return
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
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
