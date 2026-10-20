#include "optimizer.h"
#include <algorithm>
#include <cmath>
#include <iostream>

// ============================================================
// Constructor
// ============================================================
AdamW::AdamW(float lr, float weight_decay, float grad_clip, int warmup_steps)
    : lr(lr), weight_decay(weight_decay), grad_clip(grad_clip),
      warmup_steps(warmup_steps) {}

// ============================================================
// Register Parameter
// ============================================================
void AdamW::register_param(Tensor *param) {
  ParamState state;
  state.param = param;
  state.m.resize(param->size(), 0.0f);
  state.v.resize(param->size(), 0.0f);
  params.push_back(std::move(state));
}

// ============================================================
// Learning Rate Schedule
// ============================================================
float AdamW::get_lr() const {
  if (step < warmup_steps) {
    // Linear warmup
    return lr * ((float)(step + 1) / (float)warmup_steps);
  }
  // Cosine decay
  float progress = (float)(step - warmup_steps) /
                   (float)std::max(1, total_steps - warmup_steps);
  progress = std::min(1.0f, progress);
  return lr * 0.5f * (1.0f + std::cos(3.14159265f * progress));
}

// ============================================================
// Gradient Clipping
// ============================================================
void AdamW::clip_gradients() {
  if (grad_clip <= 0.0f)
    return;

  // Compute global gradient norm
  float total_norm = 0.0f;
  for (auto &ps : params) {
    if (!ps.param || ps.param->grad.empty())
      continue;
    for (float g : ps.param->grad) {
      total_norm += g * g;
    }
  }
  total_norm = std::sqrt(total_norm);

  if (total_norm > grad_clip) {
    float scale = grad_clip / (total_norm + 1e-8f);
    for (auto &ps : params) {
      if (!ps.param || ps.param->grad.empty())
        continue;
      for (float &g : ps.param->grad) {
        g *= scale;
      }
    }
  }
}

// ============================================================
// Optimization Step
// ============================================================
void AdamW::step_update() {
  step++;
  float current_lr = get_lr();
  float bc1 = 1.0f - std::pow(beta1, (float)step); // Bias correction 1
  float bc2 = 1.0f - std::pow(beta2, (float)step); // Bias correction 2

  clip_gradients();

  for (auto &ps : params) {
    if (!ps.param || ps.param->grad.empty())
      continue;
    Tensor *p = ps.param;
    int sz = p->size();

    // Resize moment buffers if parameter size changed (neurogenesis)
    if ((int)ps.m.size() != sz) {
      ps.m.resize(sz, 0.0f);
      ps.v.resize(sz, 0.0f);
    }

    for (int i = 0; i < sz; ++i) {
      float g = p->grad[i];

      // Update moments
      ps.m[i] = beta1 * ps.m[i] + (1.0f - beta1) * g;
      ps.v[i] = beta2 * ps.v[i] + (1.0f - beta2) * g * g;

      // Bias-corrected moments
      float m_hat = ps.m[i] / bc1;
      float v_hat = ps.v[i] / bc2;

      // AdamW update: param -= lr * (m_hat / (sqrt(v_hat) + eps) + weight_decay
      // * param)
      p->data[i] -= current_lr * (m_hat / (std::sqrt(v_hat) + eps) +
                                  weight_decay * p->data[i]);
    }
  }
}

// ============================================================
// Zero Gradients
// ============================================================
void AdamW::zero_grad() {
  for (auto &ps : params) {
    if (ps.param)
      ps.param->zero_grad();
  }
}

// ============================================================
// Serialization
// ============================================================
void AdamW::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&step), sizeof(int));
  os.write(reinterpret_cast<const char *>(&lr), sizeof(float));
  os.write(reinterpret_cast<const char *>(&beta1), sizeof(float));
  os.write(reinterpret_cast<const char *>(&beta2), sizeof(float));
  os.write(reinterpret_cast<const char *>(&weight_decay), sizeof(float));
  os.write(reinterpret_cast<const char *>(&warmup_steps), sizeof(int));
  os.write(reinterpret_cast<const char *>(&total_steps), sizeof(int));

  int num_params = (int)params.size();
  os.write(reinterpret_cast<const char *>(&num_params), sizeof(int));
  for (const auto &ps : params) {
    int sz = (int)ps.m.size();
    os.write(reinterpret_cast<const char *>(&sz), sizeof(int));
    os.write(reinterpret_cast<const char *>(ps.m.data()), sz * sizeof(float));
    os.write(reinterpret_cast<const char *>(ps.v.data()), sz * sizeof(float));
  }
}

bool AdamW::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&step), sizeof(int));
  is.read(reinterpret_cast<char *>(&lr), sizeof(float));
  is.read(reinterpret_cast<char *>(&beta1), sizeof(float));
  is.read(reinterpret_cast<char *>(&beta2), sizeof(float));
  is.read(reinterpret_cast<char *>(&weight_decay), sizeof(float));
  is.read(reinterpret_cast<char *>(&warmup_steps), sizeof(int));
  is.read(reinterpret_cast<char *>(&total_steps), sizeof(int));
  if (!is)
    return false;

  int num_params = 0;
  is.read(reinterpret_cast<char *>(&num_params), sizeof(int));
  // Note: we can only load moment buffers if params are already registered
  // with matching count. If not, we skip.
  if (num_params == (int)params.size()) {
    for (auto &ps : params) {
      int sz = 0;
      is.read(reinterpret_cast<char *>(&sz), sizeof(int));
      ps.m.resize(sz);
      ps.v.resize(sz);
      is.read(reinterpret_cast<char *>(ps.m.data()), sz * sizeof(float));
      is.read(reinterpret_cast<char *>(ps.v.data()), sz * sizeof(float));
    }
  } else {
    // Skip moment data
    for (int p = 0; p < num_params; ++p) {
      int sz = 0;
      is.read(reinterpret_cast<char *>(&sz), sizeof(int));
      is.seekg(sz * sizeof(float) * 2, std::ios::cur);
    }
  }
  return is.good() || is.eof();
}
