const { Adw, Gio, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


function init() {
}

function fillPreferencesWindow(window) { 
    const settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.tailscale-status")
 
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    page.add(group);

    const row = new Adw.ActionRow({ title: 'Login-Server URL' });
    group.add(row);
    const textBox = new Gtk.Entry({
        buffer: new Gtk.EntryBuffer()
    });
    textBox.set_text(settings.get_string ('login-server'));
    textBox.connect("changed", function (w) {
        // .get_buffer().text
        settings.set_string('login-server',w.get_buffer().text)
        
      });
    row.add_suffix(textBox);

    window.add(page);
}