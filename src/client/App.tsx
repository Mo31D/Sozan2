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
            message: error instanceof Error ? error.message : 'تعذر الاتصال بالخادم',
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
        <div className="mark">س</div>
        <p className="eyebrow">Sozan2</p>
        <h1>بداية نظيفة</h1>
        <p className="lead">
          هذه شاشة فحص للبنية الجديدة فقط. لم يتم نقل بيانات أو منطق مالي من النسخة القديمة.
        </p>

        {state.status === 'loading' && <div className="status neutral">جاري فحص الخادم…</div>}

        {state.status === 'error' && (
          <div className="status bad">تعذر الاتصال: {state.message}</div>
        )}

        {state.status === 'ready' && (
          <div className="status good">
            <strong>الخادم يعمل</strong>
            <span>الإصدار {state.health.version}</span>
            <span>
              قاعدة البيانات: {state.health.databaseConfigured ? 'مربوطة' : 'لم تُربط بعد'}
            </span>
          </div>
        )}
      </section>
    </main>
  );
}
