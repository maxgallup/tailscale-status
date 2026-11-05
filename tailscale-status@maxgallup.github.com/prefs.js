
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class TailscaleStatusExtensionPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {

       
        let settings = this.getSettings();
 
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

        const shortcutRow = new Adw.ActionRow({
            title: 'Toggle Shortcut',
            subtitle: 'e.g. &lt;Super&gt;&lt;Shift&gt;t, leave empty to disable'
        });
        group.add(shortcutRow);
        const shortcutBox = new Gtk.Entry({
            buffer: new Gtk.EntryBuffer()
        });
        shortcutBox.set_text(settings.get_strv('toggle-shortcut')[0] || '');
        shortcutBox.connect("changed", function (w) {
            const accel = w.get_buffer().text.trim();
            const [ok, key] = Gtk.accelerator_parse(accel);
            if (accel.length == 0) {
                w.remove_css_class('error');
                settings.set_strv('toggle-shortcut', []);
            } else if (ok && key != 0) {
                w.remove_css_class('error');
                settings.set_strv('toggle-shortcut', [accel]);
            } else {
                w.add_css_class('error');
            }
          });
        shortcutRow.add_suffix(shortcutBox);
    
        window.add(page);
    }
}






