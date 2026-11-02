import { BackButton } from './back-button';

type Props = {
  title: string;
  backTo: string;
  breadcrumbs?: string[];
  hasUnsavedChanges?: boolean;
  onBack?: () => void;
};

export function PageHeader({ title, backTo, breadcrumbs = [], hasUnsavedChanges, onBack }: Props) {
  return (
    <header className="page-header">
      <BackButton backTo={backTo} hasUnsavedChanges={hasUnsavedChanges} onBack={onBack} />
      <div>
        {breadcrumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((item, index) => (
              <span key={`${item}-${index}`}>
                {index > 0 && <span aria-hidden="true"> › </span>}
                {item}
              </span>
            ))}
          </nav>
        )}
        <h1 className="page-title">{title}</h1>
      </div>
    </header>
  );
}
