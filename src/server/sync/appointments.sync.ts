import { z } from 'zod';
import { validateAppointmentDate, validateAppointmentTime } from '../../modules/appointments/domain';
import type { ModuleSnapshot, ModuleSyncHandler, SyncMutation } from './contracts';

const clientSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), name: z.string().trim().min(1).max(160),
  phone: z.string().max(80).nullable(), notes: z.string().max(1000).nullable(), active: z.boolean(),
  createdAt: z.string().min(10).max(50), updatedAt: z.string().min(10).max(50), deletedAt: z.string().max(50).nullable(),
});

const appointmentSchema = z.object({
  id: z.string().uuid(), workspaceId: z.string().uuid(), clientId: z.string().uuid().nullable(),
  title: z.string().trim().min(1).max(160), appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/u).nullable(),
  durationMinutes: z.number().int().min(5).max(1440), travelMinutes: z.number().int().min(0).max(1440),
  location: z.string().max(300).nullable(), pricePence: z.number().int().nonnegative(),
  status: z.enum(['scheduled','completed','cancelled','missed']), note: z.string().max(1000).nullable(),
  completedAt: z.string().max(50).nullable(), createdAt: z.string().min(10).max(50), updatedAt: z.string().min(10).max(50), deletedAt: z.string().max(50).nullable(),
});

type ClientRow = { id:string; workspace_id:string; name:string; phone:string|null; notes:string|null; active:number; created_at:string; updated_at:string; deleted_at:string|null };
type AppointmentRow = { id:string; workspace_id:string; client_id:string|null; title:string; appointment_date:string; start_time:string|null; duration_minutes:number; travel_minutes:number; location:string|null; price_pence:number; status:'scheduled'|'completed'|'cancelled'|'missed'; note:string|null; completed_at:string|null; created_at:string; updated_at:string; deleted_at:string|null };

export const appointmentsSyncHandler: ModuleSyncHandler = {
  moduleKey: 'appointments',
  async apply(db: D1Database, workspaceId: string, mutation: SyncMutation): Promise<void> {
    if (mutation.operation === 'client.upsert') {
      const row = clientSchema.parse(mutation.payload);
      if (row.workspaceId !== workspaceId || row.id !== mutation.entityId) throw new Error('CLIENT_IDENTITY_MISMATCH');
      await db.prepare(`INSERT INTO appointments_clients(id,workspace_id,name,phone,notes,active,created_at,updated_at,deleted_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,phone=excluded.phone,notes=excluded.notes,active=excluded.active,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at
        WHERE appointments_clients.workspace_id=excluded.workspace_id`).bind(row.id,workspaceId,row.name,row.phone,row.notes,row.active?1:0,row.createdAt,row.updatedAt,row.deletedAt).run();
      return;
    }
    if (mutation.operation === 'appointment.upsert') {
      const row = appointmentSchema.parse(mutation.payload);
      if (row.workspaceId !== workspaceId || row.id !== mutation.entityId) throw new Error('APPOINTMENT_IDENTITY_MISMATCH');
      validateAppointmentDate(row.appointmentDate);
      validateAppointmentTime(row.startTime);
      if (row.status === 'completed' && !row.completedAt) throw new Error('APPOINTMENT_COMPLETED_AT_REQUIRED');
      if (row.status !== 'completed' && row.completedAt) throw new Error('APPOINTMENT_COMPLETED_AT_INVALID');
      if (row.clientId) {
        const client = await db.prepare(`SELECT 1 AS found FROM appointments_clients WHERE workspace_id=?1 AND id=?2 AND deleted_at IS NULL`).bind(workspaceId,row.clientId).first<{found:number}>();
        if (!client) throw new Error('CLIENT_NOT_FOUND');
      }
      const current = await db.prepare(
        `SELECT client_id FROM appointments_items WHERE workspace_id=?1 AND id=?2 LIMIT 1`,
      ).bind(workspaceId, row.id).first<{ client_id: string | null }>();
      if (current && current.client_id !== row.clientId) {
        const linkedCollection = await db.prepare(
          `SELECT 1 AS found FROM finance_receipts
           WHERE workspace_id=?1 AND source_module='appointments' AND source_entity_type='appointment'
             AND source_entity_id=?2 AND deleted_at IS NULL LIMIT 1`,
        ).bind(workspaceId, row.id).first<{ found:number }>();
        if (linkedCollection) throw new Error('APPOINTMENT_CLIENT_LOCKED_BY_COLLECTION');
      }
      await db.prepare(`INSERT INTO appointments_items(id,workspace_id,client_id,title,appointment_date,start_time,duration_minutes,travel_minutes,location,price_pence,status,note,completed_at,created_at,updated_at,deleted_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)
        ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,title=excluded.title,appointment_date=excluded.appointment_date,start_time=excluded.start_time,duration_minutes=excluded.duration_minutes,travel_minutes=excluded.travel_minutes,location=excluded.location,price_pence=excluded.price_pence,status=excluded.status,note=excluded.note,completed_at=excluded.completed_at,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at
        WHERE appointments_items.workspace_id=excluded.workspace_id`).bind(row.id,workspaceId,row.clientId,row.title,row.appointmentDate,row.startTime,row.durationMinutes,row.travelMinutes,row.location,row.pricePence,row.status,row.note,row.completedAt,row.createdAt,row.updatedAt,row.deletedAt).run();
      return;
    }
    throw new Error('SYNC_OPERATION_UNSUPPORTED');
  },
  async snapshot(db: D1Database, workspaceId: string): Promise<ModuleSnapshot> {
    const [clients, appointments] = await Promise.all([
      db.prepare(`SELECT id,workspace_id,name,phone,notes,active,created_at,updated_at,deleted_at FROM appointments_clients WHERE workspace_id=?1 ORDER BY name,id`).bind(workspaceId).all<ClientRow>(),
      db.prepare(`SELECT id,workspace_id,client_id,title,appointment_date,start_time,duration_minutes,travel_minutes,location,price_pence,status,note,completed_at,created_at,updated_at,deleted_at FROM appointments_items WHERE workspace_id=?1 ORDER BY appointment_date,start_time,id`).bind(workspaceId).all<AppointmentRow>(),
    ]);
    return { moduleKey: 'appointments', data: {
      clients: (clients.results ?? []).map((r) => ({ id:r.id,workspaceId:r.workspace_id,name:r.name,phone:r.phone,notes:r.notes,active:r.active===1,createdAt:r.created_at,updatedAt:r.updated_at,deletedAt:r.deleted_at })),
      appointments: (appointments.results ?? []).map((r) => ({ id:r.id,workspaceId:r.workspace_id,clientId:r.client_id,title:r.title,appointmentDate:r.appointment_date,startTime:r.start_time,durationMinutes:r.duration_minutes,travelMinutes:r.travel_minutes,location:r.location,pricePence:r.price_pence,status:r.status,note:r.note,completedAt:r.completed_at,createdAt:r.created_at,updatedAt:r.updated_at,deletedAt:r.deleted_at })),
    }};
  },
};
