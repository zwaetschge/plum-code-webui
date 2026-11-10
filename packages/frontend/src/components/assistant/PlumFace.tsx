import { useReducedMotion } from '@/lib/motion/reducedMotion';
import './plum-face.css';

/**
 * What the voice is doing right now, in the same words the Android voice mode
 * uses: waiting to start, listening, writing down, thinking, speaking, paused
 * or failed.
 */
export type FacePhase =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'failed';

/**
 * Plum's face: the soft plum blob of the voice mode with two eyes that say
 * what the voice conversation is doing. The eyes carry the state (wide and
 * attentive while listening, glancing around while thinking, squeezed shut
 * while paused, drooping after a failure), the blob breathes with the voice
 * when `level` follows the microphone.
 *
 * Motion stops for `prefers-reduced-motion` and in e-ink mode; the expression
 * itself stays, so the state is still readable.
 */
export function PlumFace({
  phase,
  level = 0,
  size = 112,
  title = 'Plum',
  className,
}: {
  phase: FacePhase;
  /** Microphone or voice loudness, 0–1. */
  level?: number;
  size?: number;
  title?: string;
  className?: string;
}) {
  const still = useReducedMotion();
  return (
    <div
      className={['plum-face', `is-${phase}`, still && 'is-still', className]
        .filter(Boolean)
        .join(' ')}
      style={
        {
          width: size,
          height: size,
          '--pf-level': Math.max(0, Math.min(1, level)),
        } as React.CSSProperties
      }
      role="img"
      aria-label={title}
    >
      <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <defs>
          <radialGradient id="plum-face-body" cx="36%" cy="28%" r="76%">
            <stop offset="0%" className="pf-stop-light" />
            <stop offset="55%" className="pf-stop-mid" />
            <stop offset="100%" className="pf-stop-deep" />
          </radialGradient>
          <radialGradient id="plum-face-glow" cx="50%" cy="50%" r="50%">
            <stop offset="38%" className="pf-stop-glow" />
            <stop offset="100%" className="pf-stop-glow-out" />
          </radialGradient>
          <filter id="plum-face-sheen" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <circle className="pf-halo" cx="100" cy="100" r="99" fill="url(#plum-face-glow)" />
        <g className="pf-head">
          <circle className="pf-body" cx="100" cy="100" r="63" fill="url(#plum-face-body)" />
          <ellipse
            className="pf-sheen"
            cx="78"
            cy="68"
            rx="26"
            ry="18"
            filter="url(#plum-face-sheen)"
          />
          <g className="pf-eyes">
            <g className="pf-eye pf-eye-left">
              <g className="pf-blink">
                <rect x="61" y="77" width="30" height="38" rx="15" />
              </g>
            </g>
            <g className="pf-eye pf-eye-right">
              <g className="pf-blink">
                <rect x="109" y="77" width="30" height="38" rx="15" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
