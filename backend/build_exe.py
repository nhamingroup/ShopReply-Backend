#!/usr/bin/env python3
"""Build ShopReply Backend into a single Windows .exe file.

This script:
  1. Installs PyInstaller (if missing)
  2. Generates icon.ico programmatically (no external asset needed)
  3. Runs PyInstaller with the shopreply.spec file

Usage:
    python build_exe.py

Output:
    dist/ShopReply-Backend.exe
"""

import subprocess
import sys
import os
import shutil

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


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


def generate_icon():
    """Create icon.ico from code — multiple sizes for Windows."""
    from PIL import Image, ImageDraw, ImageFont

    sizes = [256, 128, 64, 48, 32, 16]
    images = []

    for sz in sizes:
        img = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)

        # Green circle
        pad = max(1, sz // 16)
        draw.ellipse([pad, pad, sz - pad, sz - pad], fill=(34, 197, 94))

        # White "S" letter, centered
        font_size = int(sz * 0.55)
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except (OSError, IOError):
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), "S", font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        tx = (sz - tw) // 2 - bbox[0]
        ty = (sz - th) // 2 - bbox[1]
        draw.text((tx, ty), "S", fill="white", font=font)

        images.append(img)

    ico_path = os.path.join(SCRIPT_DIR, "icon.ico")
    # Save multi-size ICO (first image = largest, save appends the rest)
    images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:],
    )
    print(f"[OK] Generated {ico_path}")
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

    print("[..] Running PyInstaller (this may take several minutes)...")
    print(f"     Command: {' '.join(cmd)}")
    subprocess.check_call(cmd, cwd=SCRIPT_DIR)


def main():
    print("=" * 55)
    print("  ShopReply Backend — EXE Builder")
    print("=" * 55)
    print()

    os.chdir(SCRIPT_DIR)

    # Step 1: Ensure PyInstaller
    ensure_pyinstaller()

    # Step 2: Generate icon
    generate_icon()

    # Step 3: Build
    run_pyinstaller()

    # Step 4: Report
    exe_dir = os.path.join(SCRIPT_DIR, "dist", "ShopReply-Backend")
    exe_path = os.path.join(exe_dir, "ShopReply-Backend.exe")
    if os.path.isfile(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print()
        print("=" * 55)
        print(f"  BUILD COMPLETE")
        print(f"  Output: {exe_dir}")
        print(f"  EXE:    {exe_path}")
        print(f"  Size:   {size_mb:.1f} MB")
        print("=" * 55)
        print()
        print("  To run:")
        print(f"    {exe_path}")
        print()
        print("  The .exe will:")
        print("    - Start the FastAPI backend on localhost:3939")
        print("    - Show a green 'S' icon in the system tray")
        print("    - Create data/shopreply.db next to the .exe")
        print("    - Write logs to shopreply.log next to the .exe")
        print()
        print("  IMPORTANT: Run the .exe from the dist/ShopReply-Backend/")
        print("  folder (NOT from build/). The _internal/ folder must be")
        print("  next to the .exe.")
        print()
    else:
        print()
        print("[!!] Build may have failed — .exe not found at expected path")
        print(f"     Expected: {exe_path}")
        print("     Check the PyInstaller output above for errors.")


if __name__ == "__main__":
    main()
