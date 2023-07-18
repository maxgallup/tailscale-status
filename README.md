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
This obviously **requires** [tailscale](https://tailscale.com) to work! 

### Installation
Download the `tailscale-status@maxgallup.github.com` directory and move it to `~/.local/share/gnome-shell/extensions/`.
Enable the extension in *Extensions* or *Extension Manager*.
You might have to log in and out for the extension to be loaded.

### Contribute
Include a clear description of your suggestions in the form of an issues or [pull requests](https://github.com/maxgallup/tailscale-status/pulls).



### TODOs
- [ ] Test and support older gnome-shell versions (< 42)
- [ ] find solution to Issue #12, #9

