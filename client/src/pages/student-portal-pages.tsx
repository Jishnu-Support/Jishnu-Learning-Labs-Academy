import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Headphones, Video } from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { ProtectedPdfViewer } from '../components/protected-pdf-viewer';
import { StudentMediaEmbed, type StudentPlayableMedia } from '../components/student-media-embed';
import { DailyWisdomCards } from '../components/daily-wisdom-cards';
import { Button } from '../components/ui/button';
import { ApiError, api, apiBlob, apiUrl } from '../lib/api';

type Course = { id: string; code: string; title: string };
type ExpertSession = {
  id: string; title: string; description: string; startsAt: string; durationMinutes: number;
  status: 'SCHEDULED' | 'LIVE' | 'CANCELLED' | 'COMPLETED'; joinAvailable: boolean;
  locked?: boolean;
  freePreview?: boolean;
  course: Course | null; host: { id: string; name: string };
  attendances: Array<{ status: string; joinedAt: string | null }>;
};
type LibraryItem = {
  id: string; kind: 'BOOK' | 'DOCUMENT' | 'NOTE' | 'LINK'; category: string; title: string;
  description: string; published: boolean; saved: boolean; locked?: boolean; freePreview?: boolean; contentText?: string | null; createdAt: string;
  externalUrl?: string | null; course: Course | null; hasDocument?: boolean; documentName?: string | null;
};
type LibraryMedia = StudentPlayableMedia & {
  course: Course;
  topic: { id: string; title: string } | null;
  progressPercent: number;
  completed: boolean;
  locked?: boolean;
  createdAt: string;
  publishedAt: string | null;
};
type AttendanceSummary = {
  courses: Array<Course & { minimumAttendancePercent: number; total: number; present: number; percentage: number; low: boolean }>;
  sessions: Array<ExpertSession & { status: string; joinedAt: string | null }>;
};
type Certificate = {
  id: string; certificateNo: string; verificationCode: string; issuedAt: string;
  student: { name: string; studentProfile: { studentId: string } | null };
  course: Course; organization: { name: string };
};
type Knowledge = {
  attempts: Array<{ id: string; score: number | null; percentage: number | null; passed: boolean | null; submittedAt: string | null; assessment: { title: string; course: Course } }>;
  practice: Array<{ id: string; score: number; totalQuestions: number; answeredCount: number; createdAt: string; course: Course }>;
  ratings: Array<{ gameKey: string; rating: number }>;
  media: { completed: number; total: number };
};

const sessionTabs = ['LIVE', 'UPCOMING', 'PAST'] as const;
const games = [
  { key: 'flashcards', title: 'Topic flashcards', description: 'Review key ideas from your course topics.' },
  { key: 'quick-quiz', title: 'Quick quiz', description: 'Practice questions and get instant feedback.' },
  { key: 'word-match', title: 'Concept match', description: 'Reinforce concepts by matching related ideas.' },
] as const;

function PortalPage({ children, embedded = false }: { children: React.ReactNode; embedded?: boolean }) {
  const { user } = useAuth();
  if (embedded) return <section className="portal-content">{children}</section>;
  return <div className="portal-layout"><PortalSidebar role={user?.role ?? 'STUDENT'} /><section className="portal-content">{children}</section></div>;
}

function errorText(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function dateTimeInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function ExpertSessionsPage({ embeddedCourseId }: { embeddedCourseId?: string } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const manager = user?.role === 'ORG_ADMIN' || user?.role === 'TUTOR';
  const courseFilter = manager ? '' : embeddedCourseId ?? searchParams.get('courseId') ?? '';
  const [tab, setTab] = useState<(typeof sessionTabs)[number]>('UPCOMING');
  const [editingId, setEditingId] = useState('');
  const [startError, setStartError] = useState('');
  const [form, setForm] = useState({ courseId: '', title: '', description: '', startsAt: '', durationMinutes: '60', freePreview: false });
  const courses = useQuery({
    queryKey: ['portal-session-courses', user?.role],
    queryFn: async () => {
      if (user?.role === 'STUDENT') {
        const result = await api<{ enrollments: Array<{ course: Course }> }>('/student/courses/enrolled');
        return result.enrollments.map(({ course }) => course);
      }
      const result = await api<{ courses: Course[] }>('/courses');
      return result.courses;
    },
  });
  const sessions = useQuery({
    queryKey: ['expert-sessions', tab, user?.role, courseFilter],
    queryFn: () => api<{ sessions: ExpertSession[] }>(`${manager ? '/portal/manage' : '/portal/student'}/sessions?${new URLSearchParams({ tab, ...(courseFilter ? { courseId: courseFilter } : {}) })}`),
  });
  const schedule = useMutation({
    mutationFn: () => api(`/portal/manage/sessions${editingId ? `/${editingId}` : ''}`, {
      method: editingId ? 'PATCH' : 'POST',
      body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), durationMinutes: Number(form.durationMinutes) }),
    }),
    onSuccess: async () => {
      setEditingId('');
      setForm({ courseId: '', title: '', description: '', startsAt: '', durationMinutes: '60', freePreview: false });
      await client.invalidateQueries({ queryKey: ['expert-sessions'] });
    },
  });
  const editSession = (session: ExpertSession) => {
    setEditingId(session.id);
    setForm({
      courseId: session.course?.id ?? '',
      title: session.title,
      description: session.description,
      startsAt: dateTimeInput(session.startsAt),
      durationMinutes: String(session.durationMinutes),
      freePreview: Boolean(session.freePreview),
    });
  };
  const action = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'start' | 'cancel' }) =>
      api(`/portal/manage/sessions/${id}/${kind}`, { method: 'POST' }),
    onSuccess: async (_result, variables) => {
      setTab(variables.kind === 'start' ? 'LIVE' : 'PAST');
      await client.invalidateQueries({ queryKey: ['expert-sessions'] });
    },
  });
  const startTutorSession = useMutation({
    mutationFn: (id: string) => api(`/portal/manage/sessions/${id}/start`, { method: 'POST' }),
    onSuccess: async (_result, id) => {
      await client.invalidateQueries({ queryKey: ['expert-sessions'] });
      navigate(`/tutor/sessions/${encodeURIComponent(id)}/host`, { state: { autoOpenRoom: true } });
    },
  });
  const startSession = async (id: string) => {
    if (user?.role !== 'TUTOR') {
      action.mutate({ id, kind: 'start' });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStartError('This browser does not support camera and microphone access. Open the site in a supported browser and try again.');
      return;
    }
    try {
      setStartError('');
      const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      permissionStream.getTracks().forEach((track) => track.stop());
      startTutorSession.mutate(id);
    } catch (reason) {
      setStartError(errorText(reason));
    }
  };
  return <PortalPage embedded={Boolean(embeddedCourseId)}>
    {!embeddedCourseId && <PageHeader title="Experts Session" backTo={manager ? (user?.role === 'TUTOR' ? '/tutor' : '/org-admin') : '/student/courses'} breadcrumbs={['My Course', 'Experts Session']} />}
    {manager && <form className="card form-grid" onSubmit={(event) => { event.preventDefault(); schedule.mutate(); }}>
      <h2 className="form-grid-span">{editingId ? 'Edit Expert Session' : 'Schedule an Expert Session'}</h2>
      <label className="field"><span>Course</span><select className="input" required value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}><option value="">Select a course</option>{courses.data?.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
      <label className="field"><span>Title</span><input className="input" required minLength={3} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label className="field"><span>Start time</span><input className="input" type="datetime-local" required value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></label>
      <label className="field"><span>Duration (minutes)</span><input className="input" type="number" min={5} max={240} required value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} /></label>
      <label className="field form-grid-span"><span>Description</span><textarea className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label className="field checkbox-field form-grid-span"><input type="checkbox" checked={form.freePreview} onChange={(event) => setForm({ ...form, freePreview: event.target.checked })} /><span>Free preview (accessible without a subscription)</span></label>
      <div className="form-grid-span button-row"><Button disabled={schedule.isPending || !courses.data?.length}>{schedule.isPending ? 'Saving…' : editingId ? 'Save changes' : 'Schedule session'}</Button>
        {editingId && <Button type="button" variant="secondary" onClick={() => { setEditingId(''); setForm({ courseId: '', title: '', description: '', startsAt: '', durationMinutes: '60', freePreview: false }); }}>Cancel edit</Button>}</div>
      {schedule.isError && <p className="notice notice-error form-grid-span" role="alert">{errorText(schedule.error)}</p>}
      {schedule.isSuccess && <p className="notice notice-success form-grid-span">Session scheduled and enrolled students notified.</p>}
    </form>}
    <div className="media-tabs" role="tablist" aria-label="Expert Session time filter">
      {sessionTabs.map((value) => <button key={value} type="button" className={`tab-button${tab === value ? ' active' : ''}`} role="tab" aria-selected={tab === value} onClick={() => setTab(value)}>{value === 'LIVE' ? 'Live now' : value === 'UPCOMING' ? 'Upcoming' : 'Past'}</button>)}
    </div>
    {sessions.isError && <p className="notice notice-error" role="alert">{errorText(sessions.error)}</p>}
    {sessions.isLoading && <div className="card">Loading Expert Sessions…</div>}
    {!sessions.isLoading && !sessions.data?.sessions.length && <div className="card empty-state"><h2>No sessions here yet</h2><p>Scheduled sessions for your courses will appear here.</p></div>}
    <div className="course-list">{sessions.data?.sessions.map((session) => <article className="card" key={session.id}>
      <div className="portal-page-heading"><div><p className="eyebrow">{session.course?.code ?? 'Class'} · {session.status}{session.freePreview ? ' · FREE PREVIEW' : ''}</p><h2>{session.title}</h2><p>{session.description}</p><p className="muted">{formatWhen(session.startsAt)} · {session.durationMinutes} minutes · Host: {session.host.name}</p></div>
        {manager ? <div className="button-row">
          {session.status === 'SCHEDULED' && <Button variant="secondary" onClick={() => editSession(session)}>Edit</Button>}
          {session.status === 'SCHEDULED' && <Button disabled={action.isPending || startTutorSession.isPending} onClick={() => void startSession(session.id)}>{user?.role === 'TUTOR' ? 'Check camera / mic and start' : 'Start'}</Button>}
          {session.status === 'SCHEDULED' && <Button variant="secondary" onClick={() => { if (window.confirm('Cancel this session? Enrolled students will no longer be able to join.')) action.mutate({ id: session.id, kind: 'cancel' }); }}>Cancel</Button>}
          {session.status === 'LIVE' && <Link className="button" to={`${user?.role === 'TUTOR' ? '/tutor' : '/org-admin'}/sessions/${session.id}/host`}>Host</Link>}
          {session.status !== 'CANCELLED' && <Link className="button button-secondary" to={`${user?.role === 'TUTOR' ? '/tutor' : '/org-admin'}/sessions/${session.id}/attendees`}>Attendees</Link>}
        </div> : session.locked
          ? <Link className="button" to="/student/payments">Pay My Fee</Link>
          : <Link className="button" aria-disabled={!session.joinAvailable} onClick={(event) => { if (!session.joinAvailable) event.preventDefault(); }} to={`/student/sessions/${session.id}/prepare${courseFilter ? `?courseId=${encodeURIComponent(courseFilter)}` : ''}`}>{session.joinAvailable ? 'Join class' : 'Check devices / Join'}</Link>}
      </div>
      {!session.joinAvailable && !manager && <p className="muted">Joining opens 10 minutes before the start and closes when the class ends.</p>}
      {action.isError && <p role="alert" className="notice notice-error">{errorText(action.error)}</p>}
      {startError && <p role="alert" className="notice notice-error">{startError}</p>}
      {startTutorSession.isError && <p role="alert" className="notice notice-error">{errorText(startTutorSession.error)}</p>}
    </article>)}</div>
  </PortalPage>;
}

export function SessionAttendeesPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const sessionsPath = user?.role === 'TUTOR' ? '/tutor/sessions' : '/org-admin/sessions';
  const client = useQueryClient();
  const attendees = useQuery({
    queryKey: ['expert-session-attendees', sessionId],
    queryFn: () => api<{ attendees: Array<{ student: { id: string; name: string; studentProfile: { studentId: string }; attendanceRecords: Array<{ status: string; joinedAt: string | null }> } }> }>(`/portal/manage/sessions/${sessionId}/attendees`),
  });
  const mark = useMutation({
    mutationFn: ({ studentId, status }: { studentId: string; status: string }) =>
      api(`/portal/manage/sessions/${sessionId}/attendance/${studentId}`, { method: 'PUT', body: JSON.stringify({ status }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['expert-session-attendees', sessionId] }); },
  });
  return <PortalPage><PageHeader title="Session attendance" backTo={sessionsPath} breadcrumbs={['Experts Session', 'Attendance']} />
    {attendees.isError && <p className="notice notice-error" role="alert">{errorText(attendees.error)}</p>}
    <div className="card"><h2>Attendees</h2><div className="course-list">{attendees.data?.attendees.map(({ student }) => <div className="attendance-row" key={student.id}>
      <span>{student.name} · {student.studentProfile.studentId}</span><span>{student.attendanceRecords[0]?.status ?? 'Not marked'}</span>
      <div className="button-row">{['PRESENT', 'LATE', 'ABSENT'].map((status) => <Button key={status} variant="secondary" onClick={() => mark.mutate({ studentId: student.id, status })}>{status}</Button>)}</div>
    </div>)}</div>{mark.isError && <p className="notice notice-error" role="alert">{errorText(mark.error)}</p>}</div>
  </PortalPage>;
}

export function SessionHostPage() {
  const { sessionId } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const sessionsPath = user?.role === 'TUTOR' ? '/tutor/sessions' : '/org-admin/sessions';
  const [roomUrl, setRoomUrl] = useState('');
  const host = useMutation({
    mutationFn: () => api<{ room: { roomUrl: string } }>(`/portal/manage/sessions/${sessionId}/host`, { method: 'POST' }),
    onSuccess: ({ room }) => setRoomUrl(room.roomUrl),
  });
  const openHostRoom = host.mutate;
  const autoOpenAttempted = useRef(false);
  const autoOpenRoom = Boolean(location.state && typeof location.state === 'object' &&
    'autoOpenRoom' in location.state && location.state.autoOpenRoom);
  useEffect(() => {
    if (!autoOpenRoom || autoOpenAttempted.current) return;
    autoOpenAttempted.current = true;
    openHostRoom();
    navigate(location.pathname, { replace: true, state: null });
  }, [autoOpenRoom, location.pathname, navigate, openHostRoom]);
  return <PortalPage><PageHeader title="Host Expert Session" backTo={sessionsPath} breadcrumbs={['Experts Session', 'Host']} />
    {!roomUrl && <div className="card"><p>Open the live room for this session. Your camera and microphone settings can be managed inside Jitsi.</p>
      <Button disabled={host.isPending} onClick={() => host.mutate()}>{host.isPending ? 'Opening room…' : 'Open host room'}</Button>
      {host.isError && <p role="alert" className="notice notice-error">{errorText(host.error)}</p>}
    </div>}
    {roomUrl && <div className="card live-room-card"><div className="button-row"><h2>Live Expert Session</h2>
      <Button variant="secondary" onClick={() => { if (window.confirm('Leave this class?')) navigate(sessionsPath); }}>Leave class</Button></div>
      <iframe title="Jitsi Meet host room" src={roomUrl} allow="camera; microphone; display-capture; fullscreen" allowFullScreen />
      <p className="muted">The room is available only while the session is live and within its scheduled time window.</p>
    </div>}
  </PortalPage>;
}

export function StudentSessionPreparePage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId');
  const returnTo = courseId ? `/student/courses/${encodeURIComponent(courseId)}/sessions` : '/student/courses';
  const { user } = useAuth();
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [deviceError, setDeviceError] = useState('');
  const [cameraId, setCameraId] = useState('');
  const [micId, setMicId] = useState('');
  const [roomUrl, setRoomUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sessionQuery = useQuery({
    queryKey: ['expert-sessions', 'UPCOMING', 'STUDENT'],
    queryFn: () => api<{ sessions: ExpertSession[] }>(`/portal/student/sessions${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ''}`),
  });
  const session = sessionQuery.data?.sessions.find((item) => item.id === sessionId);
  const join = useMutation({
    mutationFn: () => api<{ room: { roomUrl: string } }>(`/portal/student/sessions/${sessionId}/join`, { method: 'POST' }),
    onSuccess: ({ room }) => setRoomUrl(room.roomUrl),
  });
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  useEffect(() => () => stream?.getTracks().forEach((track) => track.stop()), [stream]);
  const startPreview = async () => {
    try {
      setDeviceError('');
      stream?.getTracks().forEach((track) => track.stop());
      const next = await navigator.mediaDevices.getUserMedia({
        video: cameraOn ? (cameraId ? { deviceId: { exact: cameraId } } : true) : false,
        audio: micOn ? (micId ? { deviceId: { exact: micId } } : true) : false,
      });
      setStream(next);
      setDevices(await navigator.mediaDevices.enumerateDevices());
    } catch (reason) {
      setDeviceError(errorText(reason));
    }
  };
  const devicesAvailable = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
  return <PortalPage><PageHeader title={roomUrl ? 'Live Expert Session' : 'Check your devices'} backTo={returnTo} breadcrumbs={['My Course', 'Experts Session', 'Prepare']} />
    {!sessionQuery.isLoading && !session && <div className="card"><p className="notice notice-error">This session is unavailable or you are not enrolled in its course.</p></div>}
    {session && !roomUrl && <div className="card device-check-card"><p className="eyebrow">{session.course?.code}</p><h2>{session.title}</h2><p>{formatWhen(session.startsAt)}</p>
      <div className="form-grid">
        <label className="field"><span><input type="checkbox" checked={cameraOn} onChange={(event) => setCameraOn(event.target.checked)} /> Camera on</span><select className="input" aria-label="Camera device" value={cameraId} onChange={(event) => setCameraId(event.target.value)}><option value="">Default camera</option>{devices.filter((device) => device.kind === 'videoinput').map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Camera'}</option>)}</select></label>
        <label className="field"><span><input type="checkbox" checked={micOn} onChange={(event) => setMicOn(event.target.checked)} /> Microphone on</span><select className="input" aria-label="Microphone device" value={micId} onChange={(event) => setMicId(event.target.value)}><option value="">Default microphone</option>{devices.filter((device) => device.kind === 'audioinput').map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}</select></label>
      </div>
      <video ref={videoRef} className="device-preview" autoPlay muted playsInline />
      <p className="muted">Allow camera and microphone access when your browser asks. If access is blocked, use the site controls beside the address bar to enable it.</p>
      <div className="button-row"><Button type="button" variant="secondary" disabled={!devicesAvailable} onClick={() => void startPreview()}>Check devices</Button>
        <Button type="button" disabled={!session.joinAvailable || join.isPending} onClick={() => join.mutate()}>{join.isPending ? 'Joining…' : 'Join class'}</Button></div>
      {deviceError && <p role="alert" className="notice notice-error">{deviceError}</p>}
      {join.isError && <p role="alert" className="notice notice-error">{errorText(join.error)}</p>}
      {!session.joinAvailable && <p className="muted">Joining opens 10 minutes before the start and closes when the class ends.</p>}
      <p className="muted">Leaving this page will disconnect you. The class uses Jitsi Meet and requires HTTPS for camera and microphone access in production.</p>
    </div>}
    {roomUrl && <div className="card live-room-card"><div className="button-row"><h2>{session?.title ?? 'Live class'}</h2><Button variant="secondary" onClick={() => { if (window.confirm('Leave this class?')) navigate(returnTo); }}>Leave class</Button></div>
      <iframe title="Jitsi Meet live class" src={roomUrl} allow="camera; microphone; display-capture; fullscreen" allowFullScreen />
      <p className="muted">Attendance is recorded when you join. Use the leave button to exit the room.</p>
    </div>}
    <span className="sr-only">{user?.name}</span>
  </PortalPage>;
}

export function LibraryPage({ embeddedCourseId }: { embeddedCourseId?: string } = {}) {
  const { user } = useAuth();
  const { itemId } = useParams();
  const [searchParams] = useSearchParams();
  const client = useQueryClient();
  const manager = user?.role === 'ORG_ADMIN' || user?.role === 'TUTOR';
  const base = manager ? '/portal/manage/library' : '/portal/student/library';
  const courseFilter = manager ? '' : embeddedCourseId ?? searchParams.get('courseId') ?? '';
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [saved, setSaved] = useState(false);
  const [listView, setListView] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: '', description: '', category: '', kind: 'BOOK', courseId: '', contentText: '', externalUrl: '', freePreview: false });
  const items = useQuery({
    queryKey: ['library', user?.role, search, category, kind, saved, courseFilter],
    queryFn: () => api<{ items: LibraryItem[] }>(`${base}?${new URLSearchParams({ ...(search ? { search } : {}), ...(category ? { category } : {}), ...(kind ? { kind } : {}), ...(saved && !manager ? { saved: 'true' } : {}), ...(courseFilter ? { courseId: courseFilter } : {}) })}`),
    enabled: !itemId,
  });
  const media = useQuery({
    queryKey: ['student-library-media', courseFilter],
    queryFn: () => api<{ items: LibraryMedia[] }>(`/student/media${courseFilter ? `?courseId=${encodeURIComponent(courseFilter)}` : ''}`),
    enabled: user?.role === 'STUDENT' && !itemId,
  });
  const detail = useQuery({
    queryKey: ['library-item', itemId, user?.role],
    queryFn: () => api<{ item: LibraryItem }>(`${base}/${itemId}`),
    enabled: Boolean(itemId),
  });
  const document = useQuery({
    queryKey: ['library-document', itemId, user?.role],
    queryFn: () => apiBlob(`${base}/${itemId}/content`),
    enabled: Boolean(itemId && detail.data?.item.hasDocument),
  });
  const courses = useQuery({
    queryKey: ['library-courses', user?.role],
    queryFn: async () => {
      if (user?.role === 'STUDENT') return (await api<{ enrollments: Array<{ course: Course }> }>('/student/courses/enrolled')).enrollments.map(({ course }) => course);
      return (await api<{ courses: Course[] }>('/courses')).courses;
    },
    enabled: manager,
  });
  const create = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append('title', form.title);
      body.append('description', form.description);
      body.append('category', form.category);
      body.append('kind', form.kind);
      body.append('freePreview', String(form.freePreview));
      if (form.courseId) body.append('courseId', form.courseId);
      if (form.contentText) body.append('contentText', form.contentText);
      if (form.externalUrl) body.append('externalUrl', form.externalUrl);
      if (file) body.append('file', file);
      return api(`${base}`, { method: 'POST', body });
    },
    onSuccess: async () => {
      setForm({ title: '', description: '', category: '', kind: 'BOOK', courseId: '', contentText: '', externalUrl: '', freePreview: false });
      setFile(null);
      await client.invalidateQueries({ queryKey: ['library'] });
    },
  });
  const save = useMutation({
    mutationFn: (savedValue: boolean) => api(`/portal/student/library/${itemId}/saved`, { method: savedValue ? 'PUT' : 'DELETE' }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['library-item', itemId] }); await client.invalidateQueries({ queryKey: ['library'] }); },
  });
  const publish = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: { published?: boolean; freePreview?: boolean } }) => api(`/portal/manage/library/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['library'] }); await client.invalidateQueries({ queryKey: ['library-item'] }); },
  });
  if (itemId) return <PortalPage><PageHeader title={detail.data?.item.title ?? 'Library reader'} backTo={manager ? '/tutor/library' : `/student/library${courseFilter ? `?courseId=${encodeURIComponent(courseFilter)}` : ''}`} breadcrumbs={['Library', 'Reader']} />
    {!embeddedCourseId && <DailyWisdomCards />}
    {detail.isError && <p role="alert" className="notice notice-error">{errorText(detail.error)}</p>}
    {detail.data && <article className="card library-reader"><div className="button-row"><span className="eyebrow">{detail.data.item.category} · {detail.data.item.kind}</span>{!manager && <Button variant="secondary" onClick={() => save.mutate(!detail.data?.item.saved)}>{detail.data.item.saved ? 'Remove from My List' : 'Save to My List'}</Button>}</div>
      <h2>{detail.data.item.title}</h2><p>{detail.data.item.description}</p>{detail.data.item.course && <p className="muted">{detail.data.item.course.code} — {detail.data.item.course.title}</p>}
      {detail.data.item.externalUrl ? <a href={detail.data.item.externalUrl} target="_blank" rel="noreferrer">Open secure resource</a> : <div className="library-reader-pages"><div className="library-watermark" aria-hidden="true">{user?.name} · {user?.studentId ?? user?.email}</div>{detail.data.item.contentText?.split(/\n{2,}/).map((page, index) => <section key={index}><p className="eyebrow">Page {index + 1}</p><p>{page}</p></section>)}</div>}
      {document.isLoading && <p className="loading">Preparing document viewer…</p>}
      {document.isError && <p role="alert" className="notice notice-error">{errorText(document.error)}</p>}
      {document.data && <ProtectedPdfViewer blob={document.data} watermark={`${user?.name ?? 'Student'} · ${user?.studentId ?? user?.email ?? ''}`} />}
    </article>}
  </PortalPage>;

  const listedItems = embeddedCourseId ? items.data?.items.filter((item) => item.kind === 'BOOK' || item.kind === 'DOCUMENT') : items.data?.items;
  const studentNotes = user?.role === 'STUDENT' ? listedItems?.filter((item) => item.kind === 'NOTE') : [];
  const otherLibraryItems = user?.role === 'STUDENT' ? listedItems?.filter((item) => item.kind !== 'NOTE') : listedItems;
  const categories = [...new Set(listedItems?.map((item) => item.category) ?? [])];
  const renderLibraryItem = (item: LibraryItem) => <article className="card library-content-card" key={item.id}>
    <div className="library-content-thumbnail" aria-hidden="true"><BookOpen /></div>
    <p className="eyebrow">{item.category} · {item.kind} {item.course && `· ${item.course.code}`} {item.freePreview && '· FREE PREVIEW'}</p>
    <h2>{item.title}</h2><p>{item.description}</p>
    <time className="library-content-date" dateTime={item.createdAt}>Added {new Date(item.createdAt).toLocaleDateString()}</time>
    <div className="button-row">
      {!manager && item.locked
        ? <Link className="button" to="/student/payments">Pay My Fee</Link>
        : <Link className="button button-secondary" to={`${manager ? (user?.role === 'TUTOR' ? '/tutor/library' : '/org-admin/library') : '/student/library'}/${item.id}${embeddedCourseId ? `?courseId=${encodeURIComponent(embeddedCourseId)}` : ''}`}>View</Link>}
      {manager && <Button variant="secondary" onClick={() => publish.mutate({ id: item.id, changes: { published: !item.published } })}>{item.published ? 'Unpublish' : 'Publish'}</Button>}
      {manager && <Button variant="secondary" onClick={() => publish.mutate({ id: item.id, changes: { freePreview: !item.freePreview } })}>{item.freePreview ? 'Require subscription' : 'Mark free preview'}</Button>}
      {!manager && item.saved && <span className="muted">Saved to My List</span>}
    </div>
    {publish.isError && <p role="alert" className="notice notice-error">{errorText(publish.error)}</p>}
  </article>;
  return <PortalPage embedded={Boolean(embeddedCourseId)}>{!embeddedCourseId && <>
    <PageHeader title={courseFilter ? 'Course Books' : 'Library'} backTo={manager ? (user?.role === 'TUTOR' ? '/tutor' : '/org-admin') : courseFilter ? `/student/courses/${encodeURIComponent(courseFilter)}` : '/student'} breadcrumbs={['Learn', courseFilter ? 'Course Books' : 'Library']} />
    <DailyWisdomCards />
  </>}
    {manager && <form className="card form-grid library-create-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
      <h2 className="form-grid-span">Publish Library item</h2>
      <label className="field"><span>Title</span><input required className="input" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
      <label className="field"><span>Category</span><input required className="input" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
      <label className="field"><span>Kind</span><select className="input" value={form.kind} onChange={(event) => setForm({ ...form, kind: event.target.value })}>{['BOOK', 'DOCUMENT', 'NOTE', 'LINK'].map((value) => <option key={value}>{value}</option>)}</select></label>
      <label className="field"><span>Course (optional)</span><select className="input" value={form.courseId} onChange={(event) => setForm({ ...form, courseId: event.target.value })}><option value="">Organization-wide</option>{courses.data?.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label>
      <label className="field form-grid-span"><span>Description</span><textarea className="input" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label className="field checkbox-field form-grid-span"><input type="checkbox" checked={form.freePreview} onChange={(event) => setForm({ ...form, freePreview: event.target.checked })} /><span>Free preview (accessible without a subscription)</span></label>
      {form.kind === 'LINK' ? <label className="field form-grid-span"><span>HTTPS resource URL</span><input required type="url" className="input" value={form.externalUrl} onChange={(event) => setForm({ ...form, externalUrl: event.target.value })} /></label> :
        <>
          <label className="field form-grid-span"><span>PDF attachment (required for books and documents; maximum 20 MB)</span><input className="input file-input" type="file" accept=".pdf,application/pdf" required={form.kind === 'BOOK' || form.kind === 'DOCUMENT'} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
          {form.kind === 'NOTE' && <label className="field form-grid-span"><span>Reader text (separate pages with blank lines, optional when a PDF is selected)</span><textarea required={!file} className="input library-content-input" value={form.contentText} onChange={(event) => setForm({ ...form, contentText: event.target.value })} /></label>}
        </>}
      <div className="form-grid-span button-row"><Button disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save as draft'}</Button></div>
      {create.isError && <p role="alert" className="notice notice-error form-grid-span">{errorText(create.error)}</p>}
      {create.isSuccess && <p className="notice notice-success form-grid-span">Library item saved as draft.</p>}
    </form>}
    <div className="card library-toolbar"><input className="input" aria-label="Search Library" placeholder="Search title and description" value={search} onChange={(event) => setSearch(event.target.value)} />
      <select className="input" aria-label="Filter by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
      <select className="input" aria-label="Filter by kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="">All kinds</option>{['BOOK', 'DOCUMENT', 'NOTE', 'LINK'].map((value) => <option key={value}>{value}</option>)}</select>
      {!manager && <button type="button" className={`tab-button${saved ? ' active' : ''}`} aria-pressed={saved} onClick={() => setSaved((value) => !value)}>My List</button>}
      <button type="button" className="button button-secondary" onClick={() => setListView((value) => !value)}>{listView ? 'Card view' : 'List view'}</button>
    </div>
    {items.isError && <p role="alert" className="notice notice-error">{errorText(items.error)}</p>}
    {items.isLoading && <div className="card">Loading Library…</div>}
    {!items.isLoading && !listedItems?.length && <div className="card empty-state">
      <h2>{embeddedCourseId ? 'No books or documents in this course' : 'No books, documents, or notes yet'}</h2>
      <p>{embeddedCourseId ? 'Published books and documents linked to this course will appear here.' : 'Published Library items will appear here.'}</p>
    </div>}
    {studentNotes?.length ? <section className="library-content-section"><div className="list-heading"><h2>Notes</h2><span>{studentNotes.length} item{studentNotes.length === 1 ? '' : 's'}</span></div>
      <div className={listView ? 'library-item-list list-view' : 'library-item-list'}>{studentNotes.map(renderLibraryItem)}</div>
    </section> : null}
    <div className={listView ? 'library-item-list list-view' : 'library-item-list'}>{otherLibraryItems?.map(renderLibraryItem)}</div>
    {user?.role === 'STUDENT' && !embeddedCourseId && <>
      {media.isError && <p role="alert" className="notice notice-error">{errorText(media.error)}</p>}
      {(['VIDEO', 'AUDIO'] as const).map((type) => {
        const mediaItems = media.data?.items.filter((item) => item.type === type) ?? [];
        return <section className="library-content-section" key={type}>
          <div className="list-heading"><h2>{type === 'VIDEO' ? 'Videos' : 'Audios'}</h2><span>{mediaItems.length} item{mediaItems.length === 1 ? '' : 's'}</span></div>
          {media.isLoading && <p className="loading">Loading {type === 'VIDEO' ? 'videos' : 'audios'}…</p>}
          {!media.isLoading && !mediaItems.length && <div className="card empty-state"><h2>No {type === 'VIDEO' ? 'videos' : 'audios'} yet</h2><p>Published media for your active courses will appear here.</p></div>}
          <div className="library-media-grid">{mediaItems.map((item) => <article className="card library-media-card" key={item.id}>
            {item.thumbnailUrl && !item.locked
              ? <img className="library-media-thumbnail" src={`${apiUrl}${item.thumbnailUrl}`} alt={`${item.title} thumbnail`} />
              : <div className="library-content-thumbnail library-media-placeholder" aria-hidden="true">{type === 'VIDEO' ? <Video /> : <Headphones />}</div>}
            <p className="eyebrow"><span className="status-pill status-published">{type}</span> · {item.course.code} · {item.topic?.title ?? 'General lesson'}</p>
            <h3>{item.title}</h3>
            <time className="library-content-date" dateTime={item.publishedAt ?? item.createdAt}>Published {new Date(item.publishedAt ?? item.createdAt).toLocaleDateString()}</time>
            {item.locked
              ? <Link className="button" to="/student/payments">Pay My Fee</Link>
              : <StudentMediaEmbed media={item} />}
            <div className="button-row"><span className="media-status">{item.completed ? 'Completed' : `${Math.round(item.progressPercent)}% complete`}</span>
              <Link className="button button-secondary" to={`/student/courses/${encodeURIComponent(item.course.id)}/media/${encodeURIComponent(item.id)}`}>Open full player</Link>
            </div>
          </article>)}</div>
        </section>;
      })}
    </>}
  </PortalPage>;
}

export function MyAttendancePage() {
  const [courseId, setCourseId] = useState('');
  const attendance = useQuery({
    queryKey: ['student-attendance', courseId],
    queryFn: () => api<AttendanceSummary>(`/portal/student/attendance${courseId ? `?courseId=${courseId}` : ''}`),
  });
  const groupedByMonth = useMemo(() => {
    const groups = new Map<string, AttendanceSummary['sessions']>();
    for (const session of attendance.data?.sessions ?? []) {
      const date = new Date(session.startsAt);
      const key = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      groups.set(key, [...(groups.get(key) ?? []), session]);
    }
    return [...groups.entries()];
  }, [attendance.data?.sessions]);
  return <PortalPage><PageHeader title="My Attendance" backTo="/student" breadcrumbs={['Progress', 'Attendance']} />
    {attendance.isError && <p role="alert" className="notice notice-error">{errorText(attendance.error)}</p>}
    <div className="card attendance-filter"><label className="field"><span>Course</span><select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">All courses</option>{attendance.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></label></div>
    <div className="stats-grid">{attendance.data?.courses.map((course) => <article className="card stat-card" key={course.id}><p className="eyebrow">{course.code}</p><h2>{course.percentage}%</h2><p>{course.present} of {course.total} sessions</p>{course.low && <p className="notice notice-warning">Below the {course.minimumAttendancePercent}% attendance requirement.</p>}</article>)}</div>
    <div className="card"><h2>Session calendar</h2>{!groupedByMonth.length && <p className="empty-state">No completed sessions are recorded yet.</p>}
      {groupedByMonth.map(([month, sessions]) => <section className="attendance-month" key={month}><h3>{month}</h3><div className="course-list">{sessions.map((session) => <article className="attendance-row" key={session.id}><span>{new Date(session.startsAt).toLocaleDateString()} · {session.title}</span><span>{session.course?.title}</span><strong>{session.status}</strong></article>)}</div></section>)}
    </div>
  </PortalPage>;
}

export function TrackKnowledgePage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<'PLAY' | 'PROGRESS'>('PLAY');
  const knowledge = useQuery({ queryKey: ['student-knowledge'], queryFn: () => api<Knowledge>('/portal/student/knowledge') });
  const rate = useMutation({
    mutationFn: ({ gameKey, rating }: { gameKey: string; rating: number }) =>
      api('/portal/student/knowledge/ratings', { method: 'PUT', body: JSON.stringify({ gameKey, rating }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['student-knowledge'] }); },
  });
  const attempts = knowledge.data?.attempts ?? [];
  return <PortalPage><PageHeader title="Track My Knowledge" backTo="/student" breadcrumbs={['Practice', 'Track My Knowledge']} />
    <div className="media-tabs" role="tablist" aria-label="Knowledge tabs">
      <button className={`tab-button${tab === 'PLAY' ? ' active' : ''}`} role="tab" aria-selected={tab === 'PLAY'} onClick={() => setTab('PLAY')}>Play and Practice</button>
      <button className={`tab-button${tab === 'PROGRESS' ? ' active' : ''}`} role="tab" aria-selected={tab === 'PROGRESS'} onClick={() => setTab('PROGRESS')}>My Progress</button>
    </div>
    {knowledge.isError && <p role="alert" className="notice notice-error">{errorText(knowledge.error)}</p>}
    {tab === 'PLAY' ? <div className="knowledge-game-grid">{games.map((game) => {
      const rating = knowledge.data?.ratings.find((item) => item.gameKey === game.key)?.rating ?? 0;
      return <article className="card" key={game.key}><p className="eyebrow">LEARNING GAME</p><h2>{game.title}</h2><p>{game.description}</p>
        <div className="button-row"><Link className="button button-secondary" to="/student/practice">Play / practice</Link><span className="star-rating" aria-label={`Rate ${game.title}`}>{[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" aria-label={`${value} stars`} aria-pressed={rating === value} onClick={() => rate.mutate({ gameKey: game.key, rating: value })}>{value <= rating ? '★' : '☆'}</button>)}</span></div>
      </article>;
    })}</div> : <><div className="stats-grid"><article className="card stat-card"><p className="eyebrow">Assessment average</p><h2>{attempts.length ? Math.round(attempts.reduce((sum, item) => sum + (item.percentage ?? 0), 0) / attempts.length) : 0}%</h2><p>{attempts.length} submitted assessments</p></article><article className="card stat-card"><p className="eyebrow">Practice sessions</p><h2>{knowledge.data?.practice.length ?? 0}</h2><p>completed or in progress</p></article><article className="card stat-card"><p className="eyebrow">Learning media</p><h2>{knowledge.data?.media.completed ?? 0}/{knowledge.data?.media.total ?? 0}</h2><p>completed videos and audios</p></article></div>
      <div className="card"><h2>Assessment results</h2>{attempts.length ? <div className="knowledge-chart">{attempts.map((attempt) => <div className="knowledge-bar-row" key={attempt.id}><span>{attempt.assessment.title}</span><div className="knowledge-bar"><span style={{ width: `${Math.min(100, Math.max(0, attempt.percentage ?? 0))}%` }} /></div><strong>{Math.round(attempt.percentage ?? 0)}%</strong></div>)}</div> : <p className="empty-state">Complete an assessment to see your progress.</p>}</div>
      <div className="card"><h2>Recent practice</h2>{knowledge.data?.practice.slice(0, 10).map((item) => <p key={item.id}>{formatWhen(item.createdAt)} · {item.course.title} · {item.score}/{item.totalQuestions}</p>)}</div>
    </>}
    {rate.isError && <p role="alert" className="notice notice-error">{errorText(rate.error)}</p>}
  </PortalPage>;
}

export function MyCertificatesPage() {
  const certificates = useQuery({ queryKey: ['student-certificates'], queryFn: () => api<{ certificates: Certificate[] }>('/portal/student/certificates') });
  return <PortalPage><PageHeader title="My Certificates" backTo="/student" breadcrumbs={['Progress', 'My Certificates']} />
    {certificates.isError && <p role="alert" className="notice notice-error">{errorText(certificates.error)}</p>}
    {!certificates.isLoading && !certificates.data?.certificates.length && <div className="card empty-state"><h2>No certificates yet</h2><p>Certificates will appear here when they are issued for your completed courses.</p></div>}
    <div className="course-list">{certificates.data?.certificates.map((certificate) => <article className="card" key={certificate.id}><p className="eyebrow">{certificate.certificateNo}</p><h2>{certificate.course.title}</h2><p>{certificate.organization.name} · Issued {new Date(certificate.issuedAt).toLocaleDateString()}</p><div className="button-row"><Link className="button button-secondary" to={`/student/certificates/${certificate.id}`}>View</Link><a className="button" href={`/student/certificates/${certificate.id}?print=true`}>Print / Download</a><Link to={`/certificate-verify/${certificate.verificationCode}`}>Verify certificate</Link></div></article>)}</div>
  </PortalPage>;
}

export function CertificateDetailPage() {
  const { certificateId } = useParams();
  const certificates = useQuery({ queryKey: ['student-certificates'], queryFn: () => api<{ certificates: Certificate[] }>('/portal/student/certificates') });
  const certificate = certificates.data?.certificates.find((item) => item.id === certificateId);
  useEffect(() => {
    if (certificate && new URLSearchParams(window.location.search).get('print') === 'true') window.print();
  }, [certificate]);
  return <PortalPage><PageHeader title="Certificate" backTo="/student/certificates" breadcrumbs={['Progress', 'My Certificates']} />
    {certificate ? <article className="certificate-page"><p className="eyebrow">{certificate.organization.name}</p><h1>Certificate of Completion</h1><p>This certificate is proudly presented to</p><h2>{certificate.student.name}</h2><p>for successful completion of</p><h2>{certificate.course.title}</h2><p>Certificate No. {certificate.certificateNo}</p><p>Issued {new Date(certificate.issuedAt).toLocaleDateString()}</p><p className="certificate-verify-text">Verification: {window.location.origin}/certificate-verify/{certificate.verificationCode}</p><button className="button no-print" type="button" onClick={() => window.print()}>Print / Save as PDF</button></article> : <div className="card">Loading certificate…</div>}
  </PortalPage>;
}

export function CertificateVerificationPage() {
  const { verificationCode } = useParams();
  const certificate = useQuery({
    queryKey: ['certificate-verification', verificationCode],
    queryFn: () => api<{ certificate: Omit<Certificate, 'id' | 'verificationCode' | 'student'> & { student: { name: string } } }>(`/public/certificates/${verificationCode}`),
    enabled: Boolean(verificationCode),
  });
  return <section className="narrow-card card"><PageHeader title="Certificate verification" backTo="/student/login" breadcrumbs={['Public', 'Verification']} />
    {certificate.isLoading && <p>Verifying…</p>}{certificate.isError && <p role="alert" className="notice notice-error">{errorText(certificate.error)}</p>}
    {certificate.data && <><p className="notice notice-success">Certificate verified</p><p>{certificate.data.certificate.student.name} completed {certificate.data.certificate.course.title} at {certificate.data.certificate.organization.name}.</p><p>Certificate No. {certificate.data.certificate.certificateNo}</p></>}
  </section>;
}
