#ifndef TOKENIZER_H
#define TOKENIZER_H

#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

/**
 * Tokenizer — Character-level tokenizer for the LLM.
 *
 * Maps each unique character to an integer ID.
 * Simple, fast, no training required — just scans data.
 *
 * Special tokens:
 *   0 = <PAD>
 *   1 = <UNK>
 *   2 = <BOS> (beginning of sequence)
 *   3 = <EOS> (end of sequence)
 */
class Tokenizer {
public:
  static constexpr int PAD_TOKEN = 0;
  static constexpr int UNK_TOKEN = 1;
  static constexpr int BOS_TOKEN = 2;
  static constexpr int EOS_TOKEN = 3;
  static constexpr int SPECIAL_TOKENS = 4;

  Tokenizer() = default;

  // --- Vocabulary building ---

  // Build vocabulary from a string of text
  void build_from_text(const std::string &text);

  // Build vocabulary from a text file
  void build_from_file(const std::string &filepath);

  // Build vocabulary from all .txt files in a directory
  void build_from_directory(const std::string &dirpath);

  // Add a single character to vocabulary (if not present)
  void add_char(char c);

  // --- Encoding / Decoding ---

  // Encode a string to token IDs
  std::vector<int> encode(const std::string &text) const;

  // Encode with BOS and EOS tokens
  std::vector<int> encode_with_special(const std::string &text) const;

  // Decode token IDs to string
  std::string decode(const std::vector<int> &tokens) const;

  // Decode a single token
  std::string decode_token(int token) const;

  // --- Vocabulary info ---
  int vocab_size() const;
  bool has_char(char c) const;

  // --- Serialization ---
  void save(const std::string &path) const;
  bool load(const std::string &path);
  void save_stream(std::ostream &os) const;
  bool load_stream(std::istream &is);

  // --- Debug ---
  void print_vocab() const;

private:
  std::unordered_map<char, int> char_to_id;
  std::unordered_map<int, char> id_to_char;
  int next_id = SPECIAL_TOKENS;
};

#endif // TOKENIZER_H
