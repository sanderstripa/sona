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
void SettingsOverlay::PaintPanelShadow(HDC dc) {
  if (!browser_ || state_ == State::Loading || panel_y_ + panel_height_ <= 0) return;
  const int radius = std::max(1, MulDiv(22, GetDpiForWindow(owner_), 96));
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
  if (HDC memory = CreateCompatibleDC(dc)) {
    HGDIOBJ previous = SelectObject(memory, shadow_);
    const BLENDFUNCTION alpha{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
    AlphaBlend(dc, (width_ - width) / 2, panel_y_ - radius + radius / 4,
        width, height, memory, 0, 0, width, height, alpha);
    SelectObject(memory, previous);
    DeleteDC(memory);
  }
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
  // No independent Windows corners: the owner supplies the external silhouette.
  const DWORD corners = 1; // DWMWCP_DONOTROUND
  DwmSetWindowAttribute(hwnd_, 33, &corners, sizeof(corners));
  BOOL animate = TRUE;
  if (SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &animate, 0)) reduced_ = !animate;
  duration_ = reduced_ ? motion::kReducedOverlayMs : 320;
  Layout();
  // The invisible panel starts above the clipping bounds. Showing the host now
  // blocks input immediately and allows Chromium to prepare its first frame.
  ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
  return true;
}
void SettingsOverlay::Attach(HWND browser) { browser_ = browser; Layout(); }
void SettingsOverlay::Open() {
  if (state_ != State::Loading) { Focus(); return; }
  state_ = State::Opening; start_ = MotionNow();
  SetTimer(hwnd_, 1, 16, nullptr); Tick(); Focus();
}
void SettingsOverlay::Close() {
  if (state_ == State::Closing || state_ == State::Closed) return;
  KillTimer(hwnd_,2);
  state_ = State::Closing; close_start_ = progress_; start_ = MotionNow();
  SetTimer(hwnd_, 1, 16, nullptr); Tick();
}
void SettingsOverlay::Focus() {
  if (browser_ && IsWindowVisible(hwnd_) && state_ != State::Closing) SetFocus(browser_);
}
void SettingsOverlay::SetPanelHeight(int height) {
  if(state_==State::Closing||state_==State::Closed)return;
  const int next = std::clamp(height, 160, 800);
  if (next == requested_height_) return;
  requested_height_ = next;
  if (state_ != State::Open || reduced_) {
    KillTimer(hwnd_, 2);display_height_ = static_cast<float>(next);Layout();return;
  }
  resize_from_ = display_height_;resize_start_ = MotionNow();
  SetTimer(hwnd_, 2, 16, nullptr);ResizeTick();
}
void SettingsOverlay::ResizeTick() {
  const float fraction = std::min(1.f,static_cast<float>(MotionNow()-resize_start_)/380.f);
  const float eased = .5f-.5f*std::cos(fraction*3.14159265f);
  display_height_ = resize_from_+(requested_height_-resize_from_)*eased;
  panel_height_=std::min(height_,static_cast<int>(std::round(display_height_*GetDpiForWindow(owner_)/96.f)));
  ClipPanel();PlacePanel();
  if(fraction>=1)KillTimer(hwnd_,2);
}
void SettingsOverlay::Layout() {
  if (!hwnd_) return;
  RECT r = {}; GetClientRect(owner_, &r);
  POINT p = {0, 0}; ClientToScreen(owner_, &p);
  width_ = std::max(1L, r.right); height_ = std::max(1L, r.bottom);
  const float scale = GetDpiForWindow(owner_) / 96.f;
  panel_width_ = std::min(width_, static_cast<int>(std::round(1020 * scale)));
  panel_height_ = std::min(height_, static_cast<int>(std::round(display_height_ * scale)));
  RECT actual{}; GetWindowRect(hwnd_, &actual);
  if (actual.left != p.x || actual.top != p.y || actual.right-actual.left != width_ || actual.bottom-actual.top != height_) {
    SetWindowPos(hwnd_, HWND_TOP, p.x, p.y, width_, height_, SWP_NOACTIVATE | SWP_NOCOPYBITS);
    InvalidateRect(hwnd_, nullptr, FALSE);
  }
  // Crop to the owner's client region, including its rounded normal-window
  // silhouette. No independent desktop-relative geometry is persisted.
  const int radius = IsZoomed(owner_) ? 0 : static_cast<int>(std::round(16 * scale));
  HRGN region = radius ? CreateRoundRectRgn(0, 0, width_+1, height_+1, radius, radius)
                      : CreateRectRgn(0, 0, width_, height_);
  SetWindowRgn(hwnd_, region, FALSE);
  if (IsIconic(owner_)) ShowWindow(hwnd_, SW_HIDE);
  else if (state_ != State::Closed) ShowWindow(hwnd_, SW_SHOWNOACTIVATE);
  ClipPanel();
  PlacePanel();
}
void SettingsOverlay::ClipPanel() {
  if (browser_) {
    const float scale=GetDpiForWindow(owner_)/96.f;
    const int corner = static_cast<int>(std::round(24 * scale));
    HRGN panel = CreateRoundRectRgn(0, 0, panel_width_+1, panel_height_+1, corner, corner);
    HRGN top = CreateRectRgn(0, 0, panel_width_, std::min(corner, panel_height_));
    CombineRgn(panel, panel, top, RGN_OR); DeleteObject(top);
    SetWindowRgn(browser_, panel, FALSE);
  }
}
void SettingsOverlay::PlacePanel() {
  if (!browser_) return;
  const float distance = reduced_ ? std::min(12, panel_height_) : panel_height_;
  RECT old{}; GetWindowRect(browser_, &old);
  MapWindowPoints(nullptr, hwnd_, reinterpret_cast<POINT*>(&old), 2);
  panel_y_ = state_ == State::Loading ? -panel_height_ :
      static_cast<int>(std::round(-(1-progress_) * distance));
  const int x = (width_-panel_width_)/2;
  const bool visible = (GetWindowLongPtrW(browser_, GWL_STYLE) & WS_VISIBLE) != 0;
  if (visible && old.left == x && old.top == panel_y_ &&
      old.right-old.left == panel_width_ && old.bottom-old.top == panel_height_) return;
  SetWindowPos(browser_, HWND_TOP, x, panel_y_, panel_width_, panel_height_,
       SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_NOCOPYBITS);
  const int margin = MulDiv(30, GetDpiForWindow(owner_), 96);
  RECT changed{std::min(old.left, static_cast<LONG>(x))-margin, std::min(old.top, static_cast<LONG>(panel_y_))-margin,
               std::max(old.right, static_cast<LONG>(x+panel_width_))+margin,
               std::max(old.bottom, static_cast<LONG>(panel_y_+panel_height_))+margin};
  RedrawWindow(hwnd_, &changed, nullptr, RDW_INVALIDATE | RDW_NOCHILDREN | RDW_UPDATENOW);
}
void SettingsOverlay::Tick() {
  const float fraction = std::min(1.f, static_cast<float>(MotionNow()-start_) / duration_);
  progress_ = state_ == State::Closing
      ? close_start_ * motion::EaseOut(1-fraction)
      : motion::EaseOut(fraction);
  ++ticks_;
  PlacePanel();
  if (fraction < 1) return;
  KillTimer(hwnd_, 1);
  if (state_ == State::Closing) {
    state_ = State::Closed;
    if (browser_) ShowWindow(browser_, SW_HIDE);
    ShowWindow(hwnd_, SW_HIDE);
    RedrawWindow(owner_, nullptr, nullptr, RDW_INVALIDATE | RDW_ALLCHILDREN);
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
      HDC target = BeginPaint(hwnd, &paint);
      // Compose the backdrop and shadow before exposing the new frame.
      const int w = paint.rcPaint.right-paint.rcPaint.left;
      const int h = paint.rcPaint.bottom-paint.rcPaint.top;
      HDC buffer = w>0 && h>0 ? CreateCompatibleDC(target) : nullptr;
      HBITMAP frame = buffer ? CreateCompatibleBitmap(target, w, h) : nullptr;
      HGDIOBJ previous_frame = frame ? SelectObject(buffer, frame) : nullptr;
      HDC dc = frame ? buffer : target;
      if (frame) SetViewportOrgEx(dc, -paint.rcPaint.left, -paint.rcPaint.top, nullptr);
      HDC memory = self->backdrop_ ? CreateCompatibleDC(dc) : nullptr;
      if (memory) {
        HGDIOBJ previous = SelectObject(memory, self->backdrop_);
        SetStretchBltMode(dc, HALFTONE);
        StretchBlt(dc, 0, 0, self->width_, self->height_, memory, 0, 0,
            self->backdrop_width_, self->backdrop_height_, SRCCOPY);
        SelectObject(memory, previous);
        DeleteDC(memory);
      } else {
        FillRect(dc, &paint.rcPaint, GetSysColorBrush(COLOR_WINDOW));
      }
      self->PaintPanelShadow(dc);
      if (frame) {
        SetViewportOrgEx(dc, 0, 0, nullptr);
        BitBlt(target, paint.rcPaint.left, paint.rcPaint.top, w, h, dc, 0, 0, SRCCOPY);
        SelectObject(buffer, previous_frame);
        DeleteObject(frame);
      }
      if (buffer) DeleteDC(buffer);
      EndPaint(hwnd, &paint);
      return 0;
    }
    case WM_TIMER: if (wp == 1) self->Tick(); else if(wp==2)self->ResizeTick(); return 0;
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
    case WM_DESTROY: KillTimer(hwnd, 1); KillTimer(hwnd, 2); return 0;
  }
  return DefWindowProcW(hwnd, message, wp, lp);
}
}
