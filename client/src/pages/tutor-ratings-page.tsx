import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type Review = {
  id: string;
  tutorId: string;
  courseId: string;
  rating: number;
  review: string | null;
  createdAt: string;
  hiddenAt: string | null;
  hiddenReason: string | null;
  tutor: { name: string; tutorId: string | null };
  course: { title: string } | null;
  student: { name: string; studentId: string | null } | null;
};
type Ratings = {
  ratingSummary: { averageRating: number | null; reviewCount: number };
  distribution: Array<{ rating: number; count: number }>;
  trend: Array<{ month: string; averageRating: number; count: number }>;
  reviews: Array<Omit<Review, 'tutor' | 'course' | 'student' | 'hiddenAt' | 'hiddenReason'> & {
    course: { title: string } | null;
    student: { name: string; studentId: string | null } | null;
    hiddenAt?: string | null;
    hiddenReason?: string | null;
  }>;
};

function dateLabel(value: string) {
  return new Date(value).toLocaleDateString();
}

export function TutorRatingsPanel() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['my-tutor-ratings', user?.id],
    queryFn: () => api<{ ratings: Ratings }>(`/tutors/${encodeURIComponent(user!.id)}/ratings`),
    enabled: user?.role === 'TUTOR',
  });
  const ratings = query.data?.ratings;
  return <section id="ratings" className="tutor-ratings-panel">
      {query.isLoading && <p className="loading">Loading ratings…</p>}
      {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Tutor ratings could not be loaded.'}</p>}
      {ratings && <>
        <section className="card tutor-ratings-summary">
          <h2>Overall rating</h2>
          <p className="tutor-rating-large">{ratings.ratingSummary.averageRating?.toFixed(1) ?? '—'} / 5</p>
          <p className="muted">{ratings.ratingSummary.reviewCount} student rating{ratings.ratingSummary.reviewCount === 1 ? '' : 's'}</p>
          <h3>Rating distribution</h3>
          {ratings.distribution.map((item) => <p key={item.rating}>{item.rating} stars <progress max={Math.max(ratings.ratingSummary.reviewCount, 1)} value={item.count} /> {item.count}</p>)}
          <h3>Recent trend</h3>
          {ratings.trend.length
            ? <ul>{ratings.trend.map((item) => <li key={item.month}>{item.month}: {item.averageRating} / 5 ({item.count})</li>)}</ul>
            : <p className="muted">Ratings over time will appear here.</p>}
        </section>
        <section className="tutor-review-list">
          <h2>Recent course feedback</h2>
          {ratings.reviews.length === 0 && <div className="card empty-state"><h3>No ratings yet</h3><p>Student feedback will appear here without their identity.</p></div>}
          {ratings.reviews.map((item) => <article className="card tutor-review-item" key={item.id}>
            <strong>{item.rating} / 5 stars · {item.course?.title ?? 'Legacy rating'}</strong>
            <p>{item.review || 'No written feedback.'}</p>
            <small>{dateLabel(item.createdAt)}</small>
          </article>)}
        </section>
      </>}
  </section>;
}

export function TutorRatingsPage() {
  return <div className="portal-layout">
    <PortalSidebar role="TUTOR" />
    <section className="portal-content">
      <PageHeader title="My Ratings" backTo="/my-profile" breadcrumbs={['Tutor Portal', 'My Ratings']} />
      <TutorRatingsPanel />
    </section>
  </div>;
}

export function OrganizationTutorRatingsPage() {
  const queryClient = useQueryClient();
  const [tutorFilter, setTutorFilter] = useState('');
  const [courseFilter, setCourseFilter] = useState('');
  const [starFilter, setStarFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const query = useQuery({
    queryKey: ['organization-tutor-reviews'],
    queryFn: () => api<{ reviews: Review[] }>('/tutors/reviews'),
  });
  const ratingSettings = useQuery({
    queryKey: ['organization-tutor-rating-settings'],
    queryFn: () => api<{ settings: { ratingRequiresActivity: boolean } }>('/organizations/settings/tutor-ratings'),
  });
  const updateRatingSettings = useMutation({
    mutationFn: (ratingRequiresActivity: boolean) => api<{ settings: { ratingRequiresActivity: boolean } }>(
      '/organizations/settings/tutor-ratings',
      { method: 'PUT', body: JSON.stringify({ ratingRequiresActivity }) },
    ),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ['organization-tutor-rating-settings'] }),
  });
  const tutorList = useQuery({
    queryKey: ['tutors', '', '', 1],
    queryFn: () => api<{ tutors: Array<{
      user: { id: string; name: string };
      tutorId: string;
      ratingSummary: { averageRating: number | null; reviewCount: number };
    }> }>('/tutors?page=1&pageSize=100'),
  });
  const visibility = useMutation({
    mutationFn: ({ review, hidden }: { review: Review; hidden: boolean }) => api(
      `/tutors/reviews/${encodeURIComponent(review.id)}/visibility`,
      { method: 'PUT', body: JSON.stringify({ hidden, reason: reasonById[review.id]?.trim() }) },
    ),
    onSuccess: async () => {
      setReasonById({});
      await queryClient.invalidateQueries({ queryKey: ['organization-tutor-reviews'] });
      await queryClient.invalidateQueries({ queryKey: ['tutors'] });
    },
  });
  const reviews = query.data?.reviews ?? [];
  const filteredReviews = reviews.filter((item) =>
    (!tutorFilter || item.tutorId === tutorFilter)
    && (!courseFilter || item.courseId === courseFilter)
    && (!starFilter || item.rating === Number(starFilter))
    && (!dateFilter || item.createdAt.slice(0, 10) >= dateFilter),
  );
  const tutors = tutorList.data?.tutors ?? [];
  const courses = [...new Map(reviews
    .filter((item): item is Review & { course: { title: string }; courseId: string } => Boolean(item.course && item.courseId))
    .map((item) => [item.courseId, item.course.title])).entries()];
  const exportCsv = () => {
    const rows = [
      ['Tutor', 'Tutor ID', 'Course', 'Rating', 'Feedback', 'Student', 'Student ID', 'Submitted', 'Comment hidden'],
      ...filteredReviews.map((item) => [
        item.tutor.name,
        item.tutor.tutorId ?? '',
        item.course?.title ?? 'Legacy rating',
        String(item.rating),
        item.review ?? '',
        item.student?.name ?? '',
        item.student?.studentId ?? '',
        item.createdAt,
        item.hiddenAt ? 'Yes' : 'No',
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => {
      const redactedValue = value.replace(/(?:\d[\s-]*){12,}/g, '[redacted identifier]');
      const safeValue = /^[\s\uFEFF]*[=+\-@]/.test(redactedValue) ? `'${redactedValue}` : redactedValue;
      return `"${safeValue.replaceAll('"', '""')}"`;
    }).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'tutor-ratings.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const lowRated = tutors.filter((item) => item.ratingSummary.reviewCount >= 5 && (item.ratingSummary.averageRating ?? 5) < 3);

  return <div className="portal-layout">
    <PortalSidebar role="ORG_ADMIN" />
    <section className="portal-content">
      <PageHeader title="Tutor Ratings" backTo="/org-admin" breadcrumbs={['Organization', 'Tutor Ratings']} />
      {lowRated.length > 0 && <div className="notice notice-error" role="alert">Performance alert: {lowRated.map((item) => `${item.user.name} (${item.ratingSummary.averageRating?.toFixed(1)} / 5)`).join(', ')}</div>}
      <section className="card">
        <h2>Rating eligibility</h2>
        <p className="muted">Require students to attend a course session or view course content before rating their selected Tutor.</p>
        {ratingSettings.error && <p className="notice notice-error" role="alert">Rating eligibility settings could not be loaded.</p>}
        <label className="field">
          <span><input
            type="checkbox"
            checked={ratingSettings.data?.settings.ratingRequiresActivity ?? true}
            disabled={ratingSettings.isLoading || updateRatingSettings.isPending}
            onChange={(event) => updateRatingSettings.mutate(event.target.checked)}
          /> Require course activity</span>
        </label>
        {updateRatingSettings.error && <p className="notice notice-error" role="alert">Rating eligibility settings could not be saved.</p>}
        {updateRatingSettings.isSuccess && <p className="notice notice-success" role="status">Rating eligibility setting saved.</p>}
      </section>
      {query.isLoading && <p className="loading">Loading reviews…</p>}
      {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Tutor ratings could not be loaded.'}</p>}
      {visibility.error && <p className="notice notice-error" role="alert">{visibility.error instanceof ApiError ? visibility.error.message : 'Review visibility could not be changed.'}</p>}
      <div className="directory-filters">
        <label className="field"><span>Tutor</span><select className="input" value={tutorFilter} onChange={(event) => setTutorFilter(event.target.value)}><option value="">All Tutors</option>{tutors.map((item) => <option value={item.user.id} key={item.user.id}>{item.user.name}</option>)}</select></label>
        <label className="field"><span>Course</span><select className="input" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}><option value="">All courses</option>{courses.map(([id, title]) => <option value={id} key={id}>{title}</option>)}</select></label>
        <label className="field"><span>Stars</span><select className="input" value={starFilter} onChange={(event) => setStarFilter(event.target.value)}><option value="">All ratings</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value} star{value === 1 ? '' : 's'}</option>)}</select></label>
        <label className="field"><span>From date</span><input className="input" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
        <Button variant="secondary" disabled={!filteredReviews.length} onClick={exportCsv}>Export CSV</Button>
      </div>
      {filteredReviews.length === 0 && query.data && <div className="card empty-state"><h2>No reviews match these filters</h2><p>Try changing a filter or wait for students to submit feedback.</p></div>}
      {filteredReviews.map((item) => <article className="card tutor-review-item" key={item.id}>
        <div className="row-between">        <strong>{item.rating} / 5 stars · {item.tutor.name} · {item.course?.title ?? 'Legacy rating'}</strong><small>{dateLabel(item.createdAt)}</small></div>
        <p>{item.review || 'No written feedback.'}</p>
        <p className="muted">Student: {item.student?.name} ({item.student?.studentId})</p>
        {item.hiddenAt && <p className="muted">Hidden: {item.hiddenReason}</p>}
        <label className="field"><span>{item.hiddenAt ? 'Reason to restore this comment' : 'Reason to hide this comment'}</span><input className="input" maxLength={500} value={reasonById[item.id] ?? ''} onChange={(event) => setReasonById((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
        <Button variant={item.hiddenAt ? 'secondary' : 'danger'} disabled={visibility.isPending || (reasonById[item.id]?.trim().length ?? 0) < 8} onClick={() => visibility.mutate({ review: item, hidden: !item.hiddenAt })}>{item.hiddenAt ? 'Unhide comment' : 'Hide comment'}</Button>
      </article>)}
    </section>
  </div>;
}
