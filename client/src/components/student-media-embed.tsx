import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { api, apiUrl } from '../lib/api';

export type StudentPlayableMedia = {
  id: string;
  title: string;
  type: 'VIDEO' | 'AUDIO';
  source: 'UPLOAD' | 'YOUTUBE';
  youtubeVideoId: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  course?: { id: string };
  watchProgress: { lastPositionSeconds: number; watchedSeconds: number; completed: boolean } | null;
};

function preventContextMenu(event: Event) {
  event.preventDefault();
}

export function StudentMediaEmbed({ media }: { media: StudentPlayableMedia }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const watermark = `${user?.name ?? 'Student'} · ${user?.studentId ?? 'ID'}`;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSavedPosition = useRef(0);
  const [useProgressive, setUseProgressive] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const streamUrl = `${apiUrl}/student/media/${media.id}/stream/${media.type === 'VIDEO' ? 'master.m3u8' : 'audio.m4a'}`;
  const progressiveUrl = `${apiUrl}/student/media/${media.id}/progressive`;

  useEffect(() => {
    setUseProgressive(false);
    setPlaybackError('');
    lastSavedPosition.current = 0;
  }, [media.id]);

  useEffect(() => {
    const element = media.type === 'VIDEO' ? videoRef.current : audioRef.current;
    if (!element || media.source !== 'UPLOAD') return;

    const resume = () => {
      if (media.watchProgress?.lastPositionSeconds) element.currentTime = media.watchProgress.lastPositionSeconds;
    };
    element.addEventListener('loadedmetadata', resume);
    element.addEventListener('contextmenu', preventContextMenu);
    resume();
    return () => {
      element.removeEventListener('loadedmetadata', resume);
      element.removeEventListener('contextmenu', preventContextMenu);
    };
  }, [media.id, media.source, media.type, media.watchProgress?.lastPositionSeconds]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || media.type !== 'VIDEO' || media.source !== 'UPLOAD') return;

    const triggerFallback = () => {
      if (useProgressive) setPlaybackError('This video could not be played. Try again later or contact your organization.');
      else setUseProgressive(true);
    };
    if (useProgressive) {
      video.src = progressiveUrl;
      video.addEventListener('error', triggerFallback);
      return () => {
        video.removeEventListener('error', triggerFallback);
        video.removeAttribute('src');
        video.load();
      };
    }

    video.addEventListener('error', triggerFallback);
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ xhrSetup: (xhr) => { xhr.withCredentials = true; } });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) triggerFallback();
      });
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      return () => {
        video.removeEventListener('error', triggerFallback);
        hls.destroy();
      };
    } else {
      triggerFallback();
    }
    return () => {
      video.removeEventListener('error', triggerFallback);
      video.removeAttribute('src');
      video.load();
    };
  }, [media.id, media.source, media.type, progressiveUrl, streamUrl, useProgressive]);

  useEffect(() => {
    const element = media.type === 'VIDEO' ? videoRef.current : audioRef.current;
    if (!element || media.source !== 'UPLOAD') return;
    const recordProgress = () => {
      const positionSeconds = Number.isFinite(element.currentTime) ? element.currentTime : 0;
      if (Math.abs(positionSeconds - lastSavedPosition.current) < 5) return;
      lastSavedPosition.current = positionSeconds;
      const duration = media.durationSeconds ?? element.duration;
      const completed = Number.isFinite(duration) && duration > 0 && positionSeconds >= duration * 0.9;
      void api(`/student/media/${media.id}/progress`, {
        method: 'POST',
        body: JSON.stringify({
          positionSeconds,
          watchedSeconds: Math.max(positionSeconds, media.watchProgress?.watchedSeconds ?? 0),
          completed,
        }),
      }).then(async () => {
        if (!completed) return;
        await queryClient.invalidateQueries({ queryKey: ['student-certificates'] });
        await queryClient.invalidateQueries({ queryKey: ['student-courses-enrolled'] });
        if (media.course?.id) {
          await queryClient.invalidateQueries({ queryKey: ['student-course', media.course.id] });
          await queryClient.invalidateQueries({ queryKey: ['student-course-media', media.course.id] });
        }
      }).catch(() => setPlaybackError('Playback progress could not be saved.'));
    };
    element.addEventListener('timeupdate', recordProgress);
    return () => element.removeEventListener('timeupdate', recordProgress);
  }, [media.course?.id, media.durationSeconds, media.id, media.source, media.type, media.watchProgress?.watchedSeconds, queryClient]);

  if (media.source === 'YOUTUBE' && media.youtubeVideoId) {
    return <div className="media-player-wrap" onContextMenu={(event) => event.preventDefault()}>
      <iframe
        className="media-player"
        src={`https://www.youtube-nocookie.com/embed/${media.youtubeVideoId}`}
        title={media.title}
        allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="media-watermark" aria-hidden="true">{watermark}</div>
    </div>;
  }

  return <>
    <div className="media-player-wrap" onContextMenu={(event) => event.preventDefault()}>
      {media.type === 'VIDEO'
        ? <video ref={videoRef} controls preload="metadata" playsInline className="media-player" poster={media.thumbnailUrl ? `${apiUrl}${media.thumbnailUrl}` : undefined} onContextMenu={(event) => event.preventDefault()} />
        : <audio ref={audioRef} controls preload="metadata" className="media-player audio-player" src={streamUrl} onContextMenu={(event) => event.preventDefault()} />}
      {media.type === 'VIDEO' && <div className="media-watermark" aria-hidden="true">{watermark}</div>}
    </div>
    {playbackError && <p role="alert" className="notice notice-error">{playbackError}</p>}
  </>;
}
