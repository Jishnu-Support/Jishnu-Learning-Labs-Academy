import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api, apiBlob, downloadBlob } from '../lib/api';

type Opening = {
  id: string;
  title: string;
  company: string;
  description: string;
  externalUrl: string;
  postedAt: string;
  closesAt: string | null;
  isActive: boolean;
  hasApplied?: boolean;
  applicationId?: string | null;
  _count?: { applications: number };
};
type Application = {
  id: string;
  createdAt: string;
  resumeOriginalName: string;
  student: { name: string; email: string; studentProfile: { studentId: string } | null };
  jobOpening: { title: string; company: string };
};

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
}

function isResume(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return Boolean(extension && file.type === mimeTypes[extension] && file.size <= 5 * 1024 * 1024);
}

export function OpportunitiesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isStudent = user?.role === 'STUDENT';
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const apiBase = isStudent ? '/opportunities' : isSuperAdmin ? '/super-admin/opportunities' : '/org-admin/opportunities';
  const [selected, setSelected] = useState<Opening | null>(null);
  const [resume, setResume] = useState<File | null>(null);
  const [resumeError, setResumeError] = useState('');
  const [notice, setNotice] = useState('');
  const [draft, setDraft] = useState({ title: '', company: '', description: '', externalUrl: '' });
  const openings = useQuery({
    queryKey: ['opportunities', user?.role],
    queryFn: () => api<{ openings: Opening[] }>(apiBase),
  });
  const applications = useQuery({
    queryKey: ['opportunity-applications', user?.role],
    queryFn: () => api<{ applications: Application[] }>(`${apiBase}/applications`),
    enabled: user?.role === 'ORG_ADMIN',
  });
  const createMutation = useMutation({
    mutationFn: () => api<{ opening: Opening }>(apiBase, { method: 'POST', body: JSON.stringify(draft) }),
    onSuccess: async () => {
      setDraft({ title: '', company: '', description: '', externalUrl: '' });
      setNotice('Job opening published.');
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!selected || !resume) throw new Error('Choose a resume before applying.');
      const body = new FormData();
      body.append('resume', resume);
      return api(`/opportunities/${encodeURIComponent(selected.id)}/applications`, { method: 'POST', body });
    },
    onSuccess: async () => {
      setSelected(null);
      setResume(null);
      setResumeError('');
      setNotice('Your application was submitted.');
      await queryClient.invalidateQueries({ queryKey: ['opportunities'] });
    },
  });
  const downloadResume = async (application: Application) => {
    try {
      const blob = await apiBlob(`${apiBase}/applications/${encodeURIComponent(application.id)}/resume`);
      await downloadBlob(blob, application.resumeOriginalName);
    } catch (error) {
      setNotice(errorText(error));
    }
  };
  const title = isStudent ? 'Opportunities' : 'Job Openings';
  const backTo = isStudent ? '/student' : isSuperAdmin ? '/super-admin/dashboard' : '/org-admin';

  return (
    <div className="portal-layout">
      <PortalSidebar role={user?.role ?? 'STUDENT'} />
      <section className="portal-content">
        <PageHeader title={title} backTo={backTo} breadcrumbs={['Workspace', title]} />
        <p className="muted">{isStudent ? 'Explore opportunities and submit your resume securely.' : 'Publish job posts for the student Opportunities module.'}</p>
        {notice && <p className="notice" role="status">{notice}</p>}
        {openings.error && <p className="notice notice-error" role="alert">{errorText(openings.error)}</p>}
        {createMutation.error && <p className="notice notice-error" role="alert">{errorText(createMutation.error)}</p>}
        {applyMutation.error && <p className="notice notice-error" role="alert">{errorText(applyMutation.error)}</p>}
        {!isStudent && <form className="card form-stack" onSubmit={(event) => {
          event.preventDefault();
          createMutation.mutate();
        }}>
          <h2>Add job opening</h2>
          <label className="field"><span>Job title</span><input className="input" required minLength={3} maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="field"><span>Company / organization</span><input className="input" required minLength={2} maxLength={160} value={draft.company} onChange={(event) => setDraft((current) => ({ ...current, company: event.target.value }))} /></label>
          <label className="field"><span>Description</span><textarea className="input textarea" required minLength={10} maxLength={5000} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label>
          <label className="field"><span>External job link (HTTPS)</span><input className="input" type="url" required value={draft.externalUrl} onChange={(event) => setDraft((current) => ({ ...current, externalUrl: event.target.value }))} /></label>
          <Button disabled={createMutation.isPending}>{createMutation.isPending ? 'Publishing…' : 'Publish opening'}</Button>
        </form>}
        {applications.data && <section className="card">
          <h2>Applications</h2>
          {applications.data.applications.length === 0
            ? <p className="muted">No applications have been submitted.</p>
            : <div className="table-scroll"><table><thead><tr><th>Job</th><th>Student</th><th>Applied</th><th>Resume</th></tr></thead><tbody>
              {applications.data.applications.map((application) => <tr key={application.id}>
                <td>{application.jobOpening.title} · {application.jobOpening.company}</td>
                <td>{application.student.name} ({application.student.studentProfile?.studentId ?? application.student.email})</td>
                <td>{new Date(application.createdAt).toLocaleDateString()}</td>
                <td><Button variant="secondary" onClick={() => void downloadResume(application)}>{application.resumeOriginalName}</Button></td>
              </tr>)}
            </tbody></table></div>}
        </section>}
        {openings.isLoading && <p className="loading">Loading opportunities…</p>}
        {openings.data && openings.data.openings.length === 0 && <div className="card empty-state"><h2>No opportunities yet</h2><p>New job openings will appear here when an administrator publishes them.</p></div>}
        <div className="course-list">
          {openings.data?.openings.map((opening) => (
            <article className="card" key={opening.id}>
              <p className="eyebrow">{new Date(opening.postedAt).toLocaleDateString()}</p>
              <h2>{opening.title}</h2>
              <p className="muted">{opening.company}</p>
              <p>{opening.description}</p>
              <div className="button-row">
                <a className="button button-secondary" href={opening.externalUrl} target="_blank" rel="noreferrer">View job post</a>
                {isStudent && (opening.hasApplied
                  ? <span className="status-pill status-approved">Applied</span>
                  : <Button onClick={() => { setSelected(opening); setResume(null); setResumeError(''); }}>Apply</Button>)}
                {!isStudent && <span className="muted">{opening._count?.applications ?? 0} applications</span>}
              </div>
              {isStudent && selected?.id === opening.id && <form className="form-stack opportunity-application" onSubmit={(event) => {
                event.preventDefault();
                if (!resume) {
                  setResumeError('Choose a PDF, DOC, or DOCX resume to apply.');
                  return;
                }
                applyMutation.mutate();
              }}>
                <label className="field"><span>Resume (PDF, DOC, or DOCX; up to 5 MB)</span><input className="input" type="file" accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => {
                  const file = event.currentTarget.files?.[0] ?? null;
                  if (!file) return;
                  if (!isResume(file)) {
                    setResumeError('Choose a PDF, DOC, or DOCX resume up to 5 MB.');
                    setResume(null);
                    event.currentTarget.value = '';
                    return;
                  }
                  setResume(file);
                  setResumeError('');
                }} />
                  {resume && <small>{resume.name}</small>}
                  {resumeError && <small className="field-error">{resumeError}</small>}
                </label>
                <div className="button-row"><Button disabled={applyMutation.isPending}>{applyMutation.isPending ? 'Submitting…' : 'Submit application'}</Button><Button type="button" variant="secondary" onClick={() => setSelected(null)}>Cancel</Button></div>
              </form>}
            </article>
          ))}
        </div>
        {!isStudent && <p className="muted">Manage courses and course content from the organization workspace. <Link className="text-link" to={isSuperAdmin ? '/super-admin/organizations' : '/org-admin/courses'}>Open course management</Link></p>}
      </section>
    </div>
  );
}
