export type LessonTimeDefaults = {
  durationMinutes: number;
  travelMinutes: number;
  expectedStudentCount: number;
};

export function lessonTimeDefaults(studentCount: number): LessonTimeDefaults {
  const count = Math.max(1, Math.round(Number(studentCount) || 1));
  return {
    durationMinutes: Math.min(360, 90 * count),
    travelMinutes: count > 1 ? 0 : 30,
    expectedStudentCount: count,
  };
}
