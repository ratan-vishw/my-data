#ifndef OPTIMIZER_H
#define OPTIMIZER_H

#include "tensor.h"
#include <string>
#include <vector>

/**
 * AdamW Optimizer — Adaptive learning with weight decay.
 *
 * Features:
 * - Per-parameter first moment (mean) and second moment (variance) estimates
 * - Weight decay regularization (decoupled, not L2)
 * - Learning rate warmup (linear) + cosine decay schedule
 * - Gradient clipping (max norm)
 */
class AdamW {
public:
  // Hyperparameters
  float lr = 0.001f;          // Base learning rate
  float beta1 = 0.9f;         // First moment decay
  float beta2 = 0.999f;       // Second moment decay
  float eps = 1e-8f;          // Numerical stability
  float weight_decay = 0.01f; // Weight decay coefficient
  float grad_clip = 1.0f;     // Max gradient norm (0 = no clipping)
  int warmup_steps = 100;     // Linear warmup steps
  int total_steps = 100000;   // Total training steps (for cosine decay)

  // State
  int step = 0;

  AdamW() = default;
  AdamW(float lr, float weight_decay = 0.01f, float grad_clip = 1.0f,
        int warmup_steps = 100);

  /**
   * Register a parameter tensor for optimization.
   * Must be called for each learnable parameter before stepping.
   */
  void register_param(Tensor *param);

  /**
   * Perform one optimization step.
   * Reads gradients from param->grad, updates param->data.
   */
  void step_update();

  /**
   * Clip gradients by global norm across all parameters.
   */
  void clip_gradients();

  /**
   * Get current learning rate (with warmup + cosine decay).
   */
  float get_lr() const;

  /**
   * Zero all gradients.
   */
  void zero_grad();

  /**
   * Save/load optimizer state.
   */
  void save(std::ostream &os) const;
  bool load(std::istream &is);

private:
  struct ParamState {
    Tensor *param = nullptr;
    std::vector<float> m; // First moment
    std::vector<float> v; // Second moment
  };

  std::vector<ParamState> params;
};

#endif // OPTIMIZER_H
