import { createStudentSchema, type Student } from '../domain/student';
import type { StudentRepository } from '../ports/student-repository';

export class StudentsService {
  constructor(
    private readonly repository: StudentRepository,
    private readonly idFactory: () => string,
  ) {}

  list(workspaceId: string): Promise<Student[]> {
    return this.repository.listActive(workspaceId);
  }

  create(workspaceId: string, input: unknown): Promise<Student> {
    const parsed = createStudentSchema.parse(input);
    return this.repository.create({
      ...parsed,
      id: this.idFactory(),
      workspaceId,
    });
  }
}
