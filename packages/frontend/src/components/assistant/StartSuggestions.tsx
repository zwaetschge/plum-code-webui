import { useState, type CSSProperties, type PointerEvent } from 'react';
import { START_SUGGESTIONS, type StartSketch, type StartSuggestion } from './startSuggestionData';
import './start-suggestions.css';

export type { StartSuggestion };

/** Answers to these usually come with an interactive view (Dynamic UI). */
const INTERACTIVE = new Set<StartSketch>(['growth', 'dashboard', 'compare']);
const SKETCHES: StartSketch[] = ['growth', 'dashboard', 'compare', 'write', 'plan', 'explain'];

const random = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

/**
 * Six of the 36 starters per page load: one per sketch, in shuffled order,
 * so every visit shows a different mix. Mornings lead with planning.
 */
function deal(hour: number) {
  const hand = SKETCHES.map((sketch) =>
    random(START_SUGGESTIONS.filter((item) => item.sketch === sketch))
  );
  for (let i = hand.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [hand[i], hand[j]] = [hand[j]!, hand[i]!];
  }
  if (hour >= 5 && hour < 11)
    hand.sort((x, y) => Number(y.sketch === 'plan') - Number(x.sketch === 'plan'));
  return hand;
}

function track(event: PointerEvent<HTMLButtonElement>) {
  const card = event.currentTarget;
  const box = card.getBoundingClientRect();
  card.style.setProperty('--spot-x', `${event.clientX - box.left}px`);
  card.style.setProperty('--spot-y', `${event.clientY - box.top}px`);
}

export function StartSuggestions({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (suggestion: StartSuggestion) => void;
}) {
  const [items] = useState(() => deal(new Date().getHours()));
  return (
    <section className="plum-start-deck" aria-label="Vorgeschlagene Prompts">
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.key}
            type="button"
            disabled={disabled}
            className="plum-start-card"
            data-preview={item.sketch}
            style={{ '--i': index } as CSSProperties}
            onPointerMove={track}
            onClick={() => onPick(item)}
          >
            <span className="plum-start-preview" aria-hidden>
              <PreviewArt kind={item.sketch} />
            </span>
            <span className="plum-start-copy">
              <span className="plum-start-title">
                <Icon size={15} aria-hidden />
                {item.title}
              </span>
              <span className="plum-start-hint">{item.hint}</span>
            </span>
            {INTERACTIVE.has(item.sketch) && <span className="plum-start-badge">Interaktiv</span>}
          </button>
        );
      })}
    </section>
  );
}

/* Small looping sketches of what the answer will look like. Transform and
 * opacity only; reduced motion shows the resting frame. */
function PreviewArt({ kind }: { kind: StartSketch }) {
  switch (kind) {
    case 'growth':
      return (
        <svg viewBox="0 0 120 56" className="sp-growth">
          <path className="sp-area" d="M4 46 C30 44 48 38 66 30 S100 12 116 6 L116 50 L4 50 Z" />
          <path className="sp-line" d="M4 46 C30 44 48 38 66 30 S100 12 116 6" pathLength={1} />
          <line className="sp-track" x1="8" y1="53" x2="112" y2="53" />
          <circle className="sp-knob" cx="8" cy="53" r="2.6" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg viewBox="0 0 120 56" className="sp-dashboard">
          <rect className="sp-kpi" x="4" y="4" width="34" height="11" rx="3" />
          <rect className="sp-kpi" x="43" y="4" width="34" height="11" rx="3" />
          {[0, 1, 2, 3, 4, 5].map((bar) => (
            <rect
              key={bar}
              className="sp-bar"
              x={8 + bar * 18}
              y="20"
              width="10"
              height="32"
              rx="2"
              style={{ '--b': bar } as CSSProperties}
            />
          ))}
        </svg>
      );
    case 'compare':
      return (
        <svg viewBox="0 0 120 56" className="sp-compare">
          {[0, 1, 2].map((col) => (
            <g key={col} transform={`translate(${6 + col * 37} 6)`}>
              <rect className="sp-col" width="34" height="44" rx="5" />
              <rect className="sp-row" x="5" y="8" width="20" height="3" rx="1.5" />
              <rect className="sp-row" x="5" y="17" width="24" height="3" rx="1.5" />
              <rect className="sp-row" x="5" y="26" width="14" height="3" rx="1.5" />
            </g>
          ))}
          <rect className="sp-pick" x="6" y="6" width="34" height="44" rx="5" />
        </svg>
      );
    case 'write':
      return (
        <svg viewBox="0 0 120 56" className="sp-write">
          {[0, 1, 2].map((line) => (
            <rect
              key={line}
              className="sp-text"
              x="10"
              y={12 + line * 13}
              width={line === 2 ? 58 : 100}
              height="4"
              rx="2"
              style={{ '--l': line } as CSSProperties}
            />
          ))}
          <rect className="sp-caret" x="70" y="36" width="1.6" height="10" rx="0.8" />
        </svg>
      );
    case 'plan':
      return (
        <svg viewBox="0 0 120 56" className="sp-plan">
          {[0, 1, 2, 3].map((tick) => (
            <line
              key={tick}
              className="sp-grid"
              x1="4"
              x2="116"
              y1={8 + tick * 13}
              y2={8 + tick * 13}
            />
          ))}
          <rect
            className="sp-slot"
            x="12"
            y="10"
            width="40"
            height="9"
            rx="3"
            style={{ '--s': 0 } as CSSProperties}
          />
          <rect
            className="sp-slot"
            x="40"
            y="23"
            width="52"
            height="9"
            rx="3"
            style={{ '--s': 1 } as CSSProperties}
          />
          <rect
            className="sp-slot"
            x="24"
            y="36"
            width="34"
            height="9"
            rx="3"
            style={{ '--s': 2 } as CSSProperties}
          />
          <line className="sp-now" x1="0" x2="0" y1="4" y2="52" />
        </svg>
      );
    case 'explain':
      return (
        <svg viewBox="0 0 120 56" className="sp-explain">
          <path
            className="sp-edge"
            d="M60 28 L24 14 M60 28 L28 44 M60 28 L96 12 M60 28 L98 42"
            pathLength={1}
          />
          <circle className="sp-core" cx="60" cy="28" r="7" />
          {[
            [24, 14],
            [28, 44],
            [96, 12],
            [98, 42],
          ].map(([cx, cy], node) => (
            <circle
              key={node}
              className="sp-node"
              cx={cx}
              cy={cy}
              r="4"
              style={{ '--n': node } as CSSProperties}
            />
          ))}
        </svg>
      );
  }
}
