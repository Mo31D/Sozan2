export type AppointmentClient = {
  id: string;
  workspaceId: string;
  name: string;
  phone: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'missed';

export type AppointmentItem = {
  id: string;
  workspaceId: string;
  clientId: string | null;
  title: string;
  appointmentDate: string;
  startTime: string | null;
  durationMinutes: number;
  travelMinutes: number;
  location: string | null;
  pricePence: number;
  status: AppointmentStatus;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export function validateAppointmentDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error('APPOINTMENT_DATE_REQUIRED');
  return value;
}

export function validateAppointmentTime(value: string | null): string | null {
  if (value === null || value === '') return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/u.test(value)) throw new Error('APPOINTMENT_TIME_INVALID');
  return value;
}
