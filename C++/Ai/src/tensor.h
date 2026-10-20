#ifndef TENSOR_H
#define TENSOR_H

#include <cstdint>
#include <functional>
#include <iostream>
#include <string>
#include <vector>

/**
 * Tensor — 2D matrix engine for the LLM.
 * Pure C++17, no external deps (no BLAS, no LAPACK).
 * Stores data in row-major order as std::vector<float>.
 */
class Tensor {
public:
  int rows = 0;
  int cols = 0;
  std::vector<float> data;
  std::vector<float> grad; // gradient storage (same shape)
  bool requires_grad = false;

  // --- Constructors ---
  Tensor();
  Tensor(int rows, int cols, bool requires_grad = false);
  Tensor(int rows, int cols, const std::vector<float> &data,
         bool requires_grad = false);

  // --- Element access ---
  float &at(int r, int c);
  float at(int r, int c) const;
  float &operator()(int r, int c);
  float operator()(int r, int c) const;

  // --- Shape ---
  int size() const;
  void reshape(int new_rows, int new_cols);
  Tensor slice_row(int start, int count) const;
  void set_row(int row_idx, const Tensor &src, int src_row);

  // --- Initialization ---
  void zeros();
  void ones();
  void fill(float val);
  void xavier_init(); // Xavier/Glorot uniform
  void he_init();     // He/Kaiming normal
  void random_init(float scale = 0.02f);
  void zero_grad();

  // --- Arithmetic (return new tensor) ---
  Tensor matmul(const Tensor &other) const; // (M×K) × (K×N) → (M×N)
  Tensor transpose() const;                 // (M×N) → (N×M)
  Tensor add(const Tensor &other) const;    // element-wise
  Tensor subtract(const Tensor &other) const;
  Tensor multiply(const Tensor &other) const; // element-wise (Hadamard)
  Tensor scale(float s) const;
  Tensor add_scalar(float s) const;

  // --- In-place operations ---
  void add_inplace(const Tensor &other);
  void scale_inplace(float s);
  void accumulate_grad(const Tensor &grad_contrib);

  // --- Activations ---
  Tensor gelu() const;
  Tensor relu() const;
  Tensor sigmoid() const;
  Tensor tanh_act() const; // named to avoid clash with std::tanh

  // --- Softmax (row-wise) ---
  Tensor softmax() const;

  // --- Layer Normalization ---
  Tensor layer_norm(const Tensor &gamma, const Tensor &beta,
                    float eps = 1e-5f) const;

  // --- Reduction ---
  float sum() const;
  float mean() const;
  float max_val() const;
  Tensor sum_rows() const; // sum across rows → (1 × cols)
  Tensor sum_cols() const; // sum across cols → (rows × 1)

  // --- Loss ---
  static float cross_entropy_loss(const Tensor &logits,
                                  const std::vector<int> &targets);
  static Tensor cross_entropy_grad(const Tensor &logits,
                                   const std::vector<int> &targets);

  // --- Serialization ---
  void save(const std::string &path) const;
  bool load(const std::string &path);
  void save_stream(std::ostream &os) const;
  bool load_stream(std::istream &is);

  // --- Debug ---
  void print(const std::string &name = "", int max_rows = 5,
             int max_cols = 5) const;
  std::string shape_str() const;

  // --- Utility ---
  Tensor clone() const;
  void copy_from(const Tensor &other);

  // --- Embedding lookup ---
  // Given indices, extract rows from this tensor (used as embedding table)
  Tensor embedding_lookup(const std::vector<int> &indices) const;
};

#endif // TENSOR_H
