export type PlannerBlock = {
  id: string;
  sourceModule: string;
  sourceType: string;
  sourceId: string;
  title: string;
  status: 'confirmed' | 'pending';
  weekday: number | null;
  startTime: string | null;
  durationMinutes: number;
  travelMinutes: number;
  location: string | null;
};

export interface ScheduleProvider {
  listWeeklyBlocks(workspaceId: string): Promise<PlannerBlock[]>;
}
