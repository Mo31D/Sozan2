import type { Student } from '../../../modules/tutoring/domain/student';
import type {
  NewStudent,
  StudentRepository,
} from '../../../modules/tutoring/ports/student-repository';

type StudentRow = {
  id: string;
  workspace_id: string;
  name: string;
  age: number | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  level: string | null;
  notes: string | null;
  active: number;
};

function mapStudent(row: StudentRow): Student {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    age: row.age,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    level: row.level,
    notes: row.notes,
    active: row.active === 1,
  };
}

export class D1StudentRepository implements StudentRepository {
  constructor(private readonly db: D1Database) {}

  async listActive(workspaceId: string): Promise<Student[]> {
    const result = await this.db
      .prepare(
        `SELECT id, workspace_id, name, age, guardian_name, guardian_phone, level, notes, active
         FROM tutoring_students
         WHERE workspace_id = ?1 AND active = 1 AND deleted_at IS NULL
         ORDER BY name COLLATE NOCASE, id`,
      )
      .bind(workspaceId)
      .all<StudentRow>();

    return (result.results ?? []).map(mapStudent);
  }

  async listAll(workspaceId: string): Promise<Student[]> {
    const result = await this.db
      .prepare(
        `SELECT id, workspace_id, name, age, guardian_name, guardian_phone, level, notes, active
         FROM tutoring_students
         WHERE workspace_id = ?1 AND deleted_at IS NULL
         ORDER BY active DESC, name COLLATE NOCASE, id`,
      )
      .bind(workspaceId)
      .all<StudentRow>();

    return (result.results ?? []).map(mapStudent);
  }

  async create(input: NewStudent): Promise<Student> {
    await this.db
      .prepare(
        `INSERT INTO tutoring_students(
           id, workspace_id, name, age, guardian_name, guardian_phone, level, notes
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        input.id,
        input.workspaceId,
        input.name,
        input.age,
        input.guardianName,
        input.guardianPhone,
        input.level,
        input.notes,
      )
      .run();

    const row = await this.db
      .prepare(
        `SELECT id, workspace_id, name, age, guardian_name, guardian_phone, level, notes, active
         FROM tutoring_students
         WHERE workspace_id = ?1 AND id = ?2`,
      )
      .bind(input.workspaceId, input.id)
      .first<StudentRow>();

    if (!row) throw new Error('STUDENT_INSERT_FAILED');
    return mapStudent(row);
  }
}
