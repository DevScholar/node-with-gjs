// Run: node start.js examples/gtk/counter/counter.ts
import { imports } from '../../../gi-loader.ts';

imports.gi.versions.Gtk = '4.0';
const { Gtk } = imports.gi;

let clickCount = 0;

console.log("--- GTK4 Counter ---");

const app = new Gtk.Application({ application_id: 'org.gtk.counter' });

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'GTK Counter App',
        default_width: 400,
        default_height: 300
    });

    window.connect('close-request', () => {
        app.quit();
        return false;
    });

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

    window.set_child(box);
    window.present();

    console.log("Click the button to increase the counter...");
});

app.run([]);
