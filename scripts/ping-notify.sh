#!/bin/bash
if [[ $# -lt 1 ]]; then
    echo "Usage: ping-notify.sh <target-ip>" >&2
    exit 1
fi
TARGET_IP="$1"

discord-notify() {
    local message="$1"
    local webhook_url
    local user_id
    webhook_url=$(sed -n '1p' {{USER_HOME}}/.secrets/discord/notify.key)
    user_id=$(sed -n '2p' {{USER_HOME}}/.secrets/discord/notify.key)
    curl -s -H "Content-Type: application/json" \
        -d "{\"content\": \"<@${user_id}> $message\"}" \
        "$webhook_url"
}

echo "Waiting for $TARGET_IP to come up..."
while true; do
    if ping -c 1 -W 3 "$TARGET_IP" > /dev/null 2>&1; then
        discord-notify "✅ **Host is UP!**\n\nTarget \`$TARGET_IP\` is now active."
        echo "Host $TARGET_IP is active. Discord notification sent."
        break
    else
        echo "$(date '+%H:%M:%S') Host $TARGET_IP is not responding. Retrying in 30s..."
        sleep 30
    fi
done
