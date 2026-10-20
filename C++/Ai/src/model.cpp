#include "model.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <random>
#include <sstream>

namespace fs = std::filesystem;

// ============================================================
// Simple JSON parser (minimal, for config.json)
// ============================================================
static std::string read_file_str(const std::string &path) {
  std::ifstream ifs(path);
  if (!ifs)
    return "";
  return std::string((std::istreambuf_iterator<char>(ifs)),
                     std::istreambuf_iterator<char>());
}

static std::string json_get_string(const std::string &json,
                                   const std::string &key) {
  std::string search = "\"" + key + "\"";
  size_t pos = json.find(search);
  if (pos == std::string::npos)
    return "";
  pos = json.find(":", pos);
  if (pos == std::string::npos)
    return "";
  pos = json.find("\"", pos);
  if (pos == std::string::npos)
    return "";
  size_t end = json.find("\"", pos + 1);
  if (end == std::string::npos)
    return "";
  return json.substr(pos + 1, end - pos - 1);
}

static double json_get_number(const std::string &json, const std::string &key,
                              double def = 0.0) {
  std::string search = "\"" + key + "\"";
  size_t pos = json.find(search);
  if (pos == std::string::npos)
    return def;
  pos = json.find(":", pos);
  if (pos == std::string::npos)
    return def;
  pos++;
  while (pos < json.size() && (json[pos] == ' ' || json[pos] == '\t'))
    pos++;
  try {
    return std::stod(json.substr(pos));
  } catch (...) {
    return def;
  }
}

static bool json_get_bool(const std::string &json, const std::string &key,
                          bool def = false) {
  std::string search = "\"" + key + "\"";
  size_t pos = json.find(search);
  if (pos == std::string::npos)
    return def;
  pos = json.find(":", pos);
  if (pos == std::string::npos)
    return def;
  std::string rest = json.substr(pos + 1);
  if (rest.find("true") < rest.find("false"))
    return true;
  if (rest.find("false") < rest.find("true"))
    return false;
  return def;
}

// ============================================================
// Config
// ============================================================
bool Config::load_from_json(const std::string &path) {
  std::string json = read_file_str(path);
  if (json.empty()) {
    std::cerr << "Warning: Cannot load config from " << path
              << ", using defaults.\n";
    return false;
  }

  embed_dim = (int)json_get_number(json, "embed_dim", embed_dim);
  num_heads = (int)json_get_number(json, "num_heads", num_heads);
  num_layers = (int)json_get_number(json, "num_layers", num_layers);
  max_seq_len = (int)json_get_number(json, "max_seq_len", max_seq_len);
  ff_multiplier = (int)json_get_number(json, "ff_multiplier", ff_multiplier);
  learning_rate = (float)json_get_number(json, "learning_rate", learning_rate);
  batch_size = (int)json_get_number(json, "batch_size", batch_size);
  num_workers = (int)json_get_number(json, "num_workers", num_workers);
  max_epochs = (int)json_get_number(json, "max_epochs", max_epochs);
  checkpoint_every =
      (int)json_get_number(json, "checkpoint_every", checkpoint_every);
  log_every = (int)json_get_number(json, "log_every", log_every);
  grad_clip = (float)json_get_number(json, "grad_clip", grad_clip);
  warmup_steps = (int)json_get_number(json, "warmup_steps", warmup_steps);
  weight_decay = (float)json_get_number(json, "weight_decay", weight_decay);

  num_dendrites = (int)json_get_number(json, "num_dendrites", num_dendrites);
  membrane_decay =
      (float)json_get_number(json, "membrane_decay", membrane_decay);
  firing_threshold =
      (float)json_get_number(json, "firing_threshold", firing_threshold);
  refractory_steps =
      (int)json_get_number(json, "refractory_steps", refractory_steps);
  stdp_rate = (float)json_get_number(json, "stdp_rate", stdp_rate);
  hebbian_rate = (float)json_get_number(json, "hebbian_rate", hebbian_rate);
  prune_threshold =
      (float)json_get_number(json, "prune_threshold", prune_threshold);
  sprout_prob = (float)json_get_number(json, "sprout_probability", sprout_prob);

  saturation_threshold = (float)json_get_number(json, "saturation_threshold",
                                                saturation_threshold);
  max_neurons_per_layer = (int)json_get_number(json, "max_neurons_per_layer",
                                               max_neurons_per_layer);
  max_layers_allowed =
      (int)json_get_number(json, "max_layers", max_layers_allowed);
  growth_check_interval = (int)json_get_number(json, "growth_check_interval",
                                               growth_check_interval);
  neurons_to_add = (int)json_get_number(json, "neurons_to_add", neurons_to_add);
  neurogenesis_enabled = json_get_bool(json, "enabled", neurogenesis_enabled);

  std::string tp = json_get_string(json, "training_data");
  if (!tp.empty())
    training_data_path = tp;
  std::string cp = json_get_string(json, "checkpoints");
  if (!cp.empty())
    checkpoint_path = cp;
  std::string vp = json_get_string(json, "vocab");
  if (!vp.empty())
    vocab_path = vp;
  std::string lp = json_get_string(json, "logs");
  if (!lp.empty())
    log_path = lp;

  std::cout << "Config loaded from " << path << "\n";
  return true;
}

// ============================================================
// LLMModel — Initialization
// ============================================================
void LLMModel::init(const Config &cfg, const Tokenizer &tok) {
  config = cfg;
  tokenizer = tok;
  config.vocab_size = tok.vocab_size();

  init_weights();

  // Setup neurogenesis
  neurogenesis.saturation_threshold = config.saturation_threshold;
  neurogenesis.max_neurons_per_layer = config.max_neurons_per_layer;
  neurogenesis.max_layers = config.max_layers_allowed;
  neurogenesis.growth_check_interval = config.growth_check_interval;
  neurogenesis.neurons_to_add = config.neurons_to_add;
  neurogenesis.enabled = config.neurogenesis_enabled;
}

void LLMModel::init_weights() {
  int V = config.vocab_size;
  int D = config.embed_dim;
  int L = config.num_layers;

  // Embeddings
  token_embedding = Tensor(V, D, true);
  token_embedding.random_init(0.02f);

  pos_embedding = Tensor(config.max_seq_len, D, true);
  pos_embedding.random_init(0.02f);

  // Transformer blocks
  blocks.clear();
  blocks.reserve(L);
  for (int i = 0; i < L; ++i) {
    blocks.emplace_back(D, config.num_heads, i, config.ff_multiplier);
  }

  // Final layer norm
  final_ln_gamma = Tensor(1, D, true);
  final_ln_gamma.ones();
  final_ln_beta = Tensor(1, D, true);
  final_ln_beta.zeros();

  // Output projection
  output_proj = Tensor(D, V, true);
  output_proj.random_init(0.02f);
  output_bias = Tensor(1, V, true);
  output_bias.zeros();
}

// ============================================================
// Forward Pass
// ============================================================
Tensor LLMModel::forward(const std::vector<int> &tokens) {
  int seq_len = std::min((int)tokens.size(), config.max_seq_len);
  int D = config.embed_dim;

  // Token embedding lookup
  Tensor tok_emb = token_embedding.embedding_lookup(
      std::vector<int>(tokens.begin(), tokens.begin() + seq_len));

  // Position embedding
  Tensor pos_emb = pos_embedding.slice_row(0, seq_len);

  // Combined embedding
  last_embedded = tok_emb.add(pos_emb);

  // Transformer stack
  Tensor x = last_embedded;
  for (auto &block : blocks) {
    x = block.forward(x);
  }
  last_transformer_out = x;

  // Final layer norm
  last_final_norm = x.layer_norm(final_ln_gamma, final_ln_beta);

  // Output projection → logits
  Tensor logits = last_final_norm.matmul(output_proj).add(output_bias);

  return logits;
}

// ============================================================
// Backward Pass
// ============================================================
float LLMModel::backward(const std::vector<int> &input_tokens,
                         const std::vector<int> &target_tokens) {
  // Forward
  Tensor logits = forward(input_tokens);

  // Loss
  float loss = Tensor::cross_entropy_loss(logits, target_tokens);

  // Gradient of loss w.r.t. logits
  Tensor d_logits = Tensor::cross_entropy_grad(logits, target_tokens);

  int seq_len = logits.rows;
  int D = config.embed_dim;

  // Backward through output projection
  output_proj.accumulate_grad(last_final_norm.transpose().matmul(d_logits));
  output_bias.accumulate_grad(d_logits.sum_rows());

  // Backward through final layer norm (simplified: pass through)
  Tensor d_transformer = d_logits.matmul(output_proj.transpose());

  // Accumulate final LN gradients
  final_ln_gamma.accumulate_grad(
      d_transformer.multiply(last_transformer_out).sum_rows());
  final_ln_beta.accumulate_grad(d_transformer.sum_rows());

  // Backward through transformer blocks (reverse order)
  Tensor d_x = d_transformer;
  for (int i = (int)blocks.size() - 1; i >= 0; --i) {
    d_x = blocks[i].backward(d_x);
  }

  // Backward through embeddings
  // d_token_embedding: scatter d_x back to embedding rows
  for (int t = 0; t < seq_len && t < (int)input_tokens.size(); ++t) {
    int tok = input_tokens[t];
    if (tok >= 0 && tok < config.vocab_size) {
      for (int j = 0; j < D; ++j) {
        token_embedding.grad[tok * D + j] += d_x(t, j);
      }
    }
  }

  // d_pos_embedding
  for (int t = 0; t < seq_len; ++t) {
    for (int j = 0; j < D; ++j) {
      pos_embedding.grad[t * D + j] += d_x(t, j);
    }
  }

  total_steps++;
  return loss;
}

// ============================================================
// Generation
// ============================================================
static std::mt19937 &model_rng() {
  static thread_local std::mt19937 rng(static_cast<unsigned>(
      std::chrono::steady_clock::now().time_since_epoch().count() + 777));
  return rng;
}

int LLMModel::sample_token(const Tensor &logits, float temperature, int top_k,
                           const std::vector<int> &recent_tokens,
                           float repetition_penalty) {
  int V = logits.cols;
  int last_row = logits.rows - 1;

  // Get logits for last position
  std::vector<float> probs(V);
  for (int i = 0; i < V; ++i) {
    probs[i] = logits(last_row, i);
  }

  // Repetition penalty: penalize tokens that appeared recently
  if (repetition_penalty > 1.0f && !recent_tokens.empty()) {
    for (int tok : recent_tokens) {
      if (tok >= 0 && tok < V) {
        if (probs[tok] > 0.0f) {
          probs[tok] /= repetition_penalty;
        } else {
          probs[tok] *= repetition_penalty;
        }
      }
    }
  }

  // Suppress special tokens (PAD, UNK, BOS) during generation
  probs[Tokenizer::PAD_TOKEN] = -1e9f;
  probs[Tokenizer::UNK_TOKEN] = -1e9f;
  probs[Tokenizer::BOS_TOKEN] = -1e9f;

  // Temperature scaling
  if (temperature > 0.0f) {
    for (auto &p : probs)
      p /= temperature;
  }

  // Top-K filtering
  if (top_k > 0 && top_k < V) {
    // Find the top-k threshold
    std::vector<float> sorted_probs = probs;
    std::partial_sort(sorted_probs.begin(), sorted_probs.begin() + top_k,
                      sorted_probs.end(), std::greater<float>());
    float threshold = sorted_probs[top_k - 1];
    for (auto &p : probs) {
      if (p < threshold)
        p = -1e9f;
    }
  }

  // Softmax
  float max_val = *std::max_element(probs.begin(), probs.end());
  float sum = 0.0f;
  for (auto &p : probs) {
    p = std::exp(p - max_val);
    sum += p;
  }
  for (auto &p : probs)
    p /= sum;

  // Sample
  std::discrete_distribution<int> dist(probs.begin(), probs.end());
  return dist(model_rng());
}

std::string LLMModel::generate(const std::string &prompt, int max_tokens,
                                float temperature, int top_k) {
  std::vector<int> tokens = tokenizer.encode(prompt);
  if (tokens.empty()) {
    tokens.push_back(Tokenizer::BOS_TOKEN);
  }

  // Enable inference mode — disables bio-layer to prevent stateful noise
  for (auto &block : blocks) {
    block.inference_mode = true;
    block.bio_layer.reset_states();
  }

  std::string output;
  float repetition_penalty = 1.3f; // Penalize repeated characters

  for (int i = 0; i < max_tokens; ++i) {
    // Truncate to max_seq_len
    if ((int)tokens.size() > config.max_seq_len) {
      tokens.erase(tokens.begin(),
                   tokens.begin() + (tokens.size() - config.max_seq_len));
    }

    // Forward pass
    Tensor logits = forward(tokens);

    // Build recent token window for repetition penalty
    int window = std::min(30, (int)tokens.size());
    std::vector<int> recent(tokens.end() - window, tokens.end());

    // Sample next token
    int next_token =
        sample_token(logits, temperature, top_k, recent, repetition_penalty);

    // Check for EOS
    if (next_token == Tokenizer::EOS_TOKEN)
      break;

    // Stop on repeated gibberish: if same char appears 5+ times in a row
    if (output.size() >= 4) {
      char last_char = tokenizer.decode_token(next_token)[0];
      bool all_same = true;
      for (int j = 1; j <= 4 && j <= (int)output.size(); ++j) {
        if (output[output.size() - j] != last_char) {
          all_same = false;
          break;
        }
      }
      if (all_same)
        break;
    }

    tokens.push_back(next_token);
    output += tokenizer.decode_token(next_token);

    // Stop at natural sentence boundary after minimum length
    if (output.size() > 20) {
      char last = output.back();
      if (last == '.' || last == '!' || last == '?') {
        // Check if next would be a space or newline (natural break)
        if (output.size() > 40)
          break;
      }
    }
  }

  // Restore training mode
  for (auto &block : blocks) {
    block.inference_mode = false;
  }

  return output;
}

// ============================================================
// Bio Learning
// ============================================================
void LLMModel::apply_bio_learning() {
  for (auto &block : blocks) {
    block.apply_bio_learning();
  }
}

// ============================================================
// Neurogenesis
// ============================================================
bool LLMModel::check_neurogenesis() {
  std::vector<BioLayer> bio_layers;
  for (auto &block : blocks) {
    bio_layers.push_back(block.bio_layer);
  }

  bool changed = neurogenesis.check_and_grow(bio_layers, total_steps);

  // Write back
  if (changed) {
    for (int i = 0; i < (int)blocks.size(); ++i) {
      blocks[i].bio_layer = bio_layers[i];
    }
  }

  // Check if we need a new layer
  if (neurogenesis.should_add_layer(bio_layers) &&
      (int)blocks.size() < config.max_layers_allowed) {
    int new_id = (int)blocks.size();
    blocks.emplace_back(config.embed_dim, config.num_heads, new_id,
                        config.ff_multiplier);

    GrowthEvent event;
    event.step = total_steps;
    event.type = "add_layer";
    event.layer_index = new_id;
    event.count = 1;
    event.saturation_before = 1.0f;
    event.description =
        "Added new transformer block #" + std::to_string(new_id);
    neurogenesis.history.push_back(event);

    std::cout << "[NEUROGENESIS] " << event.description << "\n";
    changed = true;
  }

  return changed;
}

// ============================================================
// Parameters
// ============================================================
std::vector<Tensor *> LLMModel::all_parameters() {
  std::vector<Tensor *> params;
  params.push_back(&token_embedding);
  params.push_back(&pos_embedding);

  for (auto &block : blocks) {
    auto bp = block.parameters();
    params.insert(params.end(), bp.begin(), bp.end());
  }

  params.push_back(&final_ln_gamma);
  params.push_back(&final_ln_beta);
  params.push_back(&output_proj);
  params.push_back(&output_bias);

  return params;
}

int LLMModel::count_parameters() const {
  int total = 0;
  total += token_embedding.size();
  total += pos_embedding.size();
  for (const auto &block : blocks) {
    // Count attention params
    total += block.attention.W_q.size() + block.attention.W_k.size() +
             block.attention.W_v.size() + block.attention.W_o.size();
    total += block.attention.b_q.size() + block.attention.b_k.size() +
             block.attention.b_v.size() + block.attention.b_o.size();
    // FFN params
    total += block.ffn.W1.size() + block.ffn.b1.size() + block.ffn.W2.size() +
             block.ffn.b2.size();
    // LN params
    total += block.ln1_gamma.size() + block.ln1_beta.size() +
             block.ln2_gamma.size() + block.ln2_beta.size();
  }
  total += final_ln_gamma.size() + final_ln_beta.size();
  total += output_proj.size() + output_bias.size();
  return total;
}

// ============================================================
// Save / Load
// ============================================================
void LLMModel::save_checkpoint(const std::string &path) {
  // Create directory if needed
  fs::path dir = fs::path(path).parent_path();
  if (!dir.empty())
    fs::create_directories(dir);

  std::ofstream ofs(path, std::ios::binary);
  if (!ofs) {
    std::cerr << "Error: Cannot save checkpoint to " << path << "\n";
    return;
  }

  // Magic number
  uint32_t magic = 0x4C4C4D31; // "LLM1"
  ofs.write(reinterpret_cast<const char *>(&magic), sizeof(uint32_t));

  // Config values
  ofs.write(reinterpret_cast<const char *>(&config.embed_dim), sizeof(int));
  ofs.write(reinterpret_cast<const char *>(&config.num_heads), sizeof(int));
  ofs.write(reinterpret_cast<const char *>(&config.max_seq_len), sizeof(int));
  ofs.write(reinterpret_cast<const char *>(&config.ff_multiplier), sizeof(int));
  ofs.write(reinterpret_cast<const char *>(&config.vocab_size), sizeof(int));
  int num_blocks = (int)blocks.size();
  ofs.write(reinterpret_cast<const char *>(&num_blocks), sizeof(int));
  ofs.write(reinterpret_cast<const char *>(&total_steps), sizeof(int));

  // Tokenizer
  tokenizer.save_stream(ofs);

  // Embeddings
  token_embedding.save_stream(ofs);
  pos_embedding.save_stream(ofs);

  // Transformer blocks
  for (const auto &block : blocks) {
    block.save(ofs);
  }

  // Final LN + output
  final_ln_gamma.save_stream(ofs);
  final_ln_beta.save_stream(ofs);
  output_proj.save_stream(ofs);
  output_bias.save_stream(ofs);

  // Neurogenesis state
  neurogenesis.save(ofs);

  ofs.close();
  std::cout << "Checkpoint saved: " << path << " (" << total_steps
            << " steps)\n";
}

bool LLMModel::load_checkpoint(const std::string &path) {
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs) {
    std::cerr << "Cannot load checkpoint: " << path << "\n";
    return false;
  }

  uint32_t magic = 0;
  ifs.read(reinterpret_cast<char *>(&magic), sizeof(uint32_t));
  if (magic != 0x4C4C4D31) {
    std::cerr << "Invalid checkpoint file (bad magic)\n";
    return false;
  }

  ifs.read(reinterpret_cast<char *>(&config.embed_dim), sizeof(int));
  ifs.read(reinterpret_cast<char *>(&config.num_heads), sizeof(int));
  ifs.read(reinterpret_cast<char *>(&config.max_seq_len), sizeof(int));
  ifs.read(reinterpret_cast<char *>(&config.ff_multiplier), sizeof(int));
  ifs.read(reinterpret_cast<char *>(&config.vocab_size), sizeof(int));
  int num_blocks = 0;
  ifs.read(reinterpret_cast<char *>(&num_blocks), sizeof(int));
  ifs.read(reinterpret_cast<char *>(&total_steps), sizeof(int));

  // Tokenizer
  if (!tokenizer.load_stream(ifs)) {
    std::cerr << "Failed to load tokenizer\n";
    return false;
  }

  // Embeddings
  token_embedding.requires_grad = true;
  pos_embedding.requires_grad = true;
  if (!token_embedding.load_stream(ifs))
    return false;
  if (!pos_embedding.load_stream(ifs))
    return false;

  // Transformer blocks
  blocks.clear();
  blocks.resize(num_blocks);
  for (int i = 0; i < num_blocks; ++i) {
    if (!blocks[i].load(ifs)) {
      std::cerr << "Failed to load transformer block " << i << "\n";
      return false;
    }
  }

  // Final LN + output
  final_ln_gamma.requires_grad = true;
  final_ln_beta.requires_grad = true;
  output_proj.requires_grad = true;
  output_bias.requires_grad = true;
  if (!final_ln_gamma.load_stream(ifs))
    return false;
  if (!final_ln_beta.load_stream(ifs))
    return false;
  if (!output_proj.load_stream(ifs))
    return false;
  if (!output_bias.load_stream(ifs))
    return false;

  // Neurogenesis state
  neurogenesis.load(ifs);

  std::cout << "Checkpoint loaded: " << path << " (" << total_steps
            << " steps, " << num_blocks
            << " layers, vocab=" << config.vocab_size << ")\n";
  return true;
}

std::string LLMModel::latest_checkpoint(const std::string &dir) const {
  if (!fs::exists(dir))
    return "";

  std::string latest;
  std::filesystem::file_time_type latest_time{};

  for (const auto &entry : fs::directory_iterator(dir)) {
    if (entry.is_regular_file() && entry.path().extension() == ".ckpt") {
      auto ftime = entry.last_write_time();
      if (latest.empty() || ftime > latest_time) {
        latest = entry.path().string();
        latest_time = ftime;
      }
    }
  }
  return latest;
}

// ============================================================
// Info
// ============================================================
void LLMModel::print_info() const {
  std::cout << "\n╔══════════════════════════════════════╗\n";
  std::cout << "║       BioLLM Model Information       ║\n";
  std::cout << "╠══════════════════════════════════════╣\n";
  std::cout << "║ Embed Dim:     " << config.embed_dim << "\n";
  std::cout << "║ Num Heads:     " << config.num_heads << "\n";
  std::cout << "║ Num Layers:    " << blocks.size() << "\n";
  std::cout << "║ Max Seq Len:   " << config.max_seq_len << "\n";
  std::cout << "║ Vocab Size:    " << config.vocab_size << "\n";
  std::cout << "║ Parameters:    " << count_parameters() << "\n";
  std::cout << "║ Total Steps:   " << total_steps << "\n";
  std::cout << "║ Neurogenesis:  " << (neurogenesis.enabled ? "ON" : "OFF")
            << "\n";
  std::cout << "╚══════════════════════════════════════╝\n\n";
}
