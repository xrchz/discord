#!/usr/bin/env fish
source ./read-env.fish
curl -X GET -H "Authorization: Bot $BOT_TOKEN" \
  "https://discord.com/api/v10/channels/$CHANNEL/messages" \
> messages.json
