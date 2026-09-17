import type { AppointmentClient, AppointmentItem } from '../appointments/domain';
import type { ReportDateRange } from './insights';

export type AppointmentReportInput = {
  clients: AppointmentClient[];
  appointments: AppointmentItem[];
  receipts: Array<{
    payerRefType: string;
    payerRefId: string;
    amountPence: number;
    receivedAt: string;
    deletedAt?: string | null;
  }>;
  expenses: Array<{ expenseDate: string; amountPence: number; deletedAt?: string | null }>;
  otherIncome: Array<{ incomeDate: string; amountPence: number; deletedAt?: string | null }>;
};

export type AppointmentWorkspaceReport = {
  completed: number;
  cancelled: number;
  scheduled: number;
  serviceMinutes: number;
  travelMinutes: number;
  workMinutes: number;
  earnedPence: number;
  receivedPence: number;
  expensesPence: number;
  otherIncomePence: number;
  netCashPence: number;
  duePence: number;
  effectiveHourlyPence: number;
  unassignedDuePence: number;
  clientRows: Array<{
    clientId: string;
    name: string;
    completed: number;
    minutes: number;
    receivedPence: number;
    duePence: number;
  }>;
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + Number(value || 0), 0);
}

function activeAppointments(data: AppointmentReportInput): AppointmentItem[] {
  return data.appointments.filter((row) => !row.deletedAt);
}

function activeClientReceipts(data: AppointmentReportInput) {
  return data.receipts.filter((row) => !row.deletedAt && row.payerRefType === 'appointments.client');
}

export function appointmentCurrentDuePence(data: AppointmentReportInput): number {
  const completed = activeAppointments(data).filter((row) => row.status === 'completed');
  const receipts = activeClientReceipts(data);
  let due = 0;

  for (const client of data.clients.filter((row) => row.active && !row.deletedAt)) {
    const earned = sum(completed.filter((row) => row.clientId === client.id).map((row) => row.pricePence));
    const received = sum(receipts.filter((row) => row.payerRefId === client.id).map((row) => row.amountPence));
    due += Math.max(0, earned - received);
  }

  // A priced completed appointment without a client cannot yet be matched to a payer.
  // Keep it visible as due rather than silently dropping earned work from reconciliation.
  due += sum(completed.filter((row) => !row.clientId).map((row) => row.pricePence));
  return due;
}

export function appointmentClientDuePence(data: AppointmentReportInput, clientId: string): number {
  const earned = sum(activeAppointments(data)
    .filter((row) => row.status === 'completed' && row.clientId === clientId)
    .map((row) => row.pricePence));
  const received = sum(activeClientReceipts(data)
    .filter((row) => row.payerRefId === clientId)
    .map((row) => row.amountPence));
  return Math.max(0, earned - received);
}

export function buildAppointmentReport(
  data: AppointmentReportInput,
  range: ReportDateRange,
): AppointmentWorkspaceReport {
  const inRange = (value: string) => value.slice(0, 10) >= range.fromDate && value.slice(0, 10) <= range.toDate;
  const rows = activeAppointments(data).filter((row) => inRange(row.appointmentDate));
  const completed = rows.filter((row) => row.status === 'completed');
  const cancelled = rows.filter((row) => row.status === 'cancelled' || row.status === 'missed');
  const scheduled = rows.filter((row) => row.status === 'scheduled');
  const serviceMinutes = sum(completed.map((row) => row.durationMinutes));
  const travelMinutes = sum(completed.map((row) => row.travelMinutes));
  const workMinutes = serviceMinutes + travelMinutes;
  const earnedPence = sum(completed.map((row) => row.pricePence));
  const receipts = activeClientReceipts(data);
  const receivedPence = sum(receipts.filter((row) => inRange(row.receivedAt)).map((row) => row.amountPence));
  const expensesPence = sum(data.expenses.filter((row) => !row.deletedAt && inRange(row.expenseDate)).map((row) => row.amountPence));
  const otherIncomePence = sum(data.otherIncome.filter((row) => !row.deletedAt && inRange(row.incomeDate)).map((row) => row.amountPence));
  const netCashPence = receivedPence + otherIncomePence - expensesPence;
  const duePence = appointmentCurrentDuePence(data);
  const effectiveHourlyPence = workMinutes ? Math.round((earnedPence * 60) / workMinutes) : 0;
  const unassignedDuePence = sum(activeAppointments(data)
    .filter((row) => row.status === 'completed' && !row.clientId)
    .map((row) => row.pricePence));

  const clientRows = data.clients.map((client) => {
    const periodCompleted = completed.filter((row) => row.clientId === client.id);
    const periodReceived = sum(receipts
      .filter((row) => row.payerRefId === client.id && inRange(row.receivedAt))
      .map((row) => row.amountPence));
    return {
      clientId: client.id,
      name: client.name,
      completed: periodCompleted.length,
      minutes: sum(periodCompleted.map((row) => row.durationMinutes)),
      receivedPence: periodReceived,
      duePence: appointmentClientDuePence(data, client.id),
    };
  }).filter((row) => row.completed || row.receivedPence || row.duePence)
    .sort((a, b) => b.completed - a.completed || a.name.localeCompare(b.name, 'ar'));

  return {
    completed: completed.length,
    cancelled: cancelled.length,
    scheduled: scheduled.length,
    serviceMinutes,
    travelMinutes,
    workMinutes,
    earnedPence,
    receivedPence,
    expensesPence,
    otherIncomePence,
    netCashPence,
    duePence,
    effectiveHourlyPence,
    unassignedDuePence,
    clientRows,
  };
}
