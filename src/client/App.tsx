import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getHealth, type HealthResponse } from './api';
import {
  bootstrapLocalPlatform,
  loadLocalPlatform,
  setLocalModuleEnabled,
  type LocalPlatformSnapshot,
} from './adapters/indexeddb/platform.repository';
import { BUILTIN_MODULES } from '../platform/modules/catalog';
import { composeSurface } from '../platform/surfaces/layout';

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

  useEffect(() => {
    let active = true;

    loadLocalPlatform()
      .then((snapshot) => {
        if (active) setLocal({ status: 'ready', snapshot });
      })
      .catch((error: unknown) => {
        if (active) {
          setLocal({
            status: 'error',
            message: error instanceof Error ? error.message : 'تعذر فتح التخزين المحلي',
          });
        }
      });

    getHealth()
      .then((health) => {
        if (active) setCloud({ status: 'ready', health });
      })
      .catch(() => {
        if (active) setCloud({ status: 'offline' });
      });

    return () => {
      active = false;
    };
  }, []);

  if (local.status === 'loading') {
    return <CenteredMessage text="جاري فتح النسخة المحلية…" />;
  }

  if (local.status === 'error') {
    return <CenteredMessage text={`تعذر تشغيل التخزين المحلي: ${local.message}`} bad />;
  }

  if (!local.snapshot) {
    return (
      <LocalSetup
        cloud={cloud}
        onReady={(snapshot) => setLocal({ status: 'ready', snapshot })}
      />
    );
  }

  return (
    <MeSurface
      snapshot={local.snapshot}
      cloud={cloud}
      onChanged={async () => {
        const snapshot = await loadLocalPlatform();
        setLocal({ status: 'ready', snapshot });
      }}
    />
  );
}

function LocalSetup({
  cloud,
  onReady,
}: {
  cloud: CloudState;
  onReady: (snapshot: LocalPlatformSnapshot) => void;
}) {
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
      setError(cause instanceof Error ? cause.message : 'تعذر إنشاء مساحة العمل');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell setup-shell" dir="rtl">
      <section className="card setup-card">
        <div className="mark">S2</div>
        <p className="eyebrow">Local-first setup</p>
        <h1>ابدأ باسمك أنت</h1>
        <p className="lead">
          البيانات تُحفظ محليًا في هذا الجهاز أولًا. السحابة اختيارية، ولا يوجد اعتماد على API مدفوع.
        </p>

        <form className="setup-form" onSubmit={submit}>
          <label>
            اسم المستخدم
            <input name="displayName" autoComplete="name" placeholder="مثال: سوزان" required />
          </label>
          <label>
            اسم مساحة العمل
            <input name="workspaceName" placeholder="مثال: دروسي" required />
          </label>
          <label>
            نوع البداية
            <select name="templateKey" defaultValue="tutoring">
              <option value="tutoring">Teaching / Tutoring</option>
            </select>
          </label>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? 'جاري الإنشاء…' : 'إنشاء النسخة المحلية'}
          </button>
        </form>

        {error && <div className="status bad">{error}</div>}
        <CloudBadge cloud={cloud} />
      </section>
    </main>
  );
}

function MeSurface({
  snapshot,
  cloud,
  onChanged,
}: {
  snapshot: LocalPlatformSnapshot;
  cloud: CloudState;
  onChanged: () => Promise<void>;
}) {
  const enabledKeys = useMemo(
    () => new Set(snapshot.modules.filter((item) => item.enabled).map((item) => item.moduleKey)),
    [snapshot.modules],
  );
  const enabledModules = BUILTIN_MODULES.filter((module) => enabledKeys.has(module.key));
  const meWidgets = composeSurface(enabledModules, 'me');

  const toggleModule = async (moduleKey: string, enabled: boolean) => {
    await setLocalModuleEnabled(snapshot.workspace.id, moduleKey, enabled);
    await onChanged();
  };

  return (
    <main className="workspace-shell" dir="rtl">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">أنا</p>
          <h1>{snapshot.user.displayName}</h1>
          <p className="workspace-name">{snapshot.workspace.name}</p>
        </div>
        <CloudBadge cloud={cloud} compact />
      </header>

      <section className="panel identity-panel">
        <div>
          <span className="panel-label">وضع التخزين الحالي</span>
          <strong>Local-first</strong>
          <small>يعمل من IndexedDB حتى لو الـWorker أو الإنترنت غير متاح.</small>
        </div>
        <div>
          <span className="panel-label">Template</span>
          <strong>{snapshot.workspace.templateKey}</strong>
          <small>يمكن تغييره مستقبلًا دون تغيير الـCore.</small>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Lego modules</p>
            <h2>أجزاء البرنامج</h2>
          </div>
          <span>{enabledModules.length}/{BUILTIN_MODULES.length} مفعّل</span>
        </div>

        <div className="module-grid">
          {BUILTIN_MODULES.map((module) => {
            const enabled = enabledKeys.has(module.key);
            return (
              <article className={`module-card ${enabled ? 'enabled' : ''}`} key={module.key}>
                <div>
                  <strong>{module.title}</strong>
                  <p>{module.description}</p>
                </div>
                <button
                  type="button"
                  className="toggle-button"
                  aria-pressed={enabled}
                  onClick={() => void toggleModule(module.key, !enabled)}
                >
                  {enabled ? 'مفعّل' : 'متوقف'}
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Composable surface</p>
            <h2>محتوى صفحة «أنا»</h2>
          </div>
        </div>
        <div className="widget-grid">
          {meWidgets.length ? (
            meWidgets.map((placement) => {
              const owner = enabledModules.find((module) =>
                module.widgets.some((widget) => widget.id === placement.widgetId),
              );
              const widget = owner?.widgets.find((item) => item.id === placement.widgetId);
              const label = widget ? owner?.labels[widget.labelKey] ?? placement.widgetId : placement.widgetId;
              return (
                <article className="widget-card" key={placement.widgetId}>
                  <span>{owner?.title ?? 'Module'}</span>
                  <strong>{label}</strong>
                  <small>Widget مستقل — البيانات الفعلية ستأتي من الـModule المالك له.</small>
                </article>
              );
            })
          ) : (
            <div className="empty-state">لا توجد Widgets مفعّلة لهذه الصفحة.</div>
          )}
        </div>
      </section>
    </main>
  );
}

function CloudBadge({ cloud, compact = false }: { cloud: CloudState; compact?: boolean }) {
  const text =
    cloud.status === 'checking'
      ? 'فحص السحابة…'
      : cloud.status === 'offline'
        ? 'Local فقط'
        : cloud.health.cloudDatabaseConfigured
          ? 'Cloud متاح'
          : 'Worker متاح · D1 غير مربوطة';

  return <div className={`cloud-badge ${compact ? 'compact' : ''}`}>{text}</div>;
}

function CenteredMessage({ text, bad = false }: { text: string; bad?: boolean }) {
  return (
    <main className="shell" dir="rtl">
      <section className="card">
        <div className={`status ${bad ? 'bad' : 'neutral'}`}>{text}</div>
      </section>
    </main>
  );
}
