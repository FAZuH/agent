#!/usr/bin/env bash

if [[ $HYDE_SHELL_INIT -ne 1 ]]; then
    eval "$(hyde-shell init)"
else
    export_hyde_config
fi

setup_rofi_config() {
    font_override="* {font: \"${ROFI_FONT:-"JetBrainsMono Nerd Font"} 10\";}"
    rofi_position=$(get_rofi_pos)
}

build_workspace_menu() {
    local data clients active_id

    data=$(hyprctl workspaces -j)
    clients=$(hyprctl clients -j)
    active_id=$(hyprctl activeworkspace -j | jq '.id')

    echo "$data" | jq -r --argjson active "$active_id" --argjson clients "$clients" '
        sort_by(.id) | .[] |
        . as $ws |
        "\(if .id == $active then "▶" else " " end)  \(.name)" +
        (
            [$clients[] | select(.workspace.name == $ws.name) | .class] | unique | sort |
            if length > 0 then " (" + join(", ") + ")" else "" end
        )
    '
}

parse_selection() {
    local sel="$1"

    sel="${sel%%$'\n'*}"
    echo "$sel" | cut -c4-
}

show_picker() {
    setup_rofi_config
    local choice ws

    choice=$(build_workspace_menu | rofi -dmenu -i -p "Workspaces" \
        -theme-str "$rofi_position" \
        -theme-str "$font_override" \
        -theme "clipboard")

    if [[ -n "$choice" ]]; then
        ws=$(parse_selection "$choice")
        hyprctl dispatch workspace "$ws"
    fi
}

workspace_picker() {
    local action="$1"

    case "$action" in
        pick|"" )
            show_picker
            ;;
        * )
            echo "Usage: workspace-picker.sh {pick}"
            ;;
    esac
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    workspace_picker "$@"
fi
