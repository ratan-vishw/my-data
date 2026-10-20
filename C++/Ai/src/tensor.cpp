#include "tensor.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <numeric>
#include <random>
#include <sstream>
#include <stdexcept>

// ============================================================
// Thread-local RNG
// ============================================================
static std::mt19937 &get_rng() {
  static thread_local std::mt19937 rng(static_cast<unsigned>(
      std::chrono::steady_clock::now().time_since_epoch().count()));
  return rng;
}

// ============================================================
// Constructors
// ============================================================
Tensor::Tensor() : rows(0), cols(0), requires_grad(false) {}

Tensor::Tensor(int rows, int cols, bool requires_grad)
    : rows(rows), cols(cols), data(rows * cols, 0.0f),
      requires_grad(requires_grad) {
  if (requires_grad)
    grad.resize(rows * cols, 0.0f);
}

Tensor::Tensor(int rows, int cols, const std::vector<float> &data,
               bool requires_grad)
    : rows(rows), cols(cols), data(data), requires_grad(requires_grad) {
  assert((int)data.size() == rows * cols);
  if (requires_grad)
    grad.resize(rows * cols, 0.0f);
}

// ============================================================
// Element access
// ============================================================
float &Tensor::at(int r, int c) { return data[r * cols + c]; }
float Tensor::at(int r, int c) const { return data[r * cols + c]; }
float &Tensor::operator()(int r, int c) { return data[r * cols + c]; }
float Tensor::operator()(int r, int c) const { return data[r * cols + c]; }

// ============================================================
// Shape
// ============================================================
int Tensor::size() const { return rows * cols; }

void Tensor::reshape(int new_rows, int new_cols) {
  assert(new_rows * new_cols == rows * cols);
  rows = new_rows;
  cols = new_cols;
}

Tensor Tensor::slice_row(int start, int count) const {
  assert(start >= 0 && start + count <= rows);
  Tensor result(count, cols);
  std::copy(data.begin() + start * cols, data.begin() + (start + count) * cols,
            result.data.begin());
  return result;
}

void Tensor::set_row(int row_idx, const Tensor &src, int src_row) {
  assert(row_idx < rows && src_row < src.rows && cols == src.cols);
  std::copy(src.data.begin() + src_row * src.cols,
            src.data.begin() + (src_row + 1) * src.cols,
            data.begin() + row_idx * cols);
}

// ============================================================
// Initialization
// ============================================================
void Tensor::zeros() { std::fill(data.begin(), data.end(), 0.0f); }
void Tensor::ones() { std::fill(data.begin(), data.end(), 1.0f); }
void Tensor::fill(float val) { std::fill(data.begin(), data.end(), val); }

void Tensor::xavier_init() {
  float limit = std::sqrt(6.0f / (float)(rows + cols));
  std::uniform_real_distribution<float> dist(-limit, limit);
  auto &rng = get_rng();
  for (auto &v : data)
    v = dist(rng);
}

void Tensor::he_init() {
  float stddev = std::sqrt(2.0f / (float)rows);
  std::normal_distribution<float> dist(0.0f, stddev);
  auto &rng = get_rng();
  for (auto &v : data)
    v = dist(rng);
}

void Tensor::random_init(float scale) {
  std::normal_distribution<float> dist(0.0f, scale);
  auto &rng = get_rng();
  for (auto &v : data)
    v = dist(rng);
}

void Tensor::zero_grad() {
  if (!grad.empty())
    std::fill(grad.begin(), grad.end(), 0.0f);
}

// ============================================================
// Matrix Multiply: (M×K) × (K×N) → (M×N)
// ============================================================
Tensor Tensor::matmul(const Tensor &other) const {
  assert(cols == other.rows);
  Tensor result(rows, other.cols);
  for (int i = 0; i < rows; ++i) {
    for (int k = 0; k < cols; ++k) {
      float a_ik = data[i * cols + k];
      if (a_ik == 0.0f)
        continue;
      for (int j = 0; j < other.cols; ++j) {
        result.data[i * other.cols + j] +=
            a_ik * other.data[k * other.cols + j];
      }
    }
  }
  return result;
}

// ============================================================
// Transpose: (M×N) → (N×M)
// ============================================================
Tensor Tensor::transpose() const {
  Tensor result(cols, rows);
  for (int i = 0; i < rows; ++i)
    for (int j = 0; j < cols; ++j)
      result.data[j * rows + i] = data[i * cols + j];
  return result;
}

// ============================================================
// Arithmetic
// ============================================================
Tensor Tensor::add(const Tensor &other) const {
  // Broadcasting: if other is (1, cols), broadcast across rows
  if (other.rows == 1 && other.cols == cols) {
    Tensor result(rows, cols);
    for (int i = 0; i < rows; ++i)
      for (int j = 0; j < cols; ++j)
        result.data[i * cols + j] = data[i * cols + j] + other.data[j];
    return result;
  }
  assert(rows == other.rows && cols == other.cols);
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = data[i] + other.data[i];
  return result;
}

Tensor Tensor::subtract(const Tensor &other) const {
  assert(rows == other.rows && cols == other.cols);
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = data[i] - other.data[i];
  return result;
}

Tensor Tensor::multiply(const Tensor &other) const {
  assert(rows == other.rows && cols == other.cols);
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = data[i] * other.data[i];
  return result;
}

Tensor Tensor::scale(float s) const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = data[i] * s;
  return result;
}

Tensor Tensor::add_scalar(float s) const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = data[i] + s;
  return result;
}

void Tensor::add_inplace(const Tensor &other) {
  if (other.rows == 1 && other.cols == cols) {
    for (int i = 0; i < rows; ++i)
      for (int j = 0; j < cols; ++j)
        data[i * cols + j] += other.data[j];
    return;
  }
  assert(rows == other.rows && cols == other.cols);
  for (int i = 0; i < size(); ++i)
    data[i] += other.data[i];
}

void Tensor::scale_inplace(float s) {
  for (auto &v : data)
    v *= s;
}

void Tensor::accumulate_grad(const Tensor &grad_contrib) {
  if (grad.empty())
    grad.resize(rows * cols, 0.0f);
  assert((int)grad_contrib.data.size() == (int)grad.size());
  for (int i = 0; i < (int)grad.size(); ++i)
    grad[i] += grad_contrib.data[i];
}

// ============================================================
// Activations
// ============================================================
Tensor Tensor::gelu() const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i) {
    float x = data[i];
    // Approximate GELU: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
    float inner = 0.7978845608f * (x + 0.044715f * x * x * x);
    result.data[i] = 0.5f * x * (1.0f + std::tanh(inner));
  }
  return result;
}

Tensor Tensor::relu() const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = std::max(0.0f, data[i]);
  return result;
}

Tensor Tensor::sigmoid() const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = 1.0f / (1.0f + std::exp(-data[i]));
  return result;
}

Tensor Tensor::tanh_act() const {
  Tensor result(rows, cols);
  for (int i = 0; i < size(); ++i)
    result.data[i] = std::tanh(data[i]);
  return result;
}

// ============================================================
// Softmax (row-wise)
// ============================================================
Tensor Tensor::softmax() const {
  Tensor result(rows, cols);
  for (int i = 0; i < rows; ++i) {
    // Numerical stability: subtract max
    float max_val = data[i * cols];
    for (int j = 1; j < cols; ++j)
      max_val = std::max(max_val, data[i * cols + j]);

    float sum = 0.0f;
    for (int j = 0; j < cols; ++j) {
      result.data[i * cols + j] = std::exp(data[i * cols + j] - max_val);
      sum += result.data[i * cols + j];
    }
    if (sum > 0.0f) {
      for (int j = 0; j < cols; ++j)
        result.data[i * cols + j] /= sum;
    }
  }
  return result;
}

// ============================================================
// Layer Normalization
// ============================================================
Tensor Tensor::layer_norm(const Tensor &gamma, const Tensor &beta,
                          float eps) const {
  assert(gamma.cols == cols && beta.cols == cols);
  Tensor result(rows, cols);
  for (int i = 0; i < rows; ++i) {
    // Compute mean
    float mean = 0.0f;
    for (int j = 0; j < cols; ++j)
      mean += data[i * cols + j];
    mean /= cols;

    // Compute variance
    float var = 0.0f;
    for (int j = 0; j < cols; ++j) {
      float diff = data[i * cols + j] - mean;
      var += diff * diff;
    }
    var /= cols;

    // Normalize
    float inv_std = 1.0f / std::sqrt(var + eps);
    for (int j = 0; j < cols; ++j) {
      float norm = (data[i * cols + j] - mean) * inv_std;
      result.data[i * cols + j] = norm * gamma.data[j] + beta.data[j];
    }
  }
  return result;
}

// ============================================================
// Reduction
// ============================================================
float Tensor::sum() const {
  float s = 0.0f;
  for (auto v : data)
    s += v;
  return s;
}

float Tensor::mean() const { return sum() / (float)size(); }

float Tensor::max_val() const {
  float m = data[0];
  for (auto v : data)
    m = std::max(m, v);
  return m;
}

Tensor Tensor::sum_rows() const {
  Tensor result(1, cols);
  for (int i = 0; i < rows; ++i)
    for (int j = 0; j < cols; ++j)
      result.data[j] += data[i * cols + j];
  return result;
}

Tensor Tensor::sum_cols() const {
  Tensor result(rows, 1);
  for (int i = 0; i < rows; ++i)
    for (int j = 0; j < cols; ++j)
      result.data[i] += data[i * cols + j];
  return result;
}

// ============================================================
// Cross-Entropy Loss
// ============================================================
float Tensor::cross_entropy_loss(const Tensor &logits,
                                 const std::vector<int> &targets) {
  // logits: (seq_len × vocab_size), targets: seq_len target token ids
  assert(logits.rows == (int)targets.size());
  Tensor probs = logits.softmax();
  float loss = 0.0f;
  for (int i = 0; i < logits.rows; ++i) {
    int t = targets[i];
    if (t >= 0 && t < logits.cols) {
      float p = std::max(probs.data[i * logits.cols + t], 1e-10f);
      loss -= std::log(p);
    }
  }
  return loss / (float)logits.rows;
}

Tensor Tensor::cross_entropy_grad(const Tensor &logits,
                                  const std::vector<int> &targets) {
  // Gradient of cross-entropy w.r.t. logits = softmax(logits) -
  // one_hot(targets)
  Tensor grad = logits.softmax();
  for (int i = 0; i < logits.rows; ++i) {
    int t = targets[i];
    if (t >= 0 && t < logits.cols) {
      grad.data[i * logits.cols + t] -= 1.0f;
    }
  }
  // Average over sequence length
  grad.scale_inplace(1.0f / (float)logits.rows);
  return grad;
}

// ============================================================
// Serialization
// ============================================================
void Tensor::save(const std::string &path) const {
  std::ofstream ofs(path, std::ios::binary);
  if (!ofs)
    throw std::runtime_error("Cannot save tensor to: " + path);
  save_stream(ofs);
}

bool Tensor::load(const std::string &path) {
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs)
    return false;
  return load_stream(ifs);
}

void Tensor::save_stream(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&rows), sizeof(int));
  os.write(reinterpret_cast<const char *>(&cols), sizeof(int));
  os.write(reinterpret_cast<const char *>(data.data()),
           data.size() * sizeof(float));
}

bool Tensor::load_stream(std::istream &is) {
  is.read(reinterpret_cast<char *>(&rows), sizeof(int));
  is.read(reinterpret_cast<char *>(&cols), sizeof(int));
  if (!is)
    return false;
  data.resize(rows * cols);
  is.read(reinterpret_cast<char *>(data.data()), data.size() * sizeof(float));
  if (requires_grad)
    grad.resize(rows * cols, 0.0f);
  return is.good() || is.eof();
}

// ============================================================
// Debug
// ============================================================
void Tensor::print(const std::string &name, int max_rows, int max_cols) const {
  std::cout << "Tensor";
  if (!name.empty())
    std::cout << " '" << name << "'";
  std::cout << " [" << rows << "x" << cols << "]:\n";
  int r_end = std::min(rows, max_rows);
  int c_end = std::min(cols, max_cols);
  for (int i = 0; i < r_end; ++i) {
    std::cout << "  [";
    for (int j = 0; j < c_end; ++j) {
      if (j > 0)
        std::cout << ", ";
      printf("%.4f", data[i * cols + j]);
    }
    if (cols > max_cols)
      std::cout << ", ...";
    std::cout << "]\n";
  }
  if (rows > max_rows)
    std::cout << "  ...\n";
}

std::string Tensor::shape_str() const {
  return "(" + std::to_string(rows) + ", " + std::to_string(cols) + ")";
}

// ============================================================
// Utility
// ============================================================
Tensor Tensor::clone() const {
  Tensor result(rows, cols, requires_grad);
  result.data = data;
  result.grad = grad;
  return result;
}

void Tensor::copy_from(const Tensor &other) {
  rows = other.rows;
  cols = other.cols;
  data = other.data;
  if (requires_grad) {
    grad = other.grad;
    if (grad.empty())
      grad.resize(rows * cols, 0.0f);
  }
}

// ============================================================
// Embedding Lookup
// ============================================================
Tensor Tensor::embedding_lookup(const std::vector<int> &indices) const {
  int seq_len = (int)indices.size();
  Tensor result(seq_len, cols);
  for (int i = 0; i < seq_len; ++i) {
    int idx = indices[i];
    assert(idx >= 0 && idx < rows);
    std::copy(data.begin() + idx * cols, data.begin() + (idx + 1) * cols,
              result.data.begin() + i * cols);
  }
  return result;
}
