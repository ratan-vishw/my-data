#!/usr/bin/env python3
"""
setup.py — Setup script for BioLLM.

Creates all required directories, compiles C++ source code with clang++,
and initializes the default config if needed.

Usage:
  python3 setup.py          # Full setup
  python3 setup.py compile  # Compile only
  python3 setup.py dirs     # Create directories only
"""

import os
import sys
import subprocess
import json
import shutil

# Force UTF-8 output on Windows
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

# Project root (parent of python/)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(PROJECT_ROOT, "src")
BUILD_DIR = PROJECT_ROOT  # Build binaries in project root

DIRS = [
    "data/training",
    "models/checkpoints",
    "memory/long_term",
    "memory/episodes",
    "logs",
]

# C++ source files for each target
COMMON_SOURCES = [
    "tensor.cpp",
    "synapse.cpp",
    "neuron.cpp",
    "neurogenesis.cpp",
    "tokenizer.cpp",
    "transformer.cpp",
    "model.cpp",
    "optimizer.cpp",
    "memory.cpp",
]

TRAIN_SOURCES = COMMON_SOURCES + ["train.cpp"]
CHAT_SOURCES = COMMON_SOURCES + ["chat.cpp"]

# Compiler settings
CXX = "clang++"
CXXFLAGS = ["-std=c++17", "-O2", "-pthread", "-Wall", "-Wno-sign-compare"]


def create_directories():
    """Create all required directories."""
    print("\n\033[1;33m[1/3] Creating directories...\033[0m")
    for d in DIRS:
        path = os.path.join(PROJECT_ROOT, d)
        os.makedirs(path, exist_ok=True)
        print(f"  ✓ {d}/")
    print()


def check_compiler():
    """Check if clang++ is available."""
    global CXX
    try:
        result = subprocess.run([CXX, "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            version_line = result.stdout.split('\n')[0]
            print(f"  Compiler: {version_line}")
            return True
    except FileNotFoundError:
        pass

    # Try g++ as fallback
    try:
        result = subprocess.run(["g++", "--version"], capture_output=True, text=True)
        if result.returncode == 0:
            CXX = "g++"
            version_line = result.stdout.split('\n')[0]
            print(f"  Compiler (fallback): {version_line}")
            return True
    except FileNotFoundError:
        pass

    print("  ✗ No C++ compiler found!")
    print("  Install with: pkg install clang  (Termux)")
    return False


def compile_target(name, sources):
    """Compile a target from source files."""
    src_files = [os.path.join(SRC_DIR, s) for s in sources]
    output = os.path.join(BUILD_DIR, name)

    # Check if sources exist
    for src in src_files:
        if not os.path.exists(src):
            print(f"  ✗ Source file not found: {src}")
            return False

    cmd = [CXX] + CXXFLAGS + src_files + ["-o", output]
    print(f"  Compiling {name}...")
    print(f"    $ {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ✗ Compilation failed!")
        if result.stderr:
            # Show first 30 lines of errors
            errors = result.stderr.strip().split('\n')
            for line in errors[:30]:
                print(f"    {line}")
            if len(errors) > 30:
                print(f"    ... and {len(errors) - 30} more errors")
        return False

    if result.stderr:
        warnings = [l for l in result.stderr.strip().split('\n') if 'warning' in l.lower()]
        if warnings:
            print(f"  ⚠ {len(warnings)} warnings")

    # Make executable on Linux/Termux
    try:
        os.chmod(output, 0o755)
    except:
        pass

    print(f"  ✓ {name} compiled successfully")
    return True


def compile_all():
    """Compile all targets."""
    print("\033[1;33m[2/3] Compiling C++ source...\033[0m")
    if not check_compiler():
        return False

    success = True
    if not compile_target("train", TRAIN_SOURCES):
        success = False
    if not compile_target("chat", CHAT_SOURCES):
        success = False

    return success


def init_config():
    """Initialize default config if it doesn't exist."""
    print("\033[1;33m[3/3] Checking configuration...\033[0m")
    config_path = os.path.join(PROJECT_ROOT, "config.json")
    if os.path.exists(config_path):
        print(f"  ✓ Config exists: {config_path}")
    else:
        # Import from config module
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from config import DEFAULT_CONFIG, save_config
        save_config(DEFAULT_CONFIG)
        print(f"  ✓ Default config created: {config_path}")


def print_usage():
    """Print usage instructions after setup."""
    print("\n\033[1;32m╔══════════════════════════════════════════════╗\033[0m")
    print("\033[1;32m║          BioLLM Setup Complete!              ║\033[0m")
    print("\033[1;32m╚══════════════════════════════════════════════╝\033[0m")
    print()
    print("\033[1;33mNext steps:\033[0m")
    print()
    print("  1. Add training data:")
    print("     Place .txt files in data/training/")
    print()
    print("  2. Train the model:")
    print("     ./train --worker-id 0")
    print()
    print("  3. Or use multi-terminal training:")
    print("     python3 python/launch.py")
    print()
    print("  4. Chat with the model:")
    print("     ./chat")
    print()
    print("  5. Configure:")
    print("     python3 python/config.py")
    print()


def main():
    print("\n\033[1;36m╔══════════════════════════════════════════════╗\033[0m")
    print("\033[1;36m║          BioLLM Setup Script                 ║\033[0m")
    print("\033[1;36m╚══════════════════════════════════════════════╝\033[0m\n")

    os.chdir(PROJECT_ROOT)

    if len(sys.argv) > 1:
        cmd = sys.argv[1]
        if cmd == "compile":
            compile_all()
            return
        elif cmd == "dirs":
            create_directories()
            return

    # Full setup
    create_directories()
    success = compile_all()
    init_config()

    if success:
        print_usage()
    else:
        print("\n\033[1;31mCompilation failed. Fix errors above and re-run.\033[0m")
        print("You can retry with: python3 python/setup.py compile")


if __name__ == "__main__":
    main()
