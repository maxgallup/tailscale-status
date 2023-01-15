const { Adw, Gio, Gtk } = imports.gi;

const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();


function init() {
}

function fillPreferencesWindow(window) {
 
    const settings = ExtensionUtils.getSettings("org.gnome.shell.extensions.tailscale-status")
   
    log(settings)
 
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup();
    page.add(group);

 
    const firstRow = new Adw.ActionRow({ title: 'Refresh time (seconds)' });
    group.add(firstRow);

    let spinButton = new Gtk.SpinButton({
             value: settings.get_int ('refresh-interval'),
             valign: Gtk.Align.CENTER,
         });
    spinButton.set_sensitive(true);
    spinButton.set_range(0, 120);
    spinButton.set_increments(1, 2);
    spinButton.set_value(settings.get_int ('refresh-interval'));
    spinButton.connect("value-changed", function (w) {
      
        settings.set_int ('refresh-interval',w.get_value_as_int())
      });
    
     
   
    firstRow.add_suffix(spinButton);
    firstRow.activatable_widget = spinButton;
    const secondRow = new Adw.ActionRow({ title: 'Login-Server URL' });
    group.add(secondRow);
    const textBox = new Gtk.Entry({
        buffer: new Gtk.EntryBuffer()
    });
    textBox.set_text(settings.get_string ('login-server'));
    textBox.connect("changed", function (w) {
        // .get_buffer().text
        settings.set_string('login-server',w.get_buffer().text)
        
      });
    secondRow.add_suffix(textBox);

    window.add(page);
}