#!/usr/bin/env fish
cat .env | \
  while read -l line
    set -l kv (string split -m 1 = -- $line)
    set -x $kv
  end
