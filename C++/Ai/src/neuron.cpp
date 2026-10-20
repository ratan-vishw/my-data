#include "neuron.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <iostream>
#include <numeric>
#include <random>

// ============================================================
// Thread-local RNG
// ============================================================
static std::mt19937 &neuron_rng() {
  static thread_local std::mt19937 rng(static_cast<unsigned>(
      std::chrono::steady_clock::now().time_since_epoch().count() + 99));
  return rng;
}

// ============================================================
// Dendrite
// ============================================================
float Dendrite::compute(const std::vector<float> &inputs) const {
  float sum = bias;
  for (size_t i = 0; i < input_indices.size(); ++i) {
    int idx = input_indices[i];
    if (idx >= 0 && idx < (int)inputs.size()) {
      sum += inputs[idx] * weights[i];
    }
  }
  // Local dendritic nonlinearity (sigmoid-like)
  return std::tanh(sum);
}

// ============================================================
// BiologicalNeuron
// ============================================================
BiologicalNeuron::BiologicalNeuron(int id, int num_dendrites,
                                   int inputs_per_dendrite, int total_inputs)
    : id(id) {
  auto &rng = neuron_rng();
  std::normal_distribution<float> wdist(0.0f, 0.1f);
  std::uniform_int_distribution<int> idist(0, std::max(0, total_inputs - 1));

  dendrites.resize(num_dendrites);
  for (auto &d : dendrites) {
    d.input_indices.resize(inputs_per_dendrite);
    d.weights.resize(inputs_per_dendrite);
    d.bias = wdist(rng) * 0.01f;

    // Assign random input indices to this dendrite
    for (int i = 0; i < inputs_per_dendrite; ++i) {
      d.input_indices[i] = idist(rng);
      d.weights[i] = wdist(rng);
    }
  }
}

float BiologicalNeuron::forward(const std::vector<float> &inputs) {
  if (!is_active) {
    axon_output = 0.0f;
    return 0.0f;
  }

  // --- 1. Dendritic computation ---
  float dendritic_sum = 0.0f;
  for (auto &d : dendrites) {
    d.output = d.compute(inputs);
    dendritic_sum += d.output;
  }

  // --- 2. Soma integration (leaky integrate-and-fire) ---
  membrane_potential =
      membrane_potential * membrane_decay + dendritic_sum + soma_bias;

  // --- 3. Refractory period check ---
  if (refractory_counter > 0) {
    refractory_counter--;
    // Reduced sensitivity during refractory
    membrane_potential *= 0.3f;
  }

  // --- 4. Firing / activation ---
  // Smooth activation function based on membrane potential
  float activation =
      1.0f / (1.0f + std::exp(-(membrane_potential - firing_threshold) * 5.0f));

  // If strongly activated, enter refractory period
  if (activation > 0.8f && refractory_counter == 0) {
    refractory_counter = refractory_period;
  }

  // --- 5. Axon output ---
  axon_output = activation;
  axon_history = 0.95f * axon_history + 0.05f * axon_output;

  // Update activation running average (for saturation detection)
  activation_avg = 0.99f * activation_avg + 0.01f * std::abs(axon_output);

  return axon_output;
}

void BiologicalNeuron::reset_state() {
  membrane_potential = 0.0f;
  axon_output = 0.0f;
  refractory_counter = 0;
  for (auto &d : dendrites)
    d.output = 0.0f;
}

float BiologicalNeuron::get_saturation() const { return activation_avg; }

// ============================================================
// BioLayer
// ============================================================
BioLayer::BioLayer(int input_size, int output_size, int num_dendrites)
    : input_size(input_size), output_size(output_size),
      num_dendrites(num_dendrites) {
  init(input_size, output_size, num_dendrites);
}

void BioLayer::init(int in_size, int out_size, int n_dendrites) {
  input_size = in_size;
  output_size = out_size;
  num_dendrites = n_dendrites;

  int inputs_per_dendrite = std::max(1, in_size / n_dendrites);

  neurons.clear();
  neurons.reserve(out_size);
  for (int i = 0; i < out_size; ++i) {
    neurons.emplace_back(i, n_dendrites, inputs_per_dendrite, in_size);
  }

  // Initialize synaptic manager with full connectivity
  synapses.synapses.clear();
  auto &rng = neuron_rng();
  std::normal_distribution<float> wdist(
      0.0f, std::sqrt(2.0f / (float)(in_size + out_size)));
  for (int i = 0; i < in_size; ++i) {
    for (int j = 0; j < out_size; ++j) {
      synapses.add_synapse(i, j, wdist(rng));
    }
  }
}

Tensor BioLayer::forward(const Tensor &input) {
  // input: (seq_len × input_size)
  Tensor output(input.rows, output_size);

  for (int t = 0; t < input.rows; ++t) {
    // Extract input vector for this timestep
    std::vector<float> in_vec(input.data.begin() + t * input.cols,
                              input.data.begin() + (t + 1) * input.cols);

    // Also compute weighted input via synaptic weights (standard path)
    std::vector<float> weighted(output_size, 0.0f);
    for (const auto &syn : synapses.synapses) {
      if (!syn.active)
        continue;
      if (syn.pre_neuron_id < (int)in_vec.size() &&
          syn.post_neuron_id < output_size) {
        weighted[syn.post_neuron_id] += in_vec[syn.pre_neuron_id] * syn.weight;
      }
    }

    // Each neuron processes — combine dendritic + synaptic paths
    for (int j = 0; j < output_size; ++j) {
      // Blend biological neuron output with standard weighted sum
      float bio_out = neurons[j].forward(in_vec);
      float std_out = std::tanh(weighted[j]);
      // Weighted blend: 30% bio, 70% standard (bio modulates the standard path)
      output.data[t * output_size + j] = 0.7f * std_out + 0.3f * bio_out;
    }
  }
  return output;
}

void BioLayer::apply_bio_learning(const Tensor &pre_act,
                                  const Tensor &post_act) {
  // Compute average activations across the sequence
  std::vector<float> avg_pre(input_size, 0.0f);
  std::vector<float> avg_post(output_size, 0.0f);

  for (int t = 0; t < pre_act.rows; ++t) {
    for (int j = 0; j < input_size && j < pre_act.cols; ++j)
      avg_pre[j] += std::abs(pre_act.data[t * pre_act.cols + j]);
    for (int j = 0; j < output_size && j < post_act.cols; ++j)
      avg_post[j] += std::abs(post_act.data[t * post_act.cols + j]);
  }
  float norm = std::max(1.0f, (float)pre_act.rows);
  for (auto &v : avg_pre)
    v /= norm;
  for (auto &v : avg_post)
    v /= norm;

  // Apply learning rules
  synapses.update_traces(avg_pre, avg_post);
  synapses.apply_stdp(avg_pre, avg_post);
  synapses.apply_hebbian(avg_pre, avg_post);
}

void BioLayer::structural_update(const Tensor &pre_act,
                                 const Tensor &post_act) {
  std::vector<float> avg_pre(input_size, 0.0f);
  std::vector<float> avg_post(output_size, 0.0f);

  for (int t = 0; t < pre_act.rows; ++t) {
    for (int j = 0; j < input_size && j < pre_act.cols; ++j)
      avg_pre[j] += std::abs(pre_act.data[t * pre_act.cols + j]);
    for (int j = 0; j < output_size && j < post_act.cols; ++j)
      avg_post[j] += std::abs(post_act.data[t * post_act.cols + j]);
  }
  float norm = std::max(1.0f, (float)pre_act.rows);
  for (auto &v : avg_pre)
    v /= norm;
  for (auto &v : avg_post)
    v /= norm;

  synapses.prune();
  synapses.sprout(input_size, output_size, avg_pre, avg_post);
}

void BioLayer::add_neurons(int count) {
  auto &rng = neuron_rng();
  std::normal_distribution<float> wdist(0.0f, 0.02f);

  int old_size = output_size;
  output_size += count;

  int inputs_per_dendrite = std::max(1, input_size / num_dendrites);

  for (int i = 0; i < count; ++i) {
    int new_id = old_size + i;
    neurons.emplace_back(new_id, num_dendrites, inputs_per_dendrite,
                         input_size);
    neurons.back().creation_step = -1; // Will be set externally

    // Create synapses to this new neuron
    for (int pre = 0; pre < input_size; ++pre) {
      synapses.add_synapse(pre, new_id, wdist(rng));
    }
  }
}

float BioLayer::get_avg_saturation() const {
  if (neurons.empty())
    return 0.0f;
  float sum = 0.0f;
  for (const auto &n : neurons)
    sum += n.get_saturation();
  return sum / (float)neurons.size();
}

void BioLayer::reset_states() {
  for (auto &n : neurons)
    n.reset_state();
}

Tensor BioLayer::get_weight_matrix() const {
  Tensor w(input_size, output_size);
  std::vector<float> flat;
  synapses.to_weight_matrix(flat, input_size, output_size);
  w.data = flat;
  return w;
}

void BioLayer::set_weight_matrix(const Tensor &weights) {
  assert(weights.rows == input_size && weights.cols == output_size);
  synapses.from_weight_matrix(weights.data, input_size, output_size);
}

void BioLayer::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&input_size), sizeof(int));
  os.write(reinterpret_cast<const char *>(&output_size), sizeof(int));
  os.write(reinterpret_cast<const char *>(&num_dendrites), sizeof(int));
  synapses.save(os);
  // Save neuron states
  int n_neurons = (int)neurons.size();
  os.write(reinterpret_cast<const char *>(&n_neurons), sizeof(int));
  for (const auto &n : neurons) {
    os.write(reinterpret_cast<const char *>(&n.id), sizeof(int));
    os.write(reinterpret_cast<const char *>(&n.firing_threshold),
             sizeof(float));
    os.write(reinterpret_cast<const char *>(&n.membrane_decay), sizeof(float));
    os.write(reinterpret_cast<const char *>(&n.soma_bias), sizeof(float));
    os.write(reinterpret_cast<const char *>(&n.activation_avg), sizeof(float));
    os.write(reinterpret_cast<const char *>(&n.creation_step), sizeof(int));
    // Save dendrites
    int n_dend = (int)n.dendrites.size();
    os.write(reinterpret_cast<const char *>(&n_dend), sizeof(int));
    for (const auto &d : n.dendrites) {
      int n_idx = (int)d.input_indices.size();
      os.write(reinterpret_cast<const char *>(&n_idx), sizeof(int));
      os.write(reinterpret_cast<const char *>(d.input_indices.data()),
               n_idx * sizeof(int));
      os.write(reinterpret_cast<const char *>(d.weights.data()),
               n_idx * sizeof(float));
      os.write(reinterpret_cast<const char *>(&d.bias), sizeof(float));
    }
  }
}

bool BioLayer::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&input_size), sizeof(int));
  is.read(reinterpret_cast<char *>(&output_size), sizeof(int));
  is.read(reinterpret_cast<char *>(&num_dendrites), sizeof(int));
  if (!is)
    return false;

  if (!synapses.load(is))
    return false;

  int n_neurons = 0;
  is.read(reinterpret_cast<char *>(&n_neurons), sizeof(int));
  neurons.resize(n_neurons);
  for (auto &n : neurons) {
    is.read(reinterpret_cast<char *>(&n.id), sizeof(int));
    is.read(reinterpret_cast<char *>(&n.firing_threshold), sizeof(float));
    is.read(reinterpret_cast<char *>(&n.membrane_decay), sizeof(float));
    is.read(reinterpret_cast<char *>(&n.soma_bias), sizeof(float));
    is.read(reinterpret_cast<char *>(&n.activation_avg), sizeof(float));
    is.read(reinterpret_cast<char *>(&n.creation_step), sizeof(int));
    n.is_active = true;
    n.reset_state();

    int n_dend = 0;
    is.read(reinterpret_cast<char *>(&n_dend), sizeof(int));
    n.dendrites.resize(n_dend);
    for (auto &d : n.dendrites) {
      int n_idx = 0;
      is.read(reinterpret_cast<char *>(&n_idx), sizeof(int));
      d.input_indices.resize(n_idx);
      d.weights.resize(n_idx);
      is.read(reinterpret_cast<char *>(d.input_indices.data()),
              n_idx * sizeof(int));
      is.read(reinterpret_cast<char *>(d.weights.data()),
              n_idx * sizeof(float));
      is.read(reinterpret_cast<char *>(&d.bias), sizeof(float));
    }
  }
  return is.good() || is.eof();
}

void BioLayer::print_stats(const std::string &name) const {
  std::cout << "BioLayer";
  if (!name.empty())
    std::cout << " [" << name << "]";
  std::cout << ": " << input_size << " → " << output_size
            << " neurons=" << neurons.size()
            << " saturation=" << get_avg_saturation();
  synapses.print_stats();
}
