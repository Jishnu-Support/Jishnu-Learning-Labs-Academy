import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentCompletedCoursesPage } from './student-completed-courses-page';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  api: apiMock,
}));

afterEach(() => {
  apiMock.mockReset();
});

describe('StudentCompletedCoursesPage', () => {
  it('shows seeded sample completions, full progress, thumbnails, and non-issued certificate status', async () => {
    apiMock.mockResolvedValue({
      courses: [{
        completedAt: '2026-10-20T12:00:00.000Z',
        progressPercent: 100,
        course: {
          id: 'sample-course-1',
          code: 'SAMPLE-WEB-01',
          title: 'Web Development Fundamentals',
          description: 'Sample course description.',
          thumbnailUrl: '/brand/course-web-development.svg',
          plannedHours: 24,
        },
        tutor: { id: 'sample-tutor-1', name: 'Sample Tutor' },
        certificate: {
          id: 'sample-certificate-1',
          certificateNo: 'SAMPLE-ONLY',
          verificationCode: 'not-for-verification',
          issuedAt: '2026-10-20T12:00:00.000Z',
          isSample: true,
          student: { name: 'Sample Student' },
          course: { id: 'sample-course-1', title: 'Web Development Fundamentals', code: 'SAMPLE-WEB-01' },
          organization: { name: 'Jishnu Learning Labs' },
        },
      }],
    });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <StudentCompletedCoursesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Web Development Fundamentals' })).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith('/portal/student/completed-courses');
    expect(screen.getByText('SAMPLE · NOT ISSUED')).toBeInTheDocument();
    expect(screen.getByText(/100% complete/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Course progress: 100%' })).toHaveAttribute('value', '100');
    expect(screen.getByRole('img', { name: 'Web Development Fundamentals course thumbnail' })).toHaveAttribute('src', '/brand/course-web-development.svg');
    expect(screen.getByRole('link', { name: 'View certificate' })).toHaveAttribute('href', '/student/certificates/sample-certificate-1');
  });
});
