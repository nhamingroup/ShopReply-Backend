#!/usr/bin/env python3
"""
ShopReply Backend -- 1-Click Installer
Run: python install.py
"""
import subprocess
import sys
import os
import shutil
import platform


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    """Run a command and return result."""
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def check_python_version():
    """Step 1: Verify Python >= 3.10."""
    print("\n[1/7] Checking Python version...")
    major, minor = sys.version_info[:2]
    if major < 3 or (major == 3 and minor < 10):
        print(f"  FAIL: Python {major}.{minor} detected. Python >= 3.10 required.")
        print(f"  Download: https://www.python.org/downloads/")
        sys.exit(1)
    print(f"  OK: Python {major}.{minor}")


def create_venv():
    """Step 2: Create virtual environment if not exists."""
    print("\n[2/7] Setting up virtual environment...")
    venv_dir = os.path.join(os.path.dirname(__file__), "venv")

    if os.path.exists(venv_dir):
        print(f"  OK: Virtual environment already exists at {venv_dir}")
        return venv_dir

    print(f"  Creating virtual environment at {venv_dir}...")
    result = run([sys.executable, "-m", "venv", venv_dir])
    if result.returncode != 0:
        print(f"  FAIL: Could not create venv: {result.stderr}")
        sys.exit(1)
    print(f"  OK: Virtual environment created")
    return venv_dir


def get_pip(venv_dir: str) -> str:
    """Get the pip executable path inside the venv."""
    if platform.system() == "Windows":
        return os.path.join(venv_dir, "Scripts", "pip.exe")
    return os.path.join(venv_dir, "bin", "pip")


def get_python(venv_dir: str) -> str:
    """Get the python executable path inside the venv."""
    if platform.system() == "Windows":
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def install_requirements(venv_dir: str):
    """Step 3: Install requirements.txt."""
    print("\n[3/7] Installing Python dependencies...")
    pip = get_pip(venv_dir)
    req_file = os.path.join(os.path.dirname(__file__), "requirements.txt")

    if not os.path.exists(req_file):
        print(f"  FAIL: requirements.txt not found at {req_file}")
        sys.exit(1)

    # Upgrade pip first
    result = run([pip, "install", "--upgrade", "pip"])
    if result.returncode != 0:
        print(f"  WARNING: Could not upgrade pip: {result.stderr.strip()}")

    # Install requirements
    print("  Installing packages (this may take a few minutes on first run)...")
    result = run([pip, "install", "-r", req_file])
    if result.returncode != 0:
        print(f"  FAIL: pip install failed:")
        print(f"  {result.stderr}")
        sys.exit(1)

    print("  OK: All dependencies installed")


def create_env_file():
    """Step 4: Create .env from .env.example if not exists."""
    print("\n[4/7] Setting up environment file...")
    backend_dir = os.path.dirname(__file__)
    env_file = os.path.join(backend_dir, ".env")
    env_example = os.path.join(backend_dir, ".env.example")

    if os.path.exists(env_file):
        print(f"  OK: .env file already exists")
        return

    if os.path.exists(env_example):
        shutil.copy2(env_example, env_file)
        print(f"  OK: Created .env from .env.example")
    else:
        # Create a default .env
        with open(env_file, "w") as f:
            f.write("OLLAMA_URL=http://localhost:11434\n")
            f.write("OLLAMA_MODEL=qwen2.5:7b\n")
            f.write("AUTO_REPLY_THRESHOLD=0.85\n")
            f.write("SUGGEST_THRESHOLD=0.50\n")
        print(f"  OK: Created default .env file")

    print(f"  Edit {env_file} to customize settings")


def init_database(venv_dir: str):
    """Step 5: Initialize the database."""
    print("\n[5/7] Initializing database...")
    python = get_python(venv_dir)
    backend_dir = os.path.dirname(__file__)

    result = run(
        [python, "-c", "from database import init_db; init_db(); print('Database initialized')"],
        cwd=backend_dir,
    )
    if result.returncode != 0:
        print(f"  FAIL: Database init failed: {result.stderr.strip()}")
        sys.exit(1)

    print(f"  OK: {result.stdout.strip()}")


def check_ollama():
    """Step 6: Check if Ollama is installed (optional)."""
    print("\n[6/7] Checking Ollama (optional)...")
    ollama_path = shutil.which("ollama")

    if ollama_path:
        print(f"  OK: Ollama found at {ollama_path}")
        # Check if running
        try:
            import urllib.request
            req = urllib.request.Request("http://localhost:11434/api/tags", method="GET")
            with urllib.request.urlopen(req, timeout=3) as resp:
                if resp.status == 200:
                    print("  OK: Ollama is running")
                    return
        except Exception:
            pass
        print("  INFO: Ollama is installed but not running")
        print("  Start it with: ollama serve")
    else:
        print("  INFO: Ollama not found (optional -- AI suggestions won't work)")
        print("  Install: https://ollama.com/download")
        print("  Then run: ollama pull qwen2.5:7b")


def print_success(venv_dir: str):
    """Step 7: Print success message."""
    python = get_python(venv_dir)
    is_windows = platform.system() == "Windows"

    if is_windows:
        activate = os.path.join("venv", "Scripts", "activate")
    else:
        activate = "source venv/bin/activate"

    print("\n[7/7] Setup complete!")
    print()
    print("=" * 50)
    print("  ShopReply Backend -- Ready!")
    print("=" * 50)
    print()
    print("  To start the backend server:")
    print()
    if is_windows:
        print(f"    cd {os.path.dirname(__file__)}")
        print(f"    {activate}")
        print(f"    python run.py")
    else:
        print(f"    cd {os.path.dirname(__file__)}")
        print(f"    {activate}")
        print(f"    python run.py")
    print()
    print("  Or without activating venv:")
    print(f"    {python} run.py")
    print()
    print("  API will be available at: http://localhost:3000")
    print("  API docs (Swagger):       http://localhost:3000/docs")
    print("  Health check:             http://localhost:3000/health")
    print()
    print("  Optional: Install Ollama for AI suggestions")
    print("    https://ollama.com/download")
    print("    ollama pull qwen2.5:7b")
    print()


def main():
    print("=" * 50)
    print("  ShopReply Backend Installer")
    print("=" * 50)

    # Ensure we're in the backend directory
    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    check_python_version()
    venv_dir = create_venv()
    install_requirements(venv_dir)
    create_env_file()
    init_database(venv_dir)
    check_ollama()
    print_success(venv_dir)


if __name__ == "__main__":
    main()
