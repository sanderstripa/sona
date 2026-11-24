// Copyright 2026 The Chromium Authors
// Use of this source code is governed by a BSD-style license in LICENSE.
// CEF adapter for the unencrypted command framing and navigation replay in
// components/sessions/core/command_storage_backend.cc and session_service_commands.cc.
#include "session_reader.h"

#include <algorithm>
#include <climits>
#include <cstdint>
#include <iterator>
#include <map>
#include <set>
#include <stdexcept>
#include <tuple>
#include <utility>

namespace soulu::chromium_import {
namespace {
uint32_t U32(std::string_view bytes, size_t offset) {
  if (offset > bytes.size() || bytes.size() - offset < 4)
    throw std::runtime_error("Invalid session record");
  uint32_t value = 0;
  for (unsigned byte = 0; byte < 4; ++byte)
    value |= static_cast<uint32_t>(static_cast<unsigned char>(bytes[offset + byte])) << (byte * 8);
  return value;
}
}

std::vector<std::string> ReplaySession(std::string_view bytes,
    const std::atomic<bool>& cancelled, std::atomic<int>& processed) {
  if (bytes.size() < 8 || !bytes.starts_with("SNSS"))
    throw std::runtime_error("Invalid Chromium session");
  const auto version = U32(bytes, 4);
  if (version != 1 && version != 3)
    throw std::runtime_error("Encrypted or unsupported session: use an HTML export");

  struct Tab {
    int window = 0;
    int index = 0;
    int selected = -1;
    std::map<int, std::string> urls;
  };
  std::map<int, Tab> tabs;
  std::map<int, int> windows;
  std::set<int> closed;
  bool marker = version == 1;
  for (size_t offset = 8; offset < bytes.size();) {
    if (cancelled) return {};
    ++processed;

    if (bytes.size() - offset < 3)
      throw std::runtime_error("Truncated session command");
    const size_t size = static_cast<unsigned char>(bytes[offset]) |
                        (static_cast<unsigned char>(bytes[offset + 1]) << 8);
    offset += 2;
    if (!size || size > bytes.size() - offset)
      throw std::runtime_error("Invalid session command length");
    const auto command = static_cast<unsigned char>(bytes[offset]);
    const auto payload = bytes.substr(offset + 1, size - 1);
    offset += size;
    const auto read = [&](size_t at) { return static_cast<int>(U32(payload, at)); };

    switch (command) {
      case 255: marker = true; break;
      case 0: tabs[read(4)].window = read(0); break;
      case 2: tabs[read(0)].index = read(4); break;
      case 7: tabs[read(0)].selected = read(4); break;
      case 9: windows[read(0)] = read(4); break;
      case 16: tabs.erase(read(0)); break;
      case 17: closed.insert(read(0)); break;
      case 6: {
        if (payload.size() < 16 || U32(payload, 0) != payload.size() - 4)
          throw std::runtime_error("Invalid navigation pickle");
        const auto length = U32(payload, 12);
        if (length > payload.size() - 16 || length > 65536)
          throw std::runtime_error("Invalid navigation URL");
        tabs[read(4)].urls[read(8)] = std::string(payload.substr(16, length));
        break;
      }
      case 5: {
        auto& urls = tabs[read(0)].urls;
        urls.erase(urls.lower_bound(read(4)), urls.end());
        break;
      }
      case 11:
      case 24: {
        auto& tab = tabs[read(0)];
        const int index = command == 11 ? 0 : read(4);
        const int count = read(command == 11 ? 4 : 8);
        if (index < 0 || count <= 0 || index > INT_MAX - count)
          throw std::runtime_error("Invalid session navigation range");
        const int end = index + count;
        if (tab.selected >= index && tab.selected < end)
          tab.selected = index - 1;
        else if (tab.selected >= end)
          tab.selected -= count;
        tab.urls.erase(tab.urls.lower_bound(index), tab.urls.lower_bound(end));
        for (auto it = tab.urls.lower_bound(end); it != tab.urls.end();) {
          auto entry = tab.urls.extract(it++);
          entry.key() -= count;
          tab.urls.insert(std::move(entry));
        }
        break;
      }
      default: break;
    }
    if (tabs.size() > 10000)
      throw std::runtime_error("Oversized session");
  }
  if (!marker) throw std::runtime_error("Incomplete session snapshot");

  std::vector<const Tab*> ordered;
  for (const auto& item : tabs) {
    const auto& tab = item.second;
    const auto window = windows.find(tab.window);
    if (!closed.contains(tab.window) && window != windows.end() &&
        window->second == 0 && !tab.urls.empty())
      ordered.push_back(&tab);
  }
  std::stable_sort(ordered.begin(), ordered.end(), [](const Tab* left, const Tab* right) {
    return std::tie(left->window, left->index) < std::tie(right->window, right->index);
  });
  std::vector<std::string> result;
  for (const auto* tab : ordered) {
    auto selected = tab->urls.lower_bound(tab->selected);
    if (selected == tab->urls.end()) selected = std::prev(tab->urls.end());
    result.push_back(selected->second);
  }
  return result;
}

}  // namespace soulu::chromium_import
