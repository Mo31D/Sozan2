import { z } from 'zod';
import { validateRecurringSchedule, type ScheduleStatus } from './schedule';

export const sessionTypeSchema = z.enum([
  'private_student_home',
  'private_tutor_home',
  'online',
  'center_group',
  'own_group',
]);

const scheduleFields = {
  scheduleStatus: z.enum(['confirmed', 'pending']),
  weekday: z.number().int().min(0).max(6).nullable(),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
};

function validateScheduleShape(
  value: { scheduleStatus: 'confirmed' | 'pending'; weekday: number | null; startTime: string | null },
  ctx: z.RefinementCtx,
): void {
  try {
    validateRecurringSchedule({
      status: value.scheduleStatus,
      weekday: value.weekday,
      startTime: value.startTime,
    });
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'Invalid recurring schedule',
      path: ['scheduleStatus'],
    });
  }
}

function validateSessionShape(
  value: {
    scheduleStatus: 'confirmed' | 'pending';
    weekday: number | null;
    startTime: string | null;
    studentIds: string[];
    payerStudentId: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  validateScheduleShape(value, ctx);
  if (value.payerStudentId && !value.studentIds.includes(value.payerStudentId)) {
    ctx.addIssue({
      code: 'custom',
      message: 'SESSION_PAYER_MUST_BE_LINKED_STUDENT',
      path: ['payerStudentId'],
    });
  }
}

export const createRecurringSessionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sessionType: sessionTypeSchema,
  scheduleStatus: scheduleFields.scheduleStatus.default('confirmed'),
  weekday: scheduleFields.weekday.default(null),
  startTime: scheduleFields.startTime.default(null),
  durationMinutes: z.number().int().min(15).max(360).default(60),
  travelMinutes: z.number().int().min(0).max(360).default(0),
  location: z.string().trim().max(200).nullable().optional().default(null),
  priceBasis: z.enum(['total_session', 'per_student']).default('total_session'),
  defaultPricePence: z.number().int().min(0).default(0),
  expectedStudentCount: z.number().int().min(1).max(100).default(1),
  centerCutBps: z.number().int().min(0).max(10_000).default(0),
  studentIds: z.array(z.string().uuid()).max(100).default([]),
  payerStudentId: z.string().uuid().nullable().optional().default(null),
}).superRefine(validateSessionShape);

/**
 * Complete editable session shape. Validation belongs to the tutoring domain
 * and is shared by local persistence and cloud sync adapters.
 */
export const updateRecurringSessionDetailsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  sessionType: sessionTypeSchema,
  ...scheduleFields,
  durationMinutes: z.number().int().min(15).max(360),
  travelMinutes: z.number().int().min(0).max(360),
  location: z.string().trim().max(200).nullable(),
  priceBasis: z.enum(['total_session', 'per_student']),
  defaultPricePence: z.number().int().min(0),
  expectedStudentCount: z.number().int().min(1).max(100),
  centerCutBps: z.number().int().min(0).max(10_000),
  studentIds: z.array(z.string().uuid()).max(100).transform((ids) => [...new Set(ids)]),
  payerStudentId: z.string().uuid().nullable(),
}).superRefine(validateSessionShape);

export const updateRecurringScheduleSchema = z.object(scheduleFields).superRefine(validateScheduleShape);

export type CreateRecurringSessionInput = z.infer<typeof createRecurringSessionSchema>;
export type UpdateRecurringSessionDetailsInput = z.infer<typeof updateRecurringSessionDetailsSchema>;

/**
 * Resolves which student account owns the financial side of one completed
 * lesson. Attendance and billing are deliberately separate concepts:
 *
 * - per-student pricing/billing follows the students who actually attended;
 * - a total-session lesson with an explicit payer is one household/account
 *   obligation, even when several siblings attend or the named payer is absent;
 * - legacy/ambiguous total-session lessons without a payer keep the historical
 *   participant-based behaviour until the session is explicitly corrected.
 */
export function billingStudentIdsForOccurrence(
  session: Pick<RecurringSession, 'priceBasis' | 'studentIds' | 'payerStudentId'>,
  participantStudentIds: readonly string[],
): string[] {
  if (
    session.priceBasis === 'total_session'
    && session.payerStudentId
    && session.studentIds.includes(session.payerStudentId)
  ) {
    return [session.payerStudentId];
  }

  const linked = new Set(session.studentIds);
  return [...new Set(participantStudentIds)].filter((studentId) => linked.has(studentId));
}

export function billingOwnerStudentId(
  session: Pick<RecurringSession, 'priceBasis' | 'studentIds' | 'payerStudentId'>,
): string | null {
  if (
    session.priceBasis === 'total_session'
    && session.payerStudentId
    && session.studentIds.includes(session.payerStudentId)
  ) {
    return session.payerStudentId;
  }
  return session.studentIds.length === 1 ? session.studentIds[0] : null;
}

export type RecurringSession = {
  id: string;
  workspaceId: string;
  title: string;
  sessionType: z.infer<typeof sessionTypeSchema>;
  scheduleStatus: ScheduleStatus;
  weekday: number | null;
  startTime: string | null;
  durationMinutes: number;
  travelMinutes: number;
  location: string | null;
  priceBasis: 'total_session' | 'per_student';
  defaultPricePence: number;
  expectedStudentCount: number;
  centerCutBps: number;
  active: boolean;
  studentIds: string[];
  /** Student/household account responsible for a total-session group charge. */
  payerStudentId: string | null;
};
