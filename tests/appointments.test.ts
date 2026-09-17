import { describe, expect, it } from 'vitest';
import {
  appointmentClientDuePence,
  appointmentCurrentDuePence,
  buildAppointmentReport,
} from '../src/modules/reports/appointments';
import { reportRangeForPreset } from '../src/modules/reports/insights';
import { validateAppointmentDate, validateAppointmentTime } from '../src/modules/appointments/domain';

const client = (id: string, name: string) => ({
  id,
  workspaceId: 'ws',
  name,
  phone: null,
  notes: null,
  active: true,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  deletedAt: null,
});

const appointment = (
  id: string,
  clientId: string | null,
  date: string,
  pricePence: number,
  status: 'scheduled' | 'completed' | 'cancelled' | 'missed' = 'completed',
) => ({
  id,
  workspaceId: 'ws',
  clientId,
  title: `Service ${id}`,
  appointmentDate: date,
  startTime: '10:00',
  durationMinutes: 60,
  travelMinutes: 15,
  location: null,
  pricePence,
  status,
  note: null,
  completedAt: status === 'completed' ? `${date}T11:00:00Z` : null,
  createdAt: `${date}T09:00:00Z`,
  updatedAt: `${date}T11:00:00Z`,
  deletedAt: null,
});

describe('appointments domain and reports', () => {
  it('keeps current receivables independent from the selected report period', () => {
    const data = {
      clients: [client('c1', 'منى')],
      appointments: [
        appointment('old', 'c1', '2026-08-20', 10_000),
        appointment('current', 'c1', '2026-09-10', 5_000),
      ],
      receipts: [
        { payerRefType: 'appointments.client', payerRefId: 'c1', amountPence: 2_000, receivedAt: '2026-09-11', deletedAt: null },
      ],
      expenses: [],
      otherIncome: [],
    };

    const report = buildAppointmentReport(data, reportRangeForPreset('month', '2026-09-17'));
    expect(report.earnedPence).toBe(5_000);
    expect(report.receivedPence).toBe(2_000);
    expect(report.duePence).toBe(13_000);
    expect(appointmentCurrentDuePence(data)).toBe(13_000);
  });

  it('does not let overpayment by one client erase another client receivable', () => {
    const data = {
      clients: [client('c1', 'منى'), client('c2', 'ريم')],
      appointments: [
        appointment('a1', 'c1', '2026-09-10', 5_000),
        appointment('a2', 'c2', '2026-09-11', 7_000),
      ],
      receipts: [
        { payerRefType: 'appointments.client', payerRefId: 'c1', amountPence: 10_000, receivedAt: '2026-09-10', deletedAt: null },
      ],
      expenses: [],
      otherIncome: [],
    };

    expect(appointmentClientDuePence(data, 'c1')).toBe(0);
    expect(appointmentClientDuePence(data, 'c2')).toBe(7_000);
    expect(appointmentCurrentDuePence(data)).toBe(7_000);
  });

  it('keeps completed priced work without a client visible as unassigned due', () => {
    const data = {
      clients: [],
      appointments: [appointment('a1', null, '2026-09-12', 8_500)],
      receipts: [],
      expenses: [],
      otherIncome: [],
    };

    const report = buildAppointmentReport(data, reportRangeForPreset('week', '2026-09-17'));
    expect(report.earnedPence).toBe(8_500);
    expect(report.unassignedDuePence).toBe(8_500);
    expect(report.duePence).toBe(8_500);
  });

  it('excludes cancelled work from earnings while retaining status counts', () => {
    const data = {
      clients: [client('c1', 'منى')],
      appointments: [
        appointment('done', 'c1', '2026-09-15', 4_000, 'completed'),
        appointment('cancelled', 'c1', '2026-09-16', 9_000, 'cancelled'),
      ],
      receipts: [],
      expenses: [],
      otherIncome: [],
    };

    const report = buildAppointmentReport(data, reportRangeForPreset('week', '2026-09-17'));
    expect(report.completed).toBe(1);
    expect(report.cancelled).toBe(1);
    expect(report.earnedPence).toBe(4_000);
    expect(report.duePence).toBe(4_000);
  });

  it('validates appointment dates and clock times at the domain boundary', () => {
    expect(validateAppointmentDate('2026-09-17')).toBe('2026-09-17');
    expect(validateAppointmentTime('23:59')).toBe('23:59');
    expect(validateAppointmentTime(null)).toBeNull();
    expect(() => validateAppointmentDate('17/09/2026')).toThrow('APPOINTMENT_DATE_REQUIRED');
    expect(() => validateAppointmentTime('25:00')).toThrow('APPOINTMENT_TIME_INVALID');
  });
});
