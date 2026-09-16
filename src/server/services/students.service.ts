import { createStudentSchema, type Student } from '../../domain/student';
import {
  insertStudent,
  listActiveStudents,
} from '../repositories/students.repository';

export function getStudents(db: D1Database): Promise<Student[]> {
  return listActiveStudents(db);
}

export async function createStudent(db: D1Database, input: unknown): Promise<Student> {
  const parsed = createStudentSchema.parse(input);
  return insertStudent(db, parsed);
}
