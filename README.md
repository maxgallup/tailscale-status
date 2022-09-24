# Tailscale status gnome-shell-extension
**This extension is in no way affiliated with Tailscale Inc.**

Easily view the status of your tailscale mesh network and toggle the status of your own machine.
Thus, this requires that you have **setup tailscale beforehand**. 

![menu image](pics/screenshot.png)

### Features
* Copy address of any node by clicking it in the menu
    * 💻 - your own computer
    * 🟢 - online or idle
    * ⚫ - offline
* enable/disable incoming connections
* accept/reject subnet routes
* *if exit node:* allow direct access to local network
* Accept or send files with taildrop
* Connect through an available [exit node](https://tailscale.com/kb/1103/exit-nodes/)

### Dependencies
This obviously **requires** [tailscale](https://tailscale.com) to work! To send files `python3` is required as well.

### Installation
Download the `tailscale-status@maxgallup.github.com` directory and move it to `~/.local/share/gnome-shell/extensions/`.
Enable the extension in *Extensions* or *Extension Manager*.
You might have to log in and out for the extension to be loaded.

### Contribution info
This has been tested with [PopOS 22.04](https://pop.system76.com/) and gnome 42 on a Lenovo Ideapad laptop. Feel free to open [pull requests](https://github.com/maxgallup/tailscale-status/pulls) to improve the extension!

### TODOs
- [ ] Test and support older gnome-shell versions (< 42)
- [ ] improve code readibility



