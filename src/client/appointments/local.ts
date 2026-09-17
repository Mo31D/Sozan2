import type { AppointmentClient, AppointmentItem, AppointmentStatus } from '../../modules/appointments/domain';
import {
  canChangeAppointmentClient,
  canCompleteAppointment,
  validateAppointmentCollectionClient,
  validateAppointmentDate,
  validateAppointmentTime,
} from '../../modules/appointments/domain';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import type { LocalExpense, LocalOtherIncome, LocalReceipt } from '../finance/types';
import type { LocalWorkspaceSetting } from '../platform/types';
import { newSyncOutboxRecord } from '../sync/outbox';

export type AppointmentWorkspaceData = {
  clients: AppointmentClient[];
  appointments: AppointmentItem[];
  receipts: LocalReceipt[];
  expenses: LocalExpense[];
  otherIncome: LocalOtherIncome[];
  workspaceSettings: LocalWorkspaceSetting[];
};

function now(): string { return new Date().toISOString(); }
function localToday(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function clean(value: string, code: string, max = 160): string {
  const result = value.trim();
  if (!result) throw new Error(code);
  if (result.length > max) throw new Error(`${code}_TOO_LONG`);
  return result;
}

export async function loadAppointmentWorkspaceData(workspaceId: string): Promise<AppointmentWorkspaceData> {
  const db = await openLocalDatabase();
  const tx = db.transaction([
    STORES.appointmentsClients,
    STORES.appointmentsItems,
    STORES.financeReceipts,
    STORES.financeExpenses,
    STORES.financeOtherIncome,
    STORES.coreWorkspaceSettings,
  ], 'readonly');
  const [clients, appointments, receipts, expenses, otherIncome, settings] = await Promise.all([
    requestResult<AppointmentClient[]>(tx.objectStore(STORES.appointmentsClients).getAll()),
    requestResult<AppointmentItem[]>(tx.objectStore(STORES.appointmentsItems).getAll()),
    requestResult<LocalReceipt[]>(tx.objectStore(STORES.financeReceipts).getAll()),
    requestResult<LocalExpense[]>(tx.objectStore(STORES.financeExpenses).getAll()),
    requestResult<LocalOtherIncome[]>(tx.objectStore(STORES.financeOtherIncome).getAll()),
    requestResult<LocalWorkspaceSetting[]>(tx.objectStore(STORES.coreWorkspaceSettings).getAll()),
  ]);
  return {
    clients: clients.filter((row) => row.workspaceId === workspaceId && row.active && !row.deletedAt).sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    appointments: appointments.filter((row) => row.workspaceId === workspaceId && !row.deletedAt).sort((a, b) => a.appointmentDate.localeCompare(b.appointmentDate) || (a.startTime ?? '').localeCompare(b.startTime ?? '')),
    receipts: receipts.filter((row) => row.workspaceId === workspaceId && !row.deletedAt),
    expenses: expenses.filter((row) => row.workspaceId === workspaceId && !row.deletedAt),
    otherIncome: otherIncome.filter((row) => row.workspaceId === workspaceId && !row.deletedAt),
    workspaceSettings: settings.filter((row) => row.workspaceId === workspaceId),
  };
}

export async function createAppointmentClient(workspaceId: string, input: { name: string; phone?: string; notes?: string }): Promise<AppointmentClient> {
  const timestamp = now();
  const client: AppointmentClient = {
    id: crypto.randomUUID(), workspaceId, name: clean(input.name, 'CLIENT_NAME_REQUIRED'),
    phone: input.phone?.trim() || null, notes: input.notes?.trim() || null,
    active: true, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
  const activity = makeActivityEvent({ workspaceId, moduleKey: 'appointments', entityType: 'client', entityId: client.id, action: 'client.created', title: `تمت إضافة ${client.name}`, after: client });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.appointmentsClients, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.appointmentsClients).add(client);
  tx.objectStore(STORES.coreActivityEvents).add(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId, moduleKey: 'appointments', operation: 'client.upsert', entityType: 'client', entityId: client.id, payload: client }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
  return client;
}

export async function createAppointment(workspaceId: string, input: {
  clientId?: string | null; title: string; appointmentDate: string; startTime?: string | null;
  durationMinutes?: number; travelMinutes?: number; location?: string; pricePence?: number; note?: string;
}): Promise<AppointmentItem> {
  const timestamp = now();
  const durationMinutes = Math.round(Number(input.durationMinutes ?? 60));
  const travelMinutes = Math.round(Number(input.travelMinutes ?? 0));
  const pricePence = Math.round(Number(input.pricePence ?? 0));
  if (durationMinutes < 5 || durationMinutes > 1440) throw new Error('APPOINTMENT_DURATION_INVALID');
  if (travelMinutes < 0 || travelMinutes > 1440) throw new Error('APPOINTMENT_TRAVEL_INVALID');
  if (pricePence < 0 || !Number.isSafeInteger(pricePence)) throw new Error('AMOUNT_INVALID');
  if (input.clientId) await requireClient(workspaceId, input.clientId);
  const appointment: AppointmentItem = {
    id: crypto.randomUUID(), workspaceId, clientId: input.clientId || null,
    title: clean(input.title, 'APPOINTMENT_TITLE_REQUIRED'),
    appointmentDate: validateAppointmentDate(input.appointmentDate), startTime: validateAppointmentTime(input.startTime ?? null),
    durationMinutes, travelMinutes, location: input.location?.trim() || null, pricePence,
    status: 'scheduled', note: input.note?.trim() || null, completedAt: null,
    createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
  };
  await putAppointment('appointment.create', appointment, null);
  return appointment;
}

export async function updateAppointment(workspaceId: string, appointmentId: string, input: Partial<Omit<AppointmentItem, 'id' | 'workspaceId' | 'createdAt' | 'updatedAt' | 'deletedAt'>>): Promise<void> {
  const current = await getAppointment(workspaceId, appointmentId);
  const nextClientId = input.clientId !== undefined ? input.clientId : current.clientId;
  if (nextClientId) await requireClient(workspaceId, nextClientId);
  if (nextClientId !== current.clientId) {
    const hasLinkedCollection = await appointmentHasLinkedCollection(workspaceId, appointmentId);
    if (!canChangeAppointmentClient(current.clientId, nextClientId, hasLinkedCollection)) {
      throw new Error('APPOINTMENT_CLIENT_LOCKED_BY_COLLECTION');
    }
  }
  const next: AppointmentItem = {
    ...current,
    ...input,
    title: input.title !== undefined ? clean(input.title, 'APPOINTMENT_TITLE_REQUIRED') : current.title,
    appointmentDate: input.appointmentDate !== undefined ? validateAppointmentDate(input.appointmentDate) : current.appointmentDate,
    startTime: input.startTime !== undefined ? validateAppointmentTime(input.startTime) : current.startTime,
    updatedAt: now(),
  };
  if (next.durationMinutes < 5 || next.durationMinutes > 1440) throw new Error('APPOINTMENT_DURATION_INVALID');
  if (next.travelMinutes < 0 || next.travelMinutes > 1440) throw new Error('APPOINTMENT_TRAVEL_INVALID');
  if (next.pricePence < 0 || !Number.isSafeInteger(next.pricePence)) throw new Error('AMOUNT_INVALID');
  if (next.status === 'completed' && !canCompleteAppointment(next.appointmentDate, localToday())) {
    throw new Error('FUTURE_APPOINTMENT_COMPLETION_NOT_ALLOWED');
  }
  await putAppointment('appointment.update', next, current);
}

export async function setAppointmentStatus(workspaceId: string, appointmentId: string, status: AppointmentStatus): Promise<void> {
  const current = await getAppointment(workspaceId, appointmentId);
  if (status === 'completed' && !canCompleteAppointment(current.appointmentDate, localToday())) {
    throw new Error('FUTURE_APPOINTMENT_COMPLETION_NOT_ALLOWED');
  }
  const next = { ...current, status, completedAt: status === 'completed' ? (current.completedAt ?? now()) : null, updatedAt: now() };
  await putAppointment('appointment.status', next, current);
}

export async function collectAppointmentPayment(input: {
  workspaceId: string; clientId: string; amountPence: number; receivedAt: string;
  paymentMethod?: LocalReceipt['paymentMethod']; note?: string | null; appointmentId?: string | null;
}): Promise<LocalReceipt> {
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) throw new Error('COLLECTION_AMOUNT_INVALID');
  await requireClient(input.workspaceId, input.clientId);
  if (input.appointmentId) {
    const appointment = await getAppointment(input.workspaceId, input.appointmentId);
    validateAppointmentCollectionClient(appointment.clientId, input.clientId);
  }
  const receipt: LocalReceipt = {
    id: crypto.randomUUID(), workspaceId: input.workspaceId, payerRefType: 'appointments.client', payerRefId: input.clientId,
    amountPence: input.amountPence, receivedAt: validateAppointmentDate(input.receivedAt), paymentMethod: input.paymentMethod ?? 'cash',
    sourceKind: 'manual', sourceModule: input.appointmentId ? 'appointments' : null,
    sourceEntityType: input.appointmentId ? 'appointment' : null, sourceEntityId: input.appointmentId ?? null,
    note: input.note?.trim() || null, deletedAt: null, pendingSync: true,
  };
  const activity = makeActivityEvent({ workspaceId: input.workspaceId, moduleKey: 'finance', entityType: 'receipt', entityId: receipt.id, action: 'receipt.created', title: 'تم تسجيل تحصيل', after: receipt });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.financeReceipts, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.financeReceipts).add(receipt);
  tx.objectStore(STORES.coreActivityEvents).add(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId: input.workspaceId, moduleKey: 'finance', operation: 'receipt.create', entityType: 'receipt', entityId: receipt.id,
    payload: { payerRefType: receipt.payerRefType, payerRefId: receipt.payerRefId, amountPence: receipt.amountPence, receivedAt: receipt.receivedAt, paymentMethod: receipt.paymentMethod, sourceModule: receipt.sourceModule, sourceEntityType: receipt.sourceEntityType, sourceEntityId: receipt.sourceEntityId, note: receipt.note },
  }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
  return receipt;
}

async function requireClient(workspaceId: string, clientId: string): Promise<AppointmentClient> {
  const db = await openLocalDatabase();
  const row = await requestResult<AppointmentClient | undefined>(db.transaction(STORES.appointmentsClients, 'readonly').objectStore(STORES.appointmentsClients).get(clientId));
  if (!row || row.workspaceId !== workspaceId || !row.active || row.deletedAt) throw new Error('CLIENT_NOT_FOUND');
  return row;
}

async function getAppointment(workspaceId: string, appointmentId: string): Promise<AppointmentItem> {
  const db = await openLocalDatabase();
  const row = await requestResult<AppointmentItem | undefined>(db.transaction(STORES.appointmentsItems, 'readonly').objectStore(STORES.appointmentsItems).get(appointmentId));
  if (!row || row.workspaceId !== workspaceId || row.deletedAt) throw new Error('APPOINTMENT_NOT_FOUND');
  return row;
}

async function appointmentHasLinkedCollection(workspaceId: string, appointmentId: string): Promise<boolean> {
  const db = await openLocalDatabase();
  const rows = await requestResult<LocalReceipt[]>(db.transaction(STORES.financeReceipts, 'readonly').objectStore(STORES.financeReceipts).getAll());
  return rows.some((row) =>
    row.workspaceId === workspaceId
    && !row.deletedAt
    && row.sourceModule === 'appointments'
    && row.sourceEntityType === 'appointment'
    && row.sourceEntityId === appointmentId,
  );
}

async function putAppointment(operation: string, next: AppointmentItem, before: AppointmentItem | null): Promise<void> {
  const activity = makeActivityEvent({
    workspaceId: next.workspaceId, moduleKey: 'appointments', entityType: 'appointment', entityId: next.id,
    action: operation, title: before ? `تم تعديل ${next.title}` : `تمت إضافة ${next.title}`, before, after: next,
  });
  const db = await openLocalDatabase();
  const tx = db.transaction([STORES.appointmentsItems, STORES.coreActivityEvents, STORES.syncOutbox], 'readwrite');
  tx.objectStore(STORES.appointmentsItems).put(next);
  tx.objectStore(STORES.coreActivityEvents).put(activity);
  tx.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({ workspaceId: next.workspaceId, moduleKey: 'appointments', operation: 'appointment.upsert', entityType: 'appointment', entityId: next.id, payload: next }));
  tx.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(tx);
}
