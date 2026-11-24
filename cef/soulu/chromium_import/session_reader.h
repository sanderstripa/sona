#pragma once

#include <atomic>
#include <string>
#include <string_view>
#include <vector>

namespace soulu::chromium_import {
std::vector<std::string> ReplaySession(std::string_view bytes,
    const std::atomic<bool>& cancelled, std::atomic<int>& processed);
}
