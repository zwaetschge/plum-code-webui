export interface AssistantMotionShape {
  id: string;
  kind: 'rectangle' | 'circle' | 'text';
  x: number;
  y: number;
  toX: number;
  toY: number;
  width: number;
  height: number;
  color: string;
  text: string;
  fontSize: number;
}
export interface AssistantMotion {
  type: 'plum-motion';
  version: 1;
  width: number;
  height: number;
  duration: number;
  fps: number;
  background: string;
  shapes: AssistantMotionShape[];
  /** Independent bodies, gravity and reflections at the canvas edges. Text is a fixed caption. */
  physics?: { gravity: number; bounce: number; velocityX: number; velocityY: number };
}
export function parseAssistantMotion(content: string): AssistantMotion {
  const invalid = (): never => {
    throw new Error('Ungültige Plum-Animation');
  };
  if (content.length > 50000) invalid();
  const raw = JSON.parse(content);
  const number = (value: unknown, min: number, max: number, integer = false) => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isInteger(value))
    )
      invalid();
    return value as number;
  };
  const color = (value: unknown) => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) invalid();
    return value as string;
  };
  if (
    raw?.type !== 'plum-motion' ||
    raw.version !== 1 ||
    !Array.isArray(raw.shapes) ||
    raw.shapes.length > 20
  )
    invalid();
  const ids = new Set<string>();
  const shapes: AssistantMotionShape[] = raw.shapes.map((item: Record<string, unknown>) => {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(item.id) ||
      ids.has(item.id) ||
      !['rectangle', 'circle', 'text'].includes(String(item.kind)) ||
      typeof item.text !== 'string' ||
      item.text.length > 2000
    )
      invalid();
    ids.add(item.id as string);
    return {
      id: item.id,
      kind: item.kind as AssistantMotionShape['kind'],
      x: number(item.x, -1280, 2560),
      y: number(item.y, -720, 1440),
      toX: number(item.toX, -1280, 2560),
      toY: number(item.toY, -720, 1440),
      width: number(item.width, 1, 1280),
      height: number(item.height, 1, 720),
      color: color(item.color),
      text: item.text as string,
      fontSize: number(item.fontSize, 8, 200),
    };
  });
  const width = number(raw.width, 240, 1280, true),
    height = number(raw.height, 160, 720, true);
  if (width % 2 || height % 2) invalid();
  const physics =
    raw.physics === undefined
      ? undefined
      : {
          gravity: number(raw.physics?.gravity, -2000, 2000),
          bounce: number(raw.physics?.bounce, 0, 1),
          velocityX: number(raw.physics?.velocityX, -1000, 1000),
          velocityY: number(raw.physics?.velocityY, -1000, 1000),
        };
  if (
    physics &&
    shapes.some(
      (shape) =>
        shape.kind !== 'text' &&
        (shape.width > width || (shape.kind === 'circle' ? shape.width : shape.height) > height)
    )
  )
    invalid();
  return {
    type: 'plum-motion',
    version: 1,
    width,
    height,
    duration: number(raw.duration, 1, 10, true),
    fps: number(raw.fps, 1, 12, true),
    background: color(raw.background),
    shapes,
    ...(physics ? { physics } : {}),
  };
}
/** Fixed 120 Hz integration; no timers, randomness, source execution or external data. */
export function assistantMotionPosition(
  motion: AssistantMotion,
  shape: AssistantMotionShape,
  progress: number
) {
  const time = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (!motion.physics)
    return { x: shape.x + (shape.toX - shape.x) * time, y: shape.y + (shape.toY - shape.y) * time };
  if (shape.kind === 'text') return { x: shape.x, y: shape.y };
  const settings = motion.physics,
    maxX = motion.width - shape.width,
    maxY = motion.height - (shape.kind === 'circle' ? shape.width : shape.height);
  let x = Math.max(0, Math.min(maxX, shape.x)),
    y = Math.max(0, Math.min(maxY, shape.y)),
    vx = settings.velocityX,
    vy = settings.velocityY;
  const reflect = (position: number, velocity: number, maximum: number) => {
    if (maximum === 0) return [0, 0];
    if (position >= 0 && position <= maximum) return [position, velocity];
    const folded = ((position % (2 * maximum)) + 2 * maximum) % (2 * maximum);
    return [
      folded <= maximum ? folded : 2 * maximum - folded,
      (folded <= maximum ? velocity : -velocity) * settings.bounce,
    ];
  };
  const seconds = time * motion.duration,
    steps = Math.floor(seconds * 120);
  for (let step = 0; step <= steps; step++) {
    const dt = step === steps ? seconds - steps / 120 : 1 / 120;
    if (dt <= 0) break;
    vy += settings.gravity * dt;
    [x, vx] = reflect(x + vx * dt, vx, maxX) as [number, number];
    [y, vy] = reflect(y + vy * dt, vy, maxY) as [number, number];
  }
  return { x, y };
}
export function motionFromText(text: string): AssistantMotion {
  return {
    type: 'plum-motion',
    version: 1,
    width: 640,
    height: 360,
    duration: 4,
    fps: 10,
    background: '#FFFFFF',
    shapes: [
      {
        id: 'shape-1',
        kind: 'circle',
        x: 30,
        y: 150,
        toX: 500,
        toY: 150,
        width: 80,
        height: 80,
        color: '#1856FF',
        text: '',
        fontSize: 24,
      },
      {
        id: 'caption-1',
        kind: 'text',
        x: 30,
        y: 35,
        toX: 30,
        toY: 35,
        width: 560,
        height: 80,
        color: '#141414',
        text: text.slice(0, 2000) || 'Meine Animation',
        fontSize: 24,
      },
    ],
  };
}
export function assistantMotionSvg(motion: AssistantMotion, progress: number) {
  const time = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const escape = (value: string) =>
    value
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!
      );
  const shapes = motion.shapes
    .map((shape) => {
      const { x, y } = assistantMotionPosition(motion, shape, time);
      if (shape.kind === 'rectangle')
        return `<rect x="${x}" y="${y}" width="${shape.width}" height="${shape.height}" rx="8" fill="${shape.color}"/>`;
      if (shape.kind === 'circle')
        return `<circle cx="${x + shape.width / 2}" cy="${y + shape.width / 2}" r="${shape.width / 2}" fill="${shape.color}"/>`;
      return `<text x="${x}" y="${y}" fill="${shape.color}" font-size="${shape.fontSize}" font-family="Arial,sans-serif">${shape.text
        .split('\n')
        .map(
          (line, index) =>
            `<tspan x="${x}" dy="${index ? shape.fontSize * 1.25 : 0}">${escape(line)}</tspan>`
        )
        .join('')}</text>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${motion.width}" height="${motion.height}" viewBox="0 0 ${motion.width} ${motion.height}" role="img" aria-label="Plum-Animation"><rect width="100%" height="100%" fill="${motion.background}"/>${shapes}</svg>`;
}
