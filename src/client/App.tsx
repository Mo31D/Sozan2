import { useEffect, useState } from 'react';
import { getHealth, type HealthResponse } from './api';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; health: HealthResponse }
  | { status: 'error'; message: string };

export function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    getHealth()
      .then((health) => {
        if (active) setState({ status: 'ready', health });
      })
      .catch((error: unknown) => {
        if (active) {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'تعذر فحص بيئة التشغيل',
          });
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="shell">
      <section className="card">
        <div className="mark">S2</div>
        <p className="eyebrow">Sozan2 Platform</p>
        <h1>الهيكل الأساسي يعمل</h1>
        <p className="lead">
          Core محايد + Modules مستقلة + Local-first. التدريس هو أول Template وليس هو الـCore.
        </p>

        {state.status === 'loading' && <div className="status neutral">جاري فحص بيئة التشغيل…</div>}

        {state.status === 'error' && (
          <div className="status bad">تعذر الاتصال: {state.message}</div>
        )}

        {state.status === 'ready' && (
          <div className="status good">
            <strong>الـWorker والواجهة يعملان</strong>
            <span>الإصدار {state.health.version}</span>
            <span>Local mode: {state.health.localModeAvailable ? 'متاح' : 'غير متاح'}</span>
            <span>
              D1: {state.health.cloudDatabaseConfigured ? 'مربوطة' : 'لم تُربط بعد'}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
