#include "synapse.h"
#include <algorithm>
#include <cassert>
#include <chrono>
#include <cmath>
#include <random>

// ============================================================
// Synapse constructor
// ============================================================
Synapse::Synapse(int pre, int post, float w)
    : pre_neuron_id(pre), post_neuron_id(post), weight(w), plasticity(1.0f),
      trace_pre(0.0f), trace_post(0.0f), co_activation(0.0f), age(0),
      active(true) {}

// ============================================================
// Thread-local RNG
// ============================================================
static std::mt19937 &synapse_rng() {
  static thread_local std::mt19937 rng(static_cast<unsigned>(
      std::chrono::steady_clock::now().time_since_epoch().count() + 42));
  return rng;
}

// ============================================================
// SynapticManager
// ============================================================
void SynapticManager::add_synapse(int pre, int post, float weight) {
  synapses.emplace_back(pre, post, weight);
}

void SynapticManager::remove_synapse(int index) {
  if (index >= 0 && index < (int)synapses.size()) {
    synapses[index].active = false;
  }
}

// ============================================================
// STDP: Spike-Timing-Dependent Plasticity
// ============================================================
void SynapticManager::apply_stdp(const std::vector<float> &pre_act,
                                 const std::vector<float> &post_act, float dt) {
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;
    if (pre >= (int)pre_act.size() || post >= (int)post_act.size())
      continue;

    float pre_a = pre_act[pre];
    float post_a = post_act[post];

    // LTP: pre fires, post traces are high → strengthen
    float ltp = stdp_rate * pre_a * syn.trace_post;
    // LTD: post fires, pre traces are high → weaken
    float ltd = -stdp_rate * 0.5f * post_a * syn.trace_pre;

    float delta = (ltp + ltd) * syn.plasticity;
    syn.weight += delta;

    // Clamp weight
    syn.weight = std::max(-5.0f, std::min(5.0f, syn.weight));
    syn.age++;
  }
}

// ============================================================
// Hebbian Learning
// ============================================================
void SynapticManager::apply_hebbian(const std::vector<float> &pre_act,
                                    const std::vector<float> &post_act) {
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;
    if (pre >= (int)pre_act.size() || post >= (int)post_act.size())
      continue;

    float pre_a = pre_act[pre];
    float post_a = post_act[post];

    // Update co-activation running average
    float co = pre_a * post_a;
    syn.co_activation = 0.99f * syn.co_activation + 0.01f * co;

    // Hebbian: "fire together, wire together"
    float delta = hebbian_rate * (co - syn.co_activation) * syn.plasticity;
    syn.weight += delta;
    syn.weight = std::max(-5.0f, std::min(5.0f, syn.weight));

    // Slowly decrease plasticity (consolidation)
    syn.plasticity *= plasticity_decay;
    syn.plasticity = std::max(0.01f, syn.plasticity);
  }
}

// ============================================================
// Update activity traces
// ============================================================
void SynapticManager::update_traces(const std::vector<float> &pre_act,
                                    const std::vector<float> &post_act) {
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;

    // Decay traces
    syn.trace_pre *= trace_decay;
    syn.trace_post *= trace_decay;

    // Add current activation
    if (pre < (int)pre_act.size())
      syn.trace_pre += pre_act[pre];
    if (post < (int)post_act.size())
      syn.trace_post += post_act[post];
  }
}

// ============================================================
// Pruning — remove weak synapses
// ============================================================
int SynapticManager::prune() {
  int pruned = 0;
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    // Prune if weight is very small and synapse is old enough
    if (std::abs(syn.weight) < prune_threshold && syn.age > 100) {
      syn.active = false;
      pruned++;
    }
  }
  // Compact: remove inactive synapses
  if (pruned > 0) {
    synapses.erase(std::remove_if(synapses.begin(), synapses.end(),
                                  [](const Synapse &s) { return !s.active; }),
                   synapses.end());
  }
  return pruned;
}

// ============================================================
// Sprouting — create new synapses
// ============================================================
int SynapticManager::sprout(int num_pre, int num_post,
                            const std::vector<float> &pre_act,
                            const std::vector<float> &post_act) {
  auto &rng = synapse_rng();
  std::uniform_real_distribution<float> prob_dist(0.0f, 1.0f);
  std::normal_distribution<float> weight_dist(0.0f, 0.02f);

  int sprouted = 0;

  // Find highly active neurons and create new connections
  for (int i = 0; i < num_pre; ++i) {
    if (i >= (int)pre_act.size())
      break;
    if (pre_act[i] < 0.5f)
      continue; // Only active pre-neurons

    for (int j = 0; j < num_post; ++j) {
      if (j >= (int)post_act.size())
        break;
      if (post_act[j] < 0.5f)
        continue; // Only active post-neurons

      if (prob_dist(rng) < sprout_prob) {
        // Check if connection already exists
        bool exists = false;
        for (const auto &syn : synapses) {
          if (syn.active && syn.pre_neuron_id == i && syn.post_neuron_id == j) {
            exists = true;
            break;
          }
        }
        if (!exists) {
          add_synapse(i, j, weight_dist(rng));
          sprouted++;
        }
      }
    }
  }
  return sprouted;
}

// ============================================================
// Weight matrix conversion
// ============================================================
void SynapticManager::to_weight_matrix(std::vector<float> &matrix, int num_pre,
                                       int num_post) const {
  matrix.assign(num_pre * num_post, 0.0f);
  for (const auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;
    if (pre >= 0 && pre < num_pre && post >= 0 && post < num_post) {
      matrix[pre * num_post + post] = syn.weight;
    }
  }
}

void SynapticManager::from_weight_matrix(const std::vector<float> &matrix,
                                         int num_pre, int num_post) {
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;
    if (pre >= 0 && pre < num_pre && post >= 0 && post < num_post) {
      syn.weight = matrix[pre * num_post + post];
    }
  }
}

void SynapticManager::apply_gradient_updates(
    const std::vector<float> &weight_deltas, int num_pre, int num_post) {
  for (auto &syn : synapses) {
    if (!syn.active)
      continue;
    int pre = syn.pre_neuron_id;
    int post = syn.post_neuron_id;
    if (pre >= 0 && pre < num_pre && post >= 0 && post < num_post) {
      syn.weight += weight_deltas[pre * num_post + post] * syn.plasticity;
    }
  }
}

// ============================================================
// Serialization
// ============================================================
void SynapticManager::save(std::ostream &os) const {
  int count = (int)synapses.size();
  os.write(reinterpret_cast<const char *>(&count), sizeof(int));
  os.write(reinterpret_cast<const char *>(&stdp_rate), sizeof(float));
  os.write(reinterpret_cast<const char *>(&hebbian_rate), sizeof(float));
  os.write(reinterpret_cast<const char *>(&prune_threshold), sizeof(float));
  for (const auto &syn : synapses) {
    os.write(reinterpret_cast<const char *>(&syn.pre_neuron_id), sizeof(int));
    os.write(reinterpret_cast<const char *>(&syn.post_neuron_id), sizeof(int));
    os.write(reinterpret_cast<const char *>(&syn.weight), sizeof(float));
    os.write(reinterpret_cast<const char *>(&syn.plasticity), sizeof(float));
    os.write(reinterpret_cast<const char *>(&syn.co_activation), sizeof(float));
    os.write(reinterpret_cast<const char *>(&syn.age), sizeof(int));
  }
}

bool SynapticManager::load(std::istream &is) {
  int count = 0;
  is.read(reinterpret_cast<char *>(&count), sizeof(int));
  is.read(reinterpret_cast<char *>(&stdp_rate), sizeof(float));
  is.read(reinterpret_cast<char *>(&hebbian_rate), sizeof(float));
  is.read(reinterpret_cast<char *>(&prune_threshold), sizeof(float));
  if (!is)
    return false;

  synapses.resize(count);
  for (auto &syn : synapses) {
    is.read(reinterpret_cast<char *>(&syn.pre_neuron_id), sizeof(int));
    is.read(reinterpret_cast<char *>(&syn.post_neuron_id), sizeof(int));
    is.read(reinterpret_cast<char *>(&syn.weight), sizeof(float));
    is.read(reinterpret_cast<char *>(&syn.plasticity), sizeof(float));
    is.read(reinterpret_cast<char *>(&syn.co_activation), sizeof(float));
    is.read(reinterpret_cast<char *>(&syn.age), sizeof(int));
    syn.active = true;
    syn.trace_pre = 0.0f;
    syn.trace_post = 0.0f;
  }
  return is.good() || is.eof();
}

// ============================================================
// Stats
// ============================================================
int SynapticManager::active_count() const {
  int c = 0;
  for (const auto &s : synapses)
    if (s.active)
      c++;
  return c;
}

float SynapticManager::avg_weight() const {
  float sum = 0.0f;
  int c = 0;
  for (const auto &s : synapses) {
    if (s.active) {
      sum += std::abs(s.weight);
      c++;
    }
  }
  return c > 0 ? sum / c : 0.0f;
}

float SynapticManager::avg_plasticity() const {
  float sum = 0.0f;
  int c = 0;
  for (const auto &s : synapses) {
    if (s.active) {
      sum += s.plasticity;
      c++;
    }
  }
  return c > 0 ? sum / c : 0.0f;
}

void SynapticManager::print_stats(const std::string &name) const {
  std::cout << "Synapses";
  if (!name.empty())
    std::cout << " [" << name << "]";
  std::cout << ": count=" << active_count() << " avg_w=" << avg_weight()
            << " avg_plasticity=" << avg_plasticity() << "\n";
}
