// Copyright 2025 The Chromium Authors
// Use of this source code is governed by a BSD-style license in LICENSE.
// GetAttribute and bookmark entry extraction adapted from
// components/user_data_importer/content/content_bookmark_parser_utils.cc.

#include "bookmark_html.h"

#include <optional>
#include <stdexcept>
#include <utility>

namespace soulu::chromium_import {
namespace {
std::optional<std::string> GetAttribute(std::string_view attribute_list,
                                        std::string_view attribute) {
  std::string lookup_str = std::string(attribute).append("=\"");
  size_t begin = attribute_list.find(lookup_str);
  if (begin == std::string::npos) {
    return std::nullopt;  // Can't find the attribute.
  }

  begin += lookup_str.size();
  size_t end = begin;
  while (end < attribute_list.size()) {
    if (attribute_list[end] == '"' &&
        (end == begin || attribute_list[end - 1] != '\\')) {
      break;
    }
    end++;
  }

  if (end == attribute_list.size()) {
    return std::nullopt;  // The value is not quoted.
  }

  return std::string(attribute_list.substr(begin, end - begin));
}

std::string UpperAscii(std::string_view value) {
  std::string result(value);
  for (char& c : result) {
    if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 'a' + 'A');
  }
  return result;
}

std::string UnescapeForHtml(std::string_view text) {
  std::string result;
  while (!text.empty()) {
    const auto next = text.find('&');
    result.append(text.substr(0, next));
    if (next == text.npos) break;
    text.remove_prefix(next);
    bool replaced = false;
    for (const auto& entity : {std::pair{"&amp;", '&'}, {"&lt;", '<'},
                               {"&gt;", '>'}, {"&quot;", '"'}, {"&#39;", '\''}}) {
      if (!text.starts_with(entity.first)) continue;
      result.push_back(entity.second);
      text.remove_prefix(std::char_traits<char>::length(entity.first));
      replaced = true;
      break;
    }
    if (!replaced) {
      result.push_back('&');
      text.remove_prefix(1);
    }
  }
  return result;
}
}  // namespace

std::vector<BookmarkHtmlEntry> ParseBookmarkHtml(std::string_view html) {
  const auto upper = UpperAscii(html);
  if (upper.find("NETSCAPE-BOOKMARK-FILE-1") == upper.npos)
    throw std::runtime_error("Expected a Netscape bookmark export");

  std::vector<BookmarkHtmlEntry> roots;
  std::vector<std::vector<BookmarkHtmlEntry>*> lists;
  BookmarkHtmlEntry* pending_folder = nullptr;
  size_t entries = 0;
  for (size_t at = 0; (at = upper.find('<', at)) != upper.npos;) {
    const std::string_view token(upper.data() + at, upper.size() - at);
    if (token.starts_with("<!--")) {
      const auto close = upper.find("-->", at + 4);
      if (close == upper.npos) break;
      at = close + 3;
      continue;
    }
    auto end = at + 1;
    char quote = 0;
    for (; end < html.size(); ++end) {
      const char c = html[end];
      if (quote) {
        if (c == quote) quote = 0;
      } else if (c == '"' || c == '\'') {
        quote = c;
      } else if (c == '>') {
        break;
      }
    }
    if (end == html.size()) break;
    const auto tag = token.substr(1, token.find_first_of(" >\t\r\n") - 1);
    const size_t start = at;
    at = end + 1;
    if (tag == "DL") {
      if (lists.size() >= 65) throw std::runtime_error("Bookmarks nesting exceeds 64");
      lists.push_back(pending_folder ? &pending_folder->children
                                    : lists.empty() ? &roots : lists.back());
      pending_folder = nullptr;
    } else if (tag == "/DL") {
      if (!lists.empty()) lists.pop_back();
      pending_folder = nullptr;
    } else if ((tag == "H3" || tag == "A") && !lists.empty()) {
      const bool folder = tag == "H3";
      const auto close = upper.find(folder ? "</H3>" : "</A>", at);
      if (close == upper.npos || upper.find('<', at) < close) continue;
      if (++entries > 20000) throw std::runtime_error("Too many bookmarks");
      BookmarkHtmlEntry entry;
      entry.folder = folder;
      entry.title = UnescapeForHtml(html.substr(at, close - at));
      at = close + (folder ? 5 : 4);
      if (!folder) {
        const auto attrs = html.substr(start + 2, end - start - 2);
        auto href = GetAttribute(attrs, "HREF");
        if (!href) href = GetAttribute(attrs, "href");
        if (!href) continue;
        entry.url = UnescapeForHtml(*href);
        entry.icon = GetAttribute(attrs, "ICON").value_or("");
      }
      auto& stored = lists.back()->emplace_back(std::move(entry));
      pending_folder = folder ? &stored : nullptr;
    }
  }
  if (!entries) throw std::runtime_error("The export contains no bookmarks");
  return roots;
}
}  // namespace soulu::chromium_import
