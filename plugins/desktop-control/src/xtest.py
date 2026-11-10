#!/usr/bin/env python3
"""XTest keyboard input for XWayland clients.

Wayland-native clients (kitty, Brave, ...) get keyboard input from wtype; this
is the fallback for clients that live in XWayland: Wine/Proton games, Steam,
and other X11 apps.

    xtest.py key KEY [MOD...]
    xtest.py type TEXT
"""
import sys
import time

from Xlib import X, XK, display
from Xlib.ext import xtest

# wtype/TS modifier names -> X keysym names.
MOD_KEYSYMS = {
    "ctrl": "Control_L",
    "shift": "Shift_L",
    "alt": "Alt_L",
    "logo": "Super_L",
}


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

    if cmd == "key":
        key_chord(d, args[0], args[1:])
    elif cmd == "type":
        type_text(d, args[0])
    else:
        raise SystemExit(f"unknown command: {cmd}")
    d.sync()


if __name__ == "__main__":
    main(sys.argv)
