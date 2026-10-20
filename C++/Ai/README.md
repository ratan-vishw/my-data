# BioLLM — Self-Training Bio-Inspired Language Model

A complete language model system written in pure C++ that runs on **Termux** (Android).
Features biologically-inspired neural architecture with dynamic neuron growth,
multi-terminal parallel training, persistent memory, and an interactive chat interface.

## Features

- **Pure C++17** — No external dependencies (no PyTorch, no BLAS)
- **Bio-Inspired Neurons** — Dendrites, soma, axon, membrane potential, STDP, Hebbian learning
- **Dynamic Growth (Neurogenesis)** — Network grows new neurons and layers during training
- **Multi-Terminal Training** — Up to 8 parallel workers via tmux
- **Persistent Memory** — Long-term + episodic memory for chat
- **Interactive Chat** — REPL with typing effect and slash commands

## Quick Start

### 1. Install Requirements (Termux)

```bash
pkg update && pkg install clang python tmux
```

### 2. Build

```bash
# Option A: Using make
make all

# Option B: Using Python setup
python3 python/setup.py
```

### 3. Add Training Data

Place `.txt` files in `data/training/`:

```bash
# Example: download some text
echo "The quick brown fox jumps over the lazy dog. This is a test." > data/training/sample.txt

# Or use real text data
cp ~/Documents/book.txt data/training/
```

### 4. Train

```bash
# Single terminal
./train --worker-id 0

# Multi-terminal (8 workers via tmux)
python3 python/launch.py

# Custom number of workers
python3 python/launch.py --workers 4
```

### 5. Chat

```bash
./chat
```

## Architecture

```
Token Embedding + Position Embedding
    ↓
┌─────────────────────────────────┐
│   Transformer Block (×N)        │
│   ┌───────────────────────────┐ │
│   │ LayerNorm                 │ │
│   │ Multi-Head Self-Attention │ │
│   │ + Residual Connection     │ │
│   └───────────────────────────┘ │
│   ┌───────────────────────────┐ │
│   │ Bio-Layer Modulation      │ │
│   │ (Dendrites + STDP + LIF)  │ │
│   └───────────────────────────┘ │
│   ┌───────────────────────────┐ │
│   │ LayerNorm                 │ │
│   │ Feed-Forward (GELU)      │ │
│   │ + Residual Connection     │ │
│   └───────────────────────────┘ │
└─────────────────────────────────┘
    ↓
Final LayerNorm → Output Projection → Softmax
```

### Bio-Inspired Neuron Structure

```
                ┌─── Dendrite 1 ─── Local computation ───┐
Inputs ────────├─── Dendrite 2 ─── Local computation ────├──→ Soma ──→ Axon ──→ Output
                ├─── Dendrite 3 ─── Local computation ───┤   (LIF)
                └─── Dendrite 4 ─── Local computation ───┘
                                                              ↑
                                            Membrane Potential │ Threshold
                                            Refractory Period  │ Firing
```

**Learning Rules:**
- **STDP**: Spike-Timing-Dependent Plasticity (pre before post → strengthen)
- **Hebbian**: "Fire together, wire together"
- **Synaptic Pruning**: Remove weak connections
- **Sprouting**: Create new connections between active neurons
- **Neurogenesis**: Add new neurons when existing ones are saturated

## Configuration

```bash
# View config
python3 python/config.py

# Change model size
python3 python/config.py set model.embed_dim 256
python3 python/config.py set model.num_layers 6

# Change training params
python3 python/config.py set training.learning_rate 0.0005
python3 python/config.py set training.batch_size 8

# Reset to defaults
python3 python/config.py reset
```

## Chat Commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/status` | Model info & memory stats |
| `/memory` | Show recent conversations |
| `/reload` | Reload latest checkpoint |
| `/save` | Save memory to disk |
| `/temp N` | Set temperature (0.1-2.0) |
| `/quit` | Exit |

## Directory Structure

```
Ai/
├── src/                    # C++ source code
│   ├── tensor.h/.cpp       # Matrix operations
│   ├── synapse.h/.cpp      # Synaptic connections (STDP, Hebbian)
│   ├── neuron.h/.cpp       # Biological neurons (dendrites, soma, axon)
│   ├── neurogenesis.h/.cpp # Dynamic growth manager
│   ├── tokenizer.h/.cpp    # Character-level tokenizer
│   ├── transformer.h/.cpp  # Transformer blocks
│   ├── model.h/.cpp        # Full LLM model
│   ├── optimizer.h/.cpp    # AdamW optimizer
│   ├── memory.h/.cpp       # Persistent memory
│   ├── train.cpp           # Training worker
│   └── chat.cpp            # Chat interface
├── python/                 # Python orchestration
│   ├── config.py           # Configuration manager
│   ├── setup.py            # Build & setup
│   └── launch.py           # Multi-terminal launcher
├── data/training/          # Place .txt files here
├── models/checkpoints/     # Saved model weights
├── memory/                 # Chat memory storage
├── logs/                   # Training logs
├── config.json             # Configuration
└── Makefile                # Build system
```

## Multi-Worker Training

Workers coordinate via file-based checkpoint synchronization:

1. Each worker reads a shard of the training data (round-robin by file)
2. Workers train independently, accumulating gradients
3. Periodically, one worker saves a checkpoint (with file locking)
4. Other workers detect the new checkpoint and reload weights
5. This approximates distributed training without MPI/NCCL

```bash
# Check training status
python3 python/launch.py --status

# Stop all workers
python3 python/launch.py --stop

# Monitor logs
tail -f logs/worker_0.log
```

## Tips

- **More data = better results**. Use large text files for training.
- **Training time**: Expect hours/days on mobile CPU for meaningful results.
- **Temperature**: Higher (1.0-1.5) = more creative, lower (0.3-0.7) = more focused.
- **Monitor neurogenesis**: Check `logs/neurogenesis.log` to see network growth.
- **Battery**: Consider plugging in during long training runs on mobile.
