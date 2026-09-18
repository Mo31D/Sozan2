import type { CreateStudentInput, Student } from '../domain/student';

export type NewStudent = CreateStudentInput & {
  id: string;
  workspaceId: string;
};

export interface StudentRepository {
  listActive(workspaceId: string): Promise<Student[]>;
  listAll(workspaceId: string): Promise<Student[]>;
  create(input: NewStudent): Promise<Student>;
}
