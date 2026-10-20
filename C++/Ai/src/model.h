#ifndef MODEL_H
#define MODEL_H

#include "neurogenesis.h"
#include "optimizer.h"
#include "tensor.h"
#include "tokenizer.h"
#include "transformer.h"
#include <string>
#include <vector>

/**
 * Config — Holds all model and training configuration.
 * Loaded from config.json.
 */
struct Config {
  // Model
  int embed_dim = 128;
  int num_heads = 4;
  int num_layers = 4;
  int max_seq_len = 256;
  int ff_multiplier = 4;
  int vocab_size = 0; // Set from tokenizer

  // Training
  float learning_rate = 0.001f;
  int batch_size = 4;
  int num_workers = 8;
  int max_epochs = 1000;
  int checkpoint_every = 500;
  int log_every = 10;
  float grad_clip = 1.0f;
  int warmup_steps = 100;
  float weight_decay = 0.01f;

  // Neuron
  int num_dendrites = 4;
  float membrane_decay = 0.9f;
  float firing_threshold = 0.5f;
  int refractory_steps = 2;
  float stdp_rate = 0.01f;
  float hebbian_rate = 0.005f;
  float prune_threshold = 0.001f;
  float sprout_prob = 0.01f;

  // Neurogenesis
  float saturation_threshold = 0.8f;
  int max_neurons_per_layer = 512;
  int max_layers_allowed = 12;
  int growth_check_interval = 1000;
  int neurons_to_add = 8;
  bool neurogenesis_enabled = true;

  // Paths
  std::string training_data_path = "data/training";
  std::string checkpoint_path = "models/checkpoints";
  std::string vocab_path = "models/vocab.bin";
  std::string log_path = "logs";

  bool load_from_json(const std::string &path);
};

/**
 * LLMModel — Complete Language Model.
 *
 * Architecture:
 *   Token Embedding + Position Embedding
 *   → N × TransformerBlock (with bio-neuron modulation)
 *   → Final LayerNorm
 *   → Output Projection (to vocab logits)
 *
 * Supports:
 *   - Forward/backward for training
 *   - Autoregressive generation for chat
 *   - Dynamic growth via neurogenesis
 *   - Save/load checkpoints
 */
class LLMModel {
public:
  Config config;
  Tokenizer tokenizer;
  NeurogenesisManager neurogenesis;

  // Embeddings
  Tensor token_embedding; // (vocab_size × embed_dim)
  Tensor pos_embedding;   // (max_seq_len × embed_dim)

  // Transformer stack
  std::vector<TransformerBlock> blocks;

  // Final layer norm + output projection
  Tensor final_ln_gamma, final_ln_beta;
  Tensor output_proj; // (embed_dim × vocab_size)
  Tensor output_bias; // (1 × vocab_size)

  // Cache for backward
  Tensor last_embedded;
  Tensor last_transformer_out;
  Tensor last_final_norm;

  // Training state
  int total_steps = 0;

  LLMModel() = default;

  // --- Initialization ---
  void init(const Config &cfg, const Tokenizer &tok);
  void init_weights();

  // --- Forward Pass ---
  // Returns logits: (seq_len × vocab_size)
  Tensor forward(const std::vector<int> &tokens);

  // --- Backward Pass ---
  // Computes gradients given target tokens
  float backward(const std::vector<int> &input_tokens,
                 const std::vector<int> &target_tokens);

  // --- Generation ---
  // Generate tokens autoregressively
  std::string generate(const std::string &prompt, int max_tokens = 200,
                       float temperature = 0.8f, int top_k = 40);

  // Sample next token from logits
  int sample_token(const Tensor &logits, float temperature = 0.8f,
                   int top_k = 40,
                   const std::vector<int> &recent_tokens = {},
                   float repetition_penalty = 1.0f);

  // --- Bio Learning ---
  void apply_bio_learning();

  // --- Neurogenesis ---
  bool check_neurogenesis();

  // --- Parameters ---
  std::vector<Tensor *> all_parameters();
  int count_parameters() const;

  // --- Save/Load ---
  void save_checkpoint(const std::string &path);
  bool load_checkpoint(const std::string &path);
  std::string latest_checkpoint(const std::string &dir) const;

  // --- Info ---
  void print_info() const;
};

#endif // MODEL_H
