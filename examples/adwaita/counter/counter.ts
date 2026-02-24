// Run: node start.js examples/adwaita/counter/counter.ts
import { imports } from '../../../gi-loader.ts';

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const { Gtk, Adw } = imports.gi;

let clickCount = 0;

console.log("--- Adwaita Counter ---");

const app = new Adw.Application({ application_id: 'org.adwaita.counter' });

app.connect('activate', () => {
    const window = new Adw.ApplicationWindow({
        application: app,
        title: 'Adwaita Counter App',
        default_width: 400,
        default_height: 300
    });

    const toolbarView = new Adw.ToolbarView();

    const headerBar = new Adw.HeaderBar({
        title_widget: new Gtk.Label({ label: 'Adwaita Counter App' })
    });
    toolbarView.add_top_bar(headerBar);

    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 10,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER
    });
    box.set_margin_start(20);
    box.set_margin_end(20);
    box.set_margin_top(20);
    box.set_margin_bottom(20);

    const label = new Gtk.Label({
        label: 'Clicks: 0',
        css_classes: ['title-1']
    });

    const button = new Gtk.Button({
        label: 'Click to Add',
        css_classes: ['suggested-action']
    });

    button.connect('clicked', () => {
        clickCount++;
        const message = `Clicked ${clickCount} times`;
        label.set_label(message);
        console.log(message);
    });

    box.append(label);
    box.append(button);

    toolbarView.set_content(box);
    window.set_content(toolbarView);
    window.present();

    console.log("Click the button to increase the counter...");
});

app.run([]);
