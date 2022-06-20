#!/bin/fish
source ./read-env.sh
curl -X POST -H 'Content-Type: application/x-www-form-urlencoded' -u "$CLIENT_KEY:$CLIENT_SECRET"\
  -d 'grant_type=client_credentials&scope=applications.commands.update' "https://discord.com/api/v10/oauth2/token"
