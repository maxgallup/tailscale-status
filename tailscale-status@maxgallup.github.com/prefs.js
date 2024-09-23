
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
    
        window.add(page);
    }
}






