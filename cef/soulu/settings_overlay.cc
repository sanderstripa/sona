#include "examples/soulu/settings_overlay.h"
#include "examples/soulu/motion.h"
#include <dwmapi.h>
#include <windowsx.h>
#include <algorithm>
#include <cmath>

namespace soulu {
SettingsOverlay::SettingsOverlay(HWND owner, std::function<void()> closed,
    std::function<void()> request_close)
    : owner_(owner), closed_(std::move(closed)), request_close_(std::move(request_close)) {}
SettingsOverlay::~SettingsOverlay() {
  if (IsWindow(hwnd_)) DestroyWindow(hwnd_);
  if (backdrop_) DeleteObject(backdrop_);
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
  backdrop_width_ = std::max(1, width / 16);
  backdrop_height_ = std::max(1, height / 16);
  if (memory) {
    backdrop_ = CreateCompatibleBitmap(screen, backdrop_width_, backdrop_height_);
    if (backdrop_) {
      HGDIOBJ previous = SelectObject(memory, backdrop_);
      SetStretchBltMode(memory, HALFTONE);
      const BOOL copied = StretchBlt(memory, 0, 0, backdrop_width_, backdrop_height_,
          screen, origin.x, origin.y, width, height, SRCCOPY);
      SelectObject(memory, previous);
      if (!copied) { DeleteObject(backdrop_); backdrop_ = nullptr; }
    }
    DeleteDC(memory);
  }
  ReleaseDC(nullptr, screen);
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
  state_ = State::Opening; start_ = GetTickCount64();
  SetTimer(hwnd_, 1, 16, nullptr); Tick(); Focus();
}
void SettingsOverlay::Close() {
  if (state_ == State::Closing || state_ == State::Closed) return;
  KillTimer(hwnd_,2);
  state_ = State::Closing; close_start_ = progress_; start_ = GetTickCount64();
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
  resize_from_ = display_height_;resize_start_ = GetTickCount64();
  SetTimer(hwnd_, 2, 16, nullptr);ResizeTick();
}
void SettingsOverlay::ResizeTick() {
  const float fraction = std::min(1.f,static_cast<float>(GetTickCount64()-resize_start_)/380.f);
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
  SetWindowPos(hwnd_, HWND_TOP, p.x, p.y, width_, height_, SWP_NOACTIVATE | SWP_NOCOPYBITS);
  InvalidateRect(hwnd_, nullptr, FALSE);
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
  int y = static_cast<int>(std::round(-(1-progress_) * distance));
  if (state_ == State::Loading) y = -panel_height_;
  SetWindowPos(browser_, HWND_TOP, (width_-panel_width_)/2, y,
      panel_width_, panel_height_, SWP_NOACTIVATE | SWP_SHOWWINDOW);
}
void SettingsOverlay::Tick() {
  const float fraction = std::min(1.f, static_cast<float>(GetTickCount64()-start_) / duration_);
  const float eased = fraction >= 1 ? 1 : motion::EaseOut(fraction);
  progress_ = state_ == State::Closing ? close_start_ * (1-eased) : eased;
  ++ticks_;
  PlacePanel();
  if (fraction < 1) return;
  KillTimer(hwnd_, 1);
  if (state_ == State::Closing) {
    state_ = State::Closed; ShowWindow(hwnd_, SW_HIDE);
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
