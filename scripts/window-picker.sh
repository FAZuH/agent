#!/usr/bin/env bash
set -euo pipefail
mapfile -t entries < <(hyprctl clients -j | jq -r 'sort_by(.workspace.id) | to_entries[] | "\(.key + 1)  \(.value.workspace.name)  \(.value.class)  \(.value.title)"')
[ "${#entries[@]}" -gt 0 ] || exit 0
choice=$(printf '%s\n' "${entries[@]}" | omarchy-menu-select "Windows") || exit 0
[ -n "$choice" ] || exit 0
addr=$(hyprctl clients -j | jq -r --argjson i "${choice%% *}" 'sort_by(.workspace.id) | .[$i - 1].address')
[ -n "$addr" ] && [ "$addr" != "null" ] && hyprctl dispatch focuswindow "address:$addr"
