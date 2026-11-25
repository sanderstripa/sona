#include "examples/soulu/settings_overlay.h"
#include "examples/soulu/motion.h"
#include <dwmapi.h>
#include <windowsx.h>
#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstdint>
#include <vector>

namespace soulu {
namespace {
constexpr int kSettingsSlideMs = 360;

int ShadowRadius(HWND owner) {
  return std::max(1, MulDiv(22, GetDpiForWindow(owner), 96));
}

ULONGLONG MotionNow() {
  return static_cast<ULONGLONG>(std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count());
}
HBITMAP CreateSurface(HDC dc, int width, int height, uint32_t** pixels) {
  BITMAPINFO info{};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  void* buffer = nullptr;
  HBITMAP bitmap = CreateDIBSection(dc, &info, DIB_RGB_COLORS, &buffer, nullptr, 0);
  *pixels = static_cast<uint32_t*>(buffer);
  return bitmap;
}

void BlurLines(const uint32_t* source, uint32_t* target,
               int length, int lines, int stride, int step, int radius) {
  for (int line = 0; line < lines; ++line) {
    auto src = source + line * step;
    auto dst = target + line * step;
    int blue = 0, green = 0, red = 0;
    auto add = [&](int x, int sign) {
      const auto pixel = src[std::clamp(x, 0, length - 1) * stride];
      blue += sign * static_cast<int>(pixel & 255);
      green += sign * static_cast<int>((pixel >> 8) & 255);
      red += sign * static_cast<int>((pixel >> 16) & 255);
    };
    for (int x = -radius; x <= radius; ++x) add(x, 1);
    const int samples = 2 * radius + 1;
    for (int x = 0; x < length; ++x) {
      dst[x * stride] = (red / samples << 16) | (green / samples << 8) | (blue / samples);
      add(x - radius, -1);
      add(x + radius + 1, 1);
    }
  }
}
}

SettingsOverlay::SettingsOverlay(HWND owner, std::function<void()> closed,
    std::function<void()> request_close)
    : owner_(owner), closed_(std::move(closed)), request_close_(std::move(request_close)) {}
SettingsOverlay::~SettingsOverlay() {
  if (IsWindow(hwnd_)) DestroyWindow(hwnd_);
  if (frame_dc_) {
    if (frame_bitmap_) {
      SelectObject(frame_dc_, frame_original_);
      DeleteObject(frame_bitmap_);
    }
    DeleteDC(frame_dc_);
  }
  if (backdrop_cache_) {
    SelectObject(backdrop_cache_, backdrop_original_);
    DeleteDC(backdrop_cache_);
    DeleteObject(backdrop_frame_);
  }
  if (backdrop_) DeleteObject(backdrop_);
  if (shadow_) DeleteObject(shadow_);
}
void SettingsOverlay::CaptureBackground() {
  RECT bounds{};
  GetClientRect(owner_, &bounds);
  const int width = bounds.right, height = bounds.bottom;
  if (width <= 0 || height <= 0) return;
  POINT origin{};
  ClientToScreen(owner_, &origin);
  HDC screen = GetDC(nullptr);
  if (!screen) return;
  HDC memory = CreateCompatibleDC(screen);
  backdrop_width_ = std::max(1, width / 2);
  backdrop_height_ = std::max(1, height / 2);
  if (memory) {
    uint32_t* pixels = nullptr;
    backdrop_ = CreateSurface(screen, backdrop_width_, backdrop_height_, &pixels);
    if (backdrop_) {
      HGDIOBJ previous = SelectObject(memory, backdrop_);
      SetStretchBltMode(memory, HALFTONE);
      SetBrushOrgEx(memory, 0, 0, nullptr);
      const BOOL copied = StretchBlt(memory, 0, 0, backdrop_width_, backdrop_height_,
          screen, origin.x, origin.y, width, height, SRCCOPY);
      GdiFlush();
      SelectObject(memory, previous);
      if (copied) {
        const int radius = std::max(1, MulDiv(7, GetDpiForWindow(owner_), 96));
        std::vector<uint32_t> horizontal(static_cast<size_t>(backdrop_width_) * backdrop_height_);
        for (int pass = 0; pass < 2; ++pass) {
          BlurLines(pixels, horizontal.data(), backdrop_width_, backdrop_height_, 1, backdrop_width_, radius);
          BlurLines(horizontal.data(), pixels, backdrop_height_, backdrop_width_, backdrop_width_, 1, radius);
        }
      } else {
        DeleteObject(backdrop_);
        backdrop_ = nullptr;
      }
    }
    DeleteDC(memory);
  }
  ReleaseDC(nullptr, screen);
}
void SettingsOverlay::PaintBackdrop(HDC dc, const RECT& dirty) {
  if (backdrop_ && (width_ != cached_width_ || height_ != cached_height_)) {
    HDC source = CreateCompatibleDC(dc);
    HDC cache = CreateCompatibleDC(dc);
    HBITMAP frame = cache ? CreateCompatibleBitmap(dc, width_, height_) : nullptr;
    if (source && frame) {
      const auto previous = SelectObject(source, backdrop_);
      const auto original = SelectObject(cache, frame);
      SetStretchBltMode(cache, HALFTONE);
      SetBrushOrgEx(cache, 0, 0, nullptr);
      if (StretchBlt(cache, 0, 0, width_, height_, source, 0, 0,
                     backdrop_width_, backdrop_height_, SRCCOPY)) {
        if (backdrop_cache_) {
          SelectObject(backdrop_cache_, backdrop_original_);
          DeleteDC(backdrop_cache_);
          DeleteObject(backdrop_frame_);
        }
        backdrop_cache_ = cache;
        backdrop_frame_ = frame;
        backdrop_original_ = original;
        cached_width_ = width_;
        cached_height_ = height_;
        cache = nullptr;
        frame = nullptr;
      } else {
        SelectObject(cache, original);
      }
      SelectObject(source, previous);
    }
    if (source) DeleteDC(source);
    if (cache) DeleteDC(cache);
    if (frame) DeleteObject(frame);
  }
  if (cached_width_ == width_ && cached_height_ == height_) {
    BitBlt(dc, dirty.left, dirty.top, dirty.right - dirty.left,
           dirty.bottom - dirty.top, backdrop_cache_, dirty.left, dirty.top, SRCCOPY);
  } else {
    FillRect(dc, &dirty, GetSysColorBrush(COLOR_WINDOW));
  }
}

void SettingsOverlay::PaintPanelShadow(HDC dc) {
  if (!browser_ || state_ == State::Loading) return;
  const int radius = ShadowRadius(owner_);
  if (panel_y_ + panel_height_ + radius + radius / 4 <= 0) return;
  const int width = panel_width_ + 2 * radius;
  const int height = panel_height_ + 2 * radius;
  if (!shadow_ || shadow_panel_width_ != panel_width_ || shadow_radius_ != radius ||
      shadow_panel_height_ != panel_height_) {
    if (shadow_) DeleteObject(shadow_);
    uint32_t* pixels = nullptr;
    shadow_ = CreateSurface(dc, width, height, &pixels);
    if (!shadow_) return;
    shadow_panel_width_ = panel_width_;
    shadow_panel_height_ = panel_height_;
    shadow_radius_ = radius;
    const int corner = MulDiv(12, GetDpiForWindow(owner_), 96);
    for (int y = 0; y < height; ++y) {
      const int dy = std::max({radius - y, y - (radius + panel_height_ - corner), 0});
      for (int x = 0; x < width; ++x) {
        const int inset = y > radius + panel_height_ - corner ? corner : 0;
        const int dx = std::max({radius + inset - x, x - (radius + panel_width_ - inset), 0});
        const float edge_distance = dx && dy ? std::hypot(float(dx), float(dy))
                                              : static_cast<float>(std::max(dx, dy));
        const float distance = std::max(0.f, edge_distance - inset);
        const float strength = std::max(0.f, 1.f - distance / radius);
        pixels[y * width + x] = static_cast<uint32_t>(76 * strength * strength) << 24;
      }
    }
  }
  const int x = (width_ - width) / 2;
  const int y = panel_y_ - radius + radius / 4;
  const RECT shadow_bounds{x, y, x + width, y + height};
  RECT clip{}, dirty{};
  if (GetClipBox(dc, &clip) == ERROR || !IntersectRect(&dirty, &clip, &shadow_bounds)) return;
  if (HDC memory = CreateCompatibleDC(dc)) {
    HGDIOBJ previous = SelectObject(memory, shadow_);
    const BLENDFUNCTION alpha{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    const int dirty_width = dirty.right - dirty.left;
    const int dirty_height = dirty.bottom - dirty.top;
    AlphaBlend(dc, dirty.left, dirty.top, dirty_width, dirty_height, memory,
               dirty.left - x, dirty.top - y, dirty_width, dirty_height, alpha);
    SelectObject(memory, previous);
    DeleteDC(memory);
  }
}

void SettingsOverlay::PaintFrame(HDC target, const RECT& dirty) {
  if (!frame_dc_) frame_dc_ = CreateCompatibleDC(target);
  if (frame_dc_ && (frame_width_ != width_ || frame_height_ != height_)) {
    if (HBITMAP next = CreateCompatibleBitmap(target, width_, height_)) {
      const HGDIOBJ previous = SelectObject(frame_dc_, next);
      if (previous) {
        if (frame_bitmap_) DeleteObject(frame_bitmap_);
        else frame_original_ = previous;
        frame_bitmap_ = next;
        frame_width_ = width_;
        frame_height_ = height_;
      } else {
        DeleteObject(next);
      }
    }
  }
  if (frame_width_ != width_ || frame_height_ != height_) {
    PaintBackdrop(target, dirty);
    PaintPanelShadow(target);
    return;
  }
  // Present the blur and shadow together in the same update.
  PaintBackdrop(frame_dc_, dirty);
  if (const int saved = SaveDC(frame_dc_)) {
    IntersectClipRect(frame_dc_, dirty.left, dirty.top, dirty.right, dirty.bottom);
    PaintPanelShadow(frame_dc_);
    RestoreDC(frame_dc_, saved);
  } else {
    PaintPanelShadow(frame_dc_);
  }
  BitBlt(target, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top,
         frame_dc_, dirty.left, dirty.top, SRCCOPY);
}

bool SettingsOverlay::Create() {
  CaptureBackground();
  WNDCLASSEXW wc = {sizeof(wc)};
  wc.lpfnWndProc = Proc; wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"SouluSettingsOverlay";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassExW(&wc);
  hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW,
      wc.lpszClassName, L"Sona Preview Settings", WS_POPUP | WS_CLIPCHILDREN,
      0, 0, 1, 1, owner_, nullptr, wc.hInstance, this);
  if (!hwnd_) return false;
  // The owner supplies the external silhouette, including the desktop shadow.
  const DWORD corners = 1; // DWMWCP_DONOTROUND
  DwmSetWindowAttribute(hwnd_, 33, &corners, sizeof(corners));
  const auto non_client = DWMNCRP_DISABLED;
  DwmSetWindowAttribute(hwnd_, DWMWA_NCRENDERING_POLICY, &non_client, sizeof(non_client));
  const BOOL disable_dwm_transitions = TRUE;
  DwmSetWindowAttribute(hwnd_, DWMWA_TRANSITIONS_FORCEDISABLED,
                        &disable_dwm_transitions, sizeof(disable_dwm_transitions));
  BOOL animate = TRUE;
  if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animate, 0)) reduced_ = !animate;
  duration_ = reduced_ ? motion::kReducedOverlayMs : kSettingsSlideMs;
  Layout();
  // The invisible panel starts above the clipping bounds. Showing the host now
  // blocks input immediately and allows Chromium to prepare its first frame.
  return true;
}
void SettingsOverlay::Attach(HWND browser) {
  browser_ = browser;
  if (closing()) return;
  Layout();
}
void SettingsOverlay::Open() {
  if (state_ != State::Loading) { Focus(); return; }
  state_ = State::Opening; start_ = MotionNow();
  if (!SetTimer(hwnd_, 1, 16, nullptr)) start_ -= duration_;
  Tick();
}
void SettingsOverlay::Close() {
  if (state_ == State::Closing || state_ == State::Closed) return;
  state_ = State::Closing; close_start_ = progress_; start_ = MotionNow();
  if (!SetTimer(hwnd_, 1, 16, nullptr)) start_ -= duration_;
  Tick();
}
void SettingsOverlay::Focus() {
  if (!browser_ || !IsWindowVisible(hwnd_) || closing()) return;
  const HWND focused = GetFocus();
  if (focused != browser_ && !IsChild(browser_, focused)) SetFocus(browser_);
}
void SettingsOverlay::SetPanelHeight(int height) {
  if(state_==State::Closing||state_==State::Closed)return;
  const int next = std::clamp(height, 160, 800);
  if (next == requested_height_) return;
  // Resize CEF once before the renderer animates the new section.
  requested_height_ = next;
  Layout();
}
void SettingsOverlay::Layout() {
  if (!hwnd_ || state_ == State::Closed) return;
  RECT r = {}; GetClientRect(owner_, &r);
  POINT p = {0, 0}; ClientToScreen(owner_, &p);
  width_ = std::max(1L, r.right); height_ = std::max(1L, r.bottom);
  const float scale = GetDpiForWindow(owner_) / 96.f;
  panel_width_ = std::min(width_, static_cast<int>(std::round(1020 * scale)));
  panel_height_ = std::min(height_, static_cast<int>(std::round(requested_height_ * scale)));
  RECT actual{}; GetWindowRect(hwnd_, &actual);
  if (actual.left != p.x || actual.top != p.y || actual.right-actual.left != width_ || actual.bottom-actual.top != height_) {
    SetWindowPos(hwnd_, HWND_TOP, p.x, p.y, width_, height_, SWP_NOACTIVATE | SWP_NOCOPYBITS);
    InvalidateRect(hwnd_, nullptr, FALSE);
  }
  // Crop to the owner's client region, including its rounded normal-window
  // silhouette. No independent desktop-relative geometry is persisted.
  const int radius = IsZoomed(owner_) ? 0 : static_cast<int>(std::round(16 * scale));
  if (width_ != region_width_ || height_ != region_height_ || radius != region_radius_) {
    HRGN region = radius ? CreateRoundRectRgn(0, 0, width_+1, height_+1, radius, radius)
                        : CreateRectRgn(0, 0, width_, height_);
    if (region && SetWindowRgn(hwnd_, region, FALSE)) {
      region_width_ = width_;
      region_height_ = height_;
      region_radius_ = radius;
    } else if (region) {
      DeleteObject(region);
    }
  }
  const bool should_show = !IsIconic(owner_);
  if (should_show != (IsWindowVisible(hwnd_) != FALSE))
    ShowWindow(hwnd_, should_show ? SW_SHOWNOACTIVATE : SW_HIDE);
  ClipPanel();
  PlacePanel();
}
void SettingsOverlay::ClipPanel() {
  if (browser_) {
    const float scale=GetDpiForWindow(owner_)/96.f;
    const int corner = static_cast<int>(std::round(24 * scale));
    if (panel_width_ == clip_width_ && panel_height_ == clip_height_ && corner == clip_corner_) return;
    HRGN panel = CreateRoundRectRgn(0, 0, panel_width_+1, panel_height_+1, corner, corner);
    HRGN top = CreateRectRgn(0, 0, panel_width_, std::min(corner, panel_height_));
    if (panel && top) CombineRgn(panel, panel, top, RGN_OR);
    if (top) DeleteObject(top);
    if (panel && SetWindowRgn(browser_, panel, FALSE)) {
      clip_width_ = panel_width_;
      clip_height_ = panel_height_;
      clip_corner_ = corner;
    } else if (panel) {
      DeleteObject(panel);
    }
  }
}
void SettingsOverlay::PlacePanel() {
  if (!browser_) return;
  const int radius = ShadowRadius(owner_);
  const int hidden_travel = panel_height_ + radius + radius / 4;
  const float distance = reduced_ ? std::min(12, panel_height_) : hidden_travel;
  RECT old{}; GetWindowRect(browser_, &old);
  MapWindowPoints(nullptr, hwnd_, reinterpret_cast<POINT*>(&old), 2);
  panel_y_ = state_ == State::Loading ? -hidden_travel :
      static_cast<int>(std::round(-(1-progress_) * distance));
  const int x = (width_-panel_width_)/2;
  const bool visible = (GetWindowLongPtrW(browser_, GWL_STYLE) & WS_VISIBLE) != 0;
  const bool same_size = old.right-old.left == panel_width_ &&
                         old.bottom-old.top == panel_height_;
  if (visible && same_size && old.left == x && old.top == panel_y_) return;
  UINT flags = SWP_NOACTIVATE | SWP_NOZORDER | SWP_DEFERERASE;
  if (same_size) flags |= SWP_NOSIZE;
  if (!visible) flags |= SWP_SHOWWINDOW;
  SetWindowPos(browser_, nullptr, x, panel_y_, panel_width_, panel_height_, flags);
  const int margin = radius + radius / 4;
  const RECT changed{
      std::min(old.left, static_cast<LONG>(x)) - margin,
      std::min(old.top, static_cast<LONG>(panel_y_)) - margin,
      std::max(old.right, static_cast<LONG>(x + panel_width_)) + margin,
      std::max(old.bottom, static_cast<LONG>(panel_y_ + panel_height_)) + margin,
  };
  // Commit the new shadow position before processing another window movement.
  RedrawWindow(hwnd_, &changed, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_NOCHILDREN);
}
void SettingsOverlay::Tick() {
  if (state_ != State::Opening && state_ != State::Closing) return;
  const float fraction = std::min(1.f, static_cast<float>(MotionNow()-start_) / duration_);
  const float eased = fraction * fraction * (3.f - 2.f * fraction);
  progress_ = state_ == State::Closing
      ? close_start_ * (1.f - eased)
      : eased;
  ++ticks_;
  if (fraction < 1 || state_ != State::Closing) PlacePanel();
  if (fraction < 1) return;
  KillTimer(hwnd_, 1);
  if (state_ == State::Closing) {
    state_ = State::Closed;
    // Hide the whole tree before CEF starts destroying its child HWNDs.
    ShowWindow(hwnd_, SW_HIDE);
    if (browser_) ShowWindow(browser_, SW_HIDE);
    // The callback initiates asynchronous CEF close. The host is retained until
    // OnBeforeClose, so its browser cannot outlive the native parent.
    const auto closed = closed_; closed();
  } else { state_ = State::Open; Focus(); }
}
LRESULT CALLBACK SettingsOverlay::Proc(HWND hwnd, UINT message, WPARAM wp, LPARAM lp) {
  auto* self = reinterpret_cast<SettingsOverlay*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (message == WM_NCCREATE) {
    self = static_cast<SettingsOverlay*>(reinterpret_cast<CREATESTRUCTW*>(lp)->lpCreateParams);
    SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(self));
  }
  if (!self) return DefWindowProcW(hwnd, message, wp, lp);
  switch (message) {
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
      PAINTSTRUCT paint{};
      HDC dc = BeginPaint(hwnd, &paint);
      if (!IsRectEmpty(&paint.rcPaint)) self->PaintFrame(dc, paint.rcPaint);
      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_TIMER: if (wp == 1) self->Tick(); return 0;
    case WM_CLOSE: self->request_close_(); return 0;
    case WM_SETFOCUS: self->Focus(); return 0;
    case WM_MOUSEACTIVATE: self->Focus(); return MA_NOACTIVATE;
    case WM_LBUTTONDOWN: case WM_RBUTTONDOWN: case WM_MBUTTONDOWN:
    case WM_MOUSEWHEEL: self->Focus(); return 0; // Backdrop never dismisses.
    case WM_NCHITTEST: {
      // Keep the owner's native resize affordance, never expose background UI.
      if (!IsZoomed(self->owner_)) {
        RECT r = {}; GetWindowRect(hwnd, &r);
        const int e = MulDiv(6, GetDpiForWindow(self->owner_), 96);
        const int x = GET_X_LPARAM(lp), y = GET_Y_LPARAM(lp);
        if (x < r.left+e || x >= r.right-e || y < r.top+e || y >= r.bottom-e) return HTTRANSPARENT;
      }
      return HTCLIENT;
    }
    case WM_DESTROY: KillTimer(hwnd, 1); return 0;
  }
  return DefWindowProcW(hwnd, message, wp, lp);
}
}
