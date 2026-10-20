#include "memory.h"
#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <set>
#include <sstream>

namespace fs = std::filesystem;

// ============================================================
// Constructor
// ============================================================
MemorySystem::MemorySystem(const std::string &lt_dir, const std::string &ep_dir,
                           int max_lt, int max_ep)
    : lt_dir(lt_dir), ep_dir(ep_dir), max_long_term(max_lt),
      max_episodes(max_ep) {
  fs::create_directories(lt_dir);
  fs::create_directories(ep_dir);
}

// ============================================================
// Long-term Memory
// ============================================================
void MemorySystem::store(const std::string &key, const std::string &content,
                         float importance) {
  // Check if key already exists
  for (auto &entry : long_term) {
    if (entry.key == key) {
      entry.content = content;
      entry.importance = std::max(entry.importance, importance);
      entry.access_count++;
      entry.last_accessed = std::time(nullptr);
      return;
    }
  }

  // Add new entry
  MemoryEntry entry;
  entry.key = key;
  entry.content = content;
  entry.importance = importance;
  entry.access_count = 1;
  entry.created_at = std::time(nullptr);
  entry.last_accessed = entry.created_at;
  long_term.push_back(entry);

  // Evict if over limit
  if ((int)long_term.size() > max_long_term) {
    // Remove least important
    auto min_it =
        std::min_element(long_term.begin(), long_term.end(),
                         [](const MemoryEntry &a, const MemoryEntry &b) {
                           return a.importance < b.importance;
                         });
    long_term.erase(min_it);
  }
}

std::string MemorySystem::recall(const std::string &key) {
  for (auto &entry : long_term) {
    if (entry.key == key) {
      entry.access_count++;
      entry.last_accessed = std::time(nullptr);
      entry.importance *= 1.1f; // Boost importance on access
      return entry.content;
    }
  }
  return "";
}

std::vector<MemoryEntry> MemorySystem::search(const std::string &query,
                                              int top_k) {
  std::vector<std::pair<float, int>> scores;
  for (int i = 0; i < (int)long_term.size(); ++i) {
    float sim = compute_similarity(query, long_term[i].key + " " +
                                              long_term[i].content);
    if (sim > similarity_threshold) {
      scores.push_back({sim * long_term[i].importance, i});
    }
  }

  std::sort(scores.begin(), scores.end(),
            [](const auto &a, const auto &b) { return a.first > b.first; });

  std::vector<MemoryEntry> results;
  for (int i = 0; i < std::min(top_k, (int)scores.size()); ++i) {
    results.push_back(long_term[scores[i].second]);
  }
  return results;
}

// ============================================================
// Episodic Memory
// ============================================================
void MemorySystem::store_episode(const std::string &user_input,
                                 const std::string &model_response) {
  Episode ep;
  ep.user_input = user_input;
  ep.model_response = model_response;
  ep.timestamp = std::time(nullptr);
  ep.episode_id = next_episode_id++;
  episodes.push_back(ep);

  // Evict old episodes
  while ((int)episodes.size() > max_episodes) {
    episodes.erase(episodes.begin());
  }
}

std::vector<Episode> MemorySystem::recent_episodes(int count) {
  int start = std::max(0, (int)episodes.size() - count);
  return std::vector<Episode>(episodes.begin() + start, episodes.end());
}

// ============================================================
// Context Building
// ============================================================
std::string MemorySystem::build_context(const std::string &current_input,
                                        int max_context_chars) {
  std::string context;

  // 1. Recent conversation history
  auto recent = recent_episodes(3);
  for (const auto &ep : recent) {
    std::string entry =
        "User: " + ep.user_input + "\nAssistant: " + ep.model_response + "\n";
    if ((int)(context.size() + entry.size()) < max_context_chars) {
      context += entry;
    }
  }

  // 2. Relevant long-term memories
  auto memories = search(current_input, 3);
  for (const auto &mem : memories) {
    std::string entry = "[Memory: " + mem.key + "] " + mem.content + "\n";
    if ((int)(context.size() + entry.size()) < max_context_chars) {
      context += entry;
    }
  }

  return context;
}

// ============================================================
// Consolidation
// ============================================================
void MemorySystem::consolidate() {
  // Decay importance over time
  time_t now = std::time(nullptr);
  for (auto &entry : long_term) {
    double hours_since_access =
        std::difftime(now, entry.last_accessed) / 3600.0;
    if (hours_since_access > 24.0) {
      entry.importance *= 0.99f;
    }
  }

  // Remove very low importance memories
  long_term.erase(
      std::remove_if(long_term.begin(), long_term.end(),
                     [](const MemoryEntry &e) { return e.importance < 0.01f; }),
      long_term.end());
}

// ============================================================
// Persistence
// ============================================================
void MemorySystem::save() {
  // Save long-term memories
  {
    std::string path = lt_dir + "/memories.bin";
    std::ofstream ofs(path, std::ios::binary);
    if (ofs) {
      int count = (int)long_term.size();
      ofs.write(reinterpret_cast<const char *>(&count), sizeof(int));
      for (const auto &entry : long_term) {
        int klen = (int)entry.key.size();
        int clen = (int)entry.content.size();
        ofs.write(reinterpret_cast<const char *>(&klen), sizeof(int));
        ofs.write(entry.key.data(), klen);
        ofs.write(reinterpret_cast<const char *>(&clen), sizeof(int));
        ofs.write(entry.content.data(), clen);
        ofs.write(reinterpret_cast<const char *>(&entry.importance),
                  sizeof(float));
        ofs.write(reinterpret_cast<const char *>(&entry.access_count),
                  sizeof(int));
        ofs.write(reinterpret_cast<const char *>(&entry.created_at),
                  sizeof(time_t));
        ofs.write(reinterpret_cast<const char *>(&entry.last_accessed),
                  sizeof(time_t));
      }
    }
  }

  // Save episodes
  {
    std::string path = ep_dir + "/episodes.bin";
    std::ofstream ofs(path, std::ios::binary);
    if (ofs) {
      int count = (int)episodes.size();
      ofs.write(reinterpret_cast<const char *>(&count), sizeof(int));
      ofs.write(reinterpret_cast<const char *>(&next_episode_id), sizeof(int));
      for (const auto &ep : episodes) {
        int ulen = (int)ep.user_input.size();
        int rlen = (int)ep.model_response.size();
        ofs.write(reinterpret_cast<const char *>(&ulen), sizeof(int));
        ofs.write(ep.user_input.data(), ulen);
        ofs.write(reinterpret_cast<const char *>(&rlen), sizeof(int));
        ofs.write(ep.model_response.data(), rlen);
        ofs.write(reinterpret_cast<const char *>(&ep.timestamp),
                  sizeof(time_t));
        ofs.write(reinterpret_cast<const char *>(&ep.episode_id), sizeof(int));
      }
    }
  }
}

void MemorySystem::load() {
  // Load long-term memories
  {
    std::string path = lt_dir + "/memories.bin";
    std::ifstream ifs(path, std::ios::binary);
    if (ifs) {
      int count = 0;
      ifs.read(reinterpret_cast<char *>(&count), sizeof(int));
      long_term.resize(count);
      for (auto &entry : long_term) {
        int klen = 0, clen = 0;
        ifs.read(reinterpret_cast<char *>(&klen), sizeof(int));
        entry.key.resize(klen);
        ifs.read(&entry.key[0], klen);
        ifs.read(reinterpret_cast<char *>(&clen), sizeof(int));
        entry.content.resize(clen);
        ifs.read(&entry.content[0], clen);
        ifs.read(reinterpret_cast<char *>(&entry.importance), sizeof(float));
        ifs.read(reinterpret_cast<char *>(&entry.access_count), sizeof(int));
        ifs.read(reinterpret_cast<char *>(&entry.created_at), sizeof(time_t));
        ifs.read(reinterpret_cast<char *>(&entry.last_accessed),
                 sizeof(time_t));
      }
      std::cout << "Loaded " << count << " long-term memories.\n";
    }
  }

  // Load episodes
  {
    std::string path = ep_dir + "/episodes.bin";
    std::ifstream ifs(path, std::ios::binary);
    if (ifs) {
      int count = 0;
      ifs.read(reinterpret_cast<char *>(&count), sizeof(int));
      ifs.read(reinterpret_cast<char *>(&next_episode_id), sizeof(int));
      episodes.resize(count);
      for (auto &ep : episodes) {
        int ulen = 0, rlen = 0;
        ifs.read(reinterpret_cast<char *>(&ulen), sizeof(int));
        ep.user_input.resize(ulen);
        ifs.read(&ep.user_input[0], ulen);
        ifs.read(reinterpret_cast<char *>(&rlen), sizeof(int));
        ep.model_response.resize(rlen);
        ifs.read(&ep.model_response[0], rlen);
        ifs.read(reinterpret_cast<char *>(&ep.timestamp), sizeof(time_t));
        ifs.read(reinterpret_cast<char *>(&ep.episode_id), sizeof(int));
      }
      std::cout << "Loaded " << count << " conversation episodes.\n";
    }
  }
}

// ============================================================
// Similarity
// ============================================================
std::vector<std::string>
MemorySystem::tokenize_words(const std::string &text) const {
  std::vector<std::string> words;
  std::string word;
  for (char c : text) {
    if (std::isalpha(c)) {
      word += std::tolower(c);
    } else {
      if (!word.empty()) {
        words.push_back(word);
        word.clear();
      }
    }
  }
  if (!word.empty())
    words.push_back(word);
  return words;
}

float MemorySystem::compute_similarity(const std::string &a,
                                       const std::string &b) const {
  auto words_a = tokenize_words(a);
  auto words_b = tokenize_words(b);
  if (words_a.empty() || words_b.empty())
    return 0.0f;

  std::set<std::string> set_a(words_a.begin(), words_a.end());
  std::set<std::string> set_b(words_b.begin(), words_b.end());

  int intersection = 0;
  for (const auto &w : set_a) {
    if (set_b.count(w))
      intersection++;
  }

  int union_size = (int)set_a.size() + (int)set_b.size() - intersection;
  return union_size > 0 ? (float)intersection / (float)union_size : 0.0f;
}

// ============================================================
// Info
// ============================================================
void MemorySystem::print_stats() const {
  std::cout << "Memory: " << long_term.size() << " long-term, "
            << episodes.size() << " episodes\n";
}
