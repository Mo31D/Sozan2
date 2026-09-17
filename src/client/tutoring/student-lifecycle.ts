import type { Student } from '../../modules/tutoring/domain/student';
import type { RecurringSession } from '../../modules/tutoring/domain/session';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import { newSyncOutboxRecord } from '../sync/outbox';

function stateMutation(workspaceId: string, studentId: string, payload: { active?: boolean; familyId?: string | null }) {
  return newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'student.state.update',
    entityType: 'student',
    entityId: studentId,
    payload,
  });
}

export async function archiveLocalStudent(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const tx = db.transaction(
    [STORES.tutoringStudents, STORES.tutoringSessions, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  const studentStore = tx.objectStore(STORES.tutoringStudents);
  const sessionStore = tx.objectStore(STORES.tutoringSessions);
  const [current, sessions] = await Promise.all([
    requestResult<Student | undefined>(studentStore.get(studentId)),
    requestResult<RecurringSession[]>(sessionStore.getAll()),
  ]);
  if (!current || current.workspaceId !== workspaceId) throw new Error('STUDENT_NOT_FOUND');
  if (!current.active) {
    await transactionDone(tx);
    return;
  }

  const updatedStudent: Student = { ...current, familyId: current.familyId ?? null, active: false };
  studentStore.put(updatedStudent);

  for (const session of sessions) {
    if (session.workspaceId !== workspaceId || !session.active || !session.studentIds.includes(studentId)) continue;
    const remaining = session.studentIds.filter((id) => id !== studentId);
    if (remaining.length === 0) {
      sessionStore.put({ ...session, active: false });
      continue;
    }
    sessionStore.put({
      ...session,
      studentIds: remaining,
      expectedStudentCount: Math.max(1, Math.min(session.expectedStudentCount, remaining.length)),
    });
  }

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student',
    entityId: studentId,
    action: 'student.archived',
    title: `تم إيقاف الطالب ${current.name}`,
    detail: 'اختفى من القوائم والمواعيد القادمة، مع الاحتفاظ بالحضور والفلوس والتاريخ السابق.',
    before: current,
    after: updatedStudent,
    undoable: false,
  });
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(stateMutation(workspaceId, studentId, { active: false }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function restoreLocalStudent(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const tx = db.transaction(
    [STORES.tutoringStudents, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  const store = tx.objectStore(STORES.tutoringStudents);
  const current = await requestResult<Student | undefined>(store.get(studentId));
  if (!current || current.workspaceId !== workspaceId) throw new Error('STUDENT_NOT_FOUND');
  if (current.active) {
    await transactionDone(tx);
    return;
  }
  const updated: Student = { ...current, familyId: current.familyId ?? null, active: true };
  store.put(updated);
  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student',
    entityId: studentId,
    action: 'student.restored',
    title: `تم استرجاع الطالب ${current.name}`,
    detail: 'تم استرجاع ملف الطالب. المواعيد القديمة لا تُعاد تلقائيًا حتى لا تظهر حجوزات غير مقصودة.',
    before: current,
    after: updated,
  });
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(stateMutation(workspaceId, studentId, { active: true }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function linkLocalStudentsAsFamily(
  workspaceId: string,
  studentId: string,
  siblingId: string,
): Promise<void> {
  if (studentId === siblingId) throw new Error('STUDENT_FAMILY_SELF_LINK');
  const db = await openLocalDatabase();
  const tx = db.transaction(
    [STORES.tutoringStudents, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  const store = tx.objectStore(STORES.tutoringStudents);
  const rows = await requestResult<Student[]>(store.getAll());
  const mine = rows.filter((row) => row.workspaceId === workspaceId);
  const first = mine.find((row) => row.id === studentId);
  const second = mine.find((row) => row.id === siblingId);
  if (!first || !second) throw new Error('STUDENT_NOT_FOUND');
  if (!first.active || !second.active) throw new Error('STUDENT_ARCHIVED');

  const familyId = first.familyId ?? second.familyId ?? crypto.randomUUID();
  const oldFamilies = new Set([first.familyId, second.familyId].filter((value): value is string => Boolean(value)));
  const affected = mine.filter((row) => row.id === first.id || row.id === second.id || (row.familyId && oldFamilies.has(row.familyId)));
  for (const row of affected) {
    if (row.familyId === familyId) continue;
    store.put({ ...row, familyId });
    tx.objectStore(STORES.syncOutbox).add(stateMutation(workspaceId, row.id, { familyId }));
  }

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student-family',
    entityId: studentId,
    action: 'student.family.linked',
    title: `تم ربط ${first.name} و${second.name} كإخوة`,
    detail: 'كل طالب يظل له ملفه وحصصه وحسابه المستقل؛ الرابط عائلي فقط لتسهيل الوصول.',
    after: { familyId, studentIds: affected.map((row) => row.id) },
  });
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}

export async function unlinkLocalStudentFromFamily(workspaceId: string, studentId: string): Promise<void> {
  const db = await openLocalDatabase();
  const tx = db.transaction(
    [STORES.tutoringStudents, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  const store = tx.objectStore(STORES.tutoringStudents);
  const rows = await requestResult<Student[]>(store.getAll());
  const current = rows.find((row) => row.workspaceId === workspaceId && row.id === studentId);
  if (!current) throw new Error('STUDENT_NOT_FOUND');
  if (!current.familyId) {
    await transactionDone(tx);
    return;
  }

  const familyId = current.familyId;
  const remaining = rows.filter((row) => row.workspaceId === workspaceId && row.id !== studentId && row.familyId === familyId);
  const affected = [current, ...(remaining.length === 1 ? remaining : [])];
  for (const row of affected) {
    store.put({ ...row, familyId: null });
    tx.objectStore(STORES.syncOutbox).add(stateMutation(workspaceId, row.id, { familyId: null }));
  }

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'student-family',
    entityId: studentId,
    action: 'student.family.unlinked',
    title: `تم فصل ${current.name} عن رابط الإخوة`,
    before: { familyId },
    after: { familyId: null },
  });
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}
