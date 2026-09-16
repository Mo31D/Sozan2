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
