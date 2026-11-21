"""Compare a plain Win32 Desktop Acrylic window with a moving background."""
import ctypes as C
from ctypes import wintypes as W
import time
import tkinter as tk

from PIL import ImageGrab

user = C.windll.user32
dwm = C.windll.dwmapi
user.SetProcessDpiAwarenessContext(C.c_void_p(-4))
user.GetAncestor.argtypes = [W.HWND, W.UINT]
user.GetAncestor.restype = W.HWND
user.SetForegroundWindow.argtypes = [W.HWND]
user.GetForegroundWindow.restype = W.HWND
user.SetWindowPos.argtypes = [W.HWND,W.HWND,C.c_int,C.c_int,C.c_int,C.c_int,W.UINT]
user.CreateWindowExW.argtypes = [
    W.DWORD, W.LPCWSTR, W.LPCWSTR, W.DWORD, C.c_int, C.c_int,
    C.c_int, C.c_int, W.HWND, W.HMENU, W.HINSTANCE, W.LPVOID,
]
user.CreateWindowExW.restype = W.HWND
user.DestroyWindow.argtypes = [W.HWND]
user.PeekMessageW.argtypes = [C.POINTER(W.MSG), W.HWND, W.UINT, W.UINT, W.UINT]
user.DispatchMessageW.argtypes = [C.POINTER(W.MSG)]
dwm.DwmSetWindowAttribute.argtypes = [W.HWND, W.DWORD, C.c_void_p, W.DWORD]
dwm.DwmGetWindowAttribute.argtypes = [W.HWND, W.DWORD, W.LPVOID, W.DWORD]

class Margins(C.Structure):
    _fields_ = [(edge, C.c_int) for edge in ('left', 'right', 'top', 'bottom')]

dwm.DwmExtendFrameIntoClientArea.argtypes = [W.HWND, C.POINTER(Margins)]

back = tk.Tk()
back.overrideredirect(True)
back.geometry('460x380+90+80')
back.configure(background='black')
back.update()
# SS_BLACKRECT paints a black client area for DWM glass composition.
front = user.CreateWindowExW(0, 'STATIC', None, 0x90000004,
                             140, 110, 320, 290, None, None, None, None)
if not front:
    raise C.WinError()
try:
    frame = dwm.DwmExtendFrameIntoClientArea(front, C.byref(Margins(-1, -1, -1, -1)))
    kind = C.c_int(3)
    requested = dwm.DwmSetWindowAttribute(front, 38, C.byref(kind), C.sizeof(kind))
    actual = C.c_int()
    read = dwm.DwmGetWindowAttribute(front, 38, C.byref(actual), C.sizeof(actual))
    backing = user.GetAncestor(back.winfo_id(), 2)
    assert user.SetWindowPos(backing, front, 90, 80, 460, 380, 0x50)
    assert user.SetCursorPos(230, 230)
    user.mouse_event(2, 0, 0, 0, 0)
    user.mouse_event(4, 0, 0, 0, 0)

    def sample(color):
        back.configure(background=color)
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline:
            back.update()
            msg = W.MSG()
            while user.PeekMessageW(C.byref(msg), front, 0, 0, 1):
                user.DispatchMessageW(C.byref(msg))
            time.sleep(0.02)
        image = ImageGrab.grab()
        image.crop((85, 75, 560, 470)).save(f'acrylic-{color}.png')
        return image.getpixel((230, 230)), image.getpixel((110, 230))

    dark, dark_reference = sample('black')
    light, light_reference = sample('white')
    print({'frame': frame, 'requested': requested, 'read': read, 'actual': actual.value,
           'active': user.GetForegroundWindow() == front, 'dark': dark, 'light': light,
           'dark_reference': dark_reference, 'light_reference': light_reference}, flush=True)
    assert frame == 0 and requested == 0 and read == 0 and actual.value == 3
    assert sum(light_reference[:3]) - sum(dark_reference[:3]) >= 480
    assert user.GetForegroundWindow() == front
    assert sum(light[:3]) - sum(dark[:3]) >= 24, 'Native Acrylic did not track the background'
finally:
    user.DestroyWindow(front)
    back.destroy()
