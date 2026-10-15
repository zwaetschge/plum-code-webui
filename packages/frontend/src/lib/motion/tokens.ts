/**
 * One motion language for the chat surfaces. `ratio` is the normalised
 * damping ratio (1 = critically damped), `stiffness` the spring constant k
 * for mass 1. Durations are in milliseconds and mirror the CSS variables in
 * motion.css, so JS and CSS animations stay in step.
 */
export interface SpringConfig {
  ratio: number;
  stiffness: number;
}

export const SPRINGS = {
  /** StepOut menus growing out of their trigger. */
  menu: { ratio: 0.8, stiffness: 380 },
  /** Gliding selection markers (sidebar, effort rail). */
  marker: { ratio: 0.85, stiffness: 480 },
  /** Focus frame: leading edge, trailing edge, the two side edges. */
  lead: { ratio: 0.62, stiffness: 700 },
  trail: { ratio: 0.78, stiffness: 360 },
  side: { ratio: 0.7, stiffness: 520 },
  rapid: { ratio: 0.9, stiffness: 900 },
  /** Page flood and launch flood edges. */
  flood: { ratio: 0.86, stiffness: 300 },
  /** Programmatic scrolling. */
  scroll: { ratio: 1, stiffness: 170 },
} satisfies Record<string, SpringConfig>;

export const DURATION = {
  press: 120,
  fast: 160,
  base: 220,
  exit: 170,
  enter: 300,
  rise: 420,
  crossfade: 650,
} as const;

export const EASE = {
  enter: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  /** Slight overshoot for small pops. */
  pop: 'cubic-bezier(0.3, 1.3, 0.5, 1)',
} as const;
