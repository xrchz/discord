#!/usr/bin/env fish
jq 'map({user: .author.id, name: .author.username, addr: (.content | scan("0x[0-9a-fA-F]{40}"))})' messages.json > addresses.json
