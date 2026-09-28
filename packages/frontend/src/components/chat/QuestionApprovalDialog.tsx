import { useCallback, useMemo, useState } from 'react';
import { CheckCircle2, HelpCircle, X } from 'lucide-react';
import type { PendingQuestion } from '@plum-code-webui/shared';
import { cn } from '@/lib/utils';

interface QuestionApprovalDialogProps {
  question: PendingQuestion;
  onRespond: (answers: string[][]) => Promise<void>;
  onReject: () => Promise<void>;
  providerLabel: string;
}

export function QuestionApprovalDialog({
  question,
  onRespond,
  onReject,
  providerLabel,
}: QuestionApprovalDialogProps) {
  const [answers, setAnswers] = useState<string[][]>(() => question.questions.map(() => []));
  const [customAnswers, setCustomAnswers] = useState<string[]>(() =>
    question.questions.map(() => '')
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () =>
      question.questions.every((item, index) => {
        const selected = answers[index] ?? [];
        const custom = customAnswers[index]?.trim();
        return selected.length > 0 || Boolean(item.custom && custom);
      }),
    [answers, customAnswers, question.questions]
  );

  const toggleAnswer = useCallback((questionIndex: number, label: string, multiple: boolean) => {
    setAnswers((current) => {
      const next = current.map((entry) => [...entry]);
      const selected = next[questionIndex] ?? [];
      if (!multiple) {
        next[questionIndex] = [label];
        return next;
      }
      next[questionIndex] = selected.includes(label)
        ? selected.filter((item) => item !== label)
        : [...selected, label];
      return next;
    });
  }, []);

  const submit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      const finalAnswers = answers.map((entry, index) => {
        const custom = customAnswers[index]?.trim();
        return custom ? [...entry, custom] : entry;
      });
      await onRespond(finalAnswers);
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, customAnswers, onRespond]);

  const reject = useCallback(async () => {
    setIsSubmitting(true);
    try {
      await onReject();
    } finally {
      setIsSubmitting(false);
    }
  }, [onReject]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="glass-dialog max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-border shadow-xl">
        <div className="flex items-center gap-3 border-b border-border p-4">
          <div className="rounded-lg bg-primary/10 p-2">
            <HelpCircle className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Input Required</h2>
            <p className="text-sm text-muted-foreground">{providerLabel} needs a choice</p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {question.questions.map((item, index) => {
            const selected = answers[index] ?? [];
            return (
              <div key={`${question.requestId}-${index}`} className="space-y-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {item.header || `Question ${index + 1}`}
                  </div>
                  <p className="mt-1 text-sm font-medium text-foreground">{item.question}</p>
                </div>

                <div className="space-y-2">
                  {item.options.map((option) => {
                    const active = selected.includes(option.label);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => toggleAnswer(index, option.label, Boolean(item.multiple))}
                        className={cn(
                          'w-full rounded-lg border p-3 text-left transition-colors',
                          active
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-muted/20 hover:bg-muted/40'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <CheckCircle2
                            className={cn(
                              'mt-0.5 h-4 w-4 shrink-0',
                              active ? 'text-primary' : 'text-muted-foreground/50'
                            )}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{option.label}</div>
                            {option.description && (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {option.description}
                              </div>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {item.custom && (
                  <input
                    type="text"
                    value={customAnswers[index] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value;
                      setCustomAnswers((current) => {
                        const next = [...current];
                        next[index] = value;
                        return next;
                      });
                    }}
                    disabled={isSubmitting}
                    className="w-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm"
                    placeholder="Custom answer"
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-2 border-t border-border p-4 sm:grid-cols-2">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || isSubmitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 sm:py-2"
          >
            <CheckCircle2 className="h-4 w-4" />
            Submit
          </button>
          <button
            type="button"
            onClick={reject}
            disabled={isSubmitting}
            className="flex items-center justify-center gap-2 rounded-lg bg-muted px-4 py-3 font-medium text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50 sm:py-2"
          >
            <X className="h-4 w-4" />
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
