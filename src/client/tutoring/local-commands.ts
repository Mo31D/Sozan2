import { canChangeOpeningProgress } from '../../modules/tutoring/domain/billing';
import { configureBillingSchema, type ConfigureBillingInput } from '../../modules/tutoring/domain/billing-plan';
import { activitySyncMutation, makeActivityEvent } from '../activity/local-activity';
import { openLocalDatabase, requestResult, STORES, transactionDone } from '../adapters/indexeddb/database';
import {
  rebalanceStudentLocally,
  rebuildStudentLocally,
} from '../finance/local-rebalance';
import { newSyncOutboxRecord } from '../sync/outbox';

export type LocalBillingPlan = {
  id: string;
  workspaceId: string;
  studentId: string;
  billingMode: 'per_session' | 'package';
  packageSize: number | null;
  packagePricePence: number | null;
  cycleAnchorDate: string | null;
  effectiveFrom: string;
};

export type LocalBillingCycle = {
  id: string;
  workspaceId: string;
  studentId: string;
  sequenceNo: number;
  sessionLimit: number;
  pricePence: number;
  openingCompletedCount: number;
  openingProgressLockedAt?: string | null;
  realCompletedCount: number;
  status: 'open' | 'due' | 'paid' | 'cancelled';
  startedOn: string | null;
  completedOn: string | null;
  paidOn: string | null;
};

export type LocalReceipt = {
  id: string;
  workspaceId: string;
  payerRefType: string;
  payerRefId: string;
  amountPence: number;
  receivedAt: string;
  paymentMethod: 'cash' | 'bank' | 'wallet' | 'other';
  sourceKind: 'manual' | 'quick' | 'migration';
  sourceModule: string | null;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  note: string | null;
  deletedAt: string | null;
  pendingSync: boolean;
};

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function getLocalBilling(
  workspaceId: string,
  studentId: string,
): Promise<{ plan: LocalBillingPlan | null; cycle: LocalBillingCycle | null }> {
  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.tutoringBillingPlans, STORES.tutoringBillingCycles],
    'readonly',
  );
  const [plans, cycles] = await Promise.all([
    requestResult<LocalBillingPlan[]>(transaction.objectStore(STORES.tutoringBillingPlans).getAll()),
    requestResult<LocalBillingCycle[]>(transaction.objectStore(STORES.tutoringBillingCycles).getAll()),
  ]);
  return {
    plan: plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId) ?? null,
    cycle: cycles
      .filter((row) => row.workspaceId === workspaceId && row.studentId === studentId && row.status !== 'cancelled')
      .sort((a, b) => b.sequenceNo - a.sequenceNo)[0] ?? null,
  };
}

export async function configureLocalStudentBilling(
  workspaceId: string,
  studentId: string,
  input: unknown,
): Promise<void> {
  const parsed = configureBillingSchema.parse(input) as ConfigureBillingInput;
  const db = await openLocalDatabase();
  const read = db.transaction(
    [STORES.tutoringBillingPlans, STORES.tutoringBillingCycles],
    'readonly',
  );
  const [plans, cycles] = await Promise.all([
    requestResult<LocalBillingPlan[]>(read.objectStore(STORES.tutoringBillingPlans).getAll()),
    requestResult<LocalBillingCycle[]>(read.objectStore(STORES.tutoringBillingCycles).getAll()),
  ]);
  const existingPlan = plans.find((row) => row.workspaceId === workspaceId && row.studentId === studentId);
  const studentCycles = cycles.filter((row) => row.workspaceId === workspaceId && row.studentId === studentId);
  const currentCycle = studentCycles
    .filter((row) => row.status !== 'cancelled')
    .sort((a, b) => b.sequenceNo - a.sequenceNo)[0] ?? null;

  if (existingPlan && studentCycles.length && existingPlan.billingMode !== parsed.billingMode) {
    throw new Error('BILLING_MODE_LOCKED_BY_HISTORY');
  }

  if (parsed.billingMode === 'package') {
    if (!currentCycle && parsed.openingCompletedCount > parsed.packageSize) {
      throw new Error('OPENING_PROGRESS_EXCEEDS_PACKAGE');
    }
    if (currentCycle) {
      if (parsed.openingCompletedCount > currentCycle.sessionLimit) {
        throw new Error('OPENING_PROGRESS_EXCEEDS_PACKAGE');
      }
      if (!canChangeOpeningProgress(
        currentCycle.openingCompletedCount,
        parsed.openingCompletedCount,
        currentCycle.realCompletedCount,
        Boolean(currentCycle.openingProgressLockedAt),
      )) {
        throw new Error('OPENING_PROGRESS_LOCKED_BY_REAL_LESSONS');
      }
    }
  }

  const plan: LocalBillingPlan = parsed.billingMode === 'package'
    ? {
        id: studentId,
        workspaceId,
        studentId,
        billingMode: 'package',
        packageSize: parsed.packageSize,
        packagePricePence: parsed.packagePricePence,
        cycleAnchorDate: parsed.cycleAnchorDate,
        effectiveFrom: parsed.effectiveFrom,
      }
    : {
        id: studentId,
        workspaceId,
        studentId,
        billingMode: 'per_session',
        packageSize: null,
        packagePricePence: null,
        cycleAnchorDate: null,
        effectiveFrom: parsed.effectiveFrom,
      };

  const correctedCycle = parsed.billingMode === 'package'
    && currentCycle
    && currentCycle.openingCompletedCount !== parsed.openingCompletedCount
    ? {
        ...currentCycle,
        openingCompletedCount: parsed.openingCompletedCount,
        status: parsed.openingCompletedCount + currentCycle.realCompletedCount === currentCycle.sessionLimit
          ? 'due' as const
          : 'open' as const,
        completedOn: parsed.openingCompletedCount + currentCycle.realCompletedCount === currentCycle.sessionLimit
          ? (currentCycle.completedOn ?? parsed.effectiveFrom)
          : null,
        paidOn: null,
      }
    : null;

  const activity = makeActivityEvent({
    workspaceId,
    moduleKey: 'tutoring',
    entityType: 'billing_plan',
    entityId: studentId,
    action: existingPlan ? 'billing.updated' : 'billing.created',
    title: parsed.billingMode === 'package' ? `تم ضبط باقة ${parsed.packageSize} حصص` : 'تم ضبط الحساب بالحصة',
    before: existingPlan,
    after: plan,
    undoable: false,
  });
  const progressActivity = correctedCycle && currentCycle
    ? makeActivityEvent({
        workspaceId,
        moduleKey: 'tutoring',
        entityType: 'billing_cycle',
        entityId: currentCycle.id,
        action: 'billing.opening_progress_corrected',
        title: `تم تصحيح تقدم الباقة إلى ${correctedCycle.openingCompletedCount}/${correctedCycle.sessionLimit}`,
        before: { openingCompletedCount: currentCycle.openingCompletedCount },
        after: { openingCompletedCount: correctedCycle.openingCompletedCount },
        undoable: false,
      })
    : null;

  const transaction = db.transaction(
    [STORES.tutoringBillingPlans, STORES.tutoringBillingCycles, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.tutoringBillingPlans).put(plan);

  if (parsed.billingMode === 'package' && studentCycles.length === 0) {
    const due = parsed.openingCompletedCount === parsed.packageSize;
    transaction.objectStore(STORES.tutoringBillingCycles).add({
      id: crypto.randomUUID(),
      workspaceId,
      studentId,
      sequenceNo: 1,
      sessionLimit: parsed.packageSize,
      pricePence: parsed.packagePricePence,
      openingCompletedCount: parsed.openingCompletedCount,
      openingProgressLockedAt: null,
      realCompletedCount: 0,
      status: due ? 'due' : 'open',
      startedOn: parsed.cycleAnchorDate ?? parsed.effectiveFrom,
      completedOn: due ? parsed.effectiveFrom : null,
      paidOn: null,
    } satisfies LocalBillingCycle);
  } else if (correctedCycle) {
    transaction.objectStore(STORES.tutoringBillingCycles).put(correctedCycle);
  }

  transaction.objectStore(STORES.coreActivityEvents).add(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId,
    moduleKey: 'tutoring',
    operation: 'billing.configure',
    entityType: 'student',
    entityId: studentId,
    payload: parsed,
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  if (progressActivity) {
    transaction.objectStore(STORES.coreActivityEvents).add(progressActivity);
    transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(progressActivity));
  }
  await transactionDone(transaction);
  if (correctedCycle) {
    await rebuildStudentLocally(workspaceId, studentId);
  } else {
    await rebalanceStudentLocally(workspaceId, studentId);
  }
}

export async function collectLocalStudentPayment(input: {
  workspaceId: string;
  studentId: string;
  amountPence: number;
  receivedAt?: string;
  paymentMethod?: 'cash' | 'bank' | 'wallet' | 'other';
  note?: string | null;
}): Promise<LocalReceipt> {
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) {
    throw new Error('COLLECTION_AMOUNT_INVALID');
  }
  const receipt: LocalReceipt = {
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    payerRefType: 'tutoring.student',
    payerRefId: input.studentId,
    amountPence: input.amountPence,
    receivedAt: input.receivedAt ?? today(),
    paymentMethod: input.paymentMethod ?? 'cash',
    sourceKind: 'manual',
    sourceModule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    note: input.note ?? null,
    deletedAt: null,
    pendingSync: true,
  };
  const activity = makeActivityEvent({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    entityType: 'receipt',
    entityId: receipt.id,
    action: 'receipt.created',
    title: 'تم تسجيل تحصيل',
    after: receipt,
  });

  const db = await openLocalDatabase();
  const transaction = db.transaction(
    [STORES.financeReceipts, STORES.coreActivityEvents, STORES.syncOutbox],
    'readwrite',
  );
  transaction.objectStore(STORES.financeReceipts).add(receipt);
  transaction.objectStore(STORES.coreActivityEvents).add(activity);
  transaction.objectStore(STORES.syncOutbox).add(newSyncOutboxRecord({
    workspaceId: input.workspaceId,
    moduleKey: 'finance',
    operation: 'student.collection.create',
    entityType: 'receipt',
    entityId: receipt.id,
    payload: {
      studentId: input.studentId,
      amountPence: input.amountPence,
      receivedAt: receipt.receivedAt,
      paymentMethod: receipt.paymentMethod,
      note: receipt.note,
    },
  }));
  transaction.objectStore(STORES.syncOutbox).add(activitySyncMutation(activity));
  await transactionDone(transaction);
  await rebalanceStudentLocally(input.workspaceId, input.studentId);
  return receipt;
}

export async function listLocalStudentReceipts(
  workspaceId: string,
  studentId: string,
): Promise<LocalReceipt[]> {
  const db = await openLocalDatabase();
  const rows = await requestResult<LocalReceipt[]>(
    db.transaction(STORES.financeReceipts, 'readonly').objectStore(STORES.financeReceipts).getAll(),
  );
  return rows
    .filter((row) => row.workspaceId === workspaceId && row.payerRefId === studentId && !row.deletedAt)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}
