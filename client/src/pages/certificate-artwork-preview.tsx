import { useEffect, useState } from 'react';
import { Button } from '../components/ui/button';
import { certificateArtworkDataUrl, type CertificateArtworkData } from './certificate-artwork';

export function CertificateArtwork({ data, compact = false }: { data: CertificateArtworkData; compact?: boolean }) {
  const { studentName, courseName, completionDate, certificateId, organizationName, verificationUrl, sample } = data;
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setSrc('');
    setError('');
    void certificateArtworkDataUrl({
      studentName, courseName, completionDate, certificateId, organizationName, verificationUrl, sample,
    }).then((url) => {
      if (active) setSrc(url);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'The certificate preview could not be rendered');
    });
    return () => { active = false; };
  }, [certificateId, completionDate, courseName, organizationName, sample, studentName, verificationUrl]);

  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!src) return <p className="loading" role="status">Preparing certificate preview…</p>;
  return <img
    className={`certificate-artwork${compact ? ' certificate-artwork-compact' : ''}`}
    src={src}
    alt={`${sample ? 'Sample ' : ''}Course Completion Certificate for ${studentName}, ${courseName}`}
  />;
}

export function CertificatePreviewDialog({ data, onClose }: { data: CertificateArtworkData; onClose: () => void }) {
  const title = data.sample ? 'Sample Certificate Preview' : 'Certificate Preview';

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="certificate-preview-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="card certificate-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="certificate-preview-title">
        <header className="certificate-preview-header">
          <div>
            <h2 id="certificate-preview-title">{title}</h2>
            {data.sample && <p className="muted">Sample data only. This preview does not issue or verify a certificate.</p>}
          </div>
          <Button type="button" variant="secondary" onClick={onClose}>Close preview</Button>
        </header>
        <div className="certificate-preview-scroll">
          <CertificateArtwork data={data} />
        </div>
      </section>
    </div>
  );
}
