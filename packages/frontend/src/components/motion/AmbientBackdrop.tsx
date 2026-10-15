import { useEffect, useRef, useState } from 'react';

/** Calm hues around the Plum violet; yellows and greens turn muddy behind glass. */
const HUES = [265, 228, 196, 300, 248, 182];

const hueFor = (seed: string) => {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return HUES[Math.abs(hash) % HUES.length]!;
};

/**
 * Soft colour fields behind the chat's glass so the blur has something to
 * work with. Each conversation gets its own tint; switching crossfades the
 * old layer out under the new one. Decorative only.
 */
export function AmbientBackdrop({ seed }: { seed: string }) {
  const hue = hueFor(seed);
  const counter = useRef(0);
  const [layers, setLayers] = useState(() => [{ key: 0, hue }]);
  useEffect(() => {
    setLayers((current) =>
      current.at(-1)?.hue === hue
        ? current
        : [...current.slice(-1), { key: ++counter.current, hue }]
    );
  }, [hue]);
  useEffect(() => {
    if (layers.length < 2) return;
    // The outgoing layer has faded by then (650 ms crossfade).
    const timer = window.setTimeout(() => setLayers((current) => current.slice(-1)), 700);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return (
    <div className="plum-ambient" aria-hidden="true">
      {layers.map((layer, index) => (
        <div
          key={layer.key}
          className={
            index === layers.length - 1 ? 'plum-ambient-layer is-in' : 'plum-ambient-layer is-out'
          }
          style={{ ['--ambient-hue' as string]: layer.hue }}
        />
      ))}
    </div>
  );
}
