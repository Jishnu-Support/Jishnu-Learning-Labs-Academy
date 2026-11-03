import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { MediaPage } from './media-page';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  apiUrl: '/api',
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
  },
}));

const staffUser: CurrentUser = {
  id: 'staff-1',
  organizationId: 'org-1',
  email: 'staff@example.test',
  name: 'Media Staff',
  role: 'STAFF',
  organization: { name: 'Academy', code: 'academy', isPlatformOwner: false },
};

const processingMedia = {
  id: 'media-1',
  title: 'Python introduction',
  description: 'A short course video',
  type: 'VIDEO',
  source: 'UPLOAD',
  youtubeVideoId: null,
  status: 'PROCESSING',
  visibility: 'DRAFT',
  durationSeconds: null,
  sizeBytes: 1024,
  courseId: 'course-1',
  topicId: null,
  streamKey: null,
  course: { id: 'course-1', title: 'Python', code: 'PY101' },
  topic: null,
  uploadedBy: { id: 'staff-1', name: 'Media Staff', role: 'STAFF' },
  job: { status: 'PROCESSING', attempts: 1, progressPercent: 45, error: null },
};

function renderMediaPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthContext.Provider value={{ user: staffUser, loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/staff/media']}>
          <MediaPage />
        </MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('MediaPage', () => {
  it('renders the upload form, explicit dashboard back button, and processing progress', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/media/courses') return { courses: [{ id: 'course-1', title: 'Python', code: 'PY101', topics: [{ id: 'topic-1', title: 'Basics', order: 1 }] }] };
      if (path === '/media/limits') return { limits: { maxVideoBytes: 180 * 1024 * 1024, maxAudioBytes: 100 * 1024 * 1024 } };
      if (path.startsWith('/media?')) return { media: [processingMedia], storage: null };
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderMediaPage();

    expect(await screen.findByRole('heading', { name: 'Upload Media' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add course media' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.getByLabelText('Media type')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'My Uploads' })).toBeInTheDocument();
    expect(await screen.findByText('PROCESSING · 45%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Processing Python introduction' })).toHaveValue(45);
    expect(screen.getAllByText('PY101 — Python')).not.toHaveLength(0);
  });

  it('shows the selected file and permits switching the picker to audio', async () => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path === '/media/courses') return { courses: [{ id: 'course-1', title: 'Python', code: 'PY101', topics: [{ id: 'topic-1', title: 'Basics', order: 1 }] }] };
      if (path === '/media/limits') return { limits: { maxVideoBytes: 180 * 1024 * 1024, maxAudioBytes: 100 * 1024 * 1024 } };
      if (path.startsWith('/media?')) return { media: [], storage: null };
      throw new Error(`Unexpected API request: ${path}`);
    });
    renderMediaPage();
    const typeSelect = await screen.findByLabelText('Media type');
    fireEvent.change(typeSelect, { target: { value: 'AUDIO' } });
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Audio lesson' } });
    fireEvent.change(screen.getAllByLabelText('Course')[0], { target: { value: 'course-1' } });
    const file = new File([new Uint8Array(1024)], 'lesson.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Choose a media file'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('lesson.mp3')).toBeInTheDocument());
    expect(screen.getByText('1 KB · audio/mpeg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload & Publish' })).toBeEnabled();
  });

  it('validates YouTube URLs and adds a valid link without creating a file upload', async () => {
    const addedMedia = {
      ...processingMedia,
      source: 'YOUTUBE',
      youtubeVideoId: 'abcdefghijk',
      status: 'READY',
      visibility: 'PUBLISHED',
    };
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === '/media/courses') return { courses: [{ id: 'course-1', title: 'Python', code: 'PY101', topics: [] }] };
      if (path === '/media/limits') return { limits: { maxVideoBytes: 180 * 1024 * 1024, maxAudioBytes: 100 * 1024 * 1024 } };
      if (path === '/media' && init?.method === 'POST') return { media: addedMedia };
      if (path.startsWith('/media?')) return { media: [], storage: null };
      throw new Error(`Unexpected API request: ${path}`);
    });
    renderMediaPage();

    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Shared lesson' } });
    fireEvent.change(screen.getAllByLabelText('Course')[0], { target: { value: 'course-1' } });
    fireEvent.change(screen.getByLabelText('Video source'), { target: { value: 'YOUTUBE' } });
    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: 'https://youtube.com.evil.example/watch?v=abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add & Publish' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('valid HTTPS YouTube');
    expect(vi.mocked(api).mock.calls.some(([path, init]) => path === '/media' && init?.method === 'POST')).toBe(false);

    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: 'https://youtu.be/abcdefghijk' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add & Publish' }));
    expect(await screen.findByText('YouTube video added and published to the course.')).toBeInTheDocument();
    const createCall = vi.mocked(api).mock.calls.find(([path, init]) => path === '/media' && init?.method === 'POST');
    expect(createCall?.[1]?.body).toContain('"source":"YOUTUBE"');
    expect(createCall?.[1]?.body).toContain('"publishOnReady":true');
  });
});
