import { FormEvent, useEffect, useRef, useState } from 'react';
import { getHealth, type HealthResponse } from './api';
import {
  bootstrapLocalPlatform,
  loadLocalPlatform,
  type LocalPlatformSnapshot,
} from './adapters/indexeddb/platform.repository';
import { AppointmentsWorkspace } from './appointments/AppointmentsWorkspace';
import { ExistingAccountLogin } from './cloud/CloudAccess';
import { TutorWorkspace } from './simple/TutorWorkspace';
import { runWorkspaceSync } from './sync/engine';

type CloudState =
  | { status: 'checking' }
  | { status: 'ready'; health: HealthResponse }
  | { status: 'offline' };

type LocalState =
  | { status: 'loading' }
  | { status: 'ready'; snapshot: LocalPlatformSnapshot | null }
  | { status: 'error'; message: string };

export function App() {
  const [local, setLocal] = useState<LocalState>({ status: 'loading' });
  const [cloud, setCloud] = useState<CloudState>({ status: 'checking' });
  const [dataRevision, setDataRevision] = useState(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadLocalPlatform()
      .then((snapshot) => { if (active) setLocal({ status: 'ready', snapshot }); })
      .catch((error: unknown) => {
        if (active) setLocal({ status: 'error', message: error instanceof Error ? error.message : 'تعذر فتح البيانات المحفوظة' });
      });

    getHealth()
      .then((health) => { if (active) setCloud({ status: 'ready', health }); })
      .catch(() => { if (active) setCloud({ status: 'offline' }); });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    const snapshot = local.status === 'ready' ? local.snapshot : null;
    if (!snapshot?.cloudLink || cloud.status !== 'ready') return;
    let active = true;
    const sync = async () => {
      if (!navigator.onLine || syncingRef.current) return;
      syncingRef.current = true;
      try {
        await runWorkspaceSync(snapshot.workspace.id);
        if (active) setDataRevision((value) => value + 1);
      } catch {
        // Local data remains the source of truth and pending writes stay queued.
      } finally {
        syncingRef.current = false;
      }
    };
    void sync();
    const online = () => { void sync(); };
    const focus = () => { void sync(); };
    const visibility = () => {
      if (document.visibilityState === 'visible') void sync();
    };
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void sync();
    }, 60_000);
    window.addEventListener('online', online);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('online', online);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [cloud.status, local]);

  if (local.status === 'loading') return <CenteredMessage text="جاري فتح بياناتك…" />;
  if (local.status === 'error') return <CenteredMessage text={`تعذر تشغيل البرنامج: ${local.message}`} bad />;

  if (!local.snapshot) {
    return <LocalSetup cloud={cloud} onReady={(snapshot) => setLocal({ status: 'ready', snapshot })} />;
  }

  const reloadLocal = async () => {
    const snapshot = await loadLocalPlatform();
    setLocal({ status: 'ready', snapshot });
    setDataRevision((value) => value + 1);
  };

  const common = {
    snapshot: local.snapshot,
    cloudAvailable: cloudAccountsAvailable(cloud),
    onPlatformChanged: reloadLocal,
    dataRevision,
  };

  if (local.snapshot.workspace.templateKey === 'appointments') {
    return <AppointmentsWorkspace {...common} />;
  }
  if (local.snapshot.workspace.templateKey === 'tutoring') {
    return <TutorWorkspace {...common} />;
  }
  return <CenteredMessage text="نوع مساحة العمل دي غير مدعوم في الواجهة الحالية." bad />;
}

function cloudAccountsAvailable(cloud: CloudState): boolean {
  return cloud.status === 'ready' && cloud.health.cloudAccountsAvailable;
}

function LocalSetup({ cloud, onReady }: { cloud: CloudState; onReady: (snapshot: LocalPlatformSnapshot) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const snapshot = await bootstrapLocalPlatform({
        displayName: String(form.get('displayName') ?? ''),
        workspaceName: String(form.get('workspaceName') ?? ''),
        templateKey: String(form.get('templateKey') ?? 'tutoring'),
      });
      onReady(snapshot);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء النسخة الجديدة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="setup-simple" dir="rtl">
      <section className="setup-simple-card">
        <div className="setup-logo">م</div>
        <h1>مساعدك</h1>
        <p>نظّم شغلك ومواعيدك وفلوسك من مكان واحد. ادخل لحسابك من جهاز آخر، أو ابدأ مساحة جديدة على الجهاز ده.</p>

        <ExistingAccountLogin available={cloudAccountsAvailable(cloud)} onReady={onReady} />
        {cloudAccountsAvailable(cloud) && <div className="setup-divider"><span>أو</span></div>}

        <form className="setup-simple-form" onSubmit={submit}>
          <h2>ابدأ مساحة جديدة</h2>
          <fieldset className="setup-template-picker">
            <legend>هتستخدم البرنامج في إيه؟</legend>
            <label className="setup-template-option">
              <input type="radio" name="templateKey" value="tutoring" defaultChecked />
              <b>◫</b><strong>تدريس وحصص</strong><small>طلاب، حصص متكررة، باقات، حضور وتحصيل.</small>
            </label>
            <label className="setup-template-option">
              <input type="radio" name="templateKey" value="appointments" />
              <b>▦</b><strong>مواعيد وخدمات</strong><small>عملاء، مواعيد منفردة، أسعار، تحصيل وتقارير.</small>
            </label>
          </fieldset>
          <label>اسمك<input name="displayName" autoComplete="name" placeholder="مثال: سوزان" required /></label>
          <label>اسم شغلك<input name="workspaceName" placeholder="مثال: دروسي أو صالوني" required /></label>
          <button type="submit" disabled={busy}>{busy ? 'جاري الإنشاء…' : 'ابدأ'}</button>
        </form>

        {error && <div className="simple-toast bad">{error}</div>}
        <div className="setup-status">
          {cloud.status === 'checking' ? 'جاري فحص الاتصال…' : cloud.status === 'offline' ? 'يمكنك العمل بدون إنترنت' : 'الحسابات السحابية جاهزة'}
        </div>
      </section>
    </main>
  );
}

function CenteredMessage({ text, bad = false }: { text: string; bad?: boolean }) {
  return <main className="setup-simple" dir="rtl"><section className="setup-simple-card"><div className={`simple-toast ${bad ? 'bad' : 'good'}`}>{text}</div></section></main>;
}
