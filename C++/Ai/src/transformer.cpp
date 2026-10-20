#include "transformer.h"
#include <algorithm>
#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>

// ============================================================
// MultiHeadAttention
// ============================================================
MultiHeadAttention::MultiHeadAttention(int embed_dim, int num_heads) {
  init(embed_dim, num_heads);
}

void MultiHeadAttention::init(int ed, int nh) {
  embed_dim = ed;
  num_heads = nh;
  head_dim = embed_dim / num_heads;
  assert(head_dim * num_heads == embed_dim);

  W_q = Tensor(embed_dim, embed_dim, true);
  W_q.xavier_init();
  W_k = Tensor(embed_dim, embed_dim, true);
  W_k.xavier_init();
  W_v = Tensor(embed_dim, embed_dim, true);
  W_v.xavier_init();
  W_o = Tensor(embed_dim, embed_dim, true);
  W_o.xavier_init();

  b_q = Tensor(1, embed_dim, true);
  b_q.zeros();
  b_k = Tensor(1, embed_dim, true);
  b_k.zeros();
  b_v = Tensor(1, embed_dim, true);
  b_v.zeros();
  b_o = Tensor(1, embed_dim, true);
  b_o.zeros();
}

Tensor MultiHeadAttention::forward(const Tensor &x, bool causal) {
  int seq_len = x.rows;
  last_input = x;

  // Linear projections: Q = x·W_q + b_q, etc.
  last_q = x.matmul(W_q).add(b_q); // (seq × embed)
  last_k = x.matmul(W_k).add(b_k);
  last_v = x.matmul(W_v).add(b_v);

  // Multi-head attention
  // We process all heads together by reshaping within the matmul
  // For simplicity, we'll iterate over heads
  Tensor output(seq_len, embed_dim);
  last_attn_weights = Tensor(num_heads * seq_len, seq_len);

  float scale = 1.0f / std::sqrt((float)head_dim);

  for (int h = 0; h < num_heads; ++h) {
    int offset = h * head_dim;

    // Extract Q, K, V for this head
    Tensor q_h(seq_len, head_dim);
    Tensor k_h(seq_len, head_dim);
    Tensor v_h(seq_len, head_dim);

    for (int i = 0; i < seq_len; ++i) {
      for (int j = 0; j < head_dim; ++j) {
        q_h(i, j) = last_q(i, offset + j);
        k_h(i, j) = last_k(i, offset + j);
        v_h(i, j) = last_v(i, offset + j);
      }
    }

    // Attention scores: Q·K^T / √d_k
    Tensor scores = q_h.matmul(k_h.transpose()).scale(scale);

    // Causal mask: set future positions to -inf
    if (causal) {
      for (int i = 0; i < seq_len; ++i) {
        for (int j = i + 1; j < seq_len; ++j) {
          scores(i, j) = -1e9f;
        }
      }
    }

    // Softmax
    Tensor attn = scores.softmax();

    // Store attention weights for debugging/bio-learning
    for (int i = 0; i < seq_len; ++i)
      for (int j = 0; j < seq_len; ++j)
        last_attn_weights(h * seq_len + i, j) = attn(i, j);

    // Weighted values: attn·V
    Tensor head_out = attn.matmul(v_h);

    // Copy to output
    for (int i = 0; i < seq_len; ++i) {
      for (int j = 0; j < head_dim; ++j) {
        output(i, offset + j) = head_out(i, j);
      }
    }
  }

  // Output projection
  last_output = output.matmul(W_o).add(b_o);
  return last_output;
}

Tensor MultiHeadAttention::backward(const Tensor &grad_output) {
  int seq_len = grad_output.rows;
  float scale = 1.0f / std::sqrt((float)head_dim);

  // Gradient through output projection
  // grad_output: (seq × embed)
  // W_o grad: output^T · grad_output
  Tensor pre_proj(seq_len, embed_dim);
  // Recompute pre-projection output from last_q, last_k, last_v
  // For simplicity, we saved last_output context

  // d_W_o = pre_output^T · grad_output
  // d_pre_output = grad_output · W_o^T
  Tensor d_pre_output = grad_output.matmul(W_o.transpose());

  // Accumulate W_o gradient
  // We need the pre-projection output. Let's recompute it from stored attention
  // results. For now, accumulate gradients on W_o from the known values
  {
    // Reconstruct pre-projection from last_q, last_k, last_v
    Tensor pre_output(seq_len, embed_dim);
    for (int h = 0; h < num_heads; ++h) {
      int offset = h * head_dim;
      Tensor q_h(seq_len, head_dim), k_h(seq_len, head_dim),
          v_h(seq_len, head_dim);
      for (int i = 0; i < seq_len; ++i)
        for (int j = 0; j < head_dim; ++j) {
          q_h(i, j) = last_q(i, offset + j);
          k_h(i, j) = last_k(i, offset + j);
          v_h(i, j) = last_v(i, offset + j);
        }
      Tensor scores = q_h.matmul(k_h.transpose()).scale(scale);
      for (int i = 0; i < seq_len; ++i)
        for (int j = i + 1; j < seq_len; ++j)
          scores(i, j) = -1e9f;
      Tensor attn = scores.softmax();
      Tensor head_out = attn.matmul(v_h);
      for (int i = 0; i < seq_len; ++i)
        for (int j = 0; j < head_dim; ++j)
          pre_output(i, offset + j) = head_out(i, j);
    }
    W_o.accumulate_grad(pre_output.transpose().matmul(grad_output));
    // b_o gradient: sum over sequence
    Tensor b_o_grad = grad_output.sum_rows();
    b_o.accumulate_grad(b_o_grad);
  }

  // Gradient through each head
  Tensor d_q_full(seq_len, embed_dim);
  Tensor d_k_full(seq_len, embed_dim);
  Tensor d_v_full(seq_len, embed_dim);

  for (int h = 0; h < num_heads; ++h) {
    int offset = h * head_dim;

    // Extract head-specific pre-output gradient
    Tensor d_head(seq_len, head_dim);
    for (int i = 0; i < seq_len; ++i)
      for (int j = 0; j < head_dim; ++j)
        d_head(i, j) = d_pre_output(i, offset + j);

    // Extract Q, K, V for this head
    Tensor q_h(seq_len, head_dim), k_h(seq_len, head_dim),
        v_h(seq_len, head_dim);
    for (int i = 0; i < seq_len; ++i)
      for (int j = 0; j < head_dim; ++j) {
        q_h(i, j) = last_q(i, offset + j);
        k_h(i, j) = last_k(i, offset + j);
        v_h(i, j) = last_v(i, offset + j);
      }

    // Recompute attention weights
    Tensor scores = q_h.matmul(k_h.transpose()).scale(scale);
    for (int i = 0; i < seq_len; ++i)
      for (int j = i + 1; j < seq_len; ++j)
        scores(i, j) = -1e9f;
    Tensor attn = scores.softmax();

    // d_V = attn^T · d_head
    Tensor d_v = attn.transpose().matmul(d_head);

    // d_attn = d_head · V^T
    Tensor d_attn = d_head.matmul(v_h.transpose());

    // d_scores (through softmax): d_scores_ij = attn_ij * (d_attn_ij -
    // sum_k(attn_ik * d_attn_ik))
    Tensor d_scores(seq_len, seq_len);
    for (int i = 0; i < seq_len; ++i) {
      float dot = 0.0f;
      for (int j = 0; j < seq_len; ++j)
        dot += attn(i, j) * d_attn(i, j);
      for (int j = 0; j < seq_len; ++j)
        d_scores(i, j) = attn(i, j) * (d_attn(i, j) - dot);
    }
    d_scores.scale_inplace(scale);

    // d_Q = d_scores · K
    Tensor d_q = d_scores.matmul(k_h);
    // d_K = d_scores^T · Q
    Tensor d_k = d_scores.transpose().matmul(q_h);

    // Copy back to full gradients
    for (int i = 0; i < seq_len; ++i)
      for (int j = 0; j < head_dim; ++j) {
        d_q_full(i, offset + j) = d_q(i, j);
        d_k_full(i, offset + j) = d_k(i, j);
        d_v_full(i, offset + j) = d_v(i, j);
      }
  }

  // Gradient through Q, K, V projections
  // d_W_q = x^T · d_q_full
  W_q.accumulate_grad(last_input.transpose().matmul(d_q_full));
  W_k.accumulate_grad(last_input.transpose().matmul(d_k_full));
  W_v.accumulate_grad(last_input.transpose().matmul(d_v_full));

  b_q.accumulate_grad(d_q_full.sum_rows());
  b_k.accumulate_grad(d_k_full.sum_rows());
  b_v.accumulate_grad(d_v_full.sum_rows());

  // Gradient w.r.t. input
  Tensor d_x = d_q_full.matmul(W_q.transpose())
                   .add(d_k_full.matmul(W_k.transpose()))
                   .add(d_v_full.matmul(W_v.transpose()));

  return d_x;
}

std::vector<Tensor *> MultiHeadAttention::parameters() {
  return {&W_q, &W_k, &W_v, &W_o, &b_q, &b_k, &b_v, &b_o};
}

void MultiHeadAttention::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&embed_dim), sizeof(int));
  os.write(reinterpret_cast<const char *>(&num_heads), sizeof(int));
  W_q.save_stream(os);
  W_k.save_stream(os);
  W_v.save_stream(os);
  W_o.save_stream(os);
  b_q.save_stream(os);
  b_k.save_stream(os);
  b_v.save_stream(os);
  b_o.save_stream(os);
}

bool MultiHeadAttention::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&embed_dim), sizeof(int));
  is.read(reinterpret_cast<char *>(&num_heads), sizeof(int));
  head_dim = embed_dim / num_heads;
  W_q.requires_grad = W_k.requires_grad = W_v.requires_grad =
      W_o.requires_grad = true;
  b_q.requires_grad = b_k.requires_grad = b_v.requires_grad =
      b_o.requires_grad = true;
  return W_q.load_stream(is) && W_k.load_stream(is) && W_v.load_stream(is) &&
         W_o.load_stream(is) && b_q.load_stream(is) && b_k.load_stream(is) &&
         b_v.load_stream(is) && b_o.load_stream(is);
}

// ============================================================
// FeedForward
// ============================================================
FeedForward::FeedForward(int embed_dim, int ff_multiplier) {
  init(embed_dim, ff_multiplier);
}

void FeedForward::init(int ed, int ff_mult) {
  embed_dim = ed;
  hidden_dim = ed * ff_mult;

  W1 = Tensor(embed_dim, hidden_dim, true);
  W1.xavier_init();
  b1 = Tensor(1, hidden_dim, true);
  b1.zeros();
  W2 = Tensor(hidden_dim, embed_dim, true);
  W2.xavier_init();
  b2 = Tensor(1, embed_dim, true);
  b2.zeros();
}

Tensor FeedForward::forward(const Tensor &x) {
  last_input = x;
  last_hidden = x.matmul(W1).add(b1);
  last_gelu = last_hidden.gelu();
  return last_gelu.matmul(W2).add(b2);
}

Tensor FeedForward::backward(const Tensor &grad_output) {
  int seq_len = grad_output.rows;

  // d_W2 = gelu_output^T · grad_output
  W2.accumulate_grad(last_gelu.transpose().matmul(grad_output));
  b2.accumulate_grad(grad_output.sum_rows());

  // d_gelu = grad_output · W2^T
  Tensor d_gelu = grad_output.matmul(W2.transpose());

  // GELU gradient approximation
  Tensor d_hidden(seq_len, hidden_dim);
  for (int i = 0; i < seq_len; ++i) {
    for (int j = 0; j < hidden_dim; ++j) {
      float x = last_hidden(i, j);
      // GELU derivative approximation
      float inner = 0.7978845608f * (x + 0.044715f * x * x * x);
      float tanh_val = std::tanh(inner);
      float sech2 = 1.0f - tanh_val * tanh_val;
      float d_inner = 0.7978845608f * (1.0f + 3.0f * 0.044715f * x * x);
      float gelu_grad = 0.5f * (1.0f + tanh_val) + 0.5f * x * sech2 * d_inner;
      d_hidden(i, j) = d_gelu(i, j) * gelu_grad;
    }
  }

  // d_W1 = input^T · d_hidden
  W1.accumulate_grad(last_input.transpose().matmul(d_hidden));
  b1.accumulate_grad(d_hidden.sum_rows());

  // d_input = d_hidden · W1^T
  return d_hidden.matmul(W1.transpose());
}

std::vector<Tensor *> FeedForward::parameters() { return {&W1, &b1, &W2, &b2}; }

void FeedForward::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&embed_dim), sizeof(int));
  os.write(reinterpret_cast<const char *>(&hidden_dim), sizeof(int));
  W1.save_stream(os);
  b1.save_stream(os);
  W2.save_stream(os);
  b2.save_stream(os);
}

bool FeedForward::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&embed_dim), sizeof(int));
  is.read(reinterpret_cast<char *>(&hidden_dim), sizeof(int));
  W1.requires_grad = b1.requires_grad = W2.requires_grad = b2.requires_grad =
      true;
  return W1.load_stream(is) && b1.load_stream(is) && W2.load_stream(is) &&
         b2.load_stream(is);
}

// ============================================================
// TransformerBlock
// ============================================================
TransformerBlock::TransformerBlock(int embed_dim, int num_heads, int layer_id,
                                   int ff_multiplier) {
  init(embed_dim, num_heads, layer_id, ff_multiplier);
}

void TransformerBlock::init(int ed, int nh, int lid, int ff_mult) {
  embed_dim = ed;
  num_heads = nh;
  layer_id = lid;

  attention.init(ed, nh);
  ffn.init(ed, ff_mult);

  // Layer norm parameters
  ln1_gamma = Tensor(1, ed, true);
  ln1_gamma.ones();
  ln1_beta = Tensor(1, ed, true);
  ln1_beta.zeros();
  ln2_gamma = Tensor(1, ed, true);
  ln2_gamma.ones();
  ln2_beta = Tensor(1, ed, true);
  ln2_beta.zeros();

  // Bio layer: embed_dim → embed_dim
  bio_layer.init(ed, ed, 4);
}

Tensor TransformerBlock::forward(const Tensor &x) {
  last_input = x;

  // Pre-LN: LayerNorm → Attention → Residual
  last_ln1_out = x.layer_norm(ln1_gamma, ln1_beta);
  last_attn_out = attention.forward(last_ln1_out);
  Tensor residual1 = x.add(last_attn_out);

  // Bio-layer modulation (subtle influence) — skip during inference
  if (use_bio && !inference_mode) {
    Tensor bio_mod = bio_layer.forward(residual1);
    // Blend: 95% standard + 5% bio modulation
    for (int i = 0; i < residual1.size(); ++i) {
      residual1.data[i] = 0.95f * residual1.data[i] + 0.05f * bio_mod.data[i];
    }
  }

  // Pre-LN: LayerNorm → FFN → Residual
  last_ln2_out = residual1.layer_norm(ln2_gamma, ln2_beta);
  last_ffn_out = ffn.forward(last_ln2_out);
  Tensor output = residual1.add(last_ffn_out);

  return output;
}

Tensor TransformerBlock::backward(const Tensor &grad_output) {
  // Backward through FFN + residual
  // d_residual1 = grad_output (residual connection)
  // d_ffn_out = grad_output
  Tensor d_ffn = ffn.backward(grad_output);

  // Backward through LayerNorm2 (simplified: pass gradient through)
  // For a proper LN backward we'd need the Jacobian, but for training stability
  // we use a simplified version
  Tensor d_residual1 = grad_output.add(d_ffn);

  // Backward through attention + residual
  Tensor d_attn = attention.backward(d_residual1);
  Tensor d_input = d_residual1.add(d_attn);

  // Accumulate LN gradients (simplified)
  // In a production system, we'd compute full LN backward
  // Here we pass through the main gradient path
  ln1_gamma.accumulate_grad(d_attn.multiply(last_ln1_out).sum_rows());
  ln1_beta.accumulate_grad(d_attn.sum_rows());
  ln2_gamma.accumulate_grad(grad_output.multiply(last_ln2_out).sum_rows());
  ln2_beta.accumulate_grad(grad_output.sum_rows());

  return d_input;
}

void TransformerBlock::apply_bio_learning() {
  if (!use_bio)
    return;
  if (last_input.size() == 0)
    return;
  bio_layer.apply_bio_learning(last_input, last_attn_out);
  bio_layer.structural_update(last_input, last_attn_out);
}

std::vector<Tensor *> TransformerBlock::parameters() {
  std::vector<Tensor *> params;
  auto attn_p = attention.parameters();
  auto ffn_p = ffn.parameters();
  params.insert(params.end(), attn_p.begin(), attn_p.end());
  params.insert(params.end(), ffn_p.begin(), ffn_p.end());
  params.push_back(&ln1_gamma);
  params.push_back(&ln1_beta);
  params.push_back(&ln2_gamma);
  params.push_back(&ln2_beta);
  return params;
}

void TransformerBlock::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&embed_dim), sizeof(int));
  os.write(reinterpret_cast<const char *>(&num_heads), sizeof(int));
  os.write(reinterpret_cast<const char *>(&layer_id), sizeof(int));
  attention.save(os);
  ffn.save(os);
  ln1_gamma.save_stream(os);
  ln1_beta.save_stream(os);
  ln2_gamma.save_stream(os);
  ln2_beta.save_stream(os);
  bio_layer.save(os);
}

bool TransformerBlock::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&embed_dim), sizeof(int));
  is.read(reinterpret_cast<char *>(&num_heads), sizeof(int));
  is.read(reinterpret_cast<char *>(&layer_id), sizeof(int));
  ln1_gamma.requires_grad = ln1_beta.requires_grad = true;
  ln2_gamma.requires_grad = ln2_beta.requires_grad = true;
  if (!attention.load(is))
    return false;
  if (!ffn.load(is))
    return false;
  if (!ln1_gamma.load_stream(is))
    return false;
  if (!ln1_beta.load_stream(is))
    return false;
  if (!ln2_gamma.load_stream(is))
    return false;
  if (!ln2_beta.load_stream(is))
    return false;
  return bio_layer.load(is);
}
