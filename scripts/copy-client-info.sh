#!/usr/bin/env bash

copy_client_info() {
    local addr data

    addr=$(hyprctl activewindow -j 2>/dev/null | jq -r '.address')

    if [[ "$addr" == "null" || -z "$addr" ]]; then
        notify-send "No active window found"
        exit 1
    fi

    data=$(hyprctl clients -j | jq --arg addr "$addr" '.[] | select(.address == $addr)')
    echo "$data" | wl-copy
    notify-send "Client info copied to clipboard"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    copy_client_info "$@"
fi
