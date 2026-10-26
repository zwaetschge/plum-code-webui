import { z } from 'zod';
export const CHAT_SCHEDULE_PLAN = z
  .object({
    frequency: z.enum(['once', 'interval', 'daily', 'weekly']),
    timezone: z
      .string()
      .max(80)
      .default('Europe/Zurich')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('07:00'),
    days: z.array(z.number().int().min(0).max(6)).max(7).default([1, 2, 3, 4, 5]),
    intervalMinutes: z.number().int().min(5).max(10080).default(60),
    runAt: z.string().datetime().optional(),
    endAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.frequency === 'once' && !plan.runAt)
      context.addIssue({ code: 'custom', message: 'Zeitpunkt erforderlich' });
    if (plan.frequency === 'weekly' && !plan.days.length)
      context.addIssue({ code: 'custom', message: 'Wochentage erforderlich' });
  });
export type ChatSchedulePlan = z.infer<typeof CHAT_SCHEDULE_PLAN>;
/** Scan instants, not invented wall-clock offsets: DST gaps are skipped and repeated times run once. */
export function nextChatSchedule(
  plan: ChatSchedulePlan,
  after: Date,
  previousSlot?: string
): string | null {
  const finish = (date: Date) =>
    !plan.endAt || date.getTime() <= Date.parse(plan.endAt) ? date.toISOString() : null;
  if (plan.frequency === 'once')
    return Date.parse(plan.runAt!) > after.getTime() ? finish(new Date(plan.runAt!)) : null;
  if (plan.frequency === 'interval')
    return finish(new Date(after.getTime() + plan.intervalMinutes * 60000));
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: plan.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date: Date) =>
    Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const previous = previousSlot ? parts(new Date(previousSlot)) : null;
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const [hour, minute] = plan.time.split(':');
  // At most 8 days; minutes cover all ordinary IANA civil-time changes.
  for (
    let value = Math.floor(after.getTime() / 60000) * 60000 + 60000, end = value + 8 * 86400000;
    value <= end;
    value += 60000
  ) {
    if (plan.endAt && value > Date.parse(plan.endAt)) return null;
    const instant = new Date(value),
      local = parts(instant);
    if (local.hour !== hour || local.minute !== minute) continue;
    if (
      previous &&
      previous.year === local.year &&
      previous.month === local.month &&
      previous.day === local.day
    )
      continue;
    if (plan.frequency === 'weekly' && !plan.days.includes(weekdays.indexOf(local.weekday!)))
      continue;
    return finish(instant);
  }
  return null;
}
