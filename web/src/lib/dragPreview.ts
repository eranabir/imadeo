/**
 * Custom drag image for photos.
 *
 * Drawn onto a canvas rather than built from DOM nodes. `setDragImage` snapshots
 * the element synchronously, and a freshly created `<img>` has not decoded yet
 * at that moment — so a DOM-based preview came out blank and the browser fell
 * back to its own washed-out ghost. Canvas paints immediately, because the
 * source image on the page is already loaded.
 */
export function setPhotoDragImage(
  event: React.DragEvent,
  source: HTMLImageElement | null,
  count: number,
) {
  const SIZE = 84;
  const PAD = 14;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const box = SIZE + PAD * 2;

  const canvas = document.createElement('canvas');
  canvas.width = box * dpr;
  canvas.height = box * dpr;
  canvas.style.width = `${box}px`;
  canvas.style.height = `${box}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const card = (x: number, y: number, rotation: number, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + SIZE / 2, y + SIZE / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-SIZE / 2, -SIZE / 2);

    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;

    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, 12);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    return ctx;
  };

  // Cards fanned out behind the front one, so a multi-selection looks like a stack.
  if (count > 1) {
    card(PAD, PAD, -9, 0.6);
    ctx.restore();
    card(PAD, PAD, 5, 0.85);
    ctx.restore();
  }

  card(PAD, PAD, 0, 1);

  if (source?.complete && source.naturalWidth > 0) {
    // Cover-crop the thumbnail into the rounded card.
    const inset = 3;
    const side = SIZE - inset * 2;
    ctx.beginPath();
    ctx.roundRect(inset, inset, side, side, 9);
    ctx.clip();

    const scale = Math.max(side / source.naturalWidth, side / source.naturalHeight);
    const w = source.naturalWidth * scale;
    const h = source.naturalHeight * scale;
    ctx.drawImage(source, inset + (side - w) / 2, inset + (side - h) / 2, w, h);
  } else {
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(3, 3, SIZE - 6, SIZE - 6);
  }
  ctx.restore();

  if (count > 1) {
    const label = String(count);
    const radius = 13;
    const cx = box - radius - 2;
    const cy = radius + 2;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'oklch(52% 0.115 205)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 13px ui-sans-serif, system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 0.5);
  }

  // The element still has to be in the document for the browser to snapshot it.
  Object.assign(canvas.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    pointerEvents: 'none',
    // Kept on screen but fully transparent: an element parked far outside the
    // viewport is not painted, and an unpainted element yields a blank preview.
    opacity: '0.01',
    zIndex: '-1',
  });
  document.body.appendChild(canvas);

  event.dataTransfer.setDragImage(canvas, box / 2, box / 2);

  // The snapshot is taken synchronously, so the node can go on the next frame.
  requestAnimationFrame(() => canvas.remove());
}
