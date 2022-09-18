#!/bin/bash

DATA=$(curl --silent --unix-socket /run/tailscale/tailscaled.sock http://localhost/localapi/v0/status)

BACKENDSTATE=$(echo "$DATA" | jq -r .BackendState)

echo $BACKENDSTATE

