import { memo, useEffect, useRef } from 'react';

interface DropTrack {
  x: number;
  start: number;
  speed: number;
  width: number;
  trail: number;
  phase: number;
}

// Narrow, irregular rivulets instead of floating glass orbs. The first six
// tracks cover a phone; the rest are added only when there is room.
const TRACKS: readonly DropTrack[] = [
  { x: 0.07, start: 0.16, speed: 11, width: 8, trail: 105, phase: 0.3 },
  { x: 0.23, start: 0.72, speed: 18, width: 13, trail: 205, phase: 1.8 },
  { x: 0.39, start: 0.38, speed: 9, width: 9, trail: 130, phase: 2.9 },
  { x: 0.56, start: 0.86, speed: 15, width: 11, trail: 185, phase: 4.1 },
  { x: 0.75, start: 0.09, speed: 12, width: 10, trail: 155, phase: 5.2 },
  { x: 0.92, start: 0.6, speed: 20, width: 14, trail: 245, phase: 6.4 },
  { x: 0.14, start: 0.28, speed: 8, width: 8, trail: 100, phase: 7.7 },
  { x: 0.48, start: 0.79, speed: 16, width: 12, trail: 200, phase: 9.2 },
  { x: 0.83, start: 0.43, speed: 10, width: 9, trail: 125, phase: 10.6 },
];

function random(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function makeFog(width: number, height: number, scale: number, light: boolean): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.fillStyle = light ? 'rgba(156, 183, 191, .21)' : 'rgba(188, 211, 222, .14)';
  context.fillRect(0, 0, width, height);

  const next = random(47031);
  const count = Math.min(56, Math.max(22, Math.round((width * height) / 22000)));
  for (let index = 0; index < count; index += 1) {
    const x = next() * width;
    const y = next() * height;
    const radius = 25 + next() * 120;
    const cloud = context.createRadialGradient(x, y, 0, x, y, radius);
    const alpha = 0.04 + next() * 0.065;
    cloud.addColorStop(
      0,
      light ? `rgba(255, 255, 255, ${alpha})` : `rgba(230, 242, 246, ${alpha})`
    );
    cloud.addColorStop(1, 'rgba(255, 255, 255, 0)');
    context.fillStyle = cloud;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  return canvas;
}

function tracePath(
  context: CanvasRenderingContext2D,
  track: DropTrack,
  width: number,
  from: number,
  to: number,
  offset = 0
) {
  const xAt = (y: number) =>
    track.x * width +
    Math.sin(y * 0.012 + track.phase) * 3.2 +
    Math.sin(y * 0.032 + track.phase * 1.7) * 1.1 +
    offset;
  context.beginPath();
  context.moveTo(xAt(from), from);
  for (let y = from + 9; y < to; y += 9) context.lineTo(xAt(y), y);
  context.lineTo(xAt(to), to);
  return xAt(to);
}

function drawDrop(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  light: boolean
) {
  context.save();
  context.translate(x, y);
  const half = width / 2;
  const height = width * 1.6;
  context.beginPath();
  context.moveTo(-half * 0.15, -height * 0.8);
  context.bezierCurveTo(
    half * 0.18,
    -height * 0.55,
    half * 0.9,
    -height * 0.34,
    half,
    height * 0.12
  );
  context.bezierCurveTo(half * 1.12, height * 0.62, half * 0.54, height * 0.9, 0, height * 0.9);
  context.bezierCurveTo(
    -half * 0.75,
    height * 0.9,
    -half * 1.14,
    height * 0.5,
    -half,
    height * 0.05
  );
  context.bezierCurveTo(
    -half * 0.9,
    -height * 0.38,
    -half * 0.28,
    -height * 0.6,
    -half * 0.15,
    -height * 0.8
  );
  context.closePath();

  const body = context.createLinearGradient(-half, -height, half, height);
  if (light) {
    body.addColorStop(0, 'rgba(255, 255, 255, .68)');
    body.addColorStop(0.35, 'rgba(238, 250, 251, .28)');
    body.addColorStop(0.72, 'rgba(87, 128, 145, .25)');
    body.addColorStop(1, 'rgba(255, 255, 255, .6)');
  } else {
    body.addColorStop(0, 'rgba(226, 247, 250, .56)');
    body.addColorStop(0.34, 'rgba(107, 155, 176, .17)');
    body.addColorStop(0.7, 'rgba(4, 19, 32, .55)');
    body.addColorStop(1, 'rgba(180, 225, 237, .5)');
  }
  context.fillStyle = body;
  context.fill();
  context.strokeStyle = light ? 'rgba(65, 106, 123, .38)' : 'rgba(191, 229, 237, .42)';
  context.lineWidth = 0.9;
  context.stroke();

  context.beginPath();
  context.moveTo(-half * 0.48, -height * 0.18);
  context.quadraticCurveTo(-half * 0.6, -height * 0.58, -half * 0.07, -height * 0.59);
  context.strokeStyle = light ? 'rgba(255, 255, 255, .74)' : 'rgba(237, 250, 251, .63)';
  context.lineWidth = Math.max(0.8, width * 0.1);
  context.lineCap = 'round';
  context.stroke();
  context.restore();
}

function paintFrame(
  context: CanvasRenderingContext2D,
  fog: HTMLCanvasElement,
  width: number,
  height: number,
  elapsedMs: number,
  light: boolean
) {
  context.clearRect(0, 0, width, height);
  context.drawImage(fog, 0, 0, width, height);
  const tracks = width < 600 ? TRACKS.slice(0, 6) : TRACKS;
  for (const track of tracks) {
    const distance = height + track.trail + 100;
    const y =
      ((((track.start * height + (elapsedMs / 1000) * track.speed) % distance) + distance) %
        distance) -
      track.trail * 0.32;
    const from = Math.max(-15, y - track.trail);
    if (y < -20 || from >= height) continue;
    const to = Math.min(y, height + 20);

    // A drop wipes a translucent channel through the condensation. Both the
    // cleared centre and its reflective edges follow the same uneven path.
    context.save();
    context.globalCompositeOperation = 'destination-out';
    tracePath(context, track, width, from, to);
    context.strokeStyle = 'rgba(0, 0, 0, .55)';
    context.lineWidth = Math.max(1.4, track.width * 0.24);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    tracePath(context, track, width, from + (to - from) * 0.52, to);
    context.lineWidth = track.width * 0.5;
    context.stroke();
    context.restore();

    tracePath(context, track, width, from, to, -track.width * 0.2);
    context.strokeStyle = light ? 'rgba(255, 255, 255, .25)' : 'rgba(221, 245, 249, .14)';
    context.lineWidth = 0.8;
    context.stroke();
    tracePath(context, track, width, from, to, track.width * 0.2);
    context.strokeStyle = light ? 'rgba(61, 99, 116, .1)' : 'rgba(4, 20, 34, .12)';
    context.stroke();

    const dropX =
      track.x * width +
      Math.sin(y * 0.012 + track.phase) * 3.2 +
      Math.sin(y * 0.032 + track.phase * 1.7) * 1.1;
    if (y > -20 && y < height + 20) {
      drawDrop(context, dropX, y, track.width, light);
      if (track.width >= 11) {
        drawDrop(
          context,
          dropX - track.width * 0.17,
          y - track.width * 2.8,
          track.width * 0.27,
          light
        );
      }
    }
  }
}

export const MistyWindowBackground = memo(function MistyWindowBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: true });
    if (!canvas || !context) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let fog: HTMLCanvasElement;
    let width = 0;
    let height = 0;
    let scale = 1;
    let light = false;
    let elapsed = 0;
    let lastTick = performance.now();
    let timer: number | undefined;

    const draw = () => paintFrame(context, fog, width, height, elapsed, light);
    const resize = () => {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      scale = Math.min(window.devicePixelRatio || 1, 1.25, Math.sqrt(1_600_000 / (width * height)));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      light = document.documentElement.classList.contains('light');
      fog = makeFog(width, height, scale, light);
      draw();
    };
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const syncPlayback = () => {
      stop();
      if (document.documentElement.classList.contains('eink')) {
        context.clearRect(0, 0, width, height);
        return;
      }
      if (motion.matches) elapsed = 0;
      draw();
      if (document.hidden || motion.matches) return;
      lastTick = performance.now();
      timer = window.setInterval(() => {
        const now = performance.now();
        elapsed += Math.min(now - lastTick, 100);
        lastTick = now;
        draw();
      }, 50);
    };
    const themeObserver = new MutationObserver(() => {
      resize();
      syncPlayback();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', syncPlayback);
    motion.addEventListener('change', syncPlayback);
    resize();
    syncPlayback();
    return () => {
      stop();
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', syncPlayback);
      motion.removeEventListener('change', syncPlayback);
    };
  }, []);

  return (
    <div
      className="mist-window-backdrop pointer-events-none fixed inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ zIndex: 0 }}
    >
      <div className="mist-window-beyond" />
      <div className="mist-window-texture" />
      <canvas ref={canvasRef} className="mist-window-canvas" />
      <div className="mist-window-vignette" />
      <div className="plum-bg-grain" />
    </div>
  );
});
