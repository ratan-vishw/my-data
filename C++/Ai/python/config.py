#!/usr/bin/env python3
"""
config.py — Configuration manager for BioLLM.

Usage:
  python3 config.py                    # Show current config
  python3 config.py set key value      # Set a config value
  python3 config.py reset              # Reset to defaults
"""

import json
import sys
import os

DEFAULT_CONFIG = {
    "model": {
        "embed_dim": 128,
        "num_heads": 4,
        "num_layers": 4,
        "max_seq_len": 256,
        "ff_multiplier": 4,
        "dropout": 0.0,
        "vocab_size": 0
    },
    "training": {
        "learning_rate": 0.001,
        "batch_size": 4,
        "num_workers": 8,
        "max_epochs": 1000,
        "checkpoint_every": 500,
        "log_every": 10,
        "grad_clip": 1.0,
        "warmup_steps": 100,
        "weight_decay": 0.01
    },
    "neuron": {
        "num_dendrites": 4,
        "membrane_decay": 0.9,
        "firing_threshold": 0.5,
        "refractory_steps": 2,
        "stdp_rate": 0.01,
        "hebbian_rate": 0.005,
        "prune_threshold": 0.001,
        "sprout_probability": 0.01
    },
    "neurogenesis": {
        "saturation_threshold": 0.8,
        "max_neurons_per_layer": 512,
        "max_layers": 12,
        "growth_check_interval": 1000,
        "neurons_to_add": 8,
        "enabled": True
    },
    "memory": {
        "max_long_term": 10000,
        "max_episodes": 1000,
        "similarity_threshold": 0.3,
        "consolidation_interval": 5000
    },
    "paths": {
        "training_data": "data/training",
        "checkpoints": "models/checkpoints",
        "vocab": "models/vocab.bin",
        "long_term_memory": "memory/long_term",
        "episodic_memory": "memory/episodes",
        "logs": "logs"
    }
}

CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config.json")


def load_config():
    """Load config from file, or return defaults."""
    if os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, 'r') as f:
            return json.load(f)
    return DEFAULT_CONFIG.copy()


def save_config(config):
    """Save config to file."""
    with open(CONFIG_PATH, 'w') as f:
        json.dump(config, f, indent=4)
    print(f"Config saved to {CONFIG_PATH}")


def show_config(config, indent=0):
    """Pretty-print config."""
    for key, value in config.items():
        if isinstance(value, dict):
            print("  " * indent + f"\033[1;33m{key}:\033[0m")
            show_config(value, indent + 1)
        else:
            print("  " * indent + f"  {key}: \033[1;36m{value}\033[0m")


def set_value(config, key_path, value):
    """Set a config value by dot-separated key path."""
    keys = key_path.split(".")
    d = config
    for k in keys[:-1]:
        if k not in d:
            print(f"Error: Key '{k}' not found")
            return False
        d = d[k]

    final_key = keys[-1]
    if final_key not in d:
        print(f"Error: Key '{final_key}' not found")
        return False

    # Type conversion
    old_value = d[final_key]
    try:
        if isinstance(old_value, bool):
            d[final_key] = value.lower() in ('true', '1', 'yes')
        elif isinstance(old_value, int):
            d[final_key] = int(value)
        elif isinstance(old_value, float):
            d[final_key] = float(value)
        else:
            d[final_key] = value
    except ValueError:
        print(f"Error: Cannot convert '{value}' to {type(old_value).__name__}")
        return False

    print(f"Set {key_path} = {d[final_key]}")
    return True


def main():
    config = load_config()

    if len(sys.argv) < 2:
        print("\n\033[1;32m╔══════════════════════════════════════╗\033[0m")
        print("\033[1;32m║     BioLLM Configuration             ║\033[0m")
        print("\033[1;32m╚══════════════════════════════════════╝\033[0m\n")
        show_config(config)
        print(f"\nConfig file: {CONFIG_PATH}")
        print("\nUsage:")
        print("  python3 config.py set model.embed_dim 256")
        print("  python3 config.py set training.learning_rate 0.0005")
        print("  python3 config.py reset")
        return

    command = sys.argv[1]

    if command == "reset":
        save_config(DEFAULT_CONFIG)
        print("Config reset to defaults.")

    elif command == "set" and len(sys.argv) >= 4:
        key = sys.argv[2]
        value = sys.argv[3]
        if set_value(config, key, value):
            save_config(config)

    elif command == "show":
        show_config(config)

    else:
        print("Usage:")
        print("  python3 config.py              # Show config")
        print("  python3 config.py set KEY VAL   # Set value")
        print("  python3 config.py reset         # Reset defaults")


if __name__ == "__main__":
    main()
