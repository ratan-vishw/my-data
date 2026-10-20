#ifndef NEURON_H
#define NEURON_H

#include "synapse.h"
#include "tensor.h"
#include <string>
#include <vector>

/**
 * Dendrite — A single dendritic branch of a biological neuron.
 *
 * Each dendrite receives a subset of inputs and performs local
 * computation (weighted sum + nonlinearity) before passing its
 * signal to the soma. This models dendritic computation found
 * in real neurons, where dendrites can perform independent
 * information processing.
 */
struct Dendrite {
  std::vector<int> input_indices; // Which inputs this dendrite receives
  std::vector<float> weights;     // Local weights on this branch
  float output = 0.0f; // Output of this dendrite after local processing
  float bias = 0.0f;   // Local bias

  Dendrite() = default;

  // Compute local dendritic output from inputs
  float compute(const std::vector<float> &inputs) const;
};

/**
 * BiologicalNeuron — Models a single neuron with human-like structure.
 *
 * Structure:
 *   [Inputs] → [Dendrites (local computation)] → [Soma (integration)] → [Axon
 * (output)]
 *
 * Features:
 * - Multiple dendritic branches with local weights
 * - Soma integrates dendritic signals with membrane potential
 * - Leaky integrate-and-fire: potential decays, fires when threshold exceeded
 * - Refractory period after firing
 * - Axon carries output to downstream neurons
 */
struct BiologicalNeuron {
  int id = -1;

  // --- Dendrites ---
  std::vector<Dendrite> dendrites;

  // --- Soma (cell body) ---
  float membrane_potential = 0.0f; // Current potential
  float firing_threshold = 0.5f;   // Threshold to fire
  float membrane_decay = 0.9f;     // Leak rate (1.0 = no leak)
  float soma_bias = 0.0f;          // Soma bias term

  // --- Axon (output) ---
  float axon_output = 0.0f;  // Current output value
  float axon_history = 0.0f; // Exponential moving average of output

  // --- Refractory ---
  int refractory_counter = 0; // Countdown after firing
  int refractory_period = 2;  // Steps of reduced sensitivity after firing

  // --- State ---
  bool is_active = true;
  int creation_step =
      0; // When this neuron was created (for neurogenesis tracking)
  float activation_avg =
      0.0f; // Running average of activation (for saturation detection)

  BiologicalNeuron() = default;
  BiologicalNeuron(int id, int num_dendrites, int inputs_per_dendrite,
                   int total_inputs);

  // Forward: compute output from inputs
  // 1. Each dendrite processes its subset of inputs
  // 2. Soma integrates dendritic signals
  // 3. Membrane potential updated (leaky integrate)
  // 4. If above threshold and not refractory: fire (output via axon)
  float forward(const std::vector<float> &inputs);

  // Reset state between sequences
  void reset_state();

  // Get saturation level (how often this neuron is at max activation)
  float get_saturation() const;
};

/**
 * BioLayer — A layer of BiologicalNeurons.
 *
 * Wraps a collection of neurons to work as a neural network layer.
 * Provides batch forward pass and integrates with the Tensor-based
 * transformer architecture.
 */
class BioLayer {
public:
  std::vector<BiologicalNeuron> neurons;
  SynapticManager synapses;
  int input_size = 0;
  int output_size = 0;

  // Configuration
  int num_dendrites = 4;
  float membrane_decay = 0.9f;
  float firing_threshold = 0.5f;
  int refractory_period = 2;

  BioLayer() = default;
  BioLayer(int input_size, int output_size, int num_dendrites = 4);

  // Initialize neurons and synapses
  void init(int input_size, int output_size, int num_dendrites = 4);

  // Forward pass: (batch of input vectors) → (batch of output vectors)
  Tensor forward(const Tensor &input);

  // Apply bio-inspired learning (STDP + Hebbian)
  void apply_bio_learning(const Tensor &pre_act, const Tensor &post_act);

  // Structural plasticity: prune and sprout
  void structural_update(const Tensor &pre_act, const Tensor &post_act);

  // Add neurons to this layer
  void add_neurons(int count);

  // Get average saturation of neurons in this layer
  float get_avg_saturation() const;

  // Reset all neuron states
  void reset_states();

  // Convert to/from standard weight matrix (for gradient-based training)
  Tensor get_weight_matrix() const;
  void set_weight_matrix(const Tensor &weights);

  // Serialization
  void save(std::ostream &os) const;
  bool load(std::istream &is);

  void print_stats(const std::string &name = "") const;
};

#endif // NEURON_H
