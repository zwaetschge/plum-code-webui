import { z } from 'zod';
import { createHash } from 'node:crypto';
import { transaction } from '../../db/pg.js';
import { AppError } from '../../middleware/errorHandler.js';
import { findResource, reviseResource } from './resources.js';

export const QUIZ_ANSWER = z
  .object({
    attemptId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    lesson: z.number().int().min(0).max(99),
    answers: z.array(z.number().int().min(0).max(7)).max(30),
  })
  .strict();
export async function submitQuiz(userId: string, id: string, input: z.infer<typeof QUIZ_ANSWER>) {
  return transaction(async (tx) => {
    if (
      !(await tx.get(
        'SELECT id FROM assistant_resources WHERE id = ? AND user_id = ? AND archived = 0 FOR UPDATE',
        id,
        userId
      ))
    )
      throw new AppError('Kurs nicht gefunden', 404, 'NOT_FOUND');
    const course = await findResource(userId, id, tx);
    if (course.kind !== 'course') throw new AppError('Kurs nicht gefunden', 404, 'NOT_FOUND');
    type Attempt = {
      id: string;
      courseRevision: number;
      lesson: number;
      answers: number[];
      correct: number;
      total: number;
      at: string;
    };
    const attempts = (course.body.attempts ?? []) as Attempt[];
    const payloadHash = createHash('sha256')
      .update(JSON.stringify([id, input.expectedRevision, input.lesson, input.answers]))
      .digest('hex');
    const command = await tx.get(
      'SELECT payload_hash,result_json FROM assistant_commands WHERE user_id = ? AND command_id = ?',
      userId,
      input.attemptId
    );
    if (command) {
      if (command.payload_hash !== payloadHash)
        throw new AppError(
          'Versuchskennung wurde bereits anders verwendet',
          409,
          'COMMAND_CONFLICT'
        );
      return { course, attempt: JSON.parse(command.result_json) as Attempt };
    }
    const previous = attempts.find((attempt) => attempt.id === input.attemptId);
    if (previous) {
      if (
        previous.lesson !== input.lesson ||
        JSON.stringify(previous.answers) !== JSON.stringify(input.answers)
      )
        throw new AppError(
          'Versuchskennung wurde bereits anders verwendet',
          409,
          'COMMAND_CONFLICT'
        );
      return { course, attempt: previous };
    }
    const lessons = course.body.lessons as Array<{
      questions?: Array<{ choices: string[]; correct: number }>;
    }>;
    const questions = lessons[input.lesson]?.questions;
    if (
      !questions?.length ||
      questions.length !== input.answers.length ||
      input.answers.some((answer, index) => answer >= questions[index]!.choices.length)
    )
      throw new AppError('Bitte jede Frage gültig beantworten', 400, 'QUIZ_ANSWER_INVALID');
    const attempt = {
      id: input.attemptId,
      courseRevision: course.revision,
      lesson: input.lesson,
      answers: input.answers,
      correct: questions.filter((question, index) => question.correct === input.answers[index])
        .length,
      total: questions.length,
      at: new Date().toISOString(),
    };
    const next = await reviseResource(
      userId,
      course.id,
      input.expectedRevision,
      course.title,
      { ...course.body, attempts: [...attempts.slice(-99), attempt] },
      tx
    );
    await tx.run(
      `INSERT INTO assistant_commands(user_id,command_id,resource_id,payload_hash,action,status,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      userId,
      input.attemptId,
      id,
      payloadHash,
      'quiz-answer',
      'completed',
      JSON.stringify(attempt),
      attempt.at,
      attempt.at
    );
    return { course: next, attempt };
  });
}
