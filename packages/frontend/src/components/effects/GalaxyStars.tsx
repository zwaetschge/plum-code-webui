import { memo } from 'react';
import type { CSSProperties } from 'react';

interface Star {
  x: number;
  y: number;
  size: number;
  opacity: number;
  tone: 'white' | 'cyan' | 'violet' | 'gold';
  bright: boolean;
  twinkle: boolean;
  duration: number;
  delay: number;
}

// Fixed seed keeps the sky stable across rerenders and device reconnects.
// A loose diagonal band gives the galaxy some structure without tiled dots.
function createStars(): Star[] {
  let seed = 0x724ac39;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  return Array.from({ length: 48 }, (_, index) => {
    const x = 3 + random() * 94;
    const inBand = random() < 0.34;
    const bandY = 75 - x * 0.2 + (random() - 0.5) * 40;
    const y = inBand ? Math.max(3, Math.min(97, bandY)) : 3 + random() * 94;
    const bright = index % 21 === 4;
    const medium = !bright && index % 7 === 2;
    const size = bright
      ? 2.3 + random() * 0.7
      : medium
        ? 1.55 + random() * 0.45
        : 0.9 + random() * 0.5;
    const opacity = bright
      ? 0.78 + random() * 0.15
      : medium
        ? 0.55 + random() * 0.2
        : 0.32 + random() * 0.25;
    const toneRoll = random();
    const tone =
      toneRoll < 0.65 ? 'white' : toneRoll < 0.84 ? 'cyan' : toneRoll < 0.96 ? 'violet' : 'gold';

    return {
      x,
      y,
      size,
      opacity,
      tone,
      bright,
      twinkle: bright || index === 31,
      duration: 5 + random() * 8,
      delay: -random() * 12,
    };
  });
}

const STARS = createStars();

export const GalaxyStars = memo(function GalaxyStars() {
  return (
    <div className="galaxy-starfield" aria-hidden="true">
      {STARS.map((star, index) => (
        <span
          key={index}
          className={`galaxy-star galaxy-star-${star.tone}${star.bright ? ' is-bright' : ''}${star.twinkle ? ' is-twinkling' : ''}`}
          style={
            {
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              '--star-opacity': star.opacity,
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
});
