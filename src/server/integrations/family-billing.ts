import {
  FAMILY_PACKAGE_TARGET_TYPE,
  FAMILY_PAYER_REF_TYPE,
} from '../../modules/tutoring/domain/billing-account';

type AccountRow = {
  id: string;
  display_name: string;
  counting_mode: 'shared_occurrence' | 'per_member_quota';
  primary_student_id: string;
  package_size: number;
  package_price_pence: number;
  effective_from: string;
  active: number;
};

type MemberRow = {
  student_id: string;
  position: number;
  active: number;
};

type ProgressRow = {
  id: string;
  student_id: string;
  sequence_no: number;
  session_limit: number;
  opening_completed_count: number;
  real_completed_count: number;
  started_on: string | null;
  completed_on: string | null;
  status: string;
};

type FamilyCycleRow = {
  id: string;
  sequence_no: number;
  package_size: number;
  price_pence: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  started_on: string | null;
  completed_on: string | null;
  paid_on: string | null;
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

async function familyAccount(db: D1Database, workspaceId: string, accountId: string): Promise<AccountRow | null> {
  return db.prepare(
    `SELECT id,display_name,counting_mode,primary_student_id,package_size,package_price_pence,
            effective_from,active
     FROM tutoring_billing_accounts
     WHERE workspace_id=?1 AND id=?2 AND active=1`,
  ).bind(workspaceId, accountId).first<AccountRow>();
}

async function familyMembers(db: D1Database, workspaceId: string, accountId: string): Promise<MemberRow[]> {
  const result = await db.prepare(
    `SELECT student_id,position,active
     FROM tutoring_billing_account_members
     WHERE workspace_id=?1 AND billing_account_id=?2 AND active=1
     ORDER BY position,student_id`,
  ).bind(workspaceId, accountId).all<MemberRow>();
  return result.results ?? [];
}

async function progressRows(
  db: D1Database,
  workspaceId: string,
  studentIds: readonly string[],
): Promise<ProgressRow[]> {
  if (!studentIds.length) return [];
  const placeholders = studentIds.map((_, index) => `?${index + 2}`).join(',');
  const result = await db.prepare(
    `SELECT c.id,c.student_id,c.sequence_no,c.session_limit,c.opening_completed_count,
            c.started_on,c.completed_on,c.status,
            COALESCE(SUM(CASE WHEN o.status='completed' THEN 1 ELSE 0 END),0) AS real_completed_count
     FROM tutoring_billing_cycles c
     LEFT JOIN tutoring_billing_cycle_occurrences co
       ON co.workspace_id=c.workspace_id AND co.billing_cycle_id=c.id
     LEFT JOIN tutoring_occurrences o
       ON o.workspace_id=co.workspace_id AND o.id=co.occurrence_id
     WHERE c.workspace_id=?1
       AND c.student_id IN (${placeholders})
       AND c.status<>'cancelled'
     GROUP BY c.id
     ORDER BY c.sequence_no,c.student_id`,
  ).bind(workspaceId, ...studentIds).all<ProgressRow>();
  return result.results ?? [];
}

function complete(row: ProgressRow | undefined): boolean {
  return Boolean(row && Number(row.opening_completed_count) + Number(row.real_completed_count) >= Number(row.session_limit));
}

async function allocatedToFamilyCycle(
  db: D1Database,
  workspaceId: string,
  cycleId: string,
): Promise<{ allocated: number; paidOn: string | null }> {
  const row = await db.prepare(
    `SELECT COALESCE(SUM(a.amount_pence),0) AS allocated,
            MAX(r.received_at) AS paid_on
     FROM finance_receipt_allocations a
     JOIN finance_receipts r
       ON r.workspace_id=a.workspace_id AND r.id=a.receipt_id AND r.deleted_at IS NULL
     WHERE a.workspace_id=?1
       AND a.target_module='tutoring'
       AND a.target_type=?2
       AND a.target_id=?3`,
  ).bind(workspaceId, FAMILY_PACKAGE_TARGET_TYPE, cycleId)
    .first<{ allocated: number; paid_on: string | null }>();
  return { allocated: Number(row?.allocated ?? 0), paidOn: row?.paid_on ?? null };
}

export async function reconcileFamilyAccount(
  db: D1Database,
  workspaceId: string,
  accountId: string,
): Promise<void> {
  const account = await familyAccount(db, workspaceId, accountId);
  if (!account) return;
  const members = await familyMembers(db, workspaceId, accountId);
  const requiredIds = account.counting_mode === 'shared_occurrence'
    ? [account.primary_student_id]
    : members.map((row) => row.student_id);
  if (!requiredIds.length) return;

  const progress = await progressRows(db, workspaceId, requiredIds);
  const sequenceNos = unique(progress.map((row) => Number(row.sequence_no))).sort((a, b) => a - b);
  if (!sequenceNos.length) return;

  const existingResult = await db.prepare(
    `SELECT id,sequence_no,package_size,price_pence,status,started_on,completed_on,paid_on
     FROM tutoring_billing_account_cycles
     WHERE workspace_id=?1 AND billing_account_id=?2 AND status<>'cancelled'
     ORDER BY sequence_no`,
  ).bind(workspaceId, accountId).all<FamilyCycleRow>();
  const existing = existingResult.results ?? [];

  for (const sequenceNo of sequenceNos) {
    let familyCycle = existing.find((row) => Number(row.sequence_no) === sequenceNo) ?? null;
    const memberCycles = requiredIds
      .map((studentId) => progress.find((row) => row.student_id === studentId && Number(row.sequence_no) === sequenceNo))
      .filter((row): row is ProgressRow => Boolean(row));
    const startedOn = memberCycles.map((row) => row.started_on).filter((value): value is string => Boolean(value)).sort()[0]
      ?? familyCycle?.started_on
      ?? account.effective_from;

    if (!familyCycle) {
      familyCycle = {
        id: crypto.randomUUID(),
        sequence_no: sequenceNo,
        package_size: Number(account.package_size),
        price_pence: Number(account.package_price_pence),
        status: 'open',
        started_on: startedOn,
        completed_on: null,
        paid_on: null,
      };
      await db.prepare(
        `INSERT INTO tutoring_billing_account_cycles(
           id,workspace_id,billing_account_id,sequence_no,package_size,price_pence,
           status,started_on,completed_on,paid_on
         ) VALUES(?1,?2,?3,?4,?5,?6,'open',?7,NULL,NULL)`,
      ).bind(
        familyCycle.id,
        workspaceId,
        accountId,
        sequenceNo,
        familyCycle.package_size,
        familyCycle.price_pence,
        startedOn,
      ).run();
    }

    const allComplete = requiredIds.every((studentId) =>
      complete(progress.find((row) => row.student_id === studentId && Number(row.sequence_no) === sequenceNo)));
    const completedDates = allComplete
      ? requiredIds
          .map((studentId) => progress.find((row) =>
            row.student_id === studentId && Number(row.sequence_no) === sequenceNo)?.completed_on ?? null)
          .filter((value): value is string => Boolean(value))
          .sort()
      : [];
    const completedOn = allComplete
      ? (completedDates.at(-1) ?? familyCycle.completed_on ?? startedOn)
      : null;
    const payment = await allocatedToFamilyCycle(db, workspaceId, familyCycle.id);
    const paid = allComplete && payment.allocated >= Number(familyCycle.price_pence);

    await db.prepare(
      `UPDATE tutoring_billing_account_cycles
       SET status=?3,started_on=?4,completed_on=?5,paid_on=?6,updated_at=CURRENT_TIMESTAMP
       WHERE workspace_id=?1 AND id=?2`,
    ).bind(
      workspaceId,
      familyCycle.id,
      allComplete ? (paid ? 'paid' : 'due') : 'open',
      startedOn,
      completedOn,
      paid ? (payment.paidOn ?? completedOn) : null,
    ).run();
  }
}

export async function familyAccountIdsForStudents(
  db: D1Database,
  workspaceId: string,
  studentIds: readonly string[],
): Promise<string[]> {
  if (!studentIds.length) return [];
  const placeholders = studentIds.map((_, index) => `?${index + 2}`).join(',');
  const result = await db.prepare(
    `SELECT DISTINCT m.billing_account_id AS id
     FROM tutoring_billing_account_members m
     JOIN tutoring_billing_accounts a
       ON a.workspace_id=m.workspace_id AND a.id=m.billing_account_id
     WHERE m.workspace_id=?1 AND m.student_id IN (${placeholders})
       AND m.active=1 AND a.active=1`,
  ).bind(workspaceId, ...studentIds).all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
}

export async function reconcileFamilyAccountsForStudents(
  db: D1Database,
  workspaceId: string,
  studentIds: readonly string[],
): Promise<void> {
  const ids = await familyAccountIdsForStudents(db, workspaceId, studentIds);
  for (const id of ids) await reconcileFamilyAccount(db, workspaceId, id);
}

export async function requireFamilyBillingAccount(
  db: D1Database,
  workspaceId: string,
  accountId: string,
): Promise<void> {
  const found = await familyAccount(db, workspaceId, accountId);
  if (!found) throw new Error('BILLING_ACCOUNT_NOT_FOUND');
}

export async function listFamilyAccountObligations(
  db: D1Database,
  workspaceId: string,
  accountId: string,
): Promise<Array<{ id: string; dueAt: string; amountPence: number }>> {
  await reconcileFamilyAccount(db, workspaceId, accountId);
  const result = await db.prepare(
    `SELECT id,COALESCE(completed_on,started_on,created_at) AS due_at,price_pence
     FROM tutoring_billing_account_cycles
     WHERE workspace_id=?1 AND billing_account_id=?2 AND status IN ('due','paid')
     ORDER BY sequence_no`,
  ).bind(workspaceId, accountId).all<{ id: string; due_at: string; price_pence: number }>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    dueAt: row.due_at,
    amountPence: Number(row.price_pence),
  }));
}

export { FAMILY_PAYER_REF_TYPE };
