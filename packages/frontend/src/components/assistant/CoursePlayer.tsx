import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantResource } from '@plum-code-webui/shared';
import { api } from '@/services/api';
import { Button } from '@/components/ui/button';
interface Question {
  prompt: string;
  choices: string[];
  correct: number;
  explanation: string;
}
interface Lesson {
  title: string;
  content: string;
  completed: boolean;
  sourceIds?: string[];
  questions?: Question[];
}
interface Attempt {
  id: string;
  lesson: number;
  courseRevision: number;
  correct: number;
  total: number;
  at: string;
  answers: number[];
}
export function CoursePlayer({
  course,
  onChanged,
}: {
  course: AssistantResource;
  onChanged: (resource: AssistantResource) => void;
}) {
  const lessons = course.body.lessons as Lesson[],
    attempts = (course.body.attempts ?? []) as Attempt[];
  const [answers, setAnswers] = useState<Record<string, number>>({}),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [feedback, setFeedback] = useState<Attempt | null>(null);
  useEffect(() => {
    setAnswers({});
    setError('');
  }, [course.id, course.revision]);
  useEffect(() => setFeedback(null), [course.id]);
  const update = async (index: number, completed: boolean) => {
    setBusy(true);
    setError('');
    try {
      const next = (
        await api.patch<{ data: AssistantResource }>(`/api/assistant/courses/${course.id}`, {
          title: course.title,
          expectedRevision: course.revision,
          body: {
            ...course.body,
            lessons: lessons.map((lesson, i) => (i === index ? { ...lesson, completed } : lesson)),
          },
        })
      ).data.data;
      onChanged(next);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Fortschritt konnte nicht gespeichert werden'
      );
    } finally {
      setBusy(false);
    }
  };
  // Keep the transaction ID across a lost response until the user changes the submitted answers.
  const [pending, setPending] = useState<{
    id: string;
    lesson: number;
    answers: number[];
    revision: number;
  } | null>(null);
  useEffect(() => setPending(null), [course.id]);
  const submit = async (index: number) => {
    const values = (lessons[index]!.questions ?? []).map((_, q) => answers[`${index}:${q}`]!);
    const request =
      pending &&
      pending.lesson === index &&
      JSON.stringify(pending.answers) === JSON.stringify(values)
        ? pending
        : { id: crypto.randomUUID(), lesson: index, answers: values, revision: course.revision };
    setPending(request);
    setBusy(true);
    setError('');
    try {
      const result = (
        await api.post<{ data: { course: AssistantResource; attempt: Attempt } }>(
          `/api/assistant/courses/${course.id}/answers`,
          {
            attemptId: request.id,
            lesson: index,
            answers: values,
            expectedRevision: request.revision,
          }
        )
      ).data.data;
      setPending(null);
      setFeedback(result.attempt);
      onChanged(result.course);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : 'Quizversuch konnte nicht gespeichert werden'
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4" aria-label="Lektionen und Quiz">
      <p className="text-sm">
        {lessons.filter((lesson) => lesson.completed).length} von {lessons.length} Lektionen
        abgeschlossen
      </p>
      {lessons.map((lesson, index) => (
        <article className="space-y-3 rounded-md border p-3" key={index}>
          <h3 className="font-medium">{lesson.title}</h3>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{lesson.content}</ReactMarkdown>
          </div>
          {!!lesson.sourceIds?.length && (
            <div className="flex flex-wrap gap-3 text-sm">
              {lesson.sourceIds.map((source, i) => (
                <Link
                  key={source}
                  className="underline"
                  to={`/assistant/sources?resource=${encodeURIComponent(source)}`}
                >
                  Quelle {i + 1}
                </Link>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={busy}
              checked={lesson.completed}
              onChange={(event) => void update(index, event.target.checked)}
            />
            Lektion abgeschlossen
          </label>
          {!!lesson.questions?.length && (
            <form
              className="space-y-4 border-t pt-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(index);
              }}
            >
              {lesson.questions.map((question, q) => (
                <fieldset key={q} className="space-y-2">
                  <legend className="font-medium">
                    {q + 1}. {question.prompt}
                  </legend>
                  {question.choices.map((choice, c) => (
                    <label key={c} className="flex items-start gap-2 text-sm">
                      <input
                        required
                        type="radio"
                        disabled={busy}
                        name={`${course.id}:${index}:${q}`}
                        value={c}
                        checked={answers[`${index}:${q}`] === c}
                        onChange={() => setAnswers((old) => ({ ...old, [`${index}:${q}`]: c }))}
                        className="mt-1"
                      />
                      {choice}
                    </label>
                  ))}
                </fieldset>
              ))}
              <Button
                type="submit"
                size="sm"
                disabled={
                  busy || lesson.questions.some((_, q) => answers[`${index}:${q}`] === undefined)
                }
              >
                Antworten prüfen und Versuch speichern
              </Button>
              {feedback?.lesson === index && (
                <div role="status" className="space-y-2 rounded-md bg-muted p-3 text-sm">
                  <p>
                    {feedback.correct} von {feedback.total} richtig · Kursrevision{' '}
                    {feedback.courseRevision}
                  </p>
                  {feedback.courseRevision === course.revision - 1 &&
                    lesson.questions.map((question, q) => (
                      <p key={q}>
                        {feedback.answers[q] === question.correct
                          ? 'Richtig'
                          : `Richtige Antwort: ${question.choices[question.correct]}`}
                        . {question.explanation}
                      </p>
                    ))}
                </div>
              )}
            </form>
          )}
        </article>
      ))}
      {!!attempts.length && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Gespeicherte Versuche ({attempts.length})
          </summary>
          <ul className="mt-2 space-y-2 text-sm">
            {attempts
              .slice()
              .reverse()
              .map((attempt) => (
                <li key={attempt.id}>
                  Lektion {attempt.lesson + 1} · {attempt.correct}/{attempt.total} · Revision{' '}
                  {attempt.courseRevision} · {new Date(attempt.at).toLocaleString()}
                </li>
              ))}
          </ul>
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
