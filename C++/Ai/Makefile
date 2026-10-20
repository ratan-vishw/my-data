# ============================================================
# BioLLM Makefile
# Compiles on Termux (clang++) and Linux (g++/clang++)
# ============================================================

CXX       ?= clang++
CXXFLAGS  = -std=c++17 -O2 -pthread -Wall -Wno-sign-compare
SRC_DIR   = src

# Common source files (everything except executables)
COMMON_SRC = \
	$(SRC_DIR)/tensor.cpp \
	$(SRC_DIR)/synapse.cpp \
	$(SRC_DIR)/neuron.cpp \
	$(SRC_DIR)/neurogenesis.cpp \
	$(SRC_DIR)/tokenizer.cpp \
	$(SRC_DIR)/transformer.cpp \
	$(SRC_DIR)/model.cpp \
	$(SRC_DIR)/optimizer.cpp \
	$(SRC_DIR)/memory.cpp

# Targets
TRAIN_SRC = $(COMMON_SRC) $(SRC_DIR)/train.cpp
CHAT_SRC  = $(COMMON_SRC) $(SRC_DIR)/chat.cpp

.PHONY: all clean dirs train chat

all: dirs train chat
	@echo ""
	@echo "Build complete! Binaries: ./train ./chat"
	@echo "Run: python3 python/setup.py  for full setup"

train: $(TRAIN_SRC)
	$(CXX) $(CXXFLAGS) $(TRAIN_SRC) -o train
	@echo "Built: train"

chat: $(CHAT_SRC)
	$(CXX) $(CXXFLAGS) $(CHAT_SRC) -o chat
	@echo "Built: chat"

dirs:
	@mkdir -p data/training
	@mkdir -p models/checkpoints
	@mkdir -p memory/long_term
	@mkdir -p memory/episodes
	@mkdir -p logs

clean:
	rm -f train chat
	@echo "Cleaned build artifacts"

# Debug build (with symbols, no optimization)
debug: CXXFLAGS = -std=c++17 -g -O0 -pthread -Wall -DDEBUG
debug: all

# Size-optimized build (for limited storage)
small: CXXFLAGS = -std=c++17 -Os -pthread -Wall -Wno-sign-compare
small: all

help:
	@echo "BioLLM Build Targets:"
	@echo "  make all     - Build train and chat (default)"
	@echo "  make train   - Build training worker only"
	@echo "  make chat    - Build chat interface only"
	@echo "  make debug   - Build with debug symbols"
	@echo "  make small   - Build with size optimization"
	@echo "  make dirs    - Create data directories"
	@echo "  make clean   - Remove binaries"
