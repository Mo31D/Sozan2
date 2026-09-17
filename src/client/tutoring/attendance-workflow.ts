import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { completeLocalSession } from './attendance-commands';
import {
  cancelLocalOccurrence,
  reopenLocalOccurrence,
  rescheduleLocalOccurrence,
  restoreLocalOccurrence,
} from './attendance-corrections';
import { collectLocalStudentPayment, type LocalReceipt } from './local-commands';

export type AttendanceWorkflowAction =
  | {
      kind: 'complete';
      session: RecurringSession;
      displayedDate: string;
      occurrenceId?: string;
    }
  | {
      kind: 'complete-and-collect';
      session: RecurringSession;
      displayedDate: string;
      occurrenceId?: string;
      studentId: string;
      amountPence: number;
      paymentMethod?: LocalReceipt['paymentMethod'];
      note?: string | null;
    }
  | {
      kind: 'cancel';
      session: RecurringSession;
      displayedDate: string;
      occurrenceId?: string;
    }
  | {
      kind: 'restore';
      session: RecurringSession;
      displayedDate: string;
      occurrenceId?: string;
    }
  | {
      kind: 'reopen';
      occurrenceId: string;
    }
  | {
      kind: 'reschedule';
      session: RecurringSession;
      displayedDate: string;
      occurrenceId?: string;
      targetDate: string;
      targetStart: string | null;
      note?: string | null;
    };

export type AttendanceWorkflowDependencies = {
  complete: typeof completeLocalSession;
  collect: typeof collectLocalStudentPayment;
  cancel: typeof cancelLocalOccurrence;
  restore: typeof restoreLocalOccurrence;
  reopen: typeof reopenLocalOccurrence;
  reschedule: typeof rescheduleLocalOccurrence;
  today?: () => string;
};

function localTodayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function assertAttendanceDateNotFuture(displayedDate: string, today = localTodayIso()): void {
  if (displayedDate > today) throw new Error('FUTURE_ATTENDANCE_NOT_ALLOWED');
}

const defaultDependencies: AttendanceWorkflowDependencies = {
  complete: completeLocalSession,
  collect: collectLocalStudentPayment,
  cancel: cancelLocalOccurrence,
  restore: restoreLocalOccurrence,
  reopen: reopenLocalOccurrence,
  reschedule: rescheduleLocalOccurrence,
  today: () => localTodayIso(),
};

export function createAttendanceWorkflow(dependencies: AttendanceWorkflowDependencies = defaultDependencies) {
  const today = dependencies.today ?? (() => localTodayIso());
  return async (workspaceId: string, action: AttendanceWorkflowAction): Promise<void> => {
    switch (action.kind) {
      case 'complete':
        assertAttendanceDateNotFuture(action.displayedDate, today());
        await dependencies.complete(workspaceId, action.session, action.displayedDate, action.occurrenceId);
        return;

      case 'complete-and-collect':
        assertAttendanceDateNotFuture(action.displayedDate, today());
        await dependencies.complete(workspaceId, action.session, action.displayedDate, action.occurrenceId);
        try {
          await dependencies.collect({
            workspaceId,
            studentId: action.studentId,
            amountPence: action.amountPence,
            receivedAt: action.displayedDate,
            paymentMethod: action.paymentMethod,
            note: action.note,
          });
        } catch {
          // Completion and finance are separate durable modules. Never roll back a valid
          // attendance event because collection failed; surface an explicit recovery state.
          throw new Error('ATTENDANCE_COMPLETED_COLLECTION_FAILED');
        }
        return;

      case 'cancel':
        await dependencies.cancel(
          workspaceId,
          action.session,
          action.displayedDate,
          action.occurrenceId,
        );
        return;

      case 'restore':
        await dependencies.restore(
          workspaceId,
          action.session,
          action.displayedDate,
          action.occurrenceId,
        );
        return;

      case 'reopen':
        await dependencies.reopen(workspaceId, action.occurrenceId);
        return;

      case 'reschedule':
        await dependencies.reschedule(
          workspaceId,
          action.session,
          action.displayedDate,
          action.targetDate,
          action.targetStart,
          action.note,
          action.occurrenceId,
        );
        return;
    }
  };
}

export const runAttendanceWorkflow = createAttendanceWorkflow();
