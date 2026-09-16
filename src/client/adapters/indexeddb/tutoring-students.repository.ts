import type { Student } from '../../../modules/tutoring/domain/student';
import type {
  NewStudent,
  StudentRepository,
} from '../../../modules/tutoring/ports/student-repository';
import { newSyncOutboxRecord } from '../../sync/outbox';
import { openLocalDatabase, requestResult, STORES, transactionDone } from './database';

type StoredStudent = Student;

export class IndexedDbStudentRepository implements StudentRepository {
  async listActive(workspaceId: string): Promise<Student[]> {
    const db = await openLocalDatabase();
    const transaction = db.transaction(STORES.tutoringStudents, 'readonly');
    const store = transaction.objectStore(STORES.tutoringStudents);
    const rows = await requestResult(store.getAll() as IDBRequest<StoredStudent[]>);

    return rows
      .filter((row) => row.workspaceId === workspaceId && row.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  }

  async create(input: NewStudent): Promise<Student> {
    const student: Student = {
      id: input.id,
      workspaceId: input.workspaceId,
      name: input.name,
      age: input.age,
      guardianName: input.guardianName,
      guardianPhone: input.guardianPhone,
      level: input.level,
      notes: input.notes,
      active: true,
    };

    const db = await openLocalDatabase();
    const transaction = db.transaction(
      [STORES.tutoringStudents, STORES.syncOutbox],
      'readwrite',
    );
    transaction.objectStore(STORES.tutoringStudents).add(student);
    transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
      workspaceId: input.workspaceId,
      moduleKey: 'tutoring',
      operation: 'student.create',
      entityType: 'student',
      entityId: input.id,
      payload: {
        name: input.name,
        age: input.age,
        guardianName: input.guardianName,
        guardianPhone: input.guardianPhone,
        level: input.level,
        notes: input.notes,
      },
    }));
    await transactionDone(transaction);
    return student;
  }
}
