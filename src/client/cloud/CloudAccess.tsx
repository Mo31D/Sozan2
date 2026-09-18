import { FormEvent, useEffect, useState } from 'react';
import {
  getWorkspaceBootstrap,
  loginCloudAccount,
  registerCloudAccount,
} from './account-api';
import {
  hydrateLocalPlatformFromCloud,
  linkLocalPlatformToCloud,
  loadLocalPlatform,
  type LocalPlatformSnapshot,
} from '../adapters/indexeddb/platform.repository';
import { runWorkspaceSync, type SyncRunResult } from '../sync/engine';
import {
  listDeadLetterSyncMutations,
  removeSyncMutation,
  retryDeadLetterSyncMutation,
  type SyncOutboxRecord,
} from '../sync/outbox';

export function ExistingAccountLogin({
  available,
  onReady,
}: {
  available: boolean;
  onReady: (snapshot: LocalPlatformSnapshot) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!available) return null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const { account } = await loginCloudAccount(
        String(form.get('loginName') ?? ''),
        String(form.get('password') ?? ''),
      );
      const workspace = account.workspaces[0];
      if (!workspace) throw new Error('ACCOUNT_HAS_NO_WORKSPACE');
      const bootstrap = await getWorkspaceBootstrap(workspace.id);
      let snapshot = await hydrateLocalPlatformFromCloud(account, bootstrap);
      await runWorkspaceSync(workspace.id);
      const refreshed = await loadLocalPlatform();
      if (refreshed) snapshot = refreshed;
      onReady(snapshot);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cloud-access-block">
      <div className="section-heading compact-heading">
        <div>
          <p className="eyebrow">الحساب</p>
          <h2>عندي حساب بالفعل</h2>
        </div>
      </div>
      <form className="setup-form" onSubmit={submit}>
        <label>
          اسم الدخول
          <input name="loginName" autoComplete="username" required minLength={3} maxLength={64} />
        </label>
        <label>
          كلمة المرور
          <input name="password" type="password" autoComplete="current-password" required minLength={10} />
        </label>
        <button className="secondary-button" type="submit" disabled={busy}>
          {busy ? 'جاري الدخول والمزامنة…' : 'دخول وتنزيل بياناتي'}
        </button>
      </form>
      {error && <div className="status bad">{error}</div>}
    </section>
  );
}

export function CloudLinkPanel({
  snapshot,
  available,
  onLinked,
}: {
  snapshot: LocalPlatformSnapshot;
  available: boolean;
  onLinked: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncRunResult | null>(null);
  const [deadLetters, setDeadLetters] = useState<SyncOutboxRecord[]>([]);
  const deadLetterCount = deadLetters.length;

  useEffect(() => {
    let active = true;
    if (!snapshot.cloudLink) {
      setDeadLetters([]);
      return () => { active = false; };
    }
    void listDeadLetterSyncMutations(snapshot.workspace.id)
      .then((rows) => { if (active) setDeadLetters(rows); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [snapshot.cloudLink, snapshot.workspace.id]);

  const syncNow = async (seedInitialState = false) => {
    setBusy(true);
    setError('');
    try {
      const result = await runWorkspaceSync(snapshot.workspace.id, { seedInitialState });
      setSyncResult(result);
      setDeadLetters(await listDeadLetterSyncMutations(snapshot.workspace.id));
      await onLinked();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  if (snapshot.cloudLink) {
    return (
      <section className="panel cloud-link-panel cloud-linked-panel">
        <div className="cloud-register-copy">
          <span className="panel-label">الحساب</span>
          <strong>{snapshot.cloudLink.loginName}</strong>
          <small>بياناتك مرتبطة بالحساب ويمكن فتحها من أي جهاز بعد تسجيل الدخول.</small>
          <small>
            آخر مزامنة: {snapshot.cloudLink.lastCloudPullAt
              ? new Date(snapshot.cloudLink.lastCloudPullAt).toLocaleString('ar-EG')
              : 'لم تتم المزامنة بعد'}
          </small>
        </div>
        <div className="cloud-actions">
          <span className="cloud-linked-mark">متصل</span>
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void syncNow(false)}>
            {busy ? 'جاري المزامنة…' : 'زامن الآن'}
          </button>
        </div>
        {deadLetterCount > 0 && (
          <div className="status bad sync-conflict-box">
            <span>فيه {deadLetterCount} تغيير اتوقف بسبب تعارض أو بيانات قديمة.</span>
            <span>التغيير محفوظ للمراجعة ولم يعد يمنع تنزيل أحدث بيانات من السحابة.</span>
            <details>
              <summary>عرض التغييرات المتعارضة</summary>
              <div className="sync-conflict-list">
                {deadLetters.map((row) => (
                  <div key={row.id} className="sync-conflict-row">
                    <span><strong>{row.operation}</strong><small>{row.lastError ?? 'SYNC_MUTATION_REJECTED'}</small></span>
                    <div>
                      <button type="button" disabled={busy} onClick={() => void (async () => {
                        await retryDeadLetterSyncMutation(row.id);
                        await syncNow(false);
                      })()}>إعادة المحاولة</button>
                      <button type="button" disabled={busy} onClick={() => void (async () => {
                        await removeSyncMutation(row.id);
                        setDeadLetters(await listDeadLetterSyncMutations(snapshot.workspace.id));
                      })()}>تجاهل التغيير المحلي</button>
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
        {syncResult && (
          <div className={`status ${syncResult.failed || syncResult.deadLetters ? 'bad' : 'good'}`}>
            <span>تم رفع {syncResult.pushed} تغيير.</span>
            <span>{syncResult.pulled ? 'تم تنزيل أحدث بيانات.' : 'تم تأجيل التنزيل لحماية تغييرات لم تُرفع بعد.'}</span>
            {syncResult.pending > 0 && <span>متبقي {syncResult.pending} تغيير للمزامنة.</span>}
          </div>
        )}
        {error && <div className="status bad">{error}</div>}
      </section>
    );
  }

  if (!available) {
    return (
      <section className="panel cloud-link-panel muted-panel">
        <div>
          <span className="panel-label">الحساب</span>
          <strong>غير متاح الآن</strong>
          <small>تقدري تكملي شغلك على الجهاز، والمزامنة ترجع لما الاتصال يكون متاح.</small>
        </div>
      </section>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const loginName = String(form.get('loginName') ?? '');
      const result = await registerCloudAccount(
        snapshot,
        loginName,
        String(form.get('password') ?? ''),
      );
      await linkLocalPlatformToCloud(snapshot, result.account.user.loginName);
      setRecoveryCode(result.recoveryCode);
      const sync = await runWorkspaceSync(snapshot.workspace.id, { seedInitialState: true });
      setSyncResult(sync);
      await onLinked();
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel cloud-link-panel cloud-register-panel">
      <div className="cloud-register-copy">
        <span className="panel-label">الدخول من أي جهاز</span>
        <strong>اربط بياناتك بحساب</strong>
        <small>نفس البيانات الموجودة على الجهاز ستُحفظ في حسابك، بدون إنشاء نسخة منفصلة.</small>
      </div>
      <form className="inline-cloud-form" onSubmit={submit}>
        <input name="loginName" placeholder="اسم الدخول" autoComplete="username" minLength={3} maxLength={64} required />
        <input name="password" type="password" placeholder="كلمة مرور — 10 أحرف على الأقل" autoComplete="new-password" minLength={10} required />
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'جاري الربط والمزامنة…' : 'تفعيل الحساب'}
        </button>
      </form>
      {error && <div className="status bad">{error}</div>}
      {recoveryCode && (
        <div className="recovery-code-box">
          <strong>احفظي رمز الاسترداد الآن</strong>
          <code>{recoveryCode}</code>
          <small>يظهر مرة واحدة ويُستخدم إذا نسيتي كلمة المرور.</small>
        </div>
      )}
      {syncResult && !syncResult.failed && (
        <div className="status good">تم ربط البيانات بالحساب ومزامنتها.</div>
      )}
    </section>
  );
}

function messageFor(cause: unknown): string {
  const code = cause instanceof Error ? cause.message : 'UNKNOWN';
  const messages: Record<string, string> = {
    INVALID_CREDENTIALS: 'اسم الدخول أو كلمة المرور غير صحيحة.',
    ACCOUNT_TEMPORARILY_LOCKED: 'تم إيقاف محاولات الدخول مؤقتًا بعد عدة محاولات فاشلة.',
    LOGIN_NAME_TAKEN: 'اسم الدخول مستخدم بالفعل.',
    AUTH_RATE_LIMITED: 'محاولات كثيرة. حاولي لاحقًا.',
    DATABASE_NOT_CONFIGURED: 'التخزين السحابي غير جاهز بعد.',
    ACCOUNT_HAS_NO_WORKSPACE: 'الحساب لا يحتوي بيانات متاحة.',
    UNAUTHENTICATED: 'الجلسة انتهت. سجلي الدخول مرة أخرى.',
    WORKSPACE_FORBIDDEN: 'هذا الحساب لا يملك صلاحية لهذه البيانات.',
    SYNC_MODULE_UNSUPPORTED: 'يوجد جزء من البرنامج لم يُجهز للمزامنة بعد.',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
