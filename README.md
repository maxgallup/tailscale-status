# Tailscale status gnome-shell-extension

With this simple extension you get to easily see the status of your tailscale mesh network.
Thus, this requires that you have **setup tailscale beforehand**. 

![menu image](pics/menu.png)

The main menu shows the status of the various devices you have registered. Clicking on any of the
menu items will copy the IP address of that device to your clipboard.
* 🟢 - indicates online or idle
* 💻 - indicates your own computer
* ❌ - indicates offline

After that there is a menu that shows available connections for using as an [exit node](https://tailscale.com/kb/1103/exit-nodes/).

### Installation
This **requires** tailscale to work!
Download the `tailscale-status@maxgallup.github.com` directory and move it to `~/.local/share/gnome-shell/extensions/`.
Enable the extension in *Extensions* or *Extension Manager*.
You might have to log in and out for the extension to be loaded.

### Contribution info
This has been tested with [PopOS 22.04](https://pop.system76.com/) and gnome 42 on a Lenovo Ideapad laptop. Feel free to open [pull requests](https://github.com/maxgallup/tailscale-status/pulls) to improve the extension!
