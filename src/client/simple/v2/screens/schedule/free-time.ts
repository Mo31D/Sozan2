export const FREE_TIME_REQUIREMENTS = [
  { id: 'standard', label: 'حصة عادية + انتقال', minutes: 120 },
  { id: 'lesson-only', label: 'حصة بدون انتقال', minutes: 90 },
  { id: 'two-students', label: 'طالبين في نفس المكان', minutes: 180 },
] as const;

export type FreeTimeRequirementId = typeof FREE_TIME_REQUIREMENTS[number]['id'];

export function freeSlotFits(startMinute: number, endMinute: number, requiredMinutes: number): boolean {
  if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute) || !Number.isFinite(requiredMinutes)) return false;
  if (requiredMinutes <= 0 || endMinute <= startMinute) return false;
  return endMinute - startMinute >= requiredMinutes;
}
