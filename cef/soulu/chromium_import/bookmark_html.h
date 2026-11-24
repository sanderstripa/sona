// Copyright 2025 The Chromium Authors
// Adapted for the Sona CEF import module. See LICENSE.
#pragma once

#include <string>
#include <string_view>
#include <vector>

namespace soulu::chromium_import {
struct BookmarkHtmlEntry {
  std::string title;
  std::string url;
  std::string icon;
  std::vector<BookmarkHtmlEntry> children;
  bool folder = false;
};

std::vector<BookmarkHtmlEntry> ParseBookmarkHtml(std::string_view html);
}  // namespace soulu::chromium_import
