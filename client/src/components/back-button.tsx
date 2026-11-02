import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { hasSafeAppHistory } from '../lib/app-navigation';
import { ConfirmDialog } from './feedback';
import { Button } from './ui/button';

type Props = {
  backTo: string;
  hasUnsavedChanges?: boolean;
  label?: string;
  onBack?: () => void;
};

export function BackButton({ backTo, hasUnsavedChanges = false, label = 'Back', onBack }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const confirmLeave = () => window.confirm('Discard changes? You have unsaved changes.');
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.origin !== window.location.origin) return;
      if (!confirmLeave()) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    const handlePopState = () => {
      if (!confirmLeave()) window.history.go(1);
    };
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    document.addEventListener('click', handleClick, true);
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges, location.pathname, location.search]);

  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (hasSafeAppHistory()) navigate(-1);
    else navigate(backTo, { replace: true });
  };

  const requestBack = () => {
    if (hasUnsavedChanges) setConfirming(true);
    else goBack();
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="back-button"
        aria-label={label}
        onClick={requestBack}
      >
        <ArrowLeft size={16} aria-hidden="true" /> {label}
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Discard changes?"
          message="You have unsaved changes. Leave this page and discard them?"
          confirmLabel="Discard changes"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            goBack();
          }}
        />
      )}
    </>
  );
}
