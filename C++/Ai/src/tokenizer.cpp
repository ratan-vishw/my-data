#include "tokenizer.h"
#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>

namespace fs = std::filesystem;

// ============================================================
// Vocabulary Building
// ============================================================
void Tokenizer::build_from_text(const std::string &text) {
  for (char c : text) {
    add_char(c);
  }
}

void Tokenizer::build_from_file(const std::string &filepath) {
  std::ifstream ifs(filepath);
  if (!ifs) {
    std::cerr << "Warning: Cannot open file for vocab building: " << filepath
              << "\n";
    return;
  }
  std::string content((std::istreambuf_iterator<char>(ifs)),
                      std::istreambuf_iterator<char>());
  build_from_text(content);
}

void Tokenizer::build_from_directory(const std::string &dirpath) {
  if (!fs::exists(dirpath) || !fs::is_directory(dirpath)) {
    std::cerr << "Warning: Directory does not exist: " << dirpath << "\n";
    return;
  }

  int file_count = 0;
  for (const auto &entry : fs::recursive_directory_iterator(dirpath)) {
    if (entry.is_regular_file()) {
      std::string ext = entry.path().extension().string();
      if (ext == ".txt" || ext == ".text" || ext == ".md") {
        build_from_file(entry.path().string());
        file_count++;
      }
    }
  }
  std::cout << "Tokenizer: scanned " << file_count
            << " files, vocab_size=" << vocab_size() << "\n";
}

void Tokenizer::add_char(char c) {
  if (char_to_id.find(c) == char_to_id.end()) {
    char_to_id[c] = next_id;
    id_to_char[next_id] = c;
    next_id++;
  }
}

// ============================================================
// Encoding / Decoding
// ============================================================
std::vector<int> Tokenizer::encode(const std::string &text) const {
  std::vector<int> tokens;
  tokens.reserve(text.size());
  for (char c : text) {
    auto it = char_to_id.find(c);
    if (it != char_to_id.end()) {
      tokens.push_back(it->second);
    } else {
      tokens.push_back(UNK_TOKEN);
    }
  }
  return tokens;
}

std::vector<int> Tokenizer::encode_with_special(const std::string &text) const {
  std::vector<int> tokens;
  tokens.reserve(text.size() + 2);
  tokens.push_back(BOS_TOKEN);
  for (char c : text) {
    auto it = char_to_id.find(c);
    if (it != char_to_id.end()) {
      tokens.push_back(it->second);
    } else {
      tokens.push_back(UNK_TOKEN);
    }
  }
  tokens.push_back(EOS_TOKEN);
  return tokens;
}

std::string Tokenizer::decode(const std::vector<int> &tokens) const {
  std::string result;
  result.reserve(tokens.size());
  for (int tok : tokens) {
    result += decode_token(tok);
  }
  return result;
}

std::string Tokenizer::decode_token(int token) const {
  if (token == PAD_TOKEN)
    return "";
  if (token == UNK_TOKEN)
    return "?";
  if (token == BOS_TOKEN)
    return "";
  if (token == EOS_TOKEN)
    return "";
  auto it = id_to_char.find(token);
  if (it != id_to_char.end()) {
    return std::string(1, it->second);
  }
  return "?";
}

// ============================================================
// Vocabulary Info
// ============================================================
int Tokenizer::vocab_size() const { return next_id; }

bool Tokenizer::has_char(char c) const {
  return char_to_id.find(c) != char_to_id.end();
}

// ============================================================
// Serialization
// ============================================================
void Tokenizer::save(const std::string &path) const {
  std::ofstream ofs(path, std::ios::binary);
  if (!ofs) {
    std::cerr << "Error: Cannot save tokenizer to " << path << "\n";
    return;
  }
  save_stream(ofs);
}

bool Tokenizer::load(const std::string &path) {
  std::ifstream ifs(path, std::ios::binary);
  if (!ifs)
    return false;
  return load_stream(ifs);
}

void Tokenizer::save_stream(std::ostream &os) const {
  os.write(reinterpret_cast<const char *>(&next_id), sizeof(int));
  int map_size = (int)char_to_id.size();
  os.write(reinterpret_cast<const char *>(&map_size), sizeof(int));
  for (const auto &[c, id] : char_to_id) {
    os.write(&c, sizeof(char));
    os.write(reinterpret_cast<const char *>(&id), sizeof(int));
  }
}

bool Tokenizer::load_stream(std::istream &is) {
  is.read(reinterpret_cast<char *>(&next_id), sizeof(int));
  int map_size = 0;
  is.read(reinterpret_cast<char *>(&map_size), sizeof(int));
  if (!is)
    return false;

  char_to_id.clear();
  id_to_char.clear();
  for (int i = 0; i < map_size; ++i) {
    char c;
    int id;
    is.read(&c, sizeof(char));
    is.read(reinterpret_cast<char *>(&id), sizeof(int));
    char_to_id[c] = id;
    id_to_char[id] = c;
  }
  return is.good() || is.eof();
}

// ============================================================
// Debug
// ============================================================
void Tokenizer::print_vocab() const {
  std::cout << "Tokenizer vocab (size=" << vocab_size() << "):\n";
  std::cout << "  0: <PAD>\n  1: <UNK>\n  2: <BOS>\n  3: <EOS>\n";

  // Sort by ID for cleaner output
  std::vector<std::pair<int, char>> sorted;
  for (const auto &[c, id] : char_to_id) {
    sorted.push_back({id, c});
  }
  std::sort(sorted.begin(), sorted.end());

  for (const auto &[id, c] : sorted) {
    if (c == '\n')
      std::cout << "  " << id << ": \\n\n";
    else if (c == '\t')
      std::cout << "  " << id << ": \\t\n";
    else if (c == '\r')
      std::cout << "  " << id << ": \\r\n";
    else if (c == ' ')
      std::cout << "  " << id << ": <space>\n";
    else
      std::cout << "  " << id << ": " << c << "\n";
  }
}
