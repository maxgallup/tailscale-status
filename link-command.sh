#!/bin/bash

cd $HOME/oss/tailscale-status/tailscale-status@maxgallup.github.com

glib-compile-schemas schemas/

ln -s $HOME/oss/tailscale-status/tailscale-status@maxgallup.github.com $HOME/.local/share/gnome-shell/extensions/tailscale-status@maxgallup.github.com


