import { archiveStudentFromRecurringSession } from '../../modules/tutoring/domain/student-lifecycle';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { updateStudentSchema, type Student } from '../../modules/tutoring/domain/student';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';

export async function updateLocalStudent(
  workspaceId: string,
  studentId: string,
  input: unknown,
): Promise<Student> {
  const parsed = updateStudentSchema.parse(input);
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.tutoringStudents, 'readonly');
  const current = await requestResult<Student | undefined>(read.objectStore(STORES.tutoringStudents).get(studentId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('STUDENT_NOT_FOUND');

  const updated: Student = {
    ...current,
    name: parsed.name,
    age: parsed.age,
    guardianName: parsed.guardianName,
    guardianPhone: parsed.guardianPhone,
    level: parsed.level,
    notes: parsed.notes,
  };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student',
    entityId: studentId,
    action: 'student.updated',
    title: `تم تعديل بيانات ${updated.name}`,
    before: current,
    after: updated,
    undoable: true,
  });

  const transaction = db.transaction(
    [STORES.tutoringStudents, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringStudents).put(updated);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'student.update',
    entityType: 'student',
    entityId: studentId,
    payload: parsed,
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
  return updated;
}


export async function archiveLocalStudent(
  workspaceId: string,
  studentId: string,
): Promise<{ deactivatedSessions: number; detachedSessions: number }> {
  const db = await openLocalDatabase();
  const read = db.transaction(
    [STORES.tutoringStudents, STORES.tutoringSessions],
    'readonly',
  );
  const [current, allSessions] = await Promise.all([
    requestResult<Student | undefined>(
      read.objectStore(STORES.tutoringStudents).get(studentId),
    ),
    requestResult<RecurringSession[]>(
      read.objectStore(STORES.tutoringSessions).getAll(),
    ),
  ]);

  if (!current || current.workspaceId !== workspaceId) throw new Error('STUDENT_NOT_FOUND');
  if (!current.active) return { deactivatedSessions: 0, detachedSessions: 0 };

  const affected = allSessions
    .filter((session) => session.workspaceId === workspaceId)
    .map((session) => archiveStudentFromRecurringSession(session, studentId))
    .filter((change) => change.kind !== 'unchanged');

  const deactivatedSessions = affected.filter((change) => change.kind === 'deactivated').length;
  const detachedSessions = affected.filter((change) => change.kind === 'detached').length;
  const updatedStudent: Student = { ...current, active: false };

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student',
    entityId: studentId,
    action: 'student.archived',
    title: `تم إيقاف الطالب ${current.name}`,
    detail: [
      deactivatedSessions ? `تم إيقاف ${deactivatedSessions} موعد فردي مستقبلي` : '',
      detachedSessions ? `تم فصل الطالب من ${detachedSessions} موعد مشترك` : '',
      'التاريخ والحضور والمدفوعات محفوظة',
    ].filter(Boolean).join(' · '),
    before: current,
    after: {
      student: updatedStudent,
      sessionChanges: affected.map((change) => ({
        kind: change.kind,
        sessionId: change.session.id,
        studentIds: change.session.studentIds,
        active: change.session.active,
        payerStudentId: change.session.payerStudentId,
        expectedStudentCount: change.session.expectedStudentCount,
      })),
    },
    undoable: false,
  });

  const transaction = db.transaction(
    [STORES.tutoringStudents, STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringStudents).put(updatedStudent);
  for (const change of affected) {
    transaction.objectStore(STORES.tutoringSessions).put(change.session);
  }
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'student.archive',
    entityType: 'student',
    entityId: studentId,
    payload: {},
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);

  return { deactivatedSessions, detachedSessions };
}

export async function restoreLocalStudent(
  workspaceId: string,
  studentId: string,
): Promise<void> {
  const db = await openLocalDatabase();
  const read = db.transaction(STORES.tutoringStudents, 'readonly');
  const current = await requestResult<Student | undefined>(
    read.objectStore(STORES.tutoringStudents).get(studentId),
  );
  if (!current || current.workspaceId !== workspaceId) throw new Error('STUDENT_NOT_FOUND');
  if (current.active) return;

  const restored: Student = { ...current, active: true };
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student',
    entityId: studentId,
    action: 'student.restored',
    title: `تمت إعادة الطالب ${current.name}`,
    detail: 'تمت إعادة ملف الطالب فقط؛ المواعيد التي توقفت عند الأرشفة لا تعود تلقائيًا.',
    before: current,
    after: restored,
    undoable: false,
  });

  const transaction = db.transaction(
    [STORES.tutoringStudents, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringStudents).put(restored);
  transaction.objectStore(STORES.coreActivityEvents).put(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'student.restore',
    entityType: 'student',
    entityId: studentId,
    payload: {},
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
}
