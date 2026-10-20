#include "neurogenesis.h"
#include <algorithm>
#include <iostream>
#include <sstream>

// ============================================================
// Check and Grow
// ============================================================
bool NeurogenesisManager::check_and_grow(std::vector<BioLayer> &bio_layers,
                                         int step) {
  if (!enabled)
    return false;
  current_step = step;

  // Only check at intervals
  if (step % growth_check_interval != 0)
    return false;

  bool changed = false;

  for (int i = 0; i < (int)bio_layers.size(); ++i) {
    auto &layer = bio_layers[i];
    float sat = layer.get_avg_saturation();

    if (sat > saturation_threshold &&
        layer.output_size < max_neurons_per_layer) {
      // Determine how many to add (don't exceed max)
      int to_add =
          std::min(neurons_to_add, max_neurons_per_layer - layer.output_size);
      if (to_add <= 0)
        continue;

      int old_size = layer.output_size;
      layer.add_neurons(to_add);

      // Set creation step on new neurons
      for (int n = old_size; n < layer.output_size; ++n) {
        if (n < (int)layer.neurons.size()) {
          layer.neurons[n].creation_step = step;
        }
      }

      GrowthEvent event;
      event.step = step;
      event.type = "add_neurons";
      event.layer_index = i;
      event.count = to_add;
      event.saturation_before = sat;
      event.description = "Layer " + std::to_string(i) + ": added " +
                          std::to_string(to_add) + " neurons (" +
                          std::to_string(old_size) + " → " +
                          std::to_string(layer.output_size) +
                          "), saturation was " + std::to_string(sat);
      history.push_back(event);

      std::cout << "[NEUROGENESIS] " << event.description << "\n";
      changed = true;
    }
  }

  return changed;
}

// ============================================================
// Should Add Layer
// ============================================================
bool NeurogenesisManager::should_add_layer(
    const std::vector<BioLayer> &bio_layers) const {
  if (!enabled)
    return false;
  if ((int)bio_layers.size() >= max_layers)
    return false;

  // Check if ALL layers are saturated
  for (const auto &layer : bio_layers) {
    if (layer.get_avg_saturation() < saturation_threshold)
      return false;
    if (layer.output_size < max_neurons_per_layer)
      return false;
  }
  return true;
}

// ============================================================
// Statistics
// ============================================================
int NeurogenesisManager::total_neurons_added() const {
  int total = 0;
  for (const auto &e : history) {
    if (e.type == "add_neurons")
      total += e.count;
  }
  return total;
}

int NeurogenesisManager::total_layers_added() const {
  int total = 0;
  for (const auto &e : history) {
    if (e.type == "add_layer")
      total += e.count;
  }
  return total;
}

int NeurogenesisManager::total_pruned() const {
  int total = 0;
  for (const auto &e : history) {
    if (e.type == "prune")
      total += e.count;
  }
  return total;
}

// ============================================================
// Print History
// ============================================================
void NeurogenesisManager::print_history() const {
  std::cout << "=== Neurogenesis History ===\n";
  for (const auto &e : history) {
    std::cout << "  [Step " << e.step << "] " << e.description << "\n";
  }
  std::cout << "Total neurons added: " << total_neurons_added() << "\n";
  std::cout << "Total layers added: " << total_layers_added() << "\n";
  std::cout << "Total pruned: " << total_pruned() << "\n";
}

// ============================================================
// Serialization
// ============================================================
void NeurogenesisManager::save(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&saturation_threshold),
           sizeof(float));
  os.write(reinterpret_cast<const char *>(&max_neurons_per_layer), sizeof(int));
  os.write(reinterpret_cast<const char *>(&max_layers), sizeof(int));
  os.write(reinterpret_cast<const char *>(&growth_check_interval), sizeof(int));
  os.write(reinterpret_cast<const char *>(&neurons_to_add), sizeof(int));
  os.write(reinterpret_cast<const char *>(&current_step), sizeof(int));
  int8_t en = enabled ? 1 : 0;
  os.write(reinterpret_cast<const char *>(&en), sizeof(int8_t));

  int num_events = (int)history.size();
  os.write(reinterpret_cast<const char *>(&num_events), sizeof(int));
  for (const auto &e : history) {
    os.write(reinterpret_cast<const char *>(&e.step), sizeof(int));
    int type_len = (int)e.type.size();
    os.write(reinterpret_cast<const char *>(&type_len), sizeof(int));
    os.write(e.type.data(), type_len);
    os.write(reinterpret_cast<const char *>(&e.layer_index), sizeof(int));
    os.write(reinterpret_cast<const char *>(&e.count), sizeof(int));
    os.write(reinterpret_cast<const char *>(&e.saturation_before),
             sizeof(float));
    int desc_len = (int)e.description.size();
    os.write(reinterpret_cast<const char *>(&desc_len), sizeof(int));
    os.write(e.description.data(), desc_len);
  }
}

bool NeurogenesisManager::load(std::istream &is) {
  is.read(reinterpret_cast<char *>(&saturation_threshold), sizeof(float));
  is.read(reinterpret_cast<char *>(&max_neurons_per_layer), sizeof(int));
  is.read(reinterpret_cast<char *>(&max_layers), sizeof(int));
  is.read(reinterpret_cast<char *>(&growth_check_interval), sizeof(int));
  is.read(reinterpret_cast<char *>(&neurons_to_add), sizeof(int));
  is.read(reinterpret_cast<char *>(&current_step), sizeof(int));
  int8_t en = 0;
  is.read(reinterpret_cast<char *>(&en), sizeof(int8_t));
  enabled = (en != 0);
  if (!is)
    return false;

  int num_events = 0;
  is.read(reinterpret_cast<char *>(&num_events), sizeof(int));
  history.resize(num_events);
  for (auto &e : history) {
    is.read(reinterpret_cast<char *>(&e.step), sizeof(int));
    int type_len = 0;
    is.read(reinterpret_cast<char *>(&type_len), sizeof(int));
    e.type.resize(type_len);
    is.read(&e.type[0], type_len);
    is.read(reinterpret_cast<char *>(&e.layer_index), sizeof(int));
    is.read(reinterpret_cast<char *>(&e.count), sizeof(int));
    is.read(reinterpret_cast<char *>(&e.saturation_before), sizeof(float));
    int desc_len = 0;
    is.read(reinterpret_cast<char *>(&desc_len), sizeof(int));
    e.description.resize(desc_len);
    is.read(&e.description[0], desc_len);
  }
  return is.good() || is.eof();
}

void NeurogenesisManager::save_log(const std::string &path) const {
  std::ofstream ofs(path);
  if (!ofs) {
    std::cerr << "Warning: Cannot save growth log to " << path << "\n";
    return;
  }
  ofs << "=== Neurogenesis Growth Log ===\n\n";
  for (const auto &e : history) {
    ofs << "[Step " << e.step << "] " << e.type << " | Layer " << e.layer_index
        << " | Count " << e.count << " | Saturation " << e.saturation_before
        << "\n  " << e.description << "\n\n";
  }
  ofs << "Summary:\n";
  ofs << "  Total neurons added: " << total_neurons_added() << "\n";
  ofs << "  Total layers added: " << total_layers_added() << "\n";
  ofs << "  Total pruned: " << total_pruned() << "\n";
}
