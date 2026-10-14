import { useState, type FormEvent } from 'react';
import { Target, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_GOAL_LENGTH = 4000;

/**
 * Goal of the run, shown and set in the chat header. It sends the provider's
 * own `/goal` command, so it is offered only where the provider has one.
 */
export function SessionGoalBar({
  goal,
  canSetGoal,
  onSetGoal,
}: {
  goal: string | null;
  canSetGoal: boolean;
  onSetGoal: (objective: string) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  if (!goal && !canSetGoal) return null;

  const trimmed = draft.trim();
  const tooLong = trimmed.length > MAX_GOAL_LENGTH;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trimmed || tooLong || busy) return;
    setBusy(true);
    try {
      await onSetGoal(trimmed);
      setEditing(false);
      setDraft('');
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <form className="session-goal-bar is-editing" onSubmit={submit}>
        <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <input
          autoFocus
          className="session-goal-bar-input"
          value={draft}
          maxLength={MAX_GOAL_LENGTH + 200}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false);
          }}
          placeholder="Ziel dieser Session"
          aria-label="Ziel dieser Session"
          aria-invalid={tooLong}
        />
        <button
          type="submit"
          className="session-goal-bar-submit"
          disabled={!trimmed || tooLong || busy}
          title={tooLong ? 'Höchstens 4000 Zeichen' : 'Ziel setzen (/goal)'}
        >
          Setzen
        </button>
        <button
          type="button"
          className="session-goal-bar-cancel"
          onClick={() => setEditing(false)}
          aria-label="Abbrechen"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </form>
    );
  }

  return (
    <button
      type="button"
      className={cn('session-goal-bar', !goal && 'is-empty')}
      disabled={!canSetGoal}
      onClick={() => {
        setDraft(goal ?? '');
        setEditing(true);
      }}
      title={goal ? `Ziel: ${goal}` : 'Ziel für diese Session setzen (/goal)'}
    >
      <Target className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="session-goal-bar-label">{goal ? 'Ziel' : 'Ziel setzen'}</span>
      {goal && <span className="session-goal-bar-text">{goal}</span>}
    </button>
  );
}
