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
  if (surface_) {
    surface_->Detach();
    surface_ = nullptr;
  }
  if (IsWindow(hwnd_)) DestroyWindow(hwnd_);
  if (sharp_dc_) {
    if (sharp_bitmap_) {
      SelectObject(sharp_dc_, sharp_original_);
      DeleteObject(sharp_bitmap_);
    }
    DeleteDC(sharp_dc_);
  }
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
  sharp_dc_ = CreateCompatibleDC(screen);
  if (sharp_dc_) {
    sharp_bitmap_ = CreateCompatibleBitmap(screen, width, height);
    if (sharp_bitmap_) {
      sharp_original_ = SelectObject(sharp_dc_, sharp_bitmap_);
      if (BitBlt(sharp_dc_, 0, 0, width, height, screen, origin.x, origin.y, SRCCOPY)) {
        sharp_width_ = width;
        sharp_height_ = height;
      }
    }
  }
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
  const int w = dirty.right - dirty.left, h = dirty.bottom - dirty.top;
  const bool blurred = cached_width_ == width_ && cached_height_ == height_;
  if (blurred && (progress_ >= 1.f || !sharp_width_)) {
    BitBlt(dc, dirty.left, dirty.top, w, h, backdrop_cache_, dirty.left, dirty.top, SRCCOPY);
    return;
  }
  if (sharp_width_ == width_ && sharp_height_ == height_) {
    BitBlt(dc, dirty.left, dirty.top, w, h, sharp_dc_, dirty.left, dirty.top, SRCCOPY);
  } else if (sharp_width_) {
    StretchBlt(dc, 0, 0, width_, height_, sharp_dc_, 0, 0, sharp_width_, sharp_height_, SRCCOPY);
  } else {
    FillRect(dc, &dirty, GetSysColorBrush(COLOR_WINDOW));
  }
  if (blurred && progress_ > 0.f) {
    const BLENDFUNCTION blend{AC_SRC_OVER, 0, static_cast<BYTE>(std::round(255 * progress_)), 0};
    AlphaBlend(dc, dirty.left, dirty.top, w, h, backdrop_cache_, dirty.left, dirty.top, w, h, blend);
  }
}

void SettingsOverlay::PaintPanelShadow(HDC dc) {
  if (progress_ <= 0 || !surface_) return;
  const int radius = ShadowRadius(owner_);
  const int visible_height = panel_y_ + panel_height_;
  if (visible_height <= 0) return;
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
    const float visibility = reduced_ ? progress_ : std::min(1.f, static_cast<float>(visible_height) / radius);
    const BYTE opacity = static_cast<BYTE>(std::round(255 * visibility));
    const BLENDFUNCTION alpha{AC_SRC_OVER, 0, opacity, AC_SRC_ALPHA};
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
  const bool buffered = frame_width_ == width_ && frame_height_ == height_;
  HDC dc = buffered ? frame_dc_ : target;
  const int saved = SaveDC(dc);
  if (saved) IntersectClipRect(dc, dirty.left, dirty.top, dirty.right, dirty.bottom);
  PaintBackdrop(dc, dirty);
  PaintPanelShadow(dc);
  if (saved && progress_ > 0 && surface_) {
    const int x = (width_ - panel_width_) / 2;
    if (HRGN panel = PanelRegion(x, panel_y_)) {
      ExtSelectClipRgn(dc, panel, RGN_AND);
      DeleteObject(panel);
      surface_->DrawFrame(dc, x, panel_y_, panel_width_, panel_height_);
    }
  }
  if (saved) RestoreDC(dc, saved);
  if (buffered)
    BitBlt(target, dirty.left, dirty.top, dirty.right - dirty.left, dirty.bottom - dirty.top,
           dc, dirty.left, dirty.top, SRCCOPY);
}

bool SettingsOverlay::Create() {
  CaptureBackground();
  WNDCLASSEXW wc = {sizeof(wc)};
  wc.lpfnWndProc = Proc; wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"SouluSettingsOverlay";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassExW(&wc);
  hwnd_ = CreateWindowExW(WS_EX_TOOLWINDOW,
      wc.lpszClassName, L"Sona Preview Settings", WS_POPUP,
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
  surface_ = new ShellSurface(hwnd_, [this] { OnPanelFrame(); });
  if (!surface_->hwnd()) return false;
  Layout();
  return true;
}
void SettingsOverlay::Attach(CefRefPtr<CefBrowser> browser) {
  if (closing()) return;
  browser_ = browser;
  surface_->Attach(browser);
  Layout();
}
void SettingsOverlay::Open() {
  if (state_ != State::Loading || waiting_for_frame_) return;
  // The ready message comes from the settings document, before the matching
  // compositor frame necessarily arrives. Keep the backdrop sharp until then.
  waiting_for_frame_ = true;
  browser_->GetHost()->Invalidate(PET_VIEW);
}
void SettingsOverlay::OnPanelFrame() {
  if (!waiting_for_frame_ || state_ != State::Loading) return;
  waiting_for_frame_ = false;
  state_ = State::Opening;
  StartSlide();
}
void SettingsOverlay::StartSlide() {
  start_ = MotionNow();
  if (!SetTimer(hwnd_, 1, 16, nullptr)) start_ -= duration_;
  Tick();
}
void SettingsOverlay::Close() {
  if (closing()) return;
  close_start_ = progress_;
  state_ = State::Closing;
  // The interactive child is stationary and is covered by the same retained
  // pixels on the overlay during the exit. The timer moves only pixels.
  RedrawWindow(hwnd_, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_NOCHILDREN);
  surface_->ShowComposedSurface(false);
  StartSlide();
}
void SettingsOverlay::Focus() {
  if (!browser_ || !ready() || !IsWindowVisible(hwnd_)) return;
  const HWND panel = surface_->hwnd();
  const HWND focused = GetFocus();
  if (focused != panel && !IsChild(panel, focused)) surface_->Focus();
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
  PlacePanel();
  InvalidateRect(hwnd_, nullptr, FALSE);
}
HRGN SettingsOverlay::PanelRegion(int x, int y) const {
  const int corner = MulDiv(24, GetDpiForWindow(owner_), 96);
  HRGN panel = CreateRoundRectRgn(x, y, x + panel_width_, y + panel_height_, corner, corner);
  if (panel) {
    if (HRGN top = CreateRectRgn(x, y, x + panel_width_, y + std::min(corner, panel_height_))) {
      CombineRgn(panel, panel, top, RGN_OR);
      DeleteObject(top);
    }
  }
  return panel;
}
void SettingsOverlay::PlacePanel() {
  const HWND panel = surface_->hwnd();
  const int x = (width_ - panel_width_) / 2;
  const float scale = GetDpiForWindow(owner_) / 96.f;
  surface_->PrepareResize(panel_width_, panel_height_, scale);
  RECT old{};
  GetWindowRect(panel, &old);
  MapWindowPoints(nullptr, hwnd_, reinterpret_cast<POINT*>(&old), 2);
  if (old.left != x || old.top != 0 || old.right - old.left != panel_width_ ||
      old.bottom - old.top != panel_height_) {
    SetWindowPos(panel, nullptr, x, 0, panel_width_, panel_height_, SWP_NOACTIVATE | SWP_NOZORDER);
  }
  const int corner = MulDiv(24, GetDpiForWindow(owner_), 96);
  if (panel_width_ != clip_width_ || panel_height_ != clip_height_ || corner != clip_corner_) {
    if (HRGN region = PanelRegion(0, 0)) {
      if (SetWindowRgn(panel, region, TRUE)) {
        clip_width_ = panel_width_;
        clip_height_ = panel_height_;
        clip_corner_ = corner;
      } else {
        DeleteObject(region);
      }
    }
  }
  surface_->CommitResize();
}
void SettingsOverlay::Tick() {
  if (state_ != State::Opening && state_ != State::Closing) return;
  const float fraction = std::min(1.f, static_cast<float>(MotionNow()-start_) / duration_);
  const float eased = fraction * fraction * (3.f - 2.f * fraction);
  progress_ = state_ == State::Closing
      ? close_start_ * (1.f - eased)
      : eased;
  ++ticks_;
  const int travel = reduced_ ? std::min(12, panel_height_) : panel_height_;
  panel_y_ = -static_cast<int>(std::round((1.f - progress_) * travel));
  RedrawWindow(hwnd_, nullptr, nullptr, RDW_INVALIDATE | RDW_UPDATENOW | RDW_NOCHILDREN);
  if (fraction < 1) return;
  KillTimer(hwnd_, 1);
  if (state_ == State::Closing) {
    state_ = State::Closed;
    ShowWindow(hwnd_, SW_HIDE);
    // The callback initiates asynchronous CEF close. The host is retained until
    // OnBeforeClose, so its browser cannot outlive the native parent.
    const auto closed = closed_; closed();
  } else {
    if (IsWindow(hwnd_) && surface_->HasFrame()) {
      state_ = State::Open;
      surface_->ShowComposedSurface(true);
      Focus();
    } else {
      // A resize during the slide may still be waiting for the final CEF frame.
      SetTimer(hwnd_, 1, 16, nullptr);
    }
  }
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
