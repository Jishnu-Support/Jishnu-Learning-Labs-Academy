import type { InputHTMLAttributes } from 'react';
import { cn } from '../lib/utils';

export function Field({ label, error, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className={cn('input', className)} {...props} />
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}
