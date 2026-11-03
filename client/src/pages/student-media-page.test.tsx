import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { api } from '../lib/api';
import { StudentMediaPlayerPage } from './student-media-page';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  apiUrl: '/api',
}));

const studentUser: CurrentUser = {
  id: 'student-1',
  organizationId: 'org-1',
  email: 'student@example.test',
  name: 'Media Student',
  role: 'STUDENT',
  studentId: 'STU-1',
  organization: { name: 'Academy', code: 'academy', isPlatformOwner: false },
};

const baseMedia = {
  id: 'media-1',
  title: 'Shared lesson',
  description: 'Lesson description',
  type: 'VIDEO' as const,
  source: 'UPLOAD' as const,
  youtubeVideoId: null,
  durationSeconds: 100,
  progressPercent: 0,
  completed: false,
  course: { id: 'course-1', title: 'Python', code: 'PY101' },
  topic: null,
  watchProgress: null,
};

function renderPlayer() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user: studentUser, loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/student/media/media-1']}>
          <Routes>
            <Route path="/student/media/:mediaId" element={<StudentMediaPlayerPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('StudentMediaPlayerPage', () => {
  it('uses the privacy-enhanced YouTube embed and explains its playback and progress limits', async () => {
    vi.mocked(api).mockResolvedValue({
      media: {
        ...baseMedia,
        source: 'YOUTUBE',
        youtubeVideoId: 'abcdefghijk',
      },
    });

    renderPlayer();

    const iframe = await screen.findByTitle('YouTube video: Shared lesson');
    expect(iframe).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0');
    expect(screen.getByText(/YouTube videos do not report viewing progress here/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open it on YouTube' })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdefghijk');
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    expect(vi.mocked(api).mock.calls.some(([path]) => path.includes('/progress'))).toBe(false);
  });

  it('shows a clear error when uploaded media cannot be played', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.mocked(api).mockResolvedValue({ media: baseMedia });

    const { container } = renderPlayer();
    const video = await waitFor(() => {
      const element = container.querySelector('video');
      expect(element).not.toBeNull();
      return element as HTMLVideoElement;
    });
    fireEvent.error(video);

    expect(await screen.findByRole('alert')).toHaveTextContent('This media could not be played.');
  });

  it('does not present a failed media request as a loading state', async () => {
    vi.mocked(api).mockRejectedValue(new Error('not available'));

    renderPlayer();

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not load this media.');
    expect(screen.getByRole('heading', { name: 'Media unavailable' })).toBeInTheDocument();
  });
});
