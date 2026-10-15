import { useState, type CSSProperties, type PointerEvent } from 'react';
import { START_SUGGESTIONS, type StartSketch, type StartSuggestion } from './startSuggestionData';
import { StartScene } from './StartScene';
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
              <StartScene name={item.key} />
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
