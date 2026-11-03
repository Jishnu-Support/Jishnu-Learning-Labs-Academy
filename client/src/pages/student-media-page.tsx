import Hls from 'hls.js';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { api, apiUrl } from '../lib/api';

type StudentMediaItem = {
  id: string;
  title: string;
  description: string | null;
  type: 'VIDEO' | 'AUDIO';
  durationSeconds: number | null;
  progressPercent: number;
  completed: boolean;
  course: { id: string; title: string; code: string };
  topic: { id: string; title: string } | null;
  watchProgress: { lastPositionSeconds: number; watchedSeconds: number; completed: boolean } | null;
};

type StudentMediaResponse = {
  items: StudentMediaItem[];
  courses: Array<{ id: string; title: string; code: string }>;
};

const tabs = ['ALL', 'VIDEO', 'AUDIO'] as const;

type MediaTab = typeof tabs[number];

function formatDuration(durationSeconds: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return '—';
  const hours = Math.floor(durationSeconds / 3600);
  const minutes = Math.floor((durationSeconds % 3600) / 60);
  const seconds = Math.floor(durationSeconds % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function groupMedia(items: StudentMediaItem[]) {
  const groups = new Map<string, { course: StudentMediaItem['course']; items: StudentMediaItem[] }>();
  for (const item of items) {
    const existing = groups.get(item.course.id);
    if (existing) {
      existing.items.push(item);
    } else {
      groups.set(item.course.id, { course: item.course, items: [item] });
    }
  }
  return Array.from(groups.values());
}

export function StudentMediaPage() {
  const [tab, setTab] = useState<MediaTab>('ALL');
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');

  const queryParams = new URLSearchParams();
  if (search.trim()) queryParams.set('search', search.trim());
  if (courseId) queryParams.set('courseId', courseId);
  if (tab !== 'ALL') queryParams.set('type', tab);

  const mediaQuery = useQuery({
    queryKey: ['student-media', tab, search, courseId],
    queryFn: () => api<StudentMediaResponse>(`/student/media?${queryParams.toString()}`),
  });

  const groups = useMemo(() => groupMedia(mediaQuery.data?.items ?? []), [mediaQuery.data]);

  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title="Videos & Audios" backTo="/student" breadcrumbs={['Student', 'Learning']} />
        <div className="card media-shell">
          <div className="media-toolbar">
            <div className="media-tabs" role="tablist" aria-label="Media type filter">
              {tabs.map((value) => (
                <button key={value} type="button" className={`tab-button${tab === value ? ' active' : ''}`} onClick={() => setTab(value)}>
                  {value === 'ALL' ? 'All' : value === 'VIDEO' ? 'Videos' : 'Audios'}
                </button>
              ))}
            </div>
            <div className="media-search-row">
              <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search videos and audios" aria-label="Search media" />
              <select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)} aria-label="Filter by course">
                <option value="">All courses</option>
                {(mediaQuery.data?.courses ?? []).map((course) => (
                  <option key={course.id} value={course.id}>{course.title}</option>
                ))}
              </select>
            </div>
          </div>

          {!mediaQuery.isLoading && !mediaQuery.data?.items.length && (
            <div className="empty-state card" style={{ marginTop: '18px' }}>
              <h2>No media yet</h2>
              <p>Nothing is published for your enrolled courses yet. Try another filter or check back later.</p>
            </div>
          )}

          {groups.map((group) => (
            <div key={group.course.id} className="media-group">
              <div className="media-group-header">
                <div>
                  <span className="eyebrow">{group.course.code}</span>
                  <h2>{group.course.title}</h2>
                </div>
                <span>{group.items.length} item{group.items.length === 1 ? '' : 's'}</span>
              </div>
              <div className="media-list-grid">
                {group.items.map((item) => (
                  <article key={item.id} className="media-card card">
                    <div className="media-thumbnail">
                      <div className="media-badge">{item.type}</div>
                      <span>{formatDuration(item.durationSeconds)}</span>
                    </div>
                    <div className="media-copy">
                      <div className="media-row">
                        <h3>{item.title}</h3>
                        {item.completed && <span className="media-complete">✓</span>}
                      </div>
                      <p>{item.topic?.title ?? 'General lesson'}</p>
                      {item.watchProgress && item.watchProgress.lastPositionSeconds > 0 && (
                        <div className="progress-wrap" aria-label={`Progress ${Math.round(item.progressPercent)} percent`}>
                          <div className="progress-bar" style={{ width: `${Math.min(100, item.progressPercent)}%` }} />
                        </div>
                      )}
                      <div className="media-actions">
                        <Link className="button button-secondary" to={`/student/media/${item.id}`}>{item.completed ? 'Replay' : 'Continue watching'}</Link>
                        <span className="media-status">{item.completed ? 'Completed' : 'In progress'}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function StudentMediaPlayerPage() {
  const { mediaId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const mediaQuery = useQuery({
    queryKey: ['student-media-item', mediaId],
    queryFn: () => api<{ media: StudentMediaItem }>(`/student/media/${mediaId}`),
    enabled: Boolean(mediaId),
  });
  const media = mediaQuery.data?.media;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [lastSavedAt, setLastSavedAt] = useState(0);
  const payload = useMutation({
    mutationFn: (input: { positionSeconds: number; watchedSeconds: number; completed: boolean }) =>
      api(`/student/media/${mediaId}/progress`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  });

  const source = media ? `${apiUrl}/student/media/${media.id}/stream/${media.type === 'VIDEO' ? 'master.m3u8' : 'audio.m4a'}` : '';

  useEffect(() => {
    const mediaElement = media?.type === 'VIDEO' ? videoRef.current : audioRef.current;
    if (!mediaElement || !media) return;
    const savedPosition = media.watchProgress?.lastPositionSeconds ?? 0;
    mediaElement.currentTime = savedPosition;
    mediaElement.playbackRate = playbackRate;
  }, [media, playbackRate]);

  useEffect(() => {
    const element = media?.type === 'VIDEO' ? videoRef.current : audioRef.current;
    if (!element) return;
    const onVisibility = () => {
      if (document.hidden) element.pause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [media]);

  useEffect(() => {
    const element = media?.type === 'VIDEO' ? videoRef.current : audioRef.current;
    if (!element || !source) return;
    const record = () => {
      const currentSeconds = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      const duration = media?.durationSeconds ?? (currentSeconds > 0 ? currentSeconds : 1);
      const watchedSeconds = Math.max(currentSeconds, media?.watchProgress?.watchedSeconds ?? 0);
      const completed = currentSeconds >= duration * 0.9;
      if (Math.abs(currentSeconds - lastSavedAt) > 5) {
        setLastSavedAt(currentSeconds);
        payload.mutate({ positionSeconds: currentSeconds, watchedSeconds, completed });
      }
    };
    element.addEventListener('timeupdate', record);
    return () => element.removeEventListener('timeupdate', record);
  }, [media, lastSavedAt, payload, source]);

  useEffect(() => {
    if (!source || !media) return;
    if (media.type === 'AUDIO') {
      if (audioRef.current) audioRef.current.src = source;
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = source;
      return;
    }
    if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hls.loadSource(source);
      hls.attachMedia(video);
      return () => hls.destroy();
    }
  }, [media, source]);

  if (!media || mediaQuery.isLoading) {
    return (
      <div className="portal-layout">
        <PortalSidebar role="STUDENT" />
        <section className="portal-content"><div className="card">Loading media…</div></section>
      </div>
    );
  }

  const watermark = `${user?.name ?? 'Student'} • ${user?.studentId ?? 'ID'}`;

  return (
    <div className="portal-layout">
      <PortalSidebar role="STUDENT" />
      <section className="portal-content">
        <PageHeader title={media.title} backTo="/student/media" breadcrumbs={['Student', 'Videos & Audios']} />
        <div className="card media-player-shell">
          <div className="media-player-wrap" onContextMenu={(event) => event.preventDefault()}>
            {media.type === 'VIDEO' ? (
              <video ref={videoRef} controls preload="metadata" playsInline className="media-player" onContextMenu={(event) => event.preventDefault()} />
            ) : (
              <audio ref={audioRef} controls preload="metadata" className="media-player audio-player" onContextMenu={(event) => event.preventDefault()} />
            )}
            <div className="media-watermark" aria-hidden="true">{watermark}</div>
          </div>
          <div className="media-player-meta">
            <div>
              <p className="eyebrow">{media.course.code}</p>
              <h2>{media.course.title}</h2>
            </div>
            <div className="media-controls-row">
              <label className="field compact-field">
                <span>Speed</span>
                <select className="input" value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2}>2x</option>
                </select>
              </label>
              <button type="button" className="button button-secondary" onClick={() => navigate('/student/media')}>Back to library</button>
            </div>
          </div>
          {media.description && <p className="muted">{media.description}</p>}
          {media.watchProgress && (
            <p className="muted">Resume at {formatDuration(Math.round(media.watchProgress.lastPositionSeconds))} • {Math.round(media.progressPercent)}% watched.</p>
          )}
        </div>
      </section>
    </div>
  );
}
