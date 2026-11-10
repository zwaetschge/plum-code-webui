import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardList,
  Lightbulb,
  RotateCcw,
  Shuffle,
  X,
} from 'lucide-react';
import { quizQuestionKind, type UiQuizQuestion } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';
import { copyText } from './actions';
import { stagger, type Renderer } from './context';
import { usePersistentState } from './persist';

const isArray = Array.isArray;

// Checklist

export const Checklist: Renderer<'checklist'> = ({ node, ctx }) => {
  const ids = node.items.map((item) => item.id);
  const [done, setDone] = usePersistentState<string[]>(
    ctx.storageKey(node.id),
    () => [],
    (value) =>
      isArray(value) ? value.filter((id): id is string => typeof id === 'string') : undefined
  );
  const [copied, setCopied] = useState(false);
  const checked = new Set(done.filter((id) => ids.includes(id)));
  const total = node.items.length;
  const count = checked.size;
  const toggle = (id: string) =>
    setDone((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  const copy = () => {
    const lines = node.items.map((item) => {
      const detail = item.detail ? ` (${ctx.rt.template(item.detail)})` : '';
      return `${checked.has(item.id) ? '- [x]' : '- [ ]'} ${ctx.rt.template(item.label)}${detail}`;
    });
    void copyText([node.title, ...lines].filter(Boolean).join('\n')).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return (
    <section className="dui-checklist" aria-label={node.title || 'Checkliste'}>
      <header className="dui-checklist-head">
        <div>
          {node.title && <h4>{node.title}</h4>}
          <span className="dui-checklist-count" aria-live="polite">
            {count === total && total > 0 ? 'Alles erledigt' : `${count} von ${total} erledigt`}
          </span>
        </div>
        <div className="dui-toolbar">
          {count > 0 && (
            <button
              type="button"
              className="dui-tool"
              onClick={() => setDone([])}
              title="Zurücksetzen"
            >
              <RotateCcw size={14} aria-hidden />
              <span className="sr-only">Zurücksetzen</span>
            </button>
          )}
          {node.copyable && (
            <button type="button" className="dui-tool" onClick={copy}>
              {copied ? (
                <Check size={14} className="plum-pop" aria-hidden />
              ) : (
                <ClipboardList size={14} aria-hidden />
              )}
              <span>{copied ? 'Kopiert' : 'Liste kopieren'}</span>
            </button>
          )}
        </div>
      </header>
      <span className="dui-progress-track is-thin" aria-hidden>
        <span
          className={cn('dui-progress-fill', count === total && 'is-complete')}
          style={{ transform: `scaleX(${total ? count / total : 0})` }}
        />
      </span>
      <ul className="dui-checklist-items">
        {node.items.map((item, index) => {
          const on = checked.has(item.id);
          return (
            <li key={item.id} style={stagger(index)}>
              <label className={cn('dui-checklist-item', on && 'is-done')}>
                <input type="checkbox" checked={on} onChange={() => toggle(item.id)} />
                <span className="dui-checkmark" aria-hidden>
                  <svg viewBox="0 0 16 16">
                    <path d="M3.5 8.5l3 3 6-7" />
                  </svg>
                </span>
                <span className="dui-checklist-text">
                  <span className="dui-checklist-label">{ctx.rt.template(item.label)}</span>
                  {item.detail && (
                    <span className="dui-checklist-detail">{ctx.rt.template(item.detail)}</span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
};

// Quiz

interface QuizState {
  index: number;
  /** Given answers: option index or text; null = not answered. */
  answers: Array<number | string | null>;
  hints: boolean[];
  finished: boolean;
}

const normalize = (text: string) =>
  text.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('de-CH');

export function quizCorrect(question: UiQuizQuestion, answer: number | string | null) {
  if (answer === null) return false;
  return quizQuestionKind(question) === 'choice'
    ? answer === question.answer
    : normalize(String(answer)) === normalize(String(question.answer));
}

const LETTERS = 'ABCDEF';

export const Quiz: Renderer<'quiz'> = ({ node, ctx }) => {
  const total = node.questions.length;
  const fresh = (): QuizState => ({
    index: 0,
    answers: node.questions.map(() => null),
    hints: node.questions.map(() => false),
    finished: false,
  });
  const [state, setState] = usePersistentState<QuizState>(
    ctx.storageKey(node.id),
    fresh,
    (value) => {
      const v = value as QuizState;
      return v && isArray(v.answers) && v.answers.length === total && typeof v.index === 'number'
        ? {
            ...v,
            index: Math.min(total - 1, Math.max(0, v.index)),
            hints: isArray(v.hints) ? v.hints : fresh().hints,
          }
        : undefined;
    }
  );
  const [draft, setDraft] = useState('');
  const question = node.questions[state.index]!;
  const answer = state.answers[state.index] ?? null;
  const answered = answer !== null;
  const correct = quizCorrect(question, answer);
  const kind = quizQuestionKind(question);
  const score = node.questions.filter((q, i) => quizCorrect(q, state.answers[i] ?? null)).length;
  const next = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (answered) next.current?.focus({ preventScroll: true });
  }, [answered, state.index]);
  const give = (value: number | string) =>
    setState((current) => {
      const answers = [...current.answers];
      answers[current.index] = value;
      return { ...current, answers };
    });
  const advance = () => {
    setDraft('');
    setState((current) =>
      current.index + 1 >= total
        ? { ...current, finished: true }
        : { ...current, index: current.index + 1 }
    );
  };
  if (state.finished) {
    const ratio = total ? score / total : 0;
    const radius = 30;
    const circumference = 2 * Math.PI * radius;
    return (
      <section className="dui-card dui-quiz is-result" aria-label={node.title || 'Quiz'}>
        <div className="dui-quiz-score">
          <svg width={76} height={76} viewBox="0 0 76 76" aria-hidden>
            <circle className="dui-ring-track" cx={38} cy={38} r={radius} />
            <circle
              className={cn('dui-ring-fill', ratio >= 0.8 ? 'is-good' : ratio < 0.5 && 'is-low')}
              cx={38}
              cy={38}
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - ratio)}
              style={{ ['--dui-ring-full' as string]: circumference }}
            />
          </svg>
          <strong>
            {score}/{total}
          </strong>
        </div>
        <div className="dui-quiz-result-text">
          <h4>
            {ratio === 1
              ? 'Perfekt – alles richtig!'
              : ratio >= 0.7
                ? 'Stark gemacht!'
                : ratio >= 0.4
                  ? 'Guter Anfang'
                  : 'Dranbleiben lohnt sich'}
          </h4>
          <p>
            Du hast {score} von {total} {total === 1 ? 'Frage' : 'Fragen'} richtig beantwortet.
          </p>
          <div className="dui-quiz-review">
            {node.questions.map((q, i) => (
              <span
                key={i}
                className={cn(
                  'dui-quiz-pip',
                  quizCorrect(q, state.answers[i] ?? null) ? 'is-right' : 'is-wrong'
                )}
                title={q.q}
              />
            ))}
          </div>
        </div>
        <button
          type="button"
          className="dui-button is-primary"
          onClick={() => {
            setDraft('');
            setState(fresh());
          }}
        >
          <RotateCcw size={14} aria-hidden />
          <span>Nochmal</span>
        </button>
      </section>
    );
  }
  return (
    <section className="dui-card dui-quiz" aria-label={node.title || 'Quiz'}>
      <header className="dui-quiz-head">
        <span className="dui-quiz-title">{node.title || 'Quiz'}</span>
        <span className="dui-quiz-step">
          Frage {state.index + 1} von {total}
        </span>
      </header>
      <div className="dui-quiz-pips" aria-hidden>
        {node.questions.map((q, i) => (
          <span
            key={i}
            className={cn(
              'dui-quiz-pip',
              i === state.index && 'is-current',
              state.answers[i] !== null &&
                (quizCorrect(q, state.answers[i] ?? null) ? 'is-right' : 'is-wrong')
            )}
          />
        ))}
      </div>
      <div key={state.index} className="dui-quiz-body">
        <p className="dui-quiz-question">{question.q}</p>
        {kind === 'choice' ? (
          <div className="dui-quiz-options" role="radiogroup" aria-label="Antworten">
            {(question.options ?? []).map((option, index) => {
              const isAnswer = index === question.answer;
              const picked = answer === index;
              return (
                <button
                  key={index}
                  type="button"
                  role="radio"
                  aria-checked={picked}
                  disabled={answered}
                  style={stagger(index)}
                  className={cn(
                    'dui-quiz-option',
                    answered && isAnswer && 'is-right',
                    answered && picked && !isAnswer && 'is-wrong',
                    answered && !picked && !isAnswer && 'is-dim'
                  )}
                  onClick={() => give(index)}
                >
                  <span className="dui-quiz-letter" aria-hidden>
                    {answered && isAnswer ? (
                      <Check size={13} strokeWidth={3} />
                    ) : answered && picked ? (
                      <X size={13} strokeWidth={3} />
                    ) : (
                      LETTERS[index]
                    )}
                  </span>
                  <span>{option}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <form
            className="dui-quiz-text"
            onSubmit={(event) => {
              event.preventDefault();
              if (draft.trim() && !answered) give(draft.trim());
            }}
          >
            <input
              className={cn('dui-input', answered && (correct ? 'is-right' : 'is-wrong'))}
              value={answered ? String(answer) : draft}
              disabled={answered}
              placeholder="Deine Antwort"
              aria-label="Deine Antwort"
              onChange={(event) => setDraft(event.target.value)}
            />
            {!answered && (
              <button type="submit" className="dui-button is-primary" disabled={!draft.trim()}>
                Prüfen
              </button>
            )}
          </form>
        )}
        {!answered &&
          question.hint &&
          (state.hints[state.index] ? (
            <p className="dui-quiz-hint">
              <Lightbulb size={14} aria-hidden />
              {question.hint}
            </p>
          ) : (
            <button
              type="button"
              className="dui-link-button"
              onClick={() =>
                setState((current) => {
                  const hints = [...current.hints];
                  hints[current.index] = true;
                  return { ...current, hints };
                })
              }
            >
              <Lightbulb size={14} aria-hidden />
              Hinweis anzeigen
            </button>
          ))}
        {answered && (
          <div className={cn('dui-quiz-feedback', correct ? 'is-right' : 'is-wrong')} role="status">
            <strong>
              {correct
                ? 'Richtig!'
                : kind === 'text'
                  ? `Nicht ganz – richtig ist: ${String(question.answer)}`
                  : 'Leider falsch'}
            </strong>
            {question.explanation && <p>{question.explanation}</p>}
          </div>
        )}
      </div>
      {answered && (
        <footer className="dui-quiz-foot">
          <span className="dui-quiz-tally">{score} richtig</span>
          <button ref={next} type="button" className="dui-button is-primary" onClick={advance}>
            <span>{state.index + 1 >= total ? 'Auswertung' : 'Weiter'}</span>
            <ArrowRight size={14} aria-hidden />
          </button>
        </footer>
      )}
    </section>
  );
};

// Flashcards

interface CardsState {
  order: number[];
  position: number;
  /** Card index → known (true) / not yet (false). */
  marks: Record<string, boolean>;
}

const shuffled = (length: number) => {
  const order = Array.from({ length }, (_, index) => index);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap]!, order[index]!];
  }
  return order;
};

export const Flashcards: Renderer<'flashcards'> = ({ node, ctx }) => {
  const total = node.cards.length;
  const fresh = (): CardsState => ({
    order: Array.from({ length: total }, (_, index) => index),
    position: 0,
    marks: {},
  });
  const [state, setState] = usePersistentState<CardsState>(
    ctx.storageKey(node.id),
    fresh,
    (value) => {
      const v = value as CardsState;
      return v && isArray(v.order) && v.order.length === total && typeof v.position === 'number'
        ? { ...v, position: Math.min(total - 1, Math.max(0, v.position)), marks: v.marks ?? {} }
        : undefined;
    }
  );
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const cardIndex = state.order[state.position] ?? 0;
  const card = node.cards[cardIndex]!;
  const known = Object.values(state.marks).filter(Boolean).length;
  const unknown = Object.values(state.marks).filter((mark) => mark === false).length;
  const move = (delta: number) => {
    setFlipped(false);
    setDirection(delta > 0 ? 'next' : 'prev');
    setState((current) => ({
      ...current,
      position: (current.position + delta + total) % total,
    }));
  };
  const mark = (value: boolean) => {
    setState((current) => ({ ...current, marks: { ...current.marks, [cardIndex]: value } }));
    if (total > 1) move(1);
    else setFlipped(false);
  };
  const status = state.marks[cardIndex];
  return (
    <section className="dui-flashcards" aria-label="Lernkarten">
      <div className="dui-flash-stage">
        <button
          key={`${state.position}-${cardIndex}`}
          type="button"
          className={cn('dui-flashcard', flipped && 'is-flipped', `is-${direction}`)}
          aria-label={flipped ? `Rückseite: ${card.back}` : `Vorderseite: ${card.front}. Umdrehen`}
          onClick={() => setFlipped((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') move(1);
            else if (event.key === 'ArrowLeft') move(-1);
            else return;
            event.preventDefault();
          }}
        >
          <span className="dui-flash-face is-front">
            <span className="dui-flash-kicker">Frage</span>
            <span className="dui-flash-text">{card.front}</span>
            <span className="dui-flash-hint">Tippen zum Umdrehen</span>
          </span>
          <span className="dui-flash-face is-back" aria-hidden={!flipped}>
            <span className="dui-flash-kicker">Antwort</span>
            <span className="dui-flash-text">{card.back}</span>
          </span>
          {status !== undefined && (
            <span className={cn('dui-flash-mark', status ? 'is-known' : 'is-unknown')}>
              {status ? 'Gewusst' : 'Wiederholen'}
            </span>
          )}
        </button>
      </div>
      <div className="dui-flash-controls">
        <button
          type="button"
          className="dui-icon-button"
          aria-label="Vorherige Karte"
          onClick={() => move(-1)}
          disabled={total < 2}
        >
          <ArrowLeft size={17} />
        </button>
        <span className="dui-flash-count" aria-live="polite">
          {state.position + 1} / {total}
        </span>
        <button
          type="button"
          className="dui-icon-button"
          aria-label="Nächste Karte"
          onClick={() => move(1)}
          disabled={total < 2}
        >
          <ArrowRight size={17} />
        </button>
        <span className="dui-flash-spacer" />
        {flipped ? (
          <div className="dui-flash-grade">
            <button
              type="button"
              className="dui-button is-secondary is-unknown"
              onClick={() => mark(false)}
            >
              <X size={14} aria-hidden />
              <span>Nicht gewusst</span>
            </button>
            <button
              type="button"
              className="dui-button is-primary is-known"
              onClick={() => mark(true)}
            >
              <Check size={14} aria-hidden />
              <span>Gewusst</span>
            </button>
          </div>
        ) : (
          <>
            <span className="dui-flash-stats">
              {known} gewusst · {unknown} offen
            </span>
            <button
              type="button"
              className="dui-icon-button"
              aria-label="Mischen"
              title="Mischen"
              disabled={total < 2}
              onClick={() => {
                setFlipped(false);
                setState((current) => ({ ...current, order: shuffled(total), position: 0 }));
              }}
            >
              <Shuffle size={16} />
            </button>
            {(known > 0 || unknown > 0) && (
              <button
                type="button"
                className="dui-icon-button"
                aria-label="Von vorne"
                title="Von vorne"
                onClick={() => {
                  setFlipped(false);
                  setState(fresh());
                }}
              >
                <RotateCcw size={16} />
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
};
