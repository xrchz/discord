#!/bin/fish
source ./read-env.sh
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json'\
  -d '{"name": "rosaria", "type": 1, "description": "Track Rosaria"}' "https://discord.com/api/v10/applications/$CLIENT_KEY/commands"
