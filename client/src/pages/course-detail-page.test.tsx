import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseDetailPage } from './course-detail-page';

vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ user: { role: 'TUTOR' } }) }));
vi.mock('../components/portal-sidebar', () => ({ PortalSidebar: () => null }));
vi.mock('./notes-page', () => ({ NotesPage: () => null }));
vi.mock('./media-page', () => ({ MediaPage: () => null }));
vi.mock('./learning-pages', () => ({
  PracticeQuestionBankPage: () => null,
  TeacherAssessmentsPage: () => null,
}));
vi.mock('./student-portal-pages', () => ({ ExpertSessionsPage: () => null }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CourseDetailPage', () => {
  it('renders the eight Tutor course-management tabs in order', async () => {
    const course = {
      id: 'course-1',
      code: 'COURSE-1',
      title: 'Sample course',
      description: 'A sample course.',
      category: 'Sample',
      plannedHours: 8,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2026-12-31T00:00:00.000Z',
      status: 'PUBLISHED',
      minimumAttendancePercent: 75,
      requiresAssessmentPass: false,
      instructors: [],
      topics: [],
      notes: [],
      _count: { enrollments: 0, notes: 0 },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      const data = path.endsWith('/courses/course-1')
        ? { course }
        : path.includes('/portal/manage/sessions')
          ? { sessions: [] }
          : { rows: [] };
      return { ok: true, status: 200, json: async () => ({ data }) } as Response;
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/tutor/courses/course-1']}>
          <Routes>
            <Route path="/tutor/courses/:courseId" element={<CourseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(8));
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Overview',
      'Publish Study Material',
      'YouTube Links',
      'Video',
      'Audio',
      'Expert Session',
      'Practice Q/A',
      'Assessment',
    ]);
  });
});
