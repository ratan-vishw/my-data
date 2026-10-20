#ifndef MEMORY_H
#define MEMORY_H

#include <ctime>
#include <string>
#include <unordered_map>
#include <vector>

/**
 * MemoryEntry — A single memory item.
 */
struct MemoryEntry {
  std::string key;         // Summary/keyword
  std::string content;     // Full content
  float importance = 1.0f; // How important (decays over time)
  int access_count = 0;    // How often accessed
  time_t created_at = 0;
  time_t last_accessed = 0;
};

/**
 * Episode — A single conversation episode.
 */
struct Episode {
  std::string user_input;
  std::string model_response;
  time_t timestamp = 0;
  int episode_id = 0;
};

/**
 * MemorySystem — Persistent memory for the chat interface.
 *
 * Features:
 * - Long-term memory: key-value store of facts/associations
 * - Episodic memory: conversation history
 * - Context retrieval: find relevant memories for current input
 * - Memory consolidation: merge similar memories
 */
class MemorySystem {
public:
  std::vector<MemoryEntry> long_term;
  std::vector<Episode> episodes;

  int max_long_term = 10000;
  int max_episodes = 1000;
  float similarity_threshold = 0.3f;
  int next_episode_id = 0;

  // Paths
  std::string lt_dir; // Long-term memory directory
  std::string ep_dir; // Episodic memory directory

  MemorySystem() = default;
  MemorySystem(const std::string &lt_dir, const std::string &ep_dir,
               int max_lt = 10000, int max_ep = 1000);

  // --- Long-term memory ---
  void store(const std::string &key, const std::string &content,
             float importance = 1.0f);
  std::string recall(const std::string &key);
  std::vector<MemoryEntry> search(const std::string &query, int top_k = 5);

  // --- Episodic memory ---
  void store_episode(const std::string &user_input,
                     const std::string &model_response);
  std::vector<Episode> recent_episodes(int count = 10);

  // --- Context building ---
  // Build a context string from relevant memories for the current input
  std::string build_context(const std::string &current_input,
                            int max_context_chars = 500);

  // --- Consolidation ---
  void consolidate(); // Merge similar memories, decay importance

  // --- Persistence ---
  void save();
  void load();

  // --- Info ---
  void print_stats() const;

private:
  // Simple word-overlap similarity
  float compute_similarity(const std::string &a, const std::string &b) const;
  std::vector<std::string> tokenize_words(const std::string &text) const;
};

#endif // MEMORY_H
