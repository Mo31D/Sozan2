import { createStudentSchema, type Student } from '../domain/student';
import type { StudentRepository } from '../ports/student-repository';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class StudentsService {
  constructor(
    private readonly repository: StudentRepository,
    private readonly idFactory: () => string,
  ) {}

  list(workspaceId: string): Promise<Student[]> {
    return this.repository.listActive(workspaceId);
  }

  create(workspaceId: string, input: unknown, preferredId?: string): Promise<Student> {
    const parsed = createStudentSchema.parse(input);
    if (preferredId && !UUID_RE.test(preferredId)) throw new Error('STUDENT_ID_INVALID');
    return this.repository.create({
      ...parsed,
      id: preferredId ?? this.idFactory(),
      workspaceId,
    });
  }
}
