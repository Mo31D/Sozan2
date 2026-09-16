import { FormEvent, useEffect, useMemo, useState } from 'react';
import { getHealth, type HealthResponse } from './api';
import {
  bootstrapLocalPlatform,
  loadLocalPlatform,
  setLocalModuleEnabled,
  type LocalPlatformSnapshot,
} from './adapters/indexeddb/platform.repository';
import { CloudLinkPanel, ExistingAccountLogin } from './cloud/CloudAccess';
import { Sozan1MigrationPanel } from './migration/Sozan1MigrationPanel';
import { TutoringSurface } from './tutoring/TutoringSurface';
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

type SurfaceKey = 'me' | 'tutoring';

export function App() {
  const [local, setLocal] = useState<LocalState>({ status: 'loading' });
  const [cloud, setCloud] = useState<CloudState>({ status: 'checking' });
  const [surface, setSurface] = useState<SurfaceKey>('me');

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

  if (local.status === 'loading') return <CenteredMessage text="جاري فتح النسخة المحلية…" />;
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

  const reloadLocal = async () => {
    const snapshot = await loadLocalPlatform();
    setLocal({ status: 'ready', snapshot });
  };

  const tutoringEnabled = local.snapshot.modules.some(
    (item) => item.moduleKey === 'tutoring' && item.enabled,
  );
  const visibleSurface = surface === 'tutoring' && tutoringEnabled ? 'tutoring' : 'me';

  return (
    <main className="app-shell" dir="rtl">
      <div className="workspace-shell">
        <header className="workspace-header app-header">
          <div>
            <p className="eyebrow">{visibleSurface === 'me' ? 'أنا' : 'Tutoring'}</p>
            <h1>{visibleSurface === 'me' ? local.snapshot.user.displayName : local.snapshot.workspace.name}</h1>
            <p className="workspace-name">{local.snapshot.workspace.name}</p>
          </div>
          <CloudBadge cloud={cloud} compact />
        </header>

        {visibleSurface === 'me' ? (
          <MeSurface
            snapshot={local.snapshot}
            cloud={cloud}
            onChanged={reloadLocal}
          />
        ) : (
          <TutoringSurface
            workspaceId={local.snapshot.workspace.id}
            currencyLabel={local.snapshot.workspace.currencyLabel}
            cloudLinked={Boolean(local.snapshot.cloudLink)}
          />
        )}
      </div>

      <nav className="bottom-nav" aria-label="التنقل الرئيسي">
        {tutoringEnabled && (
          <button
            type="button"
            className={visibleSurface === 'tutoring' ? 'active' : ''}
            onClick={() => setSurface('tutoring')}
          >
            <span>التدريس</span>
          </button>
        )}
        <button
          type="button"
          className={visibleSurface === 'me' ? 'active' : ''}
          onClick={() => setSurface('me')}
        >
          <span>أنا</span>
        </button>
      </nav>
    </main>
  );
}

function cloudAccountsAvailable(cloud: CloudState): boolean {
  return cloud.status === 'ready' && cloud.health.cloudAccountsAvailable;
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
        <p className="eyebrow">Local-first</p>
        <h1>ابدأ أو ادخل لحسابك</h1>
        <p className="lead">
          على جهازك الأساسي يمكنك البدء محليًا ثم ربطه بالسحابة. على أي جهاز آخر ادخل بنفس الحساب لتنزيل نفس مساحة العمل.
        </p>

        <ExistingAccountLogin
          available={cloudAccountsAvailable(cloud)}
          onReady={onReady}
        />

        {cloudAccountsAvailable(cloud) && <div className="setup-divider"><span>أو</span></div>}

        <section className="local-start-block">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">New local workspace</p>
              <h2>ابدأ نسخة جديدة</h2>
            </div>
          </div>
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
        </section>

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
    <section className="me-surface">
      <section className="panel identity-panel">
        <div>
          <span className="panel-label">وضع التخزين الحالي</span>
          <strong>{snapshot.cloudLink ? 'Local + Cloud' : 'Local-first'}</strong>
          <small>
            {snapshot.cloudLink
              ? 'النسخة المحلية مرتبطة بنفس مساحة العمل السحابية.'
              : 'يعمل من IndexedDB حتى لو الـWorker أو الإنترنت غير متاح.'}
          </small>
        </div>
        <div>
          <span className="panel-label">Template</span>
          <strong>{snapshot.workspace.templateKey}</strong>
          <small>نوع النشاط منفصل عن الـCore ويمكن إضافة Templates أخرى لاحقًا.</small>
        </div>
      </section>

      <CloudLinkPanel
        snapshot={snapshot}
        available={cloudAccountsAvailable(cloud)}
        onLinked={onChanged}
      />

      <Sozan1MigrationPanel
        workspaceId={snapshot.workspace.id}
        cloudLinked={Boolean(snapshot.cloudLink)}
        currencyLabel={snapshot.workspace.currencyLabel}
        onImported={onChanged}
      />

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
              const ownerLabels: Readonly<Record<string, string>> | undefined = owner?.labels;
              const label = widget
                ? ownerLabels?.[widget.labelKey] ?? placement.widgetId
                : placement.widgetId;
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
    </section>
  );
}

function CloudBadge({ cloud, compact = false }: { cloud: CloudState; compact?: boolean }) {
  const text =
    cloud.status === 'checking'
      ? 'فحص السحابة…'
      : cloud.status === 'offline'
        ? 'Local فقط'
        : cloud.health.cloudDatabaseConfigured
          ? 'Cloud جاهز'
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
