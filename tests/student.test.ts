import { describe, expect, it } from 'vitest';
import { createStudentSchema } from '../src/domain/student';

describe('createStudentSchema', () => {
  it('normalises optional blank fields to null', () => {
    const student = createStudentSchema.parse({
      name: '  مريم  ',
      guardianName: ' ',
      guardianPhone: '',
    });

    expect(student.name).toBe('مريم');
    expect(student.guardianName).toBeNull();
    expect(student.guardianPhone).toBeNull();
  });

  it('requires a student name', () => {
    expect(() => createStudentSchema.parse({ name: '   ' })).toThrow();
  });
});
