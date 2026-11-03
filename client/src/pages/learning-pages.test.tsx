import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type CurrentUser } from '../auth/auth-context';
import { api } from '../lib/api';
import { StudentPracticePage } from './learning-pages';

vi.mock('../lib/api', () => ({
  api: vi.fn(),
  apiUrl: '/api',
  ApiError: class ApiError extends Error {
    constructor(message: string, public readonly status: number) { super(message); }
  },
}));

const student: CurrentUser = {
  id: 'student-1', organizationId: 'org-1', email: 'student@example.test', name: 'Student One', role: 'STUDENT',
  organization: { name: 'Academy', code: 'academy', isPlatformOwner: false },
};

function renderPracticePage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthContext.Provider value={{ user: student, loading: false, logout: vi.fn() }}>
        <MemoryRouter initialEntries={['/student/practice']}><StudentPracticePage /></MemoryRouter>
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.clearAllMocks());

describe('StudentPracticePage', () => {
  it('starts an enrolled-course practice and only reveals the answer after submission', async () => {
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (path === '/student/courses/enrolled') return { enrollments: [{ course: { id: 'course-1', code: 'PY101', title: 'Python' } }] };
      if (path === '/student/courses/course-1') return { course: { topics: [{ id: 'topic-1', title: 'Basics' }] } };
      if (path === '/learning/student/practice/history') return { sessions: [] };
      if (path === '/learning/student/practice/start') {
        expect(init?.method).toBe('POST');
        return {
          session: { id: 'session-1', totalQuestions: 1, answeredCount: 0, score: 0, status: 'IN_PROGRESS', expiresAt: null },
          remainingSeconds: null,
          summary: { score: 0, maxScore: 1, accuracyPercent: 0, weakTopics: [] },
          question: { id: 'question-1', type: 'MCQ_SINGLE', prompt: 'Choose A', options: ['A', 'B'], marks: 1, topic: 'Basics', difficulty: 'BEGINNER' },
        };
      }
      if (path === '/learning/student/practice-sessions/session-1/answers') {
        return {
          isCorrect: true, correctAnswer: 'A', explanation: 'A is correct.',
          next: { session: { id: 'session-1', totalQuestions: 1, answeredCount: 1, score: 1, status: 'COMPLETED', expiresAt: null }, remainingSeconds: null, question: null, summary: { score: 1, maxScore: 1, accuracyPercent: 100, weakTopics: [] } },
        };
      }
      throw new Error(`Unexpected API request: ${path}`);
    });

    renderPracticePage();
    expect(await screen.findByRole('heading', { name: 'Practice Q/A' })).toBeInTheDocument();
    fireEvent.change(await screen.findByLabelText('Enrolled course'), { target: { value: 'course-1' } });
    await screen.findByRole('option', { name: 'Basics' });
    fireEvent.click(screen.getByRole('button', { name: 'Start practice' }));
    expect(await screen.findByText('Choose A')).toBeInTheDocument();
    expect(screen.queryByText('A is correct.')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Your answer/), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(screen.getByText(/Correct\. Answer: "A"/)).toBeInTheDocument());
    expect(screen.getByText(/A is correct\./)).toBeInTheDocument();
    expect(screen.getByText('Practice complete')).toBeInTheDocument();
  }, 10000);
});
