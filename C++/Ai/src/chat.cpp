/**
 * chat.cpp — Interactive chat interface for the BioLLM.
 *
 * Usage: ./chat [--config path] [--checkpoint path]
 *
 * Features:
 * - Loads latest model checkpoint
 * - Interactive REPL with typing-like output
 * - Persistent memory across sessions
 * - Special commands: /save, /memory, /status, /reload, /quit, /help
 */

#include "memory.h"
#include "model.h"
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>

namespace fs = std::filesystem;

// ============================================================
// Parse arguments
// ============================================================
struct ChatArgs {
  std::string config_path = "config.json";
  std::string checkpoint_path = ""; // Auto-detect latest
  float temperature = 0.5f;
  int max_tokens = 200;
  int top_k = 20;
};

ChatArgs parse_args(int argc, char **argv) {
  ChatArgs args;
  for (int i = 1; i < argc; ++i) {
    if (std::string(argv[i]) == "--config" && i + 1 < argc)
      args.config_path = argv[++i];
    else if (std::string(argv[i]) == "--checkpoint" && i + 1 < argc)
      args.checkpoint_path = argv[++i];
    else if (std::string(argv[i]) == "--temperature" && i + 1 < argc)
      args.temperature = std::atof(argv[++i]);
    else if (std::string(argv[i]) == "--max-tokens" && i + 1 < argc)
      args.max_tokens = std::atoi(argv[++i]);
    else if (std::string(argv[i]) == "--top-k" && i + 1 < argc)
      args.top_k = std::atoi(argv[++i]);
  }
  return args;
}

// ============================================================
// Typing effect
// ============================================================
void print_typing(const std::string &text, int delay_ms = 15) {
  for (char c : text) {
    std::cout << c << std::flush;
    if (c == '\n' || c == '.' || c == '!' || c == '?') {
      std::this_thread::sleep_for(std::chrono::milliseconds(delay_ms * 3));
    } else {
      std::this_thread::sleep_for(std::chrono::milliseconds(delay_ms));
    }
  }
}

// ============================================================
// Print banner
// ============================================================
void print_banner() {
  std::cout << "\n";
  std::cout << "╔══════════════════════════════════════════════╗\n";
  std::cout << "║                                              ║\n";
  std::cout << "║     ██████╗ ██╗ ██████╗ ██╗     ██╗     ███╗║\n";
  std::cout << "║     ██╔══██╗██║██╔═══██╗██║     ██║     ████║\n";
  std::cout << "║     ██████╔╝██║██║   ██║██║     ██║     ██╔█║\n";
  std::cout << "║     ██╔══██╗██║██║   ██║██║     ██║     ██║║║\n";
  std::cout << "║     ██████╔╝██║╚██████╔╝███████╗███████╗██║║║\n";
  std::cout << "║     ╚═════╝ ╚═╝ ╚═════╝ ╚══════╝╚══════╝╚═╝║\n";
  std::cout << "║                                              ║\n";
  std::cout << "║     Bio-Inspired Language Model v1.0         ║\n";
  std::cout << "║     Self-Training Neural Architecture        ║\n";
  std::cout << "║                                              ║\n";
  std::cout << "╠══════════════════════════════════════════════╣\n";
  std::cout << "║  Commands:                                   ║\n";
  std::cout << "║    /help    - Show this help                 ║\n";
  std::cout << "║    /status  - Model info & memory stats      ║\n";
  std::cout << "║    /memory  - Show recent memories           ║\n";
  std::cout << "║    /reload  - Reload latest checkpoint       ║\n";
  std::cout << "║    /save    - Save memory to disk            ║\n";
  std::cout << "║    /temp N  - Set temperature (0.1-2.0)      ║\n";
  std::cout << "║    /top-k N - Set top-K sampling (1-200)     ║\n";
  std::cout << "║    /tokens N- Set max tokens (10-1000)       ║\n";
  std::cout << "║    /quit    - Exit                           ║\n";
  std::cout << "╚══════════════════════════════════════════════╝\n\n";
}

// ============================================================
// Main
// ============================================================
int main(int argc, char **argv) {
  ChatArgs args = parse_args(argc, argv);
  print_banner();

  // Load config
  Config config;
  config.load_from_json(args.config_path);

  // Initialize model
  LLMModel model;
  std::string ckpt = args.checkpoint_path;
  if (ckpt.empty()) {
    ckpt = model.latest_checkpoint(config.checkpoint_path);
  }

  if (ckpt.empty()) {
    std::cerr << "No checkpoint found! Train the model first.\n";
    std::cerr << "Run: ./train --worker-id 0\n";
    return 1;
  }

  std::cout << "Loading model from: " << ckpt << "\n";
  if (!model.load_checkpoint(ckpt)) {
    std::cerr << "Failed to load checkpoint!\n";
    return 1;
  }
  model.print_info();

  // Initialize memory system
  MemorySystem memory(config.training_data_path + "/../memory/long_term",
                      config.training_data_path + "/../memory/episodes", 10000,
                      1000);
  // Try the config paths if they're absolute-like
  if (fs::exists("memory/long_term")) {
    memory = MemorySystem("memory/long_term", "memory/episodes", 10000, 1000);
  }
  memory.load();

  float temperature = args.temperature;
  int max_tokens = args.max_tokens;
  int top_k = args.top_k;

  std::cout << "Ready! Type your message (or /help for commands)\n\n";

  // ========================
  // Chat Loop
  // ========================
  while (true) {
    std::cout << "\033[1;32mYou:\033[0m ";
    std::string input;
    if (!std::getline(std::cin, input))
      break;

    // Trim whitespace
    while (!input.empty() && (input.back() == '\n' || input.back() == '\r' ||
                              input.back() == ' '))
      input.pop_back();
    if (input.empty())
      continue;

    // === Handle commands ===
    if (input[0] == '/') {
      if (input == "/quit" || input == "/exit" || input == "/q") {
        std::cout << "Saving memory and exiting...\n";
        memory.save();
        break;
      } else if (input == "/help") {
        print_banner();
      } else if (input == "/status") {
        model.print_info();
        memory.print_stats();
        std::cout << "Temperature: " << temperature << "\n";
        std::cout << "Max tokens: " << max_tokens << "\n";
        std::cout << "Top-K: " << top_k << "\n";
        model.neurogenesis.print_history();
      } else if (input == "/memory") {
        auto recent = memory.recent_episodes(10);
        std::cout << "\n--- Recent Conversations ---\n";
        for (const auto &ep : recent) {
          std::cout << "  You: " << ep.user_input.substr(0, 80) << "\n";
          std::cout << "  AI:  " << ep.model_response.substr(0, 80) << "\n\n";
        }
        memory.print_stats();
      } else if (input == "/reload") {
        std::string latest = model.latest_checkpoint(config.checkpoint_path);
        if (!latest.empty()) {
          std::cout << "Reloading: " << latest << "\n";
          model.load_checkpoint(latest);
          model.print_info();
        } else {
          std::cout << "No checkpoint found.\n";
        }
      } else if (input == "/save") {
        memory.save();
        std::cout << "Memory saved.\n";
      } else if (input.substr(0, 6) == "/temp ") {
        float t = std::atof(input.c_str() + 6);
        if (t >= 0.01f && t <= 3.0f) {
          temperature = t;
          std::cout << "Temperature set to " << temperature << "\n";
        } else {
          std::cout << "Temperature must be between 0.01 and 3.0\n";
        }
      } else if (input.substr(0, 7) == "/top-k ") {
        int k = std::atoi(input.c_str() + 7);
        if (k >= 1 && k <= 200) {
          top_k = k;
          std::cout << "Top-K set to " << top_k << "\n";
        } else {
          std::cout << "Top-K must be between 1 and 200\n";
        }
      } else if (input.substr(0, 8) == "/tokens ") {
        int t = std::atoi(input.c_str() + 8);
        if (t >= 10 && t <= 1000) {
          max_tokens = t;
          std::cout << "Max tokens set to " << max_tokens << "\n";
        } else {
          std::cout << "Max tokens must be between 10 and 1000\n";
        }
      } else {
        std::cout << "Unknown command. Type /help for commands.\n";
      }
      continue;
    }

    // === Generate response ===
    // Use raw input as prompt — the model is trained on plain text,
    // not on "User:/Assistant:" format
    std::string prompt = input;

    std::cout << "\033[1;36mBioLLM:\033[0m ";

    auto gen_start = std::chrono::steady_clock::now();
    std::string response =
        model.generate(prompt, max_tokens, temperature, top_k);
    auto gen_end = std::chrono::steady_clock::now();

    float gen_time = std::chrono::duration<float>(gen_end - gen_start).count();

    // Print with typing effect
    print_typing(response);
    std::cout << "\n";

    // Show generation stats
    std::cout << "\033[0;90m(" << response.size() << " chars, " << gen_time
              << "s)\033[0m\n\n";

    // Store in memory
    memory.store_episode(input, response);

    // Store key phrases in long-term memory
    if (input.size() > 10) {
      // Simple: store the first 50 chars as key, full exchange as content
      std::string key = input.substr(0, std::min((int)input.size(), 50));
      memory.store(key, "User asked: " + input +
                            " | Response: " + response.substr(0, 200));
    }

    // Periodic memory consolidation
    if (memory.episodes.size() % 10 == 0) {
      memory.consolidate();
    }
  }

  // Save memory on exit
  memory.save();
  std::cout << "\nGoodbye!\n";
  return 0;
}
