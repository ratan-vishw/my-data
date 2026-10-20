/**
 * train.cpp — Training worker for the BioLLM.
 *
 * Usage: ./train [--worker-id N] [--config path]
 *
 * Each worker:
 * 1. Loads config and training data
 * 2. Builds or loads tokenizer
 * 3. Initializes or loads model from checkpoint
 * 4. Runs training loop with gradient-based + bio learning
 * 5. Saves checkpoints periodically (with file locking)
 * 6. Logs metrics to per-worker log file
 *
 * Multiple workers coordinate via file-based checkpoint sync.
 */

#include "memory.h"
#include "model.h"
#include <algorithm>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>

#ifdef __linux__
#include <sys/file.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

static volatile bool g_running = true;

void signal_handler(int sig) {
  std::cout << "\n[Worker] Caught signal " << sig
            << ", shutting down gracefully...\n";
  g_running = false;
}

// ============================================================
// Load all training data from directory
// ============================================================
std::string load_training_data(const std::string &dir, int worker_id,
                               int num_workers) {
  if (!fs::exists(dir)) {
    std::cerr << "Training data directory not found: " << dir << "\n";
    return "";
  }

  std::vector<std::string> files;
  for (const auto &entry : fs::recursive_directory_iterator(dir)) {
    if (entry.is_regular_file()) {
      std::string ext = entry.path().extension().string();
      if (ext == ".txt" || ext == ".text" || ext == ".md") {
        files.push_back(entry.path().string());
      }
    }
  }

  std::sort(files.begin(), files.end());

  std::string data;
  for (int i = 0; i < (int)files.size(); ++i) {
    // Shard: worker N reads every Nth file (round-robin)
    if (num_workers > 1 && (i % num_workers) != worker_id)
      continue;

    std::ifstream ifs(files[i]);
    if (ifs) {
      std::string content((std::istreambuf_iterator<char>(ifs)),
                          std::istreambuf_iterator<char>());
      data += content + "\n";
    }
  }

  std::cout << "[Worker " << worker_id << "] Loaded " << data.size()
            << " chars from " << files.size() << " files\n";
  return data;
}

// ============================================================
// File locking for checkpoint coordination
// ============================================================
class FileLock {
  int fd = -1;
  std::string path;

public:
  FileLock(const std::string &lock_path) : path(lock_path) {}

  bool acquire() {
#ifdef __linux__
    fd = open(path.c_str(), O_CREAT | O_RDWR, 0666);
    if (fd < 0)
      return false;
    return flock(fd, LOCK_EX | LOCK_NB) == 0;
#else
    // Windows/other: just try to create the file
    std::ofstream ofs(path);
    return ofs.good();
#endif
  }

  void release() {
#ifdef __linux__
    if (fd >= 0) {
      flock(fd, LOCK_UN);
      close(fd);
      fd = -1;
    }
#endif
    try {
      fs::remove(path);
    } catch (...) {
    }
  }

  ~FileLock() { release(); }
};

// ============================================================
// Parse command-line arguments
// ============================================================
struct TrainArgs {
  int worker_id = 0;
  std::string config_path = "config.json";
};

TrainArgs parse_args(int argc, char **argv) {
  TrainArgs args;
  for (int i = 1; i < argc; ++i) {
    if (std::string(argv[i]) == "--worker-id" && i + 1 < argc) {
      args.worker_id = std::atoi(argv[++i]);
    } else if (std::string(argv[i]) == "--config" && i + 1 < argc) {
      args.config_path = argv[++i];
    }
  }
  return args;
}

// ============================================================
// Main Training Loop
// ============================================================
int main(int argc, char **argv) {
  std::signal(SIGINT, signal_handler);
  std::signal(SIGTERM, signal_handler);

  TrainArgs args = parse_args(argc, argv);

  std::cout << "╔══════════════════════════════════════╗\n";
  std::cout << "║     BioLLM Training Worker #" << args.worker_id
            << "        ║\n";
  std::cout << "╚══════════════════════════════════════╝\n\n";

  // Load config
  Config config;
  config.load_from_json(args.config_path);

  // Create directories
  fs::create_directories(config.checkpoint_path);
  fs::create_directories(config.log_path);
  fs::create_directories(config.training_data_path);

  // Load training data
  std::string train_data = load_training_data(
      config.training_data_path, args.worker_id, config.num_workers);
  if (train_data.empty()) {
    std::cerr << "[Worker " << args.worker_id << "] No training data found!\n";
    std::cerr << "Place .txt files in " << config.training_data_path << "/\n";
    return 1;
  }

  // Build tokenizer
  Tokenizer tokenizer;
  if (fs::exists(config.vocab_path)) {
    tokenizer.load(config.vocab_path);
    std::cout << "Loaded existing vocabulary (size=" << tokenizer.vocab_size()
              << ")\n";
  } else {
    tokenizer.build_from_text(train_data);
    fs::create_directories(fs::path(config.vocab_path).parent_path());
    tokenizer.save(config.vocab_path);
    std::cout << "Built vocabulary from data (size=" << tokenizer.vocab_size()
              << ")\n";
  }
  config.vocab_size = tokenizer.vocab_size();

  // Tokenize all training data
  std::vector<int> all_tokens = tokenizer.encode(train_data);
  std::cout << "Tokenized data: " << all_tokens.size() << " tokens\n";

  if ((int)all_tokens.size() < config.max_seq_len + 1) {
    std::cerr << "Not enough training data! Need at least "
              << config.max_seq_len + 1 << " tokens.\n";
    return 1;
  }

  // Initialize or load model
  LLMModel model;
  std::string latest_ckpt = model.latest_checkpoint(config.checkpoint_path);
  if (!latest_ckpt.empty()) {
    std::cout << "Loading checkpoint: " << latest_ckpt << "\n";
    model.load_checkpoint(latest_ckpt);
  } else {
    std::cout << "Initializing new model...\n";
    model.init(config, tokenizer);
  }
  model.print_info();

  // Setup optimizer
  AdamW optimizer(config.learning_rate, config.weight_decay, config.grad_clip,
                  config.warmup_steps);
  auto params = model.all_parameters();
  for (auto *p : params) {
    optimizer.register_param(p);
  }

  // Open log file
  std::string log_path =
      config.log_path + "/worker_" + std::to_string(args.worker_id) + ".log";
  std::ofstream log_file(log_path, std::ios::app);
  log_file << "\n=== Training started at step " << model.total_steps
           << " ===\n";

  // RNG for sampling
  std::mt19937 rng(static_cast<unsigned>(
      std::chrono::steady_clock::now().time_since_epoch().count() +
      args.worker_id * 1000));

  int data_len = (int)all_tokens.size();
  float running_loss = 0.0f;
  int loss_count = 0;
  auto start_time = std::chrono::steady_clock::now();

  std::cout << "\n[Worker " << args.worker_id
            << "] Starting training loop...\n\n";

  // ========================
  // Training Loop
  // ========================
  for (int epoch = 0; epoch < config.max_epochs && g_running; ++epoch) {
    // Shuffle start positions each epoch
    std::vector<int> positions;
    for (int i = 0; i < data_len - config.max_seq_len - 1; ++i) {
      positions.push_back(i);
    }
    std::shuffle(positions.begin(), positions.end(), rng);

    int batches_per_epoch = std::min((int)positions.size(),
                                     (int)positions.size() / config.batch_size);

    for (int batch = 0; batch < batches_per_epoch && g_running; ++batch) {
      // Zero gradients
      optimizer.zero_grad();

      float batch_loss = 0.0f;

      for (int b = 0; b < config.batch_size; ++b) {
        int idx = batch * config.batch_size + b;
        if (idx >= (int)positions.size())
          break;
        int pos = positions[idx];

        // Extract sequence
        int seq_len = std::min(config.max_seq_len, data_len - pos - 1);
        if (seq_len < 2)
          continue;

        std::vector<int> input_tokens(all_tokens.begin() + pos,
                                      all_tokens.begin() + pos + seq_len);
        std::vector<int> target_tokens(all_tokens.begin() + pos + 1,
                                       all_tokens.begin() + pos + seq_len + 1);

        // Forward + backward
        float loss = model.backward(input_tokens, target_tokens);
        batch_loss += loss;
      }

      batch_loss /= config.batch_size;

      // Optimizer step
      optimizer.step_update();

      // Apply bio-inspired learning
      model.apply_bio_learning();

      running_loss += batch_loss;
      loss_count++;

      int global_step = model.total_steps;

      // Logging
      if (global_step % config.log_every == 0 && loss_count > 0) {
        float avg_loss = running_loss / loss_count;
        auto now = std::chrono::steady_clock::now();
        float elapsed = std::chrono::duration<float>(now - start_time).count();
        float steps_per_sec = (float)loss_count / elapsed;

        std::cout << "[W" << args.worker_id << " Step " << global_step
                  << " Epoch " << epoch << "] loss=" << avg_loss
                  << " lr=" << optimizer.get_lr() << " speed=" << steps_per_sec
                  << " steps/s\n";

        log_file << global_step << "," << avg_loss << "," << optimizer.get_lr()
                 << "," << steps_per_sec << "\n";
        log_file.flush();

        running_loss = 0.0f;
        loss_count = 0;
        start_time = now;
      }

      // Checkpoint
      if (global_step % config.checkpoint_every == 0 && global_step > 0) {
        std::string lock_path = config.checkpoint_path + "/write.lock";
        FileLock lock(lock_path);
        if (lock.acquire()) {
          std::string ckpt_name = config.checkpoint_path + "/model_step_" +
                                  std::to_string(global_step) + ".ckpt";
          model.save_checkpoint(ckpt_name);
          lock.release();

          // Also save neurogenesis log
          model.neurogenesis.save_log(config.log_path + "/neurogenesis.log");
        } else {
          std::cout << "[W" << args.worker_id
                    << "] Checkpoint locked, skipping...\n";
        }
      }

      // Neurogenesis check
      if (global_step % config.growth_check_interval == 0 && global_step > 0) {
        bool changed = model.check_neurogenesis();
        if (changed) {
          // Re-register parameters with optimizer
          optimizer = AdamW(config.learning_rate, config.weight_decay,
                            config.grad_clip, config.warmup_steps);
          optimizer.step = global_step;
          auto new_params = model.all_parameters();
          for (auto *p : new_params) {
            optimizer.register_param(p);
          }
          std::cout << "[W" << args.worker_id
                    << "] Neurogenesis! Params: " << model.count_parameters()
                    << "\n";
        }
      }

      // Check if another worker saved a newer checkpoint
      if (global_step % (config.checkpoint_every * 2) == 0 &&
          config.num_workers > 1) {
        std::string latest = model.latest_checkpoint(config.checkpoint_path);
        if (!latest.empty()) {
          // Check if it's newer than our last save
          // Simple heuristic: if the filename contains a step > our step,
          // reload (This is a basic sync mechanism)
          size_t step_pos = latest.find("step_");
          if (step_pos != std::string::npos) {
            int ckpt_step = std::atoi(latest.c_str() + step_pos + 5);
            if (ckpt_step > global_step + config.checkpoint_every) {
              std::cout
                  << "[W" << args.worker_id
                  << "] Loading newer checkpoint from another worker...\n";
              model.load_checkpoint(latest);
              // Re-register optimizer
              optimizer = AdamW(config.learning_rate, config.weight_decay,
                                config.grad_clip, config.warmup_steps);
              optimizer.step = model.total_steps;
              auto new_params = model.all_parameters();
              for (auto *p : new_params) {
                optimizer.register_param(p);
              }
            }
          }
        }
      }
    }
  }

  // Final checkpoint
  if (g_running || true) {
    std::string final_ckpt = config.checkpoint_path + "/model_final.ckpt";
    model.save_checkpoint(final_ckpt);
  }

  std::cout << "\n[Worker " << args.worker_id
            << "] Training complete. Total steps: " << model.total_steps
            << "\n";
  model.neurogenesis.print_history();

  return 0;
}
