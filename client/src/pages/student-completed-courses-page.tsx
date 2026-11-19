import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';
import { downloadCertificatePdf } from './certificate-pdf';

type Certificate = {
  id: string;
  certificateNo: string;
  verificationCode: string;
  issuedAt: string;
  isSample: boolean;
  student: { name: string };
  course: { id: string; title: string; code: string };
  organization: { name: string };
};
type CompletedCourse = {
  completedAt: string;
  course: { id: string; code: string; title: string; description: string | null; thumbnailUrl: string | null; plannedHours: number };
  progressPercent: number;
  tutor: { id: string; name: string } | null;
  certificate: Certificate;
};

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : 'The certificate could not be verified or downloaded.';
}

export function StudentCompletedCoursesPage() {
  const completed = useQuery({
    queryKey: ['student-completed-courses'],
    queryFn: () => api<{ courses: CompletedCourse[] }>('/portal/student/completed-courses'),
  });
  const [downloadError, setDownloadError] = useState('');
  const download = async (certificate: Certificate) => {
    setDownloadError('');
    try {
      if (!certificate.isSample) {
        await api(`/public/certificates/${encodeURIComponent(certificate.verificationCode)}`);
      }
      await downloadCertificatePdf(certificate);
    } catch (error) {
      setDownloadError(errorText(error));
    }
  };
  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title="My Completed Courses" backTo="/student/courses" breadcrumbs={['My Courses', 'Completed Courses']} />
        <p className="muted">Your completed courses and their certificates. Sample certificates are clearly marked and are not issued credentials.</p>
        {completed.isLoading && <p className="loading">Loading completed courses…</p>}
        {completed.error && <p className="notice notice-error" role="alert">{errorText(completed.error)}</p>}
        {downloadError && <p className="notice notice-error" role="alert">{downloadError}</p>}
        {completed.data && completed.data.courses.length === 0 && (
          <div className="card empty-state"><h2>No completed courses yet</h2><p>Certificates will appear here after your course completion criteria are met.</p></div>
        )}
        <div className="student-course-grid">
          {completed.data?.courses.map(({ course, tutor, completedAt, progressPercent, certificate }) => (
            <article className="card course-card" key={course.id}>
              {course.thumbnailUrl
                ? <img className="course-card-thumbnail" src={course.thumbnailUrl} alt={`${course.title} course thumbnail`} referrerPolicy="no-referrer" />
                : <div className="course-card-thumbnail course-card-thumbnail-placeholder" aria-label={`${course.title} course thumbnail`}><span>{course.code}</span></div>}
              <div className="course-meta"><span>{course.code}</span><span className="status-pill status-published">COMPLETED</span></div>
              <h2>{course.title}</h2>
              <p>{course.description || 'No description provided.'}</p>
              <p className="muted">Tutor: {tutor?.name ?? 'Not assigned'} · Duration: {course.plannedHours} hours</p>
              <p className="muted">Completed {new Date(completedAt).toLocaleDateString()} · {progressPercent}% complete</p>
              <progress className="course-progress" max={100} value={progressPercent} aria-label={`Course progress: ${progressPercent}%`} />
              <p className={certificate.isSample ? 'notice notice-info' : 'notice notice-success'}>
                {certificate.isSample ? 'SAMPLE · NOT ISSUED' : `Verified certificate · ${certificate.certificateNo}`}
              </p>
              <div className="course-actions">
                <Link className="button button-secondary" to={`/student/certificates/${certificate.id}`}>View certificate</Link>
                <Button onClick={() => void download(certificate)}>Download PDF</Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
