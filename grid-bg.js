/**
 * grid-bg.js — Revolution Network
 * Fond quadrillage rouge avec effet lumière souris
 * Inclure avant </body> dans index.html
 */
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'grid-bg';
  canvas.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'z-index:0',
    'pointer-events:none',
    'display:block',
  ].join(';');
  document.body.insertBefore(canvas, document.body.firstChild);

  // S'assurer que .app et les autres éléments directs sont au dessus
  const style = document.createElement('style');
  style.textContent = `
    body > *:not(#grid-bg) { position: relative; z-index: 1; }
  `;
  document.head.appendChild(style);

  const ctx = canvas.getContext('2d');
  const CELL = 40;
  const RADIUS = 180;
  let mouse = { x: -9999, y: -9999 };

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function draw() {
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Fond noir
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, W, H);

    const cols = Math.ceil(W / CELL) + 1;
    const rows = Math.ceil(H / CELL) + 1;

    // Lignes de la grille
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = c * CELL;
        const y = r * CELL;
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const intensity = Math.max(0, 1 - dist / RADIUS);
        const alpha = 0.07 + intensity * 0.88;

        ctx.strokeStyle = `rgba(210, 25, 25, ${alpha})`;
        ctx.lineWidth = 0.5 + intensity * 0.9;

        if (c < cols - 1) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + CELL, y);
          ctx.stroke();
        }
        if (r < rows - 1) {
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x, y + CELL);
          ctx.stroke();
        }
      }
    }

    // Points aux intersections
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const x = c * CELL;
        const y = r * CELL;
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const intensity = Math.max(0, 1 - dist / RADIUS);
        if (intensity > 0.04) {
          ctx.beginPath();
          ctx.arc(x, y, 2 * intensity, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 70, 70, ${intensity * 0.9})`;
          ctx.fill();
        }
      }
    }

    requestAnimationFrame(draw);
  }

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
  });
  window.addEventListener('mouseleave', () => {
    mouse.x = -9999;
    mouse.y = -9999;
  });
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX;
    mouse.y = t.clientY;
  }, { passive: true });
  window.addEventListener('resize', resize);

  resize();
  draw();
})();
