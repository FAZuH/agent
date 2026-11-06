#!/usr/bin/env python3
"""XTest input for XWayland clients, and the X11 window list.

Only clients that live in XWayland appear here: Wine/Proton games, Steam, and
other X11 apps. Wayland-native clients (kitty, Brave, ...) get pointer input
from ydotool instead, and keyboard input from wtype.

    xtest.py windows
    xtest.py move X Y
    xtest.py click X Y BUTTON COUNT
    xtest.py drag X1 Y1 X2 Y2
    xtest.py scroll X Y AMOUNT
    xtest.py key KEY [MOD...]
    xtest.py type TEXT
"""
import json
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

BUTTONS = {"left": 1, "middle": 2, "right": 3}

# wtype/TS modifier names -> X keysym names.
MOD_KEYSYMS = {
    "ctrl": "Control_L",
    "shift": "Shift_L",
    "alt": "Alt_L",
    "logo": "Super_L",
}


def windows(d):
    out = []

    def walk(win, depth=0):
        try:
            attrs = win.get_attributes()
            cls = win.get_wm_class()
            name = win.get_wm_name()
        except Exception:
            attrs, cls, name = None, None, None
        if attrs is not None and attrs.map_state == X.IsViewable:
            geom = None
            try:
                geom = win.get_geometry()
            except Exception:
                pass
            if cls and geom and geom.width > 1 and geom.height > 1:
                out.append(
                    {
                        "id": hex(win.id),
                        "class": cls[0] or cls[1],
                        "title": name or "",
                        "width": geom.width,
                        "height": geom.height,
                    }
                )
        if depth >= 3:
            return
        try:
            for child in win.query_tree().children:
                walk(child, depth + 1)
        except Exception:
            pass

    walk(d.screen().root)
    return out


def keycode(d, keysym):
    code = d.keysym_to_keycode(keysym)
    if not code:
        raise SystemExit(f"no keycode for {XK.keysym_to_string(keysym) or keysym}")
    return code


def press(d, code):
    xtest.fake_input(d, X.KeyPress, code)
    d.sync()


def release(d, code):
    xtest.fake_input(d, X.KeyRelease, code)
    d.sync()


def tap(d, code, delay=0.01):
    press(d, code)
    time.sleep(delay)
    release(d, code)


def move(d, x, y):
    xtest.fake_input(d, X.MotionNotify, x=int(x), y=int(y))
    d.sync()


def click(d, x, y, button=1, count=1):
    move(d, x, y)
    time.sleep(0.05)
    for _ in range(int(count)):
        xtest.fake_input(d, X.ButtonPress, BUTTONS.get(button, 1))
        xtest.fake_input(d, X.ButtonRelease, BUTTONS.get(button, 1))
        d.sync()
        time.sleep(0.05)


def scroll(d, x, y, amount):
    move(d, x, y)
    time.sleep(0.05)
    button = 4 if int(amount) > 0 else 5
    for _ in range(abs(int(amount))):
        xtest.fake_input(d, X.ButtonPress, button)
        xtest.fake_input(d, X.ButtonRelease, button)
        d.sync()
        time.sleep(0.02)


def type_text(d, text):
    for ch in text:
        if ch == "\n":
            tap(d, keycode(d, XK.XK_Return))
            continue
        if ch == "\t":
            tap(d, keycode(d, XK.XK_Tab))
            continue
        keysym = XK.string_to_keysym(ch)
        if not keysym:
            # Look the character up in the keyboard map.
            keysym = ord(ch) + 0x01000000
        code = keycode(d, keysym)
        # Level 1 is unshifted; anything else needs shift held.
        needs_shift = d.keycode_to_keysym(code, 0) != keysym
        shift = keycode(d, XK.XK_Shift_L)
        if needs_shift:
            press(d, shift)
        tap(d, code)
        if needs_shift:
            release(d, shift)


def key_chord(d, key, mods):
    mod_codes = []
    for mod in mods:
        sym = MOD_KEYSYMS.get(mod)
        if not sym:
            raise SystemExit(f"unknown modifier: {mod}")
        mod_codes.append(keycode(d, XK.string_to_keysym(sym)))
    base = keycode(d, XK.string_to_keysym(key) or ord(key))
    for code in mod_codes:
        press(d, code)
    tap(d, base)
    for code in reversed(mod_codes):
        release(d, code)


def main(argv):
    if len(argv) < 2:
        raise SystemExit(__doc__)
    d = display.Display()
    cmd, args = argv[1], argv[2:]

    if cmd == "windows":
        print(json.dumps(windows(d)))
    elif cmd == "move":
        move(d, args[0], args[1])
    elif cmd == "click":
        click(d, args[0], args[1], args[2] if len(args) > 2 else 1, args[3] if len(args) > 3 else 1)
    elif cmd == "drag":
        move(d, args[0], args[1])
        time.sleep(0.05)
        xtest.fake_input(d, X.ButtonPress, 1)
        d.sync()
        time.sleep(0.05)
        move(d, args[2], args[3])
        time.sleep(0.05)
        xtest.fake_input(d, X.ButtonRelease, 1)
        d.sync()
    elif cmd == "scroll":
        scroll(d, args[0], args[1], args[2])
    elif cmd == "key":
        key_chord(d, args[0], args[1:])
    elif cmd == "type":
        type_text(d, args[0])
    else:
        raise SystemExit(f"unknown command: {cmd}")
    d.sync()


if __name__ == "__main__":
    main(sys.argv)
