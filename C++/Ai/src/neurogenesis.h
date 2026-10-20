#ifndef NEUROGENESIS_H
#define NEUROGENESIS_H

#include "neuron.h"
#include <fstream>
#include <string>
#include <vector>

/**
 * GrowthEvent — Records a structural change in the network.
 */
struct GrowthEvent {
  int step;                // Training step when this happened
  std::string type;        // "add_neurons", "add_layer", "prune"
  int layer_index;         // Which layer was modified
  int count;               // How many neurons added/removed
  float saturation_before; // Saturation level that triggered this
  std::string description; // Human-readable description
};

/**
 * NeurogenesisManager — Controls dynamic growth of the neural network.
 *
 * Monitors neuron saturation (how "full" each layer is) and
 * triggers structural changes:
 * - Add neurons to saturated layers
 * - Add new transformer blocks if all layers are saturated
 * - Prune and sprout synapses for structural plasticity
 *
 * Mimics neurogenesis in the human brain — new neurons are born
 * in response to learning demands.
 */
class NeurogenesisManager {
public:
  // Configuration
  float saturation_threshold = 0.8f; // Trigger growth above this
  int max_neurons_per_layer = 512;   // Maximum neurons in any layer
  int max_layers = 12;               // Maximum transformer blocks
  int growth_check_interval = 1000;  // Check every N steps
  int neurons_to_add = 8;            // How many neurons to add at once
  bool enabled = true;               // Enable/disable neurogenesis

  // State
  int current_step = 0;
  std::vector<GrowthEvent> history; // Log of all structural changes

  NeurogenesisManager() = default;

  /**
   * Check if any layers need growth and perform it.
   * Call this at checkpoint boundaries during training.
   *
   * @param bio_layers  Vector of BioLayers in the model
   * @param step        Current training step
   * @return            true if any structural change was made
   */
  bool check_and_grow(std::vector<BioLayer> &bio_layers, int step);

  /**
   * Check if a new transformer block should be added.
   * Returns true if all existing layers are saturated.
   */
  bool should_add_layer(const std::vector<BioLayer> &bio_layers) const;

  /**
   * Get growth statistics.
   */
  int total_neurons_added() const;
  int total_layers_added() const;
  int total_pruned() const;

  /**
   * Print growth history.
   */
  void print_history() const;

  /**
   * Save/load growth state.
   */
  void save(std::ostream &os) const;
  bool load(std::istream &is);

  /**
   * Save growth log to a text file.
   */
  void save_log(const std::string &path) const;
};

#endif // NEUROGENESIS_H
