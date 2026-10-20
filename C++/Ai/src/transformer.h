#ifndef TRANSFORMER_H
#define TRANSFORMER_H

#include "neuron.h"
#include "tensor.h"
#include <string>
#include <vector>

/**
 * MultiHeadAttention — Scaled dot-product attention with multiple heads.
 *
 * Computes: Attention(Q,K,V) = softmax(Q·K^T / √d_k) · V
 * With causal masking for autoregressive generation.
 * Bio-enhancement: attention weights are modulated by synaptic plasticity.
 */
class MultiHeadAttention {
public:
  int embed_dim = 0;
  int num_heads = 0;
  int head_dim = 0;

  // Learnable parameters
  Tensor W_q, W_k, W_v, W_o; // Projection weights
  Tensor b_q, b_k, b_v, b_o; // Projection biases

  // Cache for backward pass
  Tensor last_input;
  Tensor last_q, last_k, last_v;
  Tensor last_attn_weights;
  Tensor last_output;

  MultiHeadAttention() = default;
  MultiHeadAttention(int embed_dim, int num_heads);
  void init(int embed_dim, int num_heads);

  /**
   * Forward pass.
   * @param x       Input tensor (seq_len × embed_dim)
   * @param causal  Apply causal mask (for autoregressive models)
   * @return        Output tensor (seq_len × embed_dim)
   */
  Tensor forward(const Tensor &x, bool causal = true);

  /**
   * Backward pass.
   * @param grad_output  Gradient from above (seq_len × embed_dim)
   * @return             Gradient w.r.t. input (seq_len × embed_dim)
   */
  Tensor backward(const Tensor &grad_output);

  // Get all learnable parameter pointers
  std::vector<Tensor *> parameters();

  // Save/load
  void save(std::ostream &os) const;
  bool load(std::istream &is);
};

/**
 * FeedForward — Two-layer feed-forward network with GELU activation.
 *
 * FFN(x) = GELU(x·W1 + b1)·W2 + b2
 * Hidden dimension = ff_multiplier × embed_dim (typically 4×)
 */
class FeedForward {
public:
  int embed_dim = 0;
  int hidden_dim = 0;

  // Learnable parameters
  Tensor W1, b1; // First layer
  Tensor W2, b2; // Second layer

  // Cache
  Tensor last_input;
  Tensor last_hidden;
  Tensor last_gelu;

  FeedForward() = default;
  FeedForward(int embed_dim, int ff_multiplier = 4);
  void init(int embed_dim, int ff_multiplier = 4);

  Tensor forward(const Tensor &x);
  Tensor backward(const Tensor &grad_output);

  std::vector<Tensor *> parameters();

  void save(std::ostream &os) const;
  bool load(std::istream &is);
};

/**
 * TransformerBlock — One transformer layer.
 *
 * Pre-LN architecture:
 *   x = x + Attention(LayerNorm(x))
 *   x = x + FFN(LayerNorm(x))
 *
 * Includes a BioLayer for biological neuron modulation.
 */
class TransformerBlock {
public:
  int embed_dim = 0;
  int num_heads = 0;
  int layer_id = 0;

  // Sub-components
  MultiHeadAttention attention;
  FeedForward ffn;

  // Layer normalization parameters
  Tensor ln1_gamma, ln1_beta; // Before attention
  Tensor ln2_gamma, ln2_beta; // Before FFN

  // Bio layer (optional modulation)
  BioLayer bio_layer;
  bool use_bio = true;
  bool inference_mode = false; // Disable bio-layer during generation

  // Cache
  Tensor last_input;
  Tensor last_ln1_out, last_ln2_out;
  Tensor last_attn_out, last_ffn_out;

  TransformerBlock() = default;
  TransformerBlock(int embed_dim, int num_heads, int layer_id,
                   int ff_multiplier = 4);
  void init(int embed_dim, int num_heads, int layer_id, int ff_multiplier = 4);

  Tensor forward(const Tensor &x);
  Tensor backward(const Tensor &grad_output);

  // Apply bio-inspired learning on this block
  void apply_bio_learning();

  std::vector<Tensor *> parameters();

  // Access bio layer for neurogenesis
  BioLayer &get_bio_layer() { return bio_layer; }

  void save(std::ostream &os) const;
  bool load(std::istream &is);
};

#endif // TRANSFORMER_H
