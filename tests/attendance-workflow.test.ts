import { describe, expect, it, vi } from 'vitest';
import type { RecurringSession } from '../src/modules/tutoring/domain/session';
import {
  createAttendanceWorkflow,
  type AttendanceWorkflowDependencies,
} from '../src/client/tutoring/attendance-workflow';

const session: RecurringSession = {
  id: '10000000-0000-4000-8000-000000000001',
  workspaceId: '10000000-0000-4000-8000-000000000002',
  title: 'مريم',
  sessionType: 'private_student_home',
  scheduleStatus: 'confirmed',
  weekday: 2,
  startTime: '16:00',
  durationMinutes: 60,
  travelMinutes: 20,
  location: null,
  priceBasis: 'total_session',
  defaultPricePence: 3000,
  expectedStudentCount: 1,
  centerCutBps: 0,
  active: true,
  studentIds: ['10000000-0000-4000-8000-000000000003'],
};

function dependencies(): AttendanceWorkflowDependencies {
  return {
    complete: vi.fn(async () => undefined) as AttendanceWorkflowDependencies['complete'],
    collect: vi.fn(async (input) => ({
      id: '10000000-0000-4000-8000-000000000004',
      workspaceId: input.workspaceId,
      payerRefType: 'tutoring.student',
      payerRefId: input.studentId,
      amountPence: input.amountPence,
      receivedAt: input.receivedAt ?? '2026-09-16',
      paymentMethod: input.paymentMethod ?? 'cash',
      sourceKind: 'manual',
      sourceModule: null,
      sourceEntityType: null,
      sourceEntityId: null,
      note: input.note ?? null,
      deletedAt: null,
      pendingSync: true,
    })) as AttendanceWorkflowDependencies['collect'],
    cancel: vi.fn(async () => undefined) as AttendanceWorkflowDependencies['cancel'],
    restore: vi.fn(async () => undefined) as AttendanceWorkflowDependencies['restore'],
    reopen: vi.fn(async () => undefined) as AttendanceWorkflowDependencies['reopen'],
    reschedule: vi.fn(async () => undefined) as AttendanceWorkflowDependencies['reschedule'],
    today: () => '2026-09-17',
  };
}

describe('attendance workflow', () => {
  it('completes before recording a linked collection', async () => {
    const deps = dependencies();
    const workflow = createAttendanceWorkflow(deps);

    await workflow(session.workspaceId, {
      kind: 'complete-and-collect',
      session,
      displayedDate: '2026-09-16',
      studentId: session.studentIds[0],
      amountPence: 3000,
      paymentMethod: 'cash',
    });

    expect(deps.complete).toHaveBeenCalledOnce();
    expect(deps.collect).toHaveBeenCalledOnce();
    expect(vi.mocked(deps.complete).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(deps.collect).mock.invocationCallOrder[0]);
  });

  it('blocks completion and collection for a future lesson before any durable write', async () => {
    const deps = dependencies();
    const workflow = createAttendanceWorkflow(deps);

    await expect(workflow(session.workspaceId, {
      kind: 'complete-and-collect',
      session,
      displayedDate: '2026-09-18',
      studentId: session.studentIds[0],
      amountPence: 3000,
    })).rejects.toThrow('FUTURE_ATTENDANCE_NOT_ALLOWED');

    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.collect).not.toHaveBeenCalled();
  });

  it('does not record money when completion itself fails', async () => {
    const deps = dependencies();
    vi.mocked(deps.complete).mockRejectedValueOnce(new Error('completion failed'));
    const workflow = createAttendanceWorkflow(deps);

    await expect(workflow(session.workspaceId, {
      kind: 'complete-and-collect',
      session,
      displayedDate: '2026-09-16',
      studentId: session.studentIds[0],
      amountPence: 3000,
    })).rejects.toThrow('completion failed');

    expect(deps.collect).not.toHaveBeenCalled();
  });

  it('surfaces a recoverable state when collection fails after durable completion', async () => {
    const deps = dependencies();
    vi.mocked(deps.collect).mockRejectedValueOnce(new Error('finance failed'));
    const workflow = createAttendanceWorkflow(deps);

    await expect(workflow(session.workspaceId, {
      kind: 'complete-and-collect',
      session,
      displayedDate: '2026-09-16',
      studentId: session.studentIds[0],
      amountPence: 3000,
    })).rejects.toThrow('ATTENDANCE_COMPLETED_COLLECTION_FAILED');

    expect(deps.complete).toHaveBeenCalledOnce();
    expect(deps.collect).toHaveBeenCalledOnce();
  });

  it('routes correction actions without duplicating business rules in the UI', async () => {
    const deps = dependencies();
    const workflow = createAttendanceWorkflow(deps);

    await workflow(session.workspaceId, { kind: 'cancel', session, displayedDate: '2026-09-18' });
    await workflow(session.workspaceId, { kind: 'restore', session, displayedDate: '2026-09-16' });
    await workflow(session.workspaceId, { kind: 'reopen', occurrenceId: 'occurrence-1' });
    await workflow(session.workspaceId, {
      kind: 'reschedule',
      session,
      displayedDate: '2026-09-18',
      targetDate: '2026-09-19',
      targetStart: '17:30',
    });

    expect(deps.cancel).toHaveBeenCalledOnce();
    expect(deps.restore).toHaveBeenCalledOnce();
    expect(deps.reopen).toHaveBeenCalledOnce();
    expect(deps.reschedule).toHaveBeenCalledOnce();
  });
});
