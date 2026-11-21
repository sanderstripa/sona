#pragma once
#include <windows.h>
#include <functional>
#include <string>

namespace soulu {
class SettingsOverlay final {
 public:
  explicit SettingsOverlay(HWND owner, std::function<void()> closed,
                           std::function<void()> request_close);
  ~SettingsOverlay();
  bool Create();
  void Attach(HWND browser);
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
  void PlacePanel();
  void ResizeTick();
  void ClipPanel();
  void CaptureBackground();
  HBITMAP backdrop_ = nullptr;
  int backdrop_width_ = 0, backdrop_height_ = 0;
  HWND owner_ = nullptr, hwnd_ = nullptr, browser_ = nullptr;
  std::function<void()> closed_, request_close_;
  State state_ = State::Loading;
  ULONGLONG start_ = 0;
  float progress_ = 0, close_start_ = 1;
  int width_ = 1, height_ = 1, panel_width_ = 1, panel_height_ = 1;
  int duration_ = 260, ticks_ = 0;
  bool reduced_ = false;
  int requested_height_ = 800;
  float display_height_ = 800, resize_from_ = 800;
  ULONGLONG resize_start_ = 0;
};
}
