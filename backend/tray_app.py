"""ShopReply Backend — System tray wrapper for PyInstaller packaging.

This is the main entry point that PyInstaller bundles into a single .exe.
It starts the FastAPI backend in a background thread and shows a Windows
system tray icon with controls.
"""

import sys
import os
import time
import threading
import logging
import socket

# --- Resolve paths early (before any imports that use relative paths) ---
# When running as a PyInstaller .exe, sys._MEIPASS is the temp extraction dir.
# The working directory should be where the .exe lives, so the SQLite DB
# and data folder sit next to it.
if getattr(sys, "frozen", False):
    # Running as compiled .exe
    _exe_dir = os.path.dirname(sys.executable)
    # console=False makes sys.stdout/stderr None → uvicorn's DefaultFormatter
    # calls sys.stderr.isatty() which crashes. Redirect to os.devnull.
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w")
else:
    # Running as script
    _exe_dir = os.path.dirname(os.path.abspath(__file__))

os.chdir(_exe_dir)

# Ensure data directory exists (for SQLite DB)
_data_dir = os.path.join(_exe_dir, "data")
os.makedirs(_data_dir, exist_ok=True)

# Set DATABASE_URL so database.py picks it up
if not os.environ.get("DATABASE_URL"):
    _db_path = os.environ.get("SHOPREPLY_DB_PATH", os.path.join(_data_dir, "shopreply.db"))
    # Normalise to forward slashes for SQLite URI
    _db_path = _db_path.replace("\\", "/")
    os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"

# Load .env if present (next to exe or in cwd)
try:
    from dotenv import load_dotenv
    _env_file = os.path.join(_exe_dir, ".env")
    if os.path.isfile(_env_file):
        load_dotenv(_env_file)
except ImportError:
    pass

# --- Now safe to import heavy deps ---

import pystray  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
import uvicorn  # noqa: E402
import webbrowser  # noqa: E402

try:
    import winreg  # noqa: E402
except ImportError:
    winreg = None  # Not on Windows — startup toggle will be a no-op


logger = logging.getLogger("shopreply.tray")

# --- File-based logging (always, so we can diagnose exe crashes) ---
_log_file = os.path.join(_exe_dir, "shopreply.log")
_file_handler = logging.FileHandler(_log_file, encoding="utf-8")
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(levelname)s: %(message)s"))
logging.getLogger().addHandler(_file_handler)
logging.getLogger().setLevel(logging.INFO)


# ---------------------------------------------------------------------------
# Icon creation
# ---------------------------------------------------------------------------

def create_icon_image() -> Image.Image:
    """Create a 64x64 RGBA icon: green circle with white 'S' letter."""
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Green circle (Tailwind green-500 = #22c55e = 34,197,94)
    draw.ellipse([4, 4, size - 4, size - 4], fill=(34, 197, 94))
    # Try to use a larger built-in font; fall back to default
    try:
        font = ImageFont.truetype("arial.ttf", 32)
    except (OSError, IOError):
        font = ImageFont.load_default()
    # Center the "S"
    bbox = draw.textbbox((0, 0), "S", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]
    draw.text((tx, ty), "S", fill="white", font=font)
    return img


# ---------------------------------------------------------------------------
# Port helpers
# ---------------------------------------------------------------------------

def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", port)) == 0


# ---------------------------------------------------------------------------
# Main tray application
# ---------------------------------------------------------------------------

class ShopReplyTray:
    def __init__(self):
        self.port = int(os.environ.get("SHOPREPLY_PORT", "3939"))
        self.server: uvicorn.Server | None = None
        self.server_thread: threading.Thread | None = None
        self.is_running = False
        self.has_error = False
        self.error_msg = ""
        self.icon: pystray.Icon | None = None

    # ---- Server lifecycle ------------------------------------------------

    def start_server(self):
        """Start FastAPI/uvicorn server — runs in a daemon thread."""
        try:
            # Check port availability first
            if is_port_in_use(self.port):
                self.has_error = True
                self.error_msg = f"Port {self.port} is already in use"
                logger.error(self.error_msg)
                return

            logger.info("Importing main app module...")
            from main import app  # noqa: import here so CWD is set first
            logger.info("Main app module imported successfully")

            config = uvicorn.Config(
                app,
                host="127.0.0.1",
                port=self.port,
                log_level="info",
                # Disable signal handlers — we handle shutdown ourselves
                # (uvicorn signal handlers interfere with pystray's event loop)
            )
            self.server = uvicorn.Server(config)
            # Override install_signal_handlers to no-op (runs in thread, not main)
            self.server.install_signal_handlers = lambda: None
            self.is_running = True
            self.has_error = False
            logger.info("Server starting on port %d", self.port)
            self.server.run()
        except Exception as exc:
            import traceback
            self.has_error = True
            self.error_msg = str(exc)
            self.is_running = False
            logger.error("Server failed to start: %s", exc)
            logger.error("Traceback:\n%s", traceback.format_exc())

    def stop_server(self):
        if self.server:
            self.server.should_exit = True
        self.is_running = False

    # ---- Menu actions ----------------------------------------------------

    def open_dashboard(self, _icon=None, _item=None):
        webbrowser.open(f"http://localhost:{self.port}/health")

    def open_api_docs(self, _icon=None, _item=None):
        webbrowser.open(f"http://localhost:{self.port}/docs")

    def open_log_file(self, _icon=None, _item=None):
        os.startfile(_log_file)

    def toggle_startup(self, _icon=None, _item=None):
        """Add or remove ShopReply from Windows startup (HKCU\\...\\Run)."""
        if winreg is None:
            return
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"
        app_name = "ShopReply"
        if getattr(sys, "frozen", False):
            exe_path = f'"{sys.executable}"'
        else:
            exe_path = f'"{sys.executable}" "{os.path.abspath(__file__)}"'

        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_ALL_ACCESS
            )
            try:
                winreg.QueryValueEx(key, app_name)
                # Exists -> remove
                winreg.DeleteValue(key, app_name)
                logger.info("Removed from Windows startup")
            except FileNotFoundError:
                # Does not exist -> add
                winreg.SetValueEx(key, app_name, 0, winreg.REG_SZ, exe_path)
                logger.info("Added to Windows startup")
            winreg.CloseKey(key)
        except Exception:
            logger.exception("Failed to toggle startup registry key")

    def is_startup_enabled(self) -> bool:
        if winreg is None:
            return False
        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            )
            winreg.QueryValueEx(key, "ShopReply")
            winreg.CloseKey(key)
            return True
        except Exception:
            return False

    def quit_app(self, _icon=None, _item=None):
        logger.info("Quitting ShopReply tray app")
        self.stop_server()
        if self.icon:
            self.icon.stop()

    # ---- Tray menu -------------------------------------------------------

    def _build_menu(self) -> pystray.Menu:
        """Build the right-click menu for the tray icon."""
        if self.has_error:
            status_text = f"Status: Error - {self.error_msg[:40]}"
        elif self.is_running:
            status_text = "Status: Running"
        else:
            status_text = "Status: Starting..."

        return pystray.Menu(
            pystray.MenuItem("ShopReply Backend v1.0", None, enabled=False),
            pystray.MenuItem(status_text, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open Health Check", self.open_dashboard),
            pystray.MenuItem("Open API Docs", self.open_api_docs),
            pystray.MenuItem("Open Log File", self.open_log_file),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                "Start with Windows",
                self.toggle_startup,
                checked=lambda item: self.is_startup_enabled(),
            ),
            pystray.MenuItem(f"Port: {self.port}", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit", self.quit_app),
        )

    # ---- Main entry point ------------------------------------------------

    def _show_notification(self, title: str, message: str):
        """Show a Windows tray balloon notification."""
        if self.icon:
            try:
                self.icon.notify(message, title)
            except Exception:
                logger.debug("Notification not supported on this platform")

    def _wait_and_notify(self):
        """Wait for server to be ready, then show success/error notification."""
        # Wait for tray icon to fully initialize first
        time.sleep(3)
        # Wait up to 10s for server to start
        for _ in range(20):
            time.sleep(0.5)
            if self.has_error:
                self._show_notification(
                    "ShopReply - Error",
                    f"Backend failed to start: {self.error_msg[:80]}\n"
                    f"Check log: {_log_file}"
                )
                return
            if self.is_running and is_port_in_use(self.port):
                self._show_notification(
                    "ShopReply Backend",
                    f"Server is running on port {self.port}.\n"
                    "Open Chrome extension to get started!"
                )
                return
        # Timeout
        self._show_notification(
            "ShopReply - Warning",
            "Server is taking longer than expected to start..."
        )

    def run(self):
        """Launch server thread + tray icon (blocking)."""
        # Start server in background thread
        self.server_thread = threading.Thread(target=self.start_server, daemon=True)
        self.server_thread.start()

        # Give server a moment to fail fast (e.g. port in use)
        time.sleep(1.0)

        # Create and run the tray icon (blocks until icon.stop())
        self.icon = pystray.Icon("ShopReply")
        self.icon.icon = create_icon_image()
        self.icon.title = f"ShopReply Backend (:{self.port})"
        self.icon.menu = self._build_menu()

        # Delay notification so icon.run() has time to initialize the Win32 window
        notify_thread = threading.Thread(target=self._wait_and_notify, daemon=True)
        notify_thread.start()

        self.icon.run()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )
    app = ShopReplyTray()
    app.run()
