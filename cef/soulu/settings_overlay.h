#pragma once
#include <windows.h>
#include <functional>
#include "examples/soulu/shell_surface.h"

namespace soulu {
class SettingsOverlay final {
 public:
  explicit SettingsOverlay(HWND owner, std::function<void()> closed,
                           std::function<void()> request_close);
  ~SettingsOverlay();
  bool Create();
  void Attach(CefRefPtr<CefBrowser> browser);
  CefRefPtr<ShellSurface> surface() const { return surface_; }
  void Open();
  void Close();
  void Layout();
  void SetPanelHeight(int height);
  void Focus();
  HWND hwnd() const { return hwnd_; }
  bool closing() const { return state_ == State::Closing || state_ == State::Closed; }
  bool ready() const { return state_ == State::Open; }
  float progress() const { return progress_; }
  int duration() const { return duration_; }
  int ticks() const { return ticks_; }
 private:
  enum class State { Loading, Opening, Open, Closing, Closed };
  static LRESULT CALLBACK Proc(HWND, UINT, WPARAM, LPARAM);
  void Tick();
  void StartSlide();
  void OnPanelFrame();
  void PlacePanel();
  HRGN PanelRegion(int x, int y) const;
  void CaptureBackground();
  void PaintPanelShadow(HDC dc);
  void PaintBackdrop(HDC dc, const RECT& dirty);
  void PaintFrame(HDC target, const RECT& dirty);
  HBITMAP backdrop_ = nullptr, sharp_bitmap_ = nullptr, shadow_ = nullptr;
  HDC sharp_dc_ = nullptr;
  HGDIOBJ sharp_original_ = nullptr;
  int sharp_width_ = 0, sharp_height_ = 0;
  HDC backdrop_cache_ = nullptr;
  HBITMAP backdrop_frame_ = nullptr;
  HGDIOBJ backdrop_original_ = nullptr;
  HDC frame_dc_ = nullptr;
  HBITMAP frame_bitmap_ = nullptr;
  HGDIOBJ frame_original_ = nullptr;
  int frame_width_ = 0, frame_height_ = 0;
  int cached_width_ = 0, cached_height_ = 0;
  int region_width_ = 0, region_height_ = 0, region_radius_ = 0;
  int clip_width_ = 0, clip_height_ = 0, clip_corner_ = 0;
  int panel_y_ = 0, shadow_panel_width_ = 0, shadow_panel_height_ = 0, shadow_radius_ = 0;
  int backdrop_width_ = 0, backdrop_height_ = 0;
  HWND owner_ = nullptr, hwnd_ = nullptr;
  CefRefPtr<ShellSurface> surface_;
  CefRefPtr<CefBrowser> browser_;
  std::function<void()> closed_, request_close_;
  State state_ = State::Loading;
  ULONGLONG start_ = 0;
  float progress_ = 0, close_start_ = 1;
  int width_ = 1, height_ = 1, panel_width_ = 1, panel_height_ = 1;
  int duration_ = 260, ticks_ = 0;
  bool reduced_ = false, waiting_for_frame_ = false;
  int requested_height_ = 800;
};
}
