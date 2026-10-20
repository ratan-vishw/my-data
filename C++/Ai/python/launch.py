#!/usr/bin/env python3
"""
launch.py — Multi-terminal training launcher for BioLLM.

Uses tmux to create up to 8 panes, each running a training worker.
Also supports launching a chat session in a separate pane.

Usage:
  python3 launch.py                # Launch 8 training workers
  python3 launch.py --workers 4    # Launch 4 training workers
  python3 launch.py --chat         # Launch chat in a tmux pane
  python3 launch.py --stop         # Stop all training workers
  python3 launch.py --status       # Check worker status
"""

import os
import sys
import subprocess
import time
import json
import signal

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SESSION_NAME = "biollm"


def check_tmux():
    """Check if tmux is installed."""
    try:
        result = subprocess.run(["tmux", "-V"], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"  tmux: {result.stdout.strip()}")
            return True
    except FileNotFoundError:
        pass
    print("  ✗ tmux not found!")
    print("  Install with: pkg install tmux  (Termux)")
    return False


def check_binaries():
    """Check if train and chat binaries exist."""
    train_path = os.path.join(PROJECT_ROOT, "train")
    chat_path = os.path.join(PROJECT_ROOT, "chat")

    if not os.path.exists(train_path):
        print(f"  ✗ train binary not found at {train_path}")
        print("  Run: python3 python/setup.py compile")
        return False

    print(f"  ✓ train binary found")
    return True


def kill_session():
    """Kill existing tmux session."""
    subprocess.run(["tmux", "kill-session", "-t", SESSION_NAME],
                   capture_output=True)


def launch_training(num_workers=8):
    """Launch training workers in tmux panes."""
    print(f"\n\033[1;36m╔══════════════════════════════════════════════╗\033[0m")
    print(f"\033[1;36m║    Launching {num_workers} Training Workers              ║\033[0m")
    print(f"\033[1;36m╚══════════════════════════════════════════════╝\033[0m\n")

    if not check_tmux():
        return False
    if not check_binaries():
        return False

    # Kill existing session
    kill_session()
    time.sleep(0.5)

    train_bin = os.path.join(PROJECT_ROOT, "train")
    config_path = os.path.join(PROJECT_ROOT, "config.json")

    # Create new tmux session with first worker
    cmd = f"cd {PROJECT_ROOT} && ./train --worker-id 0 --config config.json"
    subprocess.run([
        "tmux", "new-session", "-d", "-s", SESSION_NAME,
        "-n", "training", cmd
    ])
    print(f"  ✓ Worker 0 started")

    # Split into panes for remaining workers
    for i in range(1, num_workers):
        cmd = f"cd {PROJECT_ROOT} && ./train --worker-id {i} --config config.json"

        # Choose split direction (alternate horizontal/vertical)
        split_flag = "-v" if i % 2 == 1 else "-h"

        subprocess.run([
            "tmux", "split-window", split_flag, "-t", SESSION_NAME, cmd
        ])

        # Rebalance panes
        subprocess.run([
            "tmux", "select-layout", "-t", SESSION_NAME, "tiled"
        ])

        print(f"  ✓ Worker {i} started")
        time.sleep(0.2)

    print(f"\n\033[1;32mAll {num_workers} workers launched!\033[0m")
    print(f"\nTo attach to the session:")
    print(f"  tmux attach -t {SESSION_NAME}")
    print(f"\nTo detach (keep training in background):")
    print(f"  Press Ctrl+B, then D")
    print(f"\nTo stop all workers:")
    print(f"  python3 python/launch.py --stop")
    print(f"  or: tmux kill-session -t {SESSION_NAME}")

    return True


def launch_chat():
    """Launch chat in a new tmux window."""
    print("\n\033[1;36mLaunching Chat Interface...\033[0m\n")

    if not check_tmux():
        return False

    chat_bin = os.path.join(PROJECT_ROOT, "chat")
    if not os.path.exists(chat_bin):
        print(f"  ✗ chat binary not found. Run: python3 python/setup.py compile")
        return False

    cmd = f"cd {PROJECT_ROOT} && ./chat --config config.json"

    # Try to add to existing session, or create new
    result = subprocess.run(
        ["tmux", "has-session", "-t", SESSION_NAME],
        capture_output=True
    )

    if result.returncode == 0:
        # Add as new window in existing session
        subprocess.run([
            "tmux", "new-window", "-t", SESSION_NAME, "-n", "chat", cmd
        ])
        print(f"  ✓ Chat launched in existing session")
        print(f"  tmux attach -t {SESSION_NAME}")
    else:
        # Create new session
        subprocess.run([
            "tmux", "new-session", "-d", "-s", SESSION_NAME,
            "-n", "chat", cmd
        ])
        print(f"  ✓ Chat launched in new session")
        print(f"  tmux attach -t {SESSION_NAME}")

    return True


def stop_training():
    """Stop all training workers."""
    print("\n\033[1;33mStopping all training workers...\033[0m")
    kill_session()
    print("  ✓ Session killed")

    # Also try to kill any orphaned processes
    try:
        subprocess.run(["pkill", "-f", "./train"], capture_output=True)
    except:
        pass


def check_status():
    """Check status of training workers."""
    print(f"\n\033[1;36mTraining Status\033[0m\n")

    # Check tmux session
    result = subprocess.run(
        ["tmux", "has-session", "-t", SESSION_NAME],
        capture_output=True
    )
    if result.returncode != 0:
        print("  No active training session.")
        print("  Start with: python3 python/launch.py")
        return

    # List panes
    result = subprocess.run(
        ["tmux", "list-panes", "-t", SESSION_NAME, "-F",
         "#{pane_index}: #{pane_current_command} (#{pane_pid})"],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        print("  Active panes:")
        for line in result.stdout.strip().split('\n'):
            print(f"    {line}")

    # Check log files
    log_dir = os.path.join(PROJECT_ROOT, "logs")
    if os.path.exists(log_dir):
        print(f"\n  Log files:")
        for f in sorted(os.listdir(log_dir)):
            if f.endswith('.log'):
                path = os.path.join(log_dir, f)
                size = os.path.getsize(path)
                # Read last line
                last_line = ""
                try:
                    with open(path, 'r') as fh:
                        lines = fh.readlines()
                        if lines:
                            last_line = lines[-1].strip()
                except:
                    pass
                print(f"    {f} ({size} bytes) — {last_line[:60]}")

    # Check checkpoints
    ckpt_dir = os.path.join(PROJECT_ROOT, "models", "checkpoints")
    if os.path.exists(ckpt_dir):
        ckpts = sorted([f for f in os.listdir(ckpt_dir) if f.endswith('.ckpt')])
        if ckpts:
            print(f"\n  Checkpoints: {len(ckpts)}")
            print(f"    Latest: {ckpts[-1]}")


def main():
    if len(sys.argv) < 2:
        # Default: launch 8 workers
        launch_training(8)
        return

    arg = sys.argv[1]

    if arg == "--workers" and len(sys.argv) > 2:
        n = int(sys.argv[2])
        n = max(1, min(8, n))
        launch_training(n)

    elif arg == "--chat":
        launch_chat()

    elif arg == "--stop":
        stop_training()

    elif arg == "--status":
        check_status()

    elif arg == "--help":
        print("Usage:")
        print("  python3 launch.py              # Launch 8 workers")
        print("  python3 launch.py --workers N   # Launch N workers (1-8)")
        print("  python3 launch.py --chat        # Launch chat interface")
        print("  python3 launch.py --stop        # Stop all workers")
        print("  python3 launch.py --status      # Check status")

    else:
        print(f"Unknown argument: {arg}")
        print("Use --help for usage")


if __name__ == "__main__":
    main()
