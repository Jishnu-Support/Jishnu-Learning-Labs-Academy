import { useEffect } from 'react';
import { Button } from './ui/button';

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);
  return <div className="toast" role="status">{message}</div>;
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="dialog-backdrop">
      <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <p className="eyebrow">PLEASE CONFIRM</p>
        <h2 id="confirm-title">{title}</h2>
        <p className="muted">{message}</p>
        <div className="row-actions">
          <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </section>
    </div>
  );
}
