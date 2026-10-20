#ifndef SYNAPSE_H
#define SYNAPSE_H

#include <cstdint>
#include <iostream>
#include <string>
#include <vector>

/**
 * Synapse — Biologically-inspired synaptic connection.
 *
 * Models a single connection between two neurons with:
 * - Weight (connection strength)
 * - Plasticity (meta-learning rate for this synapse)
 * - STDP (Spike-Timing-Dependent Plasticity)
 * - Hebbian co-activation tracking
 * - Age tracking for pruning decisions
 */
struct Synapse {
  int pre_neuron_id = -1;     // Source neuron
  int post_neuron_id = -1;    // Target neuron
  float weight = 0.0f;        // Connection strength
  float plasticity = 1.0f;    // How easily this synapse changes (meta-learning)
  float trace_pre = 0.0f;     // Pre-synaptic activity trace (for STDP)
  float trace_post = 0.0f;    // Post-synaptic activity trace (for STDP)
  float co_activation = 0.0f; // Running average of co-activation (Hebbian)
  int age = 0;                // Steps since creation
  bool active = true;         // Whether this synapse is alive

  Synapse() = default;
  Synapse(int pre, int post, float w);
};

/**
 * SynapticManager — Manages collections of synapses with bio-inspired learning
 * rules.
 */
class SynapticManager {
public:
  // Configuration
  float stdp_rate = 0.01f;        // STDP learning rate
  float hebbian_rate = 0.005f;    // Hebbian learning rate
  float prune_threshold = 0.001f; // Prune synapses below this weight
  float sprout_prob = 0.01f;      // Probability of new synapse sprouting
  float trace_decay = 0.95f;      // Activity trace decay rate
  float plasticity_decay =
      0.999f; // Plasticity slowly decreases (consolidation)

  std::vector<Synapse> synapses;

  SynapticManager() = default;

  // --- Core operations ---
  void add_synapse(int pre, int post, float weight);
  void remove_synapse(int index);

  // --- Learning rules ---

  // STDP: Update based on spike timing
  // If pre fires before post → strengthen (LTP)
  // If pre fires after post → weaken (LTD)
  void apply_stdp(const std::vector<float> &pre_activations,
                  const std::vector<float> &post_activations, float dt = 1.0f);

  // Hebbian: "Neurons that fire together wire together"
  void apply_hebbian(const std::vector<float> &pre_activations,
                     const std::vector<float> &post_activations);

  // Update activity traces (call each step)
  void update_traces(const std::vector<float> &pre_activations,
                     const std::vector<float> &post_activations);

  // --- Structural plasticity ---

  // Prune weak/inactive synapses
  int prune();

  // Sprout new synapses between highly active neurons
  int sprout(int num_pre_neurons, int num_post_neurons,
             const std::vector<float> &pre_activations,
             const std::vector<float> &post_activations);

  // --- Weight access ---
  // Build a weight matrix (pre × post) from synapses
  void to_weight_matrix(std::vector<float> &matrix, int num_pre,
                        int num_post) const;

  // Update synapses from a weight matrix (after gradient update)
  void from_weight_matrix(const std::vector<float> &matrix, int num_pre,
                          int num_post);

  // Apply weight changes from gradient-based learning
  void apply_gradient_updates(const std::vector<float> &weight_deltas,
                              int num_pre, int num_post);

  // --- Serialization ---
  void save(std::ostream &os) const;
  bool load(std::istream &is);

  // --- Stats ---
  int active_count() const;
  float avg_weight() const;
  float avg_plasticity() const;
  void print_stats(const std::string &name = "") const;
};

#endif // SYNAPSE_H
