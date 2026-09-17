export type StudentBaseline = {
  id: string;
  workspaceId: string;
  studentId: string;
  completedLessonsBeforeTracking: number;
  sourceNote: string | null;
  observedAt: string;
};
