// Run: node start.js examples/gtk/drag-box/drag-box.ts
import { imports } from '../../../gi-loader.ts';

imports.gi.versions.Gtk = '4.0';
const { Gtk } = imports.gi;

console.log("--- GTK4 Flicker-free Draggable Square (Cairo) ---");

const app = new Gtk.Application({ application_id: 'org.gtk.dragbox' });

app.connect('activate', () => {
    const window = new Gtk.ApplicationWindow({
        application: app,
        title: 'Drag Example (High Frequency IPC) ',
        default_width: 600,
        default_height: 400
    });

    const fixed = new Gtk.Fixed();
    fixed.set_hexpand(true);
    fixed.set_vexpand(true);

    const squareSize = 80;
    const drawingArea = new Gtk.DrawingArea();
    drawingArea.set_size_request(squareSize, squareSize);

    const drawFunction = (area: any, cr: any, width: number, height: number) => {
        cr.setSourceRGB(1.0, 0.2, 0.2);
        cr.rectangle(0, 0, width, height);
        cr.fill();
    };

    drawingArea.set_draw_func(drawFunction);

    let currentX = 260;
    let currentY = 160;
    fixed.put(drawingArea, currentX, currentY);

    const drag = new Gtk.GestureDrag();
    
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;

    drag.connect('drag-begin', (gesture: any, startX: number, startY: number) => {
        if (startX >= currentX && startX <= currentX + squareSize &&
            startY >= currentY && startY <= currentY + squareSize) {
            isDragging = true;
            dragStartX = currentX;
            dragStartY = currentY;
            console.log(`✅ Drag started at: (${startX}, ${startY})`);
        }
    });

    drag.connect('drag-update', (gesture: any, offsetX: number, offsetY: number) => {
        if (!isDragging) return;
        const newX = dragStartX + offsetX;
        const newY = dragStartY + offsetY;
        fixed.move(drawingArea, newX, newY);
    });

    drag.connect('drag-end', (gesture: any, offsetX: number, offsetY: number) => {
        if (!isDragging) return;
        isDragging = false;
        currentX = dragStartX + offsetX;
        currentY = dragStartY + offsetY;
        console.log(`🛑 Drag ended at position: (${currentX}, ${currentY})`);
    });

    fixed.add_controller(drag);

    window.set_child(fixed);
    window.present();

    console.log("Window loaded. Try dragging the red square smoothly!");
});

app.run([]);
