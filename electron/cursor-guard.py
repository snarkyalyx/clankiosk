#!/usr/bin/env python3
"""Hide GNOME's native pointer only while it is over the kiosk X11 window."""

import ctypes
import ctypes.util
import signal
import sys
import time


def load_library(name):
    path = ctypes.util.find_library(name)
    if not path:
        raise RuntimeError(f"{name} library is unavailable")
    return ctypes.CDLL(path)


x11 = load_library("X11")
xfixes = load_library("Xfixes")
Display = ctypes.c_void_p
Window = ctypes.c_ulong
Int = ctypes.c_int
UInt = ctypes.c_uint
Bool = ctypes.c_int

x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XOpenDisplay.restype = Display
x11.XCloseDisplay.argtypes = [Display]
x11.XDefaultRootWindow.argtypes = [Display]
x11.XDefaultRootWindow.restype = Window
x11.XGetGeometry.argtypes = [Display, Window, ctypes.POINTER(Window), ctypes.POINTER(Int), ctypes.POINTER(Int), ctypes.POINTER(UInt), ctypes.POINTER(UInt), ctypes.POINTER(UInt), ctypes.POINTER(UInt)]
x11.XGetGeometry.restype = Bool
x11.XTranslateCoordinates.argtypes = [Display, Window, Window, Int, Int, ctypes.POINTER(Int), ctypes.POINTER(Int), ctypes.POINTER(Window)]
x11.XTranslateCoordinates.restype = Bool
x11.XQueryPointer.argtypes = [Display, Window, ctypes.POINTER(Window), ctypes.POINTER(Window), ctypes.POINTER(Int), ctypes.POINTER(Int), ctypes.POINTER(Int), ctypes.POINTER(Int), ctypes.POINTER(UInt)]
x11.XQueryPointer.restype = Bool
x11.XFlush.argtypes = [Display]
xfixes.XFixesQueryExtension.argtypes = [Display, ctypes.POINTER(Int), ctypes.POINTER(Int)]
xfixes.XFixesQueryExtension.restype = Bool
xfixes.XFixesHideCursor.argtypes = [Display, Window]
xfixes.XFixesShowCursor.argtypes = [Display, Window]


window = Window(int(sys.argv[1], 0))
display = x11.XOpenDisplay(None)
if not display:
    raise SystemExit("cannot connect to the desktop X11 display")

root = x11.XDefaultRootWindow(display)
event_base, error_base = Int(), Int()
if not xfixes.XFixesQueryExtension(display, ctypes.byref(event_base), ctypes.byref(error_base)):
    x11.XCloseDisplay(display)
    raise SystemExit("the XFixes cursor extension is unavailable")

running = True
hidden = False


def stop(_signum, _frame):
    global running
    running = False


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

try:
    while running:
        root_return, x, y = Window(), Int(), Int()
        width, height, border, depth = UInt(), UInt(), UInt(), UInt()
        geometry_ok = x11.XGetGeometry(display, window, ctypes.byref(root_return), ctypes.byref(x), ctypes.byref(y), ctypes.byref(width), ctypes.byref(height), ctypes.byref(border), ctypes.byref(depth))
        root_x, root_y, child = Int(), Int(), Window()
        translated = geometry_ok and x11.XTranslateCoordinates(display, window, root, 0, 0, ctypes.byref(root_x), ctypes.byref(root_y), ctypes.byref(child))
        pointer_root, pointer_child = Window(), Window()
        pointer_x, pointer_y, window_x, window_y, mask = Int(), Int(), Int(), Int(), UInt()
        pointer_ok = x11.XQueryPointer(display, root, ctypes.byref(pointer_root), ctypes.byref(pointer_child), ctypes.byref(pointer_x), ctypes.byref(pointer_y), ctypes.byref(window_x), ctypes.byref(window_y), ctypes.byref(mask))

        inside = bool(geometry_ok and translated and pointer_ok and width.value and height.value and
                      root_x.value <= pointer_x.value < root_x.value + width.value and
                      root_y.value <= pointer_y.value < root_y.value + height.value)
        if inside != hidden:
            (xfixes.XFixesHideCursor if inside else xfixes.XFixesShowCursor)(display, window)
            x11.XFlush(display)
            hidden = inside
        time.sleep(0.04)
finally:
    if hidden:
        xfixes.XFixesShowCursor(display, window)
        x11.XFlush(display)
    x11.XCloseDisplay(display)
