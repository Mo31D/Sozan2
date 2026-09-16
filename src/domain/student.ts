import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

export const createStudentSchema = z.object({
  name: z.string().trim().min(1).max(100),
  guardianName: optionalText(100),
  guardianPhone: optionalText(50),
  level: optionalText(100),
  notes: optionalText(500),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export type Student = {
  id: number;
  name: string;
  guardianName: string | null;
  guardianPhone: string | null;
  level: string | null;
  notes: string | null;
  active: boolean;
};
