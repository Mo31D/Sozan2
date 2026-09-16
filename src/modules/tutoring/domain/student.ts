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
  age: z.number().int().min(1).max(120).nullable().optional().default(null),
  guardianName: optionalText(100),
  guardianPhone: optionalText(50),
  level: optionalText(100),
  notes: optionalText(500),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;

export type Student = {
  id: string;
  workspaceId: string;
  name: string;
  age: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
  level: string | null;
  notes: string | null;
  active: boolean;
};
