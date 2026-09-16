import { FormEvent, useState } from 'react';
import {
  getWorkspaceBootstrap,
  loginCloudAccount,
  registerCloudAccount,
} from './account-api';
import {
  hydrateLocalPlatformFromCloud,
  linkLocalPlatformToCloud,
  type LocalPlatformSnapshot,
} from '../adapters/indexeddb/platform.repository';

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
      const snapshot = await hydrateLocalPlatformFromCloud(account, bootstrap);
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
          <p className="eyebrow">Cloud account</p>
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
          {busy ? 'جاري الدخول…' : 'دخول وتنزيل بياناتي'}
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

  if (snapshot.cloudLink) {
    return (
      <section className="panel cloud-link-panel">
        <div>
          <span className="panel-label">الحساب السحابي</span>
          <strong>{snapshot.cloudLink.loginName}</strong>
          <small>مساحة العمل مرتبطة بالسحابة ويمكن فتحها من أجهزة أخرى.</small>
        </div>
        <span className="cloud-linked-mark">مرتبط</span>
      </section>
    );
  }

  if (!available) {
    return (
      <section className="panel cloud-link-panel muted-panel">
        <div>
          <span className="panel-label">الحساب السحابي</span>
          <strong>غير متاح بعد</strong>
          <small>النسخة المحلية تعمل بشكل مستقل. ربط D1 سيُفعّل الحسابات متعددة الأجهزة.</small>
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
        <strong>اربط مساحة العمل بحساب</strong>
        <small>نفس IDs المحلية ستصبح IDs السحابية؛ لن نصنع نسخة منفصلة من بياناتك.</small>
      </div>
      <form className="inline-cloud-form" onSubmit={submit}>
        <input name="loginName" placeholder="اسم الدخول" autoComplete="username" minLength={3} maxLength={64} required />
        <input name="password" type="password" placeholder="كلمة مرور — 10 أحرف على الأقل" autoComplete="new-password" minLength={10} required />
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? 'جاري الربط…' : 'تفعيل الحساب السحابي'}
        </button>
      </form>
      {error && <div className="status bad">{error}</div>}
      {recoveryCode && (
        <div className="recovery-code-box">
          <strong>احفظ Recovery Code الآن</strong>
          <code>{recoveryCode}</code>
          <small>يظهر مرة واحدة. يُستخدم لاستعادة الحساب إذا نسيت كلمة المرور.</small>
        </div>
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
    AUTH_RATE_LIMITED: 'محاولات كثيرة. حاول لاحقًا.',
    DATABASE_NOT_CONFIGURED: 'قاعدة البيانات السحابية غير مربوطة بعد.',
    ACCOUNT_HAS_NO_WORKSPACE: 'الحساب لا يحتوي مساحة عمل متاحة.',
  };
  return messages[code] ?? `تعذر إكمال العملية (${code})`;
}
