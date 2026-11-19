import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentCourseDetailPage } from './student-course-detail-page';

vi.mock('../components/portal-sidebar', () => ({ PortalSidebar: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StudentCourseDetailPage', () => {
  it('renders the ten course tabs in the required order', async () => {
    const course = {
      id: 'course-1',
      code: 'COURSE-1',
      title: 'Sample course',
      description: 'A sample course.',
      thumbnailUrl: null,
      category: 'Sample',
      plannedHours: 8,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
      minimumAttendancePercent: 75,
      requiresAssessmentPass: false,
      progressPercent: 0,
      instructors: [],
      topics: [],
      notes: [],
      enrollments: [{
        id: 'enrollment-1',
        status: 'ACTIVE',
        enrolledAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        selectedTutorId: null,
        pendingTutorId: null,
        selectedTutor: null,
        pendingTutor: null,
      }],
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.endsWith('/student/courses/course-1')
        ? { course }
        : path.endsWith('/student/courses/enrolled')
          ? { enrollments: [] }
          : { tutor: null };
      return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/student/courses/course-1/overview']}>
          <Routes>
            <Route path="/student/courses/:courseId/:tab?" element={<StudentCourseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(10));
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Study material',
      'Youtube links',
      'Videos',
      'Audios',
      'Expert session',
      'Practice Q/A',
      'Assessment',
      'Evaluation reports',
      'My certificate',
    ]);
  });
});
