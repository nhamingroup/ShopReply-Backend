#!/usr/bin/env python3
"""Build ShopReply Backend into a single Windows .exe file.

This script:
  1. Installs PyInstaller + PyArmor (if missing)
  2. Obfuscates Python source with PyArmor (anti-decompile)
  3. Generates icon.ico from extension PNG icon
  4. Runs PyInstaller with the shopreply.spec file
  5. Restores original sources after build

Usage:
    python build_exe.py
    python build_exe.py --no-obfuscate   # skip PyArmor (dev builds)

Output:
    dist/ShopReply-Backend/ShopReply-Backend.exe
"""

import subprocess
import sys
import os
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Python source files to obfuscate before packaging
OBFUSCATE_FILES = [
    "main.py",
    "database.py",
    "embeddings.py",
    "ollama_client.py",
    "schemas.py",
    "tray_app.py",
    "run.py",
]


def ensure_pyinstaller():
    """Install PyInstaller if not already available."""
    try:
        import PyInstaller  # noqa: F401
        print(f"[OK] PyInstaller {PyInstaller.__version__} found")
    except ImportError:
        print("[..] Installing PyInstaller...")
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "pyinstaller>=6.0.0"],
            stdout=subprocess.DEVNULL,
        )
        print("[OK] PyInstaller installed")


def ensure_pyarmor():
    """Install PyArmor if not already available. Returns True if available."""
    try:
        result = subprocess.run(
            ["pyarmor", "--version"],
            capture_output=True, text=True,
        )
        if result.returncode == 0:
            ver = result.stdout.strip().split('\n')[0]
            print(f"[OK] PyArmor found: {ver}")
            return True
    except Exception:
        pass

    print("[..] Installing PyArmor...")
    try:
        subprocess.check_call(
            [sys.executable, "-m", "pip", "install", "pyarmor>=8.0"],
            stdout=subprocess.DEVNULL,
        )
        print("[OK] PyArmor installed")
        return True
    except subprocess.CalledProcessError:
        print("[!!] Failed to install PyArmor — skipping obfuscation")
        return False


def obfuscate_sources():
    """Obfuscate Python source files with PyArmor.

    Backs up originals, replaces them with obfuscated versions.
    Call restore_sources() after PyInstaller build to undo.
    Returns True if obfuscation succeeded.
    """
    print()
    print("[..] Obfuscating Python sources with PyArmor...")

    obf_dir = os.path.join(SCRIPT_DIR, "_obfuscated")
    backup_dir = os.path.join(SCRIPT_DIR, "_source_backup")

    # Clean previous runs
    if os.path.exists(obf_dir):
        shutil.rmtree(obf_dir)
    if os.path.exists(backup_dir):
        shutil.rmtree(backup_dir)

    os.makedirs(backup_dir, exist_ok=True)

    # Backup originals
    for fname in OBFUSCATE_FILES:
        src = os.path.join(SCRIPT_DIR, fname)
        if os.path.isfile(src):
            shutil.copy2(src, os.path.join(backup_dir, fname))

    # Collect files to obfuscate
    files_to_obfuscate = [
        os.path.join(SCRIPT_DIR, f) for f in OBFUSCATE_FILES
        if os.path.isfile(os.path.join(SCRIPT_DIR, f))
    ]

    try:
        cmd = [
            "pyarmor", "gen",
            "--output", obf_dir,
        ] + files_to_obfuscate

        subprocess.check_call(cmd, cwd=SCRIPT_DIR)

        # Copy obfuscated .py files back over originals
        for fname in os.listdir(obf_dir):
            if fname.endswith(".py"):
                shutil.copy2(os.path.join(obf_dir, fname), os.path.join(SCRIPT_DIR, fname))

        # Copy PyArmor runtime directory (needed at runtime)
        for d in os.listdir(obf_dir):
            if d.startswith("pyarmor_runtime"):
                runtime_src = os.path.join(obf_dir, d)
                runtime_dest = os.path.join(SCRIPT_DIR, d)
                if os.path.exists(runtime_dest):
                    shutil.rmtree(runtime_dest)
                shutil.copytree(runtime_src, runtime_dest)
                print(f"[OK] PyArmor runtime: {d}")
                break

        print(f"[OK] Obfuscated {len(files_to_obfuscate)} files")
        return True

    except subprocess.CalledProcessError as e:
        print(f"[!!] PyArmor obfuscation failed: {e}")
        print("[!!] Restoring original sources...")
        restore_sources()
        return False


def restore_sources():
    """Restore original source files from backup after build."""
    backup_dir = os.path.join(SCRIPT_DIR, "_source_backup")
    if not os.path.isdir(backup_dir):
        return

    restored = 0
    for fname in OBFUSCATE_FILES:
        backup = os.path.join(backup_dir, fname)
        if os.path.isfile(backup):
            shutil.copy2(backup, os.path.join(SCRIPT_DIR, fname))
            restored += 1

    # Clean up temp dirs
    shutil.rmtree(backup_dir, ignore_errors=True)
    obf_dir = os.path.join(SCRIPT_DIR, "_obfuscated")
    if os.path.exists(obf_dir):
        shutil.rmtree(obf_dir, ignore_errors=True)

    if restored:
        print(f"[OK] Restored {restored} original source files")


def generate_icon():
    """Create icon.ico from the extension PNG icon (shared design source)."""
    from PIL import Image

    # Use the extension 128px icon as the single source of truth
    icon_src = os.path.join(SCRIPT_DIR, "..", "extension", "public", "icon", "128.png")
    if not os.path.isfile(icon_src):
        raise FileNotFoundError(
            f"Extension icon not found at {icon_src}. "
            "Run from the backend/ directory inside the repo."
        )

    base = Image.open(icon_src).convert("RGBA")
    sizes = [256, 128, 64, 48, 32, 16]
    images = [base.resize((sz, sz), Image.LANCZOS) for sz in sizes]

    ico_path = os.path.join(SCRIPT_DIR, "icon.ico")
    images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"[OK] Generated {ico_path} (from extension icon)")
    return ico_path


def run_pyinstaller():
    """Run PyInstaller using the spec file."""
    spec_path = os.path.join(SCRIPT_DIR, "shopreply.spec")

    if not os.path.isfile(spec_path):
        print("[!!] shopreply.spec not found, using command-line mode instead")
        cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onedir",
            "--noconsole",
            "--name", "ShopReply-Backend",
            "--icon", os.path.join(SCRIPT_DIR, "icon.ico"),
            "--add-data", f".env.example{os.pathsep}.",
            os.path.join(SCRIPT_DIR, "tray_app.py"),
        ]
    else:
        cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", spec_path]

    print()
    print("[..] Running PyInstaller (this may take several minutes)...")
    print(f"     Command: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=SCRIPT_DIR)


def main():
    skip_obfuscate = "--no-obfuscate" in sys.argv

    print("=" * 55)
    print("  ShopReply Backend — EXE Builder")
    print("  Obfuscation:", "DISABLED" if skip_obfuscate else "ENABLED")
    print("=" * 55)
    print()

    os.chdir(SCRIPT_DIR)

    # Step 1: Ensure tools
    ensure_pyinstaller()

    obfuscated = False
    if not skip_obfuscate:
        if ensure_pyarmor():
            obfuscated = obfuscate_sources()
        else:
            print("[!!] Continuing without obfuscation")

    try:
        # Step 2: Generate icon
        generate_icon()

        # Step 3: Build
        run_pyinstaller()
    finally:
        # Step 4: ALWAYS restore original sources (even if build fails)
        if obfuscated:
            print()
            restore_sources()

    # Step 5: Report
    exe_dir = os.path.join(SCRIPT_DIR, "dist", "ShopReply-Backend")
    exe_path = os.path.join(exe_dir, "ShopReply-Backend.exe")
    if os.path.isfile(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print()
        print("=" * 55)
        print(f"  BUILD COMPLETE")
        print(f"  Output:      {exe_dir}")
        print(f"  EXE:         {exe_path}")
        print(f"  Size:        {size_mb:.1f} MB")
        print(f"  Obfuscated:  {'YES' if obfuscated else 'NO'}")
        print("=" * 55)
        print()
    else:
        print()
        print("[!!] Build may have failed — .exe not found at expected path")
        print(f"     Expected: {exe_path}")
        print("     Check the PyInstaller output above for errors.")


if __name__ == "__main__":
    main()
