#!/bin/fish
source ./read-env.sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'\
  -d '{"name": "lsd-price", "type": 1, "description": "Get prices for LSDs"}' "https://discord.com/api/v10/applications/$CLIENT_KEY/commands"
