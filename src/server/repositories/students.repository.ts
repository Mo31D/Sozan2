import type { CreateStudentInput, Student } from '../../domain/student';

type StudentRow = {
  id: number;
  name: string;
  guardian_name: string | null;
  guardian_phone: string | null;
  level: string | null;
  notes: string | null;
  active: number;
};

function mapStudent(row: StudentRow): Student {
  return {
    id: Number(row.id),
    name: row.name,
    guardianName: row.guardian_name,
    guardianPhone: row.guardian_phone,
    level: row.level,
    notes: row.notes,
    active: row.active === 1,
  };
}

export async function listActiveStudents(db: D1Database): Promise<Student[]> {
  const result = await db
    .prepare(
      `SELECT id, name, guardian_name, guardian_phone, level, notes, active
       FROM students
       WHERE active = 1 AND deleted_at IS NULL
       ORDER BY name COLLATE NOCASE, id`,
    )
    .all<StudentRow>();

  return (result.results ?? []).map(mapStudent);
}

export async function insertStudent(
  db: D1Database,
  input: CreateStudentInput,
): Promise<Student> {
  const result = await db
    .prepare(
      `INSERT INTO students(name, guardian_name, guardian_phone, level, notes)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
    .bind(input.name, input.guardianName, input.guardianPhone, input.level, input.notes)
    .run();

  const id = Number(result.meta.last_row_id);
  const row = await db
    .prepare(
      `SELECT id, name, guardian_name, guardian_phone, level, notes, active
       FROM students
       WHERE id = ?1`,
    )
    .bind(id)
    .first<StudentRow>();

  if (!row) {
    throw new Error('STUDENT_INSERT_FAILED');
  }

  return mapStudent(row);
}
