import type { ReactNode } from 'react';
import type { ControlAction } from '../contracts';
import { money } from '../presentation';

export type CommonListProps = {
  editId: string | null;
  setEditId: (id: string | null) => void;
  busy: boolean;
  currency?: string;
  workspaceId: string;
  act: ControlAction;
};

export function Empty({ text }: { text: string }) {
  return <div className="control-empty">{text}</div>;
}

export function EditableMoneyCard({
  title,
  subtitle,
  amount,
  currency,
  deleted,
  editing,
  busy,
  onEdit,
  onDelete,
  onRestore,
  editForm,
}: {
  title: string;
  subtitle: string;
  amount: number;
  currency?: string;
  deleted: boolean;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => Promise<boolean>;
  onRestore: () => Promise<boolean>;
  editForm: ReactNode;
}) {
  return (
    <article className={`control-card ${deleted ? 'deleted' : ''}`}>
      <div className="control-card-head">
        <div><strong>{title}</strong><small>{subtitle}</small></div>
        <div className="money-stack"><b>{money(amount, currency)}</b>{deleted && <span className="deleted-badge">محذوف</span>}</div>
      </div>
      {!deleted ? (
        <div className="row-actions">
          <button type="button" onClick={onEdit}>تعديل</button>
          <button className="danger" type="button" disabled={busy} onClick={() => { if (confirm('حذف هذا المدخل؟')) void onDelete(); }}>حذف</button>
        </div>
      ) : (
        <div className="row-actions"><button type="button" disabled={busy} onClick={() => void onRestore()}>استرجاع</button></div>
      )}
      {editing && !deleted && editForm}
    </article>
  );
}
