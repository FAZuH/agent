#!/usr/bin/env bash

lookup_clipboard_word() {
    local word max_len=100 query

    word=$(wl-paste --type text 2>/dev/null | head -n 1 | awk '{$1=$1; print}')

    if [[ -z "$word" || ${#word} -gt $max_len ]]; then
        exit 0
    fi

    query=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$word")
    xdg-open "https://www.merriam-webster.com/dictionary/$query"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    lookup_clipboard_word "$@"
fi
