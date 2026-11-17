import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api, apiUrl } from '../lib/api';

type Tutor = {
  id: string;
  name: string;
  bio: string | null;
  expertise: string[];
  joiningDate: string;
  hasPhoto: boolean;
  ratingSummary: { averageRating: number | null; reviewCount: number };
  myReview: { rating: number; review: string | null } | null;
  coursePrices: Array<{ period: 'MONTHLY' | 'QUARTERLY' | 'YEARLY'; price: number }>;
};

export function StudentTutorsPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId') ?? '';
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState('');
  const [changePending, setChangePending] = useState(false);
  const tutors = useQuery({
    queryKey: ['student-tutors', courseId],
    queryFn: () => api<{ tutors: Tutor[] }>(`/tutors/available?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(courseId),
  });
  const preferred = useQuery({
    queryKey: ['student-preferred-tutor', courseId],
    queryFn: () => api<{ tutor: Tutor | null }>(`/tutors/preferred?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(courseId),
  });
  const selectedTutor = preferred.data?.tutor ?? null;
  useEffect(() => {
    setRating(selectedTutor?.myReview?.rating ?? 0);
    setReview(selectedTutor?.myReview?.review ?? '');
  }, [selectedTutor?.id, selectedTutor?.myReview?.rating, selectedTutor?.myReview?.review]);
  const selectTutor = useMutation({
    mutationFn: (tutorId: string) => api<{ tutor: Tutor | null; effectiveAtRenewal: boolean }>('/tutors/preferred', {
      method: 'PUT',
      body: JSON.stringify({ tutorId, courseId }),
    }),
    onSuccess: async (result) => {
      setChangePending(result.effectiveAtRenewal);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-preferred-tutor', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-tutors', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-courses-enrolled'] }),
        queryClient.invalidateQueries({ queryKey: ['student-course', courseId] }),
      ]);
    },
  });
  const saveReview = useMutation({
    mutationFn: () => api(`/tutors/${selectedTutor!.id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ courseId, rating, review: review.trim() || null }),
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-tutors', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-preferred-tutor', courseId] }),
      ]);
    },
  });
  const deleteReview = useMutation({
    mutationFn: () => api(`/tutors/${selectedTutor!.id}/review`, { method: 'DELETE', body: JSON.stringify({ courseId }) }),
    onSuccess: async () => {
      setRating(0);
      setReview('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-tutors', courseId] }),
        queryClient.invalidateQueries({ queryKey: ['student-preferred-tutor', courseId] }),
      ]);
    },
  });
  const error = tutors.error ?? preferred.error ?? selectTutor.error ?? saveReview.error ?? deleteReview.error;

  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title="Choose a Tutor" backTo="/student" breadcrumbs={['Dashboard', 'Tutors']} />
        {!courseId && <div className="notice notice-error" role="alert">Open tutor selection from a course so your choice is attached to the correct enrollment.</div>}
        <p className="muted">Choose a Tutor assigned to this course. Changing your Tutor here does not change course access or existing faculty assignments.</p>
        {changePending && <div className="notice notice-info" role="status">Your paid subscription is active. The new Tutor will take effect at the next renewal; your current Tutor remains selected until then.</div>}
        {preferred.data?.tutor && <p className="muted">Current Tutor: <strong>{preferred.data.tutor.name}</strong></p>}
        {preferred.data?.tutor && <Link className="button button-secondary" to={`/student/courses/${encodeURIComponent(courseId)}`}>Back to course</Link>}
        {error && <p className="notice notice-error" role="alert">{error instanceof ApiError ? error.message : 'Tutor information could not be loaded.'}</p>}
        {(tutors.isLoading || preferred.isLoading) && <p className="loading">Loading Tutors…</p>}
        {tutors.data?.tutors.length === 0 && <div className="card empty-state"><h2>No approved Tutors available</h2><p>Approved Tutors from your organization will appear here.</p></div>}
        {tutors.data && <div className="student-course-grid tutor-choice-grid">
          {tutors.data.tutors.map((tutor) => (
            <article className="card tutor-choice-card" key={tutor.id}>
              {tutor.hasPhoto
                ? <img className="tutor-profile-photo" src={`${apiUrl}/tutors/${encodeURIComponent(tutor.id)}/photo`} alt={`${tutor.name} profile`} />
                : <div className="tutor-avatar-placeholder" aria-hidden="true">{tutor.name.slice(0, 1).toUpperCase()}</div>}
              <h2>{tutor.name}</h2>
              <p>{tutor.expertise.length ? tutor.expertise.join(' · ') : 'Subject expertise not listed'}</p>
              <p className="muted">{tutor.bio || 'No biography provided.'}</p>
              <p className="tutor-rating-summary">
                {tutor.ratingSummary.averageRating === null ? 'No ratings yet' : `${tutor.ratingSummary.averageRating.toFixed(1)} out of 5`}
                {' · '}{tutor.ratingSummary.reviewCount} review{tutor.ratingSummary.reviewCount === 1 ? '' : 's'}
              </p>
              <p className="muted">{tutor.coursePrices.length
                ? tutor.coursePrices.map((price) => `${price.price.toLocaleString()} / ${price.period.toLowerCase()}`).join(' · ')
                : 'No fee plan published for this course'}</p>
              {selectedTutor?.id === tutor.id
                ? <span className="status-pill status-published">YOUR PREFERRED TUTOR</span>
                : <Button disabled={selectTutor.isPending} onClick={() => selectTutor.mutate(tutor.id)}>{selectTutor.isPending ? 'Saving…' : 'Choose this Tutor'}</Button>}
            </article>
          ))}
        </div>}
        {selectedTutor && <section className="card tutor-review-form">
          <h2>Rate {selectedTutor.name}</h2>
          <p className="muted">Your review can be updated later. Tutors see feedback without your identity; organization administrators can see student attribution.</p>
          <div className="rating-stars" role="group" aria-label="Tutor rating">
            {[1, 2, 3, 4, 5].map((value) => <button
              key={value}
              type="button"
              className={value <= rating ? 'rating-star selected' : 'rating-star'}
              aria-label={`${value} star${value === 1 ? '' : 's'}`}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
            >★</button>)}
          </div>
          <label className="field"><span>Written feedback (optional, 500 characters)</span><textarea className="input textarea" maxLength={500} value={review} onChange={(event) => setReview(event.target.value)} /></label>
          <Button disabled={!rating || saveReview.isPending} onClick={() => saveReview.mutate()}>{saveReview.isPending ? 'Submitting…' : selectedTutor.myReview ? 'Update review' : 'Submit review'}</Button>
          {selectedTutor.myReview && <Button variant="danger" disabled={deleteReview.isPending} onClick={() => deleteReview.mutate()}>{deleteReview.isPending ? 'Deleting…' : 'Delete my review'}</Button>}
          {saveReview.isSuccess && <p className="notice notice-success" role="status">Your review has been saved.</p>}
        </section>}
      </section>
    </div>
  );
}
