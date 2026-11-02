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
      if (path === '/media/limits') return { limits: { maxVideoBytes: 500 * 1024 * 1024, maxAudioBytes: 100 * 1024 * 1024 } };
      if (path.startsWith('/media?')) return { media: [processingMedia], storage: null };
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderMediaPage();

    expect(await screen.findByRole('heading', { name: 'Upload Media' })).toBeInTheDocument();
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
      if (path === '/media/courses') return { courses: [] };
      if (path === '/media/limits') return { limits: { maxVideoBytes: 500 * 1024 * 1024, maxAudioBytes: 100 * 1024 * 1024 } };
      if (path.startsWith('/media?')) return { media: [], storage: null };
      throw new Error(`Unexpected API request: ${path}`);
    });
    renderMediaPage();
    const typeSelect = await screen.findByLabelText('Media type');
    fireEvent.change(typeSelect, { target: { value: 'AUDIO' } });
    const file = new File([new Uint8Array(1024)], 'lesson.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByLabelText('Choose a media file'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('lesson.mp3')).toBeInTheDocument());
    expect(screen.getByText('1 KB · audio/mpeg')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload media' })).toBeEnabled();
  });
});
