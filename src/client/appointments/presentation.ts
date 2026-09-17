import type { AppointmentItem } from '../../modules/appointments/domain';
import { appointmentClientDuePence, appointmentCurrentDuePence } from '../../modules/reports/appointments';
import { money } from '../shared/format';
import type { AppointmentWorkspaceData } from './local';

export function clientName(data: AppointmentWorkspaceData, clientId: string | null): string {
  if (!clientId) return 'بدون عميل';
  return data.clients.find((client) => client.id === clientId)?.name ?? 'عميل غير متاح';
}

export function appointmentsForDate(data: AppointmentWorkspaceData, date: string): AppointmentItem[] {
  return data.appointments
    .filter((row) => row.appointmentDate === date)
    .sort((a, b) => (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') || a.title.localeCompare(b.title, 'ar'));
}

export function upcomingAppointments(data: AppointmentWorkspaceData, today: string, limit = 30): AppointmentItem[] {
  return data.appointments
    .filter((row) => row.appointmentDate >= today && row.status === 'scheduled')
    .sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate) || (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99'))
    .slice(0, limit);
}

export function currentAppointmentDue(data: AppointmentWorkspaceData): number {
  return appointmentCurrentDuePence(data);
}

export function currentClientDue(data: AppointmentWorkspaceData, clientId: string): number {
  return appointmentClientDuePence(data, clientId);
}

export function recentAppointmentMoneyRows(data: AppointmentWorkspaceData, currencyLabel: string) {
  return [
    ...data.receipts
      .filter((row) => row.payerRefType === 'appointments.client')
      .map((row) => ({
        id: `r-${row.id}`,
        date: row.receivedAt,
        kind: 'in' as const,
        title: `تحصيل من ${clientName(data, row.payerRefId)}`,
        value: `+ ${money(row.amountPence, currencyLabel)}`,
      })),
    ...data.expenses.map((row) => ({
      id: `e-${row.id}`,
      date: row.expenseDate,
      kind: 'out' as const,
      title: `مصروف · ${row.category}`,
      value: `− ${money(row.amountPence, currencyLabel)}`,
    })),
    ...data.otherIncome.map((row) => ({
      id: `i-${row.id}`,
      date: row.incomeDate,
      kind: 'in' as const,
      title: `دخل آخر · ${row.category}`,
      value: `+ ${money(row.amountPence, currencyLabel)}`,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 12);
}
