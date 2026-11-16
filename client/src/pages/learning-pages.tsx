import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { PracticeAnswerInput } from '../components/practice-answer-input';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type QuestionType = 'MCQ_SINGLE' | 'MCQ_MULTIPLE' | 'TRUE_FALSE' | 'MATCH' | 'FILL_BLANK' | 'SHORT_ANSWER';
type Course = { id: string; code: string; title: string };
type Question = {
  id: string; courseId: string; topicId: string | null; type: QuestionType; prompt: string; topic: string; difficulty: string; marks: number;
  options: unknown; correctAnswer: unknown; explanation?: string | null;
  course: Course;
};
type Assessment = {
  id: string; title: string; instructions: string; totalMarks: number; passMark: number; durationMinutes: number;
  status: string; opensAt: string | null; closesAt: string | null; maxAttempts: number;
  resultReleaseMode: 'IMMEDIATE' | 'MANUAL'; answerReviewAllowed: boolean; course: Course;
  shuffleQuestions: boolean; shuffleOptions: boolean; weight: number | null;
  locked?: boolean;
  attempts?: Array<{ id: string; status: string; score: number | null; submittedAt: string | null; passed?: boolean | null }>;
  availability?: 'UPCOMING' | 'OPEN' | 'CLOSED';
};
type AssessmentDetail = Assessment & { questions: Array<Record<string, unknown> & { id: string }> };
type LearningQuestion = {
  id: string; type: QuestionType | 'FILL_IN_BLANK'; prompt: string; options: unknown; answer?: unknown; correctAnswer?: unknown;
  explanation?: string | null; marks: number; topic: string; difficulty: string;
};
type PracticeSession = {
  session: { id: string; totalQuestions: number; answeredCount: number; score: number; status: string; expiresAt: string | null; practiceSet?: { title: string } | null };
  remainingSeconds: number | null;
  question: LearningQuestion | null;
  summary: { score: number; maxScore: number; accuracyPercent: number; weakTopics: string[] };
};
type PracticeSetSummary = {
  id: string; title: string; courseId: string; topic: string; difficulty: string; published: boolean; questionCount: number;
  course: Course; locked?: boolean;
};
type PracticeSetDetail = PracticeSetSummary & { questions: Array<Question & { courseTopic: { id: string; title: string } | null }> };
type Attempt = {
  id: string; status: string; remainingSeconds: number; timeTakenSeconds: number | null;
  score: number | null; percentage: number | null; passed: boolean | null;
  history: Array<{ id: string; status: string; startedAt: string; submittedAt: string | null; score: number | null; percentage: number | null; passed: boolean | null }>;
  assessment: { title: string; totalMarks: number; passMark: number };
  questions: LearningQuestion[];
};

const questionTypes: QuestionType[] = ['MCQ_SINGLE', 'MCQ_MULTIPLE', 'TRUE_FALSE', 'MATCH', 'FILL_BLANK', 'SHORT_ANSWER'];
const initialQuestion = {
  courseId: '', topicId: '', type: 'MCQ_SINGLE' as QuestionType, prompt: '', options: '["Option A","Option B"]',
  correctAnswer: '"Option A"', topic: 'General', difficulty: 'BEGINNER', marks: '1', explanation: '',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}

function dashboardPath(role?: string) {
  return role === 'ORG_ADMIN' ? '/org-admin' : role === 'TUTOR' ? '/tutor' : '/student';
}

function assessmentReturnTo(state: unknown) {
  if (state && typeof state === 'object' && 'returnTo' in state) {
    const value = (state as { returnTo?: unknown }).returnTo;
    if (typeof value === 'string' && value.startsWith('/student/courses/') && !value.startsWith('//')) return value;
  }
  return '/student/courses';
}

function parseJsonOrText(input: string): unknown {
  try { return JSON.parse(input) as unknown; } catch { return input; }
}

function hasAnswer(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => hasAnswer(item));
  if (value && typeof value === 'object') return Object.values(value).some((item) => hasAnswer(item));
  return value !== null && value !== undefined;
}

function practiceAnswerMatches(question: LearningQuestion, answer: unknown) {
  const normalize = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();
  const expected = question.correctAnswer ?? question.answer;
  if (question.type === 'MATCH' && expected && typeof expected === 'object' && !Array.isArray(expected) && answer && typeof answer === 'object' && !Array.isArray(answer)) {
    const expectedPairs = Object.entries(expected);
    return expectedPairs.length > 0 && expectedPairs.every(([key, value]) => normalize((answer as Record<string, unknown>)[key]) === normalize(value));
  }
  if (question.type === 'FILL_BLANK' || question.type === 'FILL_IN_BLANK') {
    const expectedBlanks = Array.isArray(expected) ? expected : [expected];
    const actualBlanks = Array.isArray(answer) ? answer : [answer];
    return expectedBlanks.length > 0 && expectedBlanks.every((expectedBlank, index) => {
      const accepted = Array.isArray(expectedBlank) ? expectedBlank : [expectedBlank];
      return accepted.some((item) => normalize(item) === normalize(actualBlanks[index]));
    });
  }
  if (question.type === 'MCQ_MULTIPLE') {
    const expectedValues = Array.isArray(expected) ? expected.map(normalize).sort() : [];
    const actualValues = Array.isArray(answer) ? answer.map(normalize).sort() : [];
    return expectedValues.length === actualValues.length && expectedValues.every((value, index) => value === actualValues[index]);
  }
  const acceptedValues = Array.isArray(expected) ? expected : [expected];
  return acceptedValues.some((item) => normalize(item) === normalize(answer));
}

function formatError(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request could not be completed.';
}

function useTeacherCourses() {
  return useQuery({
    queryKey: ['courses', 'learning-teacher'],
    queryFn: () => api<{ courses: Course[] }>('/courses'),
  });
}

function useStudentCourses() {
  return useQuery({
    queryKey: ['student', 'courses', 'learning'],
    queryFn: async () => {
      const response = await api<{ enrollments: Array<{ course: Course }> }>('/student/courses/enrolled');
      return response.enrollments.map(({ course }) => course);
    },
  });
}

export function PracticeQuestionBankPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'TUTOR';
  const base = `${dashboardPath(role)}/learning/questions`;
  const courses = useTeacherCourses();
  const client = useQueryClient();
  const [form, setForm] = useState(initialQuestion);
  const [editingId, setEditingId] = useState('');
  const [showQuestionForm, setShowQuestionForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null);
  const [search, setSearch] = useState('');
  const [filterCourseId, setFilterCourseId] = useState('');
  const [filterTopicId, setFilterTopicId] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [csv, setCsv] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [practiceSetForm, setPracticeSetForm] = useState({ courseId: '', title: '', topic: '', difficulty: 'BEGINNER', questionIds: [] as string[] });
  const [previewSetId, setPreviewSetId] = useState('');
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});
  const [previewChecked, setPreviewChecked] = useState(false);
  const questions = useQuery({
    queryKey: ['learning', 'questions', search, filterCourseId, filterTopicId, filterType, filterDifficulty],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterCourseId) params.set('courseId', filterCourseId);
      if (filterTopicId) params.set('topicId', filterTopicId);
      if (filterType) params.set('type', filterType);
      if (filterDifficulty) params.set('difficulty', filterDifficulty);
      return api<{ questions: Question[] }>(`/learning/teacher/questions${params.size ? `?${params}` : ''}`);
    },
  });
  const filterCourseDetail = useQuery({
    queryKey: ['courses', 'learning-filter', filterCourseId],
    queryFn: () => api<{ course: { topics: Array<{ id: string; title: string }> } }>(`/courses/${filterCourseId}`),
    enabled: Boolean(filterCourseId),
  });
  const formCourseDetail = useQuery({
    queryKey: ['courses', 'learning-form', form.courseId],
    queryFn: () => api<{ course: { topics: Array<{ id: string; title: string }> } }>(`/courses/${form.courseId}`),
    enabled: Boolean(form.courseId),
  });
  const practiceSets = useQuery({
    queryKey: ['learning', 'practice-sets'],
    queryFn: () => api<{ practiceSets: PracticeSetSummary[] }>('/learning/teacher/practice-sets'),
  });
  const setQuestions = useQuery({
    queryKey: ['learning', 'practice-set-questions', practiceSetForm.courseId, practiceSetForm.difficulty],
    queryFn: () => api<{ questions: Question[] }>(`/learning/teacher/questions?courseId=${encodeURIComponent(practiceSetForm.courseId)}&difficulty=${encodeURIComponent(practiceSetForm.difficulty)}`),
    enabled: Boolean(practiceSetForm.courseId),
  });
  const setQuestionOptions = (setQuestions.data?.questions ?? []).filter((question) => question.topic === practiceSetForm.topic);
  const previewSet = useQuery({
    queryKey: ['learning', 'practice-set-preview', previewSetId],
    queryFn: () => api<{ practiceSet: PracticeSetDetail }>(`/learning/teacher/practice-sets/${previewSetId}`),
    enabled: Boolean(previewSetId),
  });
  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        courseId: form.courseId, topicId: form.topicId || null, type: form.type, prompt: form.prompt,
        options: parseJsonOrText(form.options), correctAnswer: parseJsonOrText(form.correctAnswer), topic: form.topic,
        difficulty: form.difficulty, marks: Number(form.marks), explanation: form.explanation || null,
      };
      return editingId
        ? api(`/learning/teacher/questions/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : api('/learning/teacher/questions', { method: 'POST', body: JSON.stringify(payload) });
    },
    onSuccess: async () => {
      setForm(initialQuestion);
      setEditingId('');
      setShowQuestionForm(false);
      setMessage(editingId ? 'Question updated.' : 'Question added.');
      setError('');
      await client.invalidateQueries({ queryKey: ['learning', 'questions'] });
    },
    onError: (reason) => setError(formatError(reason)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/learning/teacher/questions/${id}`, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['learning', 'questions'] }),
    onError: (reason) => setError(formatError(reason)),
  });
  const importCsv = useMutation({
    mutationFn: () => api<{ imported: number; errors: number; results: Array<{ row: number; status: string; message?: string }> }>('/learning/teacher/questions/import', { method: 'POST', body: JSON.stringify({ csv }) }),
    onSuccess: async (result) => {
      setMessage(`${result.imported} row(s) imported; ${result.errors} row(s) need attention.`);
      setError(result.results.filter((row) => row.status === 'error').map((row) => `Row ${row.row}: ${row.message}`).join('\n'));
      await client.invalidateQueries({ queryKey: ['learning', 'questions'] });
    },
    onError: (reason) => setError(formatError(reason)),
  });
  const createSet = useMutation({
    mutationFn: () => api<{ practiceSet: PracticeSetSummary }>('/learning/teacher/practice-sets', {
      method: 'POST',
      body: JSON.stringify({ ...practiceSetForm, published: false }),
    }),
    onSuccess: async () => {
      setPracticeSetForm({ courseId: '', title: '', topic: '', difficulty: 'BEGINNER', questionIds: [] });
      setMessage('Practice set saved as a draft.');
      setError('');
      await client.invalidateQueries({ queryKey: ['learning', 'practice-sets'] });
    },
    onError: (reason) => setError(formatError(reason)),
  });
  const setPublication = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => api(`/learning/teacher/practice-sets/${id}`, {
      method: 'PATCH', body: JSON.stringify({ published }),
    }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['learning', 'practice-sets'] }); },
    onError: (reason) => setError(formatError(reason)),
  });
  const removeSet = useMutation({
    mutationFn: (id: string) => api(`/learning/teacher/practice-sets/${id}`, { method: 'DELETE' }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['learning', 'practice-sets'] }); },
    onError: (reason) => setError(formatError(reason)),
  });
  const startEdit = (question: Question) => {
    setEditingId(question.id);
    setShowQuestionForm(true);
    setForm({
      courseId: question.courseId, topicId: question.topicId ?? '', type: question.type, prompt: question.prompt,
      options: JSON.stringify(question.options), correctAnswer: JSON.stringify(question.correctAnswer),
      topic: question.topic, difficulty: question.difficulty, marks: String(question.marks), explanation: question.explanation ?? '',
    });
  };
  const update = (key: keyof typeof initialQuestion, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return <div className="portal-layout"><PortalSidebar role={role} /><section className="portal-content">
    <PageHeader title="Practice Q/A" backTo={dashboardPath(role)} breadcrumbs={['Learning', 'Question bank']} />
    <p className="muted">Build and maintain a tenant-scoped practice question bank.</p>
    {error && <p className="notice notice-error" role="alert">{error}</p>}{message && <p className="notice">{message}</p>}
    <div className="practice-toolbar">
      <Field label="Search questions"><input className="input" value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
      <Field label="Course"><select className="input" value={filterCourseId} onChange={(event) => { setFilterCourseId(event.target.value); setFilterTopicId(''); }}><option value="">All courses</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code}</option>)}</select></Field>
      <Field label="Topic"><select className="input" value={filterTopicId} onChange={(event) => setFilterTopicId(event.target.value)}><option value="">All topics</option>{filterCourseDetail.data?.course.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></Field>
      <Field label="Difficulty"><select className="input" value={filterDifficulty} onChange={(event) => setFilterDifficulty(event.target.value)}><option value="">All</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Type"><select className="input" value={filterType} onChange={(event) => setFilterType(event.target.value)}><option value="">All</option>{questionTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <div className="practice-toolbar-actions">
        <Button type="button" onClick={() => { setEditingId(''); setForm(initialQuestion); setShowQuestionForm((current) => !current); }}>{showQuestionForm ? 'Close form' : 'Add Practice Q/A'}</Button>
        <Button type="button" variant="secondary" onClick={() => setShowCsvImport((current) => !current)}>{showCsvImport ? 'Close import' : 'Import CSV'}</Button>
      </div>
    </div>
    {showQuestionForm && <div className="card practice-question-form">
      <h2>{editingId ? 'Edit question' : 'Add Practice Q/A'}</h2>
      <div className="form-grid">
        <Field label="Course"><select className="input" value={form.courseId} onChange={(event) => setForm((current) => ({ ...current, courseId: event.target.value, topicId: '' }))}><option value="">Select a course</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></Field>
        <Field label="Course topic"><select className="input" value={form.topicId} onChange={(event) => update('topicId', event.target.value)}><option value="">General / no topic</option>{formCourseDetail.data?.course.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></Field>
        <Field label="Question type"><select className="input" value={form.type} onChange={(event) => update('type', event.target.value)}>{questionTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
        <Field label="Topic"><input className="input" value={form.topic} onChange={(event) => update('topic', event.target.value)} /></Field>
        <Field label="Difficulty"><select className="input" value={form.difficulty} onChange={(event) => update('difficulty', event.target.value)}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((value) => <option key={value}>{value}</option>)}</select></Field>
        <Field label="Marks"><input className="input" type="number" min="1" value={form.marks} onChange={(event) => update('marks', event.target.value)} /></Field>
      </div>
      <Field label="Question"><textarea className="input" value={form.prompt} onChange={(event) => update('prompt', event.target.value)} /></Field>
      <Field label="Options (JSON; use an array of pairs for Match)"><textarea className="input" value={form.options} onChange={(event) => update('options', event.target.value)} /></Field>
      <Field label="Accepted answer (JSON; arrays support multiple accepted answers/blanks)"><textarea className="input" value={form.correctAnswer} onChange={(event) => update('correctAnswer', event.target.value)} /></Field>
      <Field label="Explanation"><textarea className="input" value={form.explanation} onChange={(event) => update('explanation', event.target.value)} /></Field>
      <div className="card"><strong>Preview</strong><p>{form.prompt || 'Your question preview appears here.'}</p><pre>{form.options}</pre></div>
      <div className="button-row"><Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !form.courseId || !form.prompt}>{save.isPending ? 'Saving…' : editingId ? 'Save question' : 'Add question'}</Button>{editingId && <Button type="button" variant="secondary" onClick={() => { setEditingId(''); setForm(initialQuestion); }}>Cancel edit</Button>}</div>
    </div>
    }
    {showCsvImport && <div className="card practice-csv-import">
      <h2>CSV bulk import</h2><p className="muted">CSV supports every question type except MATCH. Encode array/object cells as JSON inside quoted CSV cells.</p>
      <a className="button button-secondary" href="/api/learning/teacher/questions/template.csv">Download template</a>
      <Field label="CSV content"><textarea className="input" value={csv} onChange={(event) => setCsv(event.target.value)} /></Field>
      <Button variant="secondary" disabled={!csv || importCsv.isPending} onClick={() => importCsv.mutate()}>Import CSV</Button>
    </div>}
    {questions.error && <p className="notice notice-error" role="alert">{formatError(questions.error)}</p>}
    <div className="course-list practice-question-list">{questions.data?.questions.map((question) => <article className="card practice-question-card" key={question.id}>
      <div className="practice-question-content"><p className="eyebrow">{question.course.code} · {question.topic} · {question.type} · {question.difficulty}</p><h3>{question.prompt}</h3></div>
      <div className="practice-question-actions"><Button type="button" variant="secondary" onClick={() => setPreviewQuestion(question)}>View</Button><Button type="button" variant="secondary" onClick={() => startEdit(question)}>Edit</Button><Button type="button" variant="secondary" onClick={() => { if (window.confirm('Delete this Practice Q/A?')) remove.mutate(question.id); }}>Delete</Button></div>
    </article>)}</div>
    <section className="practice-sets-section">
      <h2>Practice Sets</h2>
      <p className="muted">Build sets from your question bank, then publish them to enrolled students.</p>
      <div className="card practice-set-builder">
        <h3>Create a practice set</h3>
        <div className="form-grid">
          <Field label="Course"><select className="input" value={practiceSetForm.courseId} onChange={(event) => setPracticeSetForm((current) => ({ ...current, courseId: event.target.value, topic: '', questionIds: [] }))}><option value="">Select a course</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></Field>
          <Field label="Title"><input className="input" value={practiceSetForm.title} onChange={(event) => setPracticeSetForm((current) => ({ ...current, title: event.target.value }))} /></Field>
          <Field label="Difficulty"><select className="input" value={practiceSetForm.difficulty} onChange={(event) => setPracticeSetForm((current) => ({ ...current, difficulty: event.target.value, topic: '', questionIds: [] }))}>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Topic"><select className="input" value={practiceSetForm.topic} onChange={(event) => setPracticeSetForm((current) => ({ ...current, topic: event.target.value, questionIds: [] }))}><option value="">Select a topic</option>{[...new Set((setQuestions.data?.questions ?? []).map((question) => question.topic))].map((topic) => <option key={topic}>{topic}</option>)}</select></Field>
        </div>
        <fieldset className="practice-set-question-picker"><legend>Questions ({setQuestionOptions.length})</legend>{setQuestions.isPending ? <p className="muted">Loading questions…</p> : setQuestionOptions.length ? setQuestionOptions.map((question) => <label key={question.id}><input type="checkbox" checked={practiceSetForm.questionIds.includes(question.id)} onChange={(event) => setPracticeSetForm((current) => ({ ...current, questionIds: event.target.checked ? [...current.questionIds, question.id] : current.questionIds.filter((id) => id !== question.id) }))} /><span>{question.prompt}</span></label>) : <p className="muted">Choose a course, difficulty, and topic with active questions.</p>}</fieldset>
        <Button type="button" disabled={createSet.isPending || !practiceSetForm.courseId || practiceSetForm.title.trim().length < 2 || !practiceSetForm.topic || !practiceSetForm.questionIds.length} onClick={() => createSet.mutate()}>{createSet.isPending ? 'Saving…' : 'Save as draft'}</Button>
      </div>
      {practiceSets.isError && <p className="notice notice-error" role="alert">{formatError(practiceSets.error)}</p>}
      <div className="practice-set-list">{practiceSets.data?.practiceSets.map((set) => <article className="card practice-set-card" key={set.id}>
        <div><p className="eyebrow">{set.course.code} · {set.topic} · {set.difficulty}</p><h3>{set.title}</h3><p className="muted">{set.questionCount} questions · {set.published ? 'Published' : 'Draft'}</p></div>
        <div className="practice-set-actions"><Button type="button" variant="secondary" onClick={() => { setPreviewSetId(set.id); setPreviewChecked(false); setPreviewAnswers({}); }}>View</Button><Button type="button" variant="secondary" disabled={setPublication.isPending} onClick={() => setPublication.mutate({ id: set.id, published: !set.published })}>{set.published ? 'Unpublish' : 'Publish'}</Button><Button type="button" variant="secondary" onClick={() => { if (window.confirm(`Delete practice set "${set.title}"?`)) removeSet.mutate(set.id); }}>Delete</Button></div>
      </article>)}</div>
    </section>
    <Link to={`${base}/assessments`}>Manage assessments</Link>
    {previewQuestion && <div className="viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewQuestion(null); }}><section className="card practice-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="question-preview-title"><PageHeader title="Practice Q/A preview" backTo={`${base}`} breadcrumbs={['Practice Q/A', 'Preview']} onBack={() => setPreviewQuestion(null)} /><p className="eyebrow">{previewQuestion.course.code} · {previewQuestion.topic} · {previewQuestion.difficulty}</p><h2 id="question-preview-title">{previewQuestion.prompt}</h2><pre>{JSON.stringify(previewQuestion.options, null, 2)}</pre><p><strong>Correct answer:</strong> {JSON.stringify(previewQuestion.correctAnswer)}</p><p><strong>Explanation:</strong> {previewQuestion.explanation || 'No explanation provided.'}</p><Button type="button" variant="secondary" onClick={() => setPreviewQuestion(null)}>Close</Button></section></div>}
    {previewSetId && <div className="viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewSetId(''); }}><section className="card practice-preview-dialog practice-set-preview" role="dialog" aria-modal="true" aria-labelledby="practice-set-preview-title"><PageHeader title={previewSet.data?.practiceSet.title ?? 'Practice set preview'} backTo={`${base}`} breadcrumbs={['Practice Sets', 'Preview']} onBack={() => setPreviewSetId('')} /><p className="muted">Preview how this set appears to students. No student attempt is created.</p>{previewSet.isPending && <p className="loading">Loading practice set…</p>}{previewSet.isError && <p className="notice notice-error" role="alert">{formatError(previewSet.error)}</p>}{previewSet.data?.practiceSet.questions.map((question, index) => <article className="practice-preview-question" key={question.id}><p className="eyebrow">Question {index + 1} · {question.type}</p><h3>{question.prompt}</h3><PracticeAnswerInput question={question} value={previewAnswers[question.id]} onChange={(value) => setPreviewAnswers((current) => ({ ...current, [question.id]: value }))} />{previewChecked && <div className={practiceAnswerMatches(question, previewAnswers[question.id]) ? 'notice practice-feedback-correct' : 'notice practice-feedback-incorrect'}><strong>{practiceAnswerMatches(question, previewAnswers[question.id]) ? 'Correct' : 'Review this answer'}</strong><p>Correct answer: {JSON.stringify(question.correctAnswer)}</p><p>{question.explanation || 'No explanation provided.'}</p></div>}</article>)}{previewSet.data?.practiceSet.questions.length ? <Button type="button" disabled={previewChecked && previewSet.data.practiceSet.questions.every((question) => hasAnswer(previewAnswers[question.id]))} onClick={() => setPreviewChecked(true)}>Check answers</Button> : null}<Button type="button" variant="secondary" onClick={() => setPreviewSetId('')}>Close preview</Button></section></div>}
  </section></div>;
}

export function TeacherAssessmentsPage() {
  const { user } = useAuth();
  const role = user?.role ?? 'TUTOR';
  const courses = useTeacherCourses();
  const client = useQueryClient();
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [totalMarks, setTotalMarks] = useState('10');
  const [passMark, setPassMark] = useState('5');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [maxAttempts, setMaxAttempts] = useState('1');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [shuffleQuestions, setShuffleQuestions] = useState(true);
  const [shuffleOptions, setShuffleOptions] = useState(true);
  const [resultReleaseMode, setResultReleaseMode] = useState<'IMMEDIATE' | 'MANUAL'>('IMMEDIATE');
  const [answerReviewAllowed, setAnswerReviewAllowed] = useState(true);
  const [questionsJson, setQuestionsJson] = useState('[{"type":"MCQ_SINGLE","prompt":"Example question?","options":["A","B"],"correctAnswer":"A","topic":"General","difficulty":"BEGINNER","marks":10}]');
  const [selectedBankQuestions, setSelectedBankQuestions] = useState<string[]>([]);
  const [editingAssessmentId, setEditingAssessmentId] = useState('');
  const [originalQuestionIds, setOriginalQuestionIds] = useState<string[]>([]);
  const [previewAssessmentId, setPreviewAssessmentId] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [regradeQuestionId, setRegradeQuestionId] = useState('');
  const [regradeAnswer, setRegradeAnswer] = useState('');
  const [error, setError] = useState('');
  const assessments = useQuery({ queryKey: ['learning', 'assessments'], queryFn: () => api<{ assessments: Assessment[] }>('/learning/teacher/assessments') });
  const bankQuestions = useQuery({
    queryKey: ['learning', 'assessment-bank', courseId],
    queryFn: () => api<{ questions: Question[] }>(`/learning/teacher/questions?courseId=${encodeURIComponent(courseId)}`),
    enabled: Boolean(courseId),
  });
  const results = useQuery({
    queryKey: ['learning', 'assessment-results', selectedId],
    queryFn: () => api<{ assessment: Assessment; summary: Record<string, number>; attempts: Array<{ id: string; student: { name: string; studentProfile: { studentId: string } | null }; score: number | null; passed: boolean | null; flaggedEvents: unknown[] }>; questionAnalysis: Array<{ questionId: string; prompt: string; averagePercent: number }> }>(`/learning/teacher/assessments/${selectedId}/results`),
    enabled: Boolean(selectedId),
  });
  const preview = useQuery({
    queryKey: ['learning', 'assessment-preview', previewAssessmentId],
    queryFn: () => api<{ assessment: AssessmentDetail }>(`/learning/teacher/assessments/${previewAssessmentId}`),
    enabled: Boolean(previewAssessmentId),
  });
  const create = useMutation({
    mutationFn: async () => {
      const questions = JSON.parse(questionsJson) as Array<Record<string, unknown> & { id?: string }>;
      const config = {
        courseId, title, instructions, totalMarks: Number(totalMarks), passMark: Number(passMark), durationMinutes: Number(durationMinutes),
        opensAt: opensAt ? new Date(opensAt).toISOString() : null, closesAt: closesAt ? new Date(closesAt).toISOString() : null,
        maxAttempts: Number(maxAttempts), shuffleQuestions, shuffleOptions, resultReleaseMode, answerReviewAllowed,
      };
      if (!editingAssessmentId) {
        return api('/learning/teacher/assessments', {
          method: 'POST',
          body: JSON.stringify({
            ...config,
            questions: [
              ...questions,
              ...(bankQuestions.data?.questions.filter((question) => selectedBankQuestions.includes(question.id)).map((question) => ({
                sourceQuestionId: question.id, type: question.type, prompt: question.prompt, options: question.options,
                correctAnswer: question.correctAnswer, topic: question.topic, topicId: question.topicId,
                difficulty: question.difficulty, marks: question.marks, explanation: question.explanation,
              })) ?? []),
            ],
          }),
        });
      }
      await api(`/learning/teacher/assessments/${editingAssessmentId}`, { method: 'PATCH', body: JSON.stringify({ ...config, courseId: undefined }) });
      const existingIds = new Set(questions.filter((question) => question.id).map((question) => question.id!));
      const desiredOrder: string[] = [];
      for (const question of questions) {
        const { id, ...fields } = question;
        if (id) {
          await api(`/learning/teacher/assessments/${editingAssessmentId}/questions/${id}`, { method: 'PATCH', body: JSON.stringify(fields) });
          desiredOrder.push(id);
        } else {
          const created = await api<{ question: { id: string } }>(`/learning/teacher/assessments/${editingAssessmentId}/questions`, { method: 'POST', body: JSON.stringify(fields) });
          desiredOrder.push(created.question.id);
        }
      }
      for (const id of originalQuestionIds) {
        if (!existingIds.has(id)) await api(`/learning/teacher/assessments/${editingAssessmentId}/questions/${id}`, { method: 'DELETE' });
      }
      if (desiredOrder.length) await api(`/learning/teacher/assessments/${editingAssessmentId}/questions/reorder`, { method: 'PATCH', body: JSON.stringify({ questionIds: desiredOrder }) });
      return undefined;
    },
    onSuccess: async () => {
      setTitle(''); setEditingAssessmentId(''); setOriginalQuestionIds([]); setError('');
      await client.invalidateQueries({ queryKey: ['learning', 'assessments'] });
    },
    onError: (reason) => setError(formatError(reason)),
  });
  const editDraft = async (id: string) => {
    try {
      const { assessment } = await api<{ assessment: AssessmentDetail }>(`/learning/teacher/assessments/${id}`);
      setEditingAssessmentId(id);
      setOriginalQuestionIds(assessment.questions.map(({ id: questionId }) => questionId));
      setCourseId(assessment.course.id); setTitle(assessment.title); setInstructions(assessment.instructions);
      setTotalMarks(String(assessment.totalMarks)); setPassMark(String(assessment.passMark)); setDurationMinutes(String(assessment.durationMinutes));
      setMaxAttempts(String(assessment.maxAttempts)); setOpensAt(assessment.opensAt?.slice(0, 16) ?? ''); setClosesAt(assessment.closesAt?.slice(0, 16) ?? '');
      setResultReleaseMode(assessment.resultReleaseMode); setShuffleQuestions(assessment.shuffleQuestions); setShuffleOptions(assessment.shuffleOptions);
      setAnswerReviewAllowed(assessment.answerReviewAllowed); setQuestionsJson(JSON.stringify(assessment.questions, null, 2));
    } catch (reason) {
      setError(formatError(reason));
    }
  };
  const action = useMutation({
    mutationFn: ({ id, operation }: { id: string; operation: 'publish' | 'duplicate' | 'release' | 'close' | 'reopen' }) => api(`/learning/teacher/assessments/${id}/${operation === 'release' ? 'results/release' : operation}`, { method: 'POST' }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ['learning', 'assessments'] }); if (selectedId) await client.invalidateQueries({ queryKey: ['learning', 'assessment-results', selectedId] }); },
    onError: (reason) => setError(formatError(reason)),
  });
  return <div className="portal-layout"><PortalSidebar role={role} /><section className="portal-content">
    <PageHeader title="Assessments" backTo={dashboardPath(role)} breadcrumbs={['Learning', 'Assessments']} />
    <p className="muted">Create draft assessments, publish an immutable question snapshot, and review student results.</p>
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    <div className="card"><h2>{editingAssessmentId ? 'Edit draft assessment' : 'Create Your Own Assessment'}</h2><div className="form-grid">
      <Field label="Course"><select className="input" value={courseId} onChange={(event) => { setCourseId(event.target.value); setSelectedBankQuestions([]); }}><option value="">Select a course</option>{courses.data?.courses.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></Field>
      <Field label="Title"><input className="input" value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
      <Field label="Total marks"><input className="input" type="number" value={totalMarks} onChange={(event) => setTotalMarks(event.target.value)} /></Field>
      <Field label="Pass mark"><input className="input" type="number" value={passMark} onChange={(event) => setPassMark(event.target.value)} /></Field>
      <Field label="Duration in minutes"><input className="input" type="number" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></Field>
      <Field label="Maximum attempts"><input className="input" type="number" min="1" max="20" value={maxAttempts} onChange={(event) => setMaxAttempts(event.target.value)} /></Field>
      <Field label="Opens at"><input className="input" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} /></Field>
      <Field label="Closes at"><input className="input" type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} /></Field>
      <Field label="Result release"><select className="input" value={resultReleaseMode} onChange={(event) => setResultReleaseMode(event.target.value as 'IMMEDIATE' | 'MANUAL')}><option value="IMMEDIATE">Immediate</option><option value="MANUAL">Manual</option></select></Field>
    </div>    <Field label="Write your questions (JSON array; all question types are supported, and the question bank is optional)"><textarea className="input" value={questionsJson} onChange={(event) => setQuestionsJson(event.target.value)} /></Field>
      <Field label="Instructions"><textarea className="input" value={instructions} onChange={(event) => setInstructions(event.target.value)} /></Field>
      <label className="checkbox-field"><input type="checkbox" checked={shuffleQuestions} onChange={(event) => setShuffleQuestions(event.target.checked)} /> Shuffle questions per attempt</label>
      <label className="checkbox-field"><input type="checkbox" checked={shuffleOptions} onChange={(event) => setShuffleOptions(event.target.checked)} /> Shuffle options per attempt</label>
      <label className="checkbox-field"><input type="checkbox" checked={answerReviewAllowed} onChange={(event) => setAnswerReviewAllowed(event.target.checked)} /> Allow answer review after results release</label>
      {bankQuestions.data?.questions.length ? <div><h3>Pick questions from the bank</h3>{bankQuestions.data.questions.map((question) => <label className="checkbox-field" key={question.id}><input type="checkbox" checked={selectedBankQuestions.includes(question.id)} onChange={(event) => setSelectedBankQuestions((current) => event.target.checked ? [...current, question.id] : current.filter((id) => id !== question.id))} />{question.prompt} · {question.marks} mark(s)</label>)}</div> : null}
      <Button disabled={!title || !courseId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : editingAssessmentId ? 'Save draft changes' : 'Create Your Own Assessment'}</Button>
      {editingAssessmentId && <Button variant="secondary" onClick={() => { setEditingAssessmentId(''); setOriginalQuestionIds([]); }}>Cancel edit</Button>}
    </div>
    {assessments.data?.assessments.map((assessment) => <article className="card" key={assessment.id}>
      <p className="eyebrow">{assessment.course.code} · {assessment.status}</p><h2>{assessment.title}</h2><p>{assessment.totalMarks} marks · {assessment.durationMinutes} minutes</p>
      <div className="button-row">{assessment.status === 'DRAFT' && <Button onClick={() => action.mutate({ id: assessment.id, operation: 'publish' })}>Publish</Button>}
        {assessment.status === 'DRAFT' && <Button variant="secondary" onClick={() => void editDraft(assessment.id)}>Edit draft</Button>}
        {assessment.status === 'PUBLISHED' && <Button variant="secondary" onClick={() => action.mutate({ id: assessment.id, operation: 'close' })}>Close assessment</Button>}
        {assessment.status === 'CLOSED' && <Button variant="secondary" onClick={() => action.mutate({ id: assessment.id, operation: 'reopen' })}>Reopen assessment</Button>}
        <Button variant="secondary" onClick={() => action.mutate({ id: assessment.id, operation: 'duplicate' })}>Duplicate as new draft</Button>
        <Button variant="secondary" onClick={() => setPreviewAssessmentId(assessment.id)}>Preview as student</Button>
        <Button variant="secondary" onClick={() => setSelectedId(assessment.id)}>View results</Button>
        {assessment.resultReleaseMode === 'MANUAL' && <Button variant="secondary" onClick={() => action.mutate({ id: assessment.id, operation: 'release' })}>Release results</Button>}
      </div>
    </article>)}
    {preview.data && <div className="card"><h2>Preview mode: {preview.data.assessment.title}</h2><p>This is a read-only student preview. No attempt is created or saved.</p>
      {preview.data.assessment.questions.map((question, index) => <article className="card" key={question.id}><h3>{index + 1}. {String(question.prompt)}</h3><p>{String(question.type)} · {String(question.marks)} marks</p>
        {Array.isArray(question.options) && <ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{typeof option === 'string' ? option : JSON.stringify(option)}</li>)}</ul>}
      </article>)}
      <Button variant="secondary" onClick={() => setPreviewAssessmentId('')}>Close preview</Button>
    </div>}
    {results.data && <div className="card"><h2>Results: {results.data.assessment.title}</h2><p>Attempts {results.data.summary.attempts} · Average {Number(results.data.summary.average ?? 0).toFixed(1)} · Pass rate {Number(results.data.summary.passRate ?? 0).toFixed(1)}%</p>
      <a className="button button-secondary" href={`/api/learning/teacher/assessments/${selectedId}/results.csv`}>Export results CSV</a>
      <div className="course-list">{results.data.attempts.map((attempt) => <p key={attempt.id}>{attempt.student.name} ({attempt.student.studentProfile?.studentId ?? '—'}) · {attempt.score ?? '—'} · {attempt.passed ? 'Pass' : 'Not passed'} · {attempt.flaggedEvents.length ? 'Flagged' : ''}</p>)}</div>
      <h3>Question analysis and regrade</h3>{results.data.questionAnalysis.map((item) => <div key={item.questionId}><p>{item.prompt}: {item.averagePercent.toFixed(1)}% average</p>
        <div className="button-row"><Button variant="secondary" onClick={() => setRegradeQuestionId(item.questionId)}>Regrade this question</Button>
          {regradeQuestionId === item.questionId && <><input className="input" aria-label="New correct answer (JSON)" value={regradeAnswer} onChange={(event) => setRegradeAnswer(event.target.value)} /><Button onClick={() => {
            void api(`/learning/teacher/assessments/${selectedId}/results/regrade`, { method: 'POST', body: JSON.stringify({ questionId: item.questionId, correctAnswer: parseJsonOrText(regradeAnswer) }) })
              .then(() => results.refetch()).catch((reason: unknown) => setError(formatError(reason)));
          }}>Apply audited regrade</Button></>}
        </div></div>)}
    </div>}
  </section></div>;
}

export function StudentPracticePage({ embeddedCourseId }: { embeddedCourseId?: string } = {}) {
  const { user } = useAuth();
  const courses = useStudentCourses();
  const [courseId, setCourseId] = useState(embeddedCourseId ?? '');
  const [topicId, setTopicId] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [count, setCount] = useState('10');
  const [timeLimitMinutes, setTimeLimitMinutes] = useState('');
  const [answer, setAnswer] = useState<unknown>('');
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [practiceSeconds, setPracticeSeconds] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const courseDetails = useQuery({
    queryKey: ['student', 'course', 'practice-topics', courseId],
    queryFn: () => api<{ course: { topics: Array<{ id: string; title: string }> } }>(`/student/courses/${courseId}`),
    enabled: Boolean(courseId),
  });
  const history = useQuery({ queryKey: ['learning', 'practice-history', embeddedCourseId], queryFn: () => api<{ sessions: Array<{ id: string; course: Course; practiceSet: { title: string } | null; score: number; totalQuestions: number; answeredCount: number; createdAt: string }> }>(`/learning/student/practice/history${embeddedCourseId ? `?courseId=${encodeURIComponent(embeddedCourseId)}` : ''}`) });
  const practiceSets = useQuery({
    queryKey: ['learning', 'student-practice-sets', embeddedCourseId],
    queryFn: () => api<{ practiceSets: PracticeSetSummary[] }>(`/learning/student/practice-sets${embeddedCourseId ? `?courseId=${encodeURIComponent(embeddedCourseId)}` : ''}`),
  });
  const handleStart = (next: PracticeSession) => { setSession(next); setPracticeSeconds(next.remainingSeconds); setAnswer(''); setFeedback(''); setError(''); };
  const start = useMutation({
    mutationFn: () => api<PracticeSession>('/learning/student/practice/start', { method: 'POST', body: JSON.stringify({
      courseId, count: Number(count), ...(topicId ? { topicId } : {}), ...(difficulty ? { difficulty } : {}),
      ...(timeLimitMinutes ? { timeLimitSeconds: Number(timeLimitMinutes) * 60 } : {}),
    }) }),
    onSuccess: handleStart,
    onError: (reason) => setError(formatError(reason)),
  });
  const startSet = useMutation({
    mutationFn: (id: string) => api<PracticeSession>(`/learning/student/practice-sets/${id}/start`, { method: 'POST' }),
    onSuccess: handleStart,
    onError: (reason) => setError(formatError(reason)),
  });
  const submit = useMutation({
    mutationFn: () => api<{ isCorrect: boolean; correctAnswer: unknown; explanation: string | null; next: PracticeSession }>(`/learning/student/practice-sessions/${session!.session.id}/answers`, {
      method: 'POST', body: JSON.stringify({ questionId: session!.question!.id, answer }),
    }),
    onSuccess: async (result) => {
      setFeedback(`${result.isCorrect ? 'Correct.' : 'Not quite.'} Answer: ${JSON.stringify(result.correctAnswer)}${result.explanation ? ` — ${result.explanation}` : ''}`);
      setSession(result.next); setPracticeSeconds(result.next.remainingSeconds); setAnswer('');
      await history.refetch();
    },
    onError: (reason) => setError(formatError(reason)),
  });
  useEffect(() => {
    if (practiceSeconds === null || practiceSeconds <= 0 || !session || session.session.status !== 'IN_PROGRESS') return;
    const timer = window.setInterval(() => setPracticeSeconds((value) => value === null ? null : Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [practiceSeconds, session, session?.session.id, session?.session.status]);
  useEffect(() => {
    if (practiceSeconds !== 0 || !session || session.session.status !== 'IN_PROGRESS') return;
    void api<PracticeSession>(`/learning/student/practice-sessions/${session.session.id}`)
      .then((next) => { setSession(next); setPracticeSeconds(next.remainingSeconds); })
      .catch((reason: unknown) => setError(formatError(reason)));
  }, [practiceSeconds, session, session?.session.id, session?.session.status]);
  const content = <section className="portal-content">
    {!embeddedCourseId && <PageHeader title="Practice Q/A" backTo="/student/courses" breadcrumbs={['My Course', 'Practice Q/A']} />}
    {error && <p className="notice notice-error" role="alert">{error}</p>}
    {!session && <>
      <section className="practice-sets-section"><h2>Published Practice Sets</h2>{practiceSets.isError && <p className="notice notice-error" role="alert">{formatError(practiceSets.error)}</p>}<div className="practice-set-list">{practiceSets.data?.practiceSets.map((set) => <article className="card practice-set-card" key={set.id}><div><p className="eyebrow">{set.course.code} · {set.topic} · {set.difficulty}</p><h3>{set.title}</h3><p className="muted">{set.questionCount} questions</p></div>{set.locked ? <Link className="button" to="/student/payments">Pay My Fee</Link> : <Button type="button" disabled={startSet.isPending} onClick={() => startSet.mutate(set.id)}>{startSet.isPending ? 'Starting…' : 'Start set'}</Button>}</article>)}</div>{practiceSets.data && !practiceSets.data.practiceSets.length && <p className="empty-state card">No published sets are available for this course yet.</p>}</section>
      <div className="card"><h2>Random practice</h2><div className="form-grid">
      {!embeddedCourseId && <Field label="Enrolled course"><select className="input" value={courseId} onChange={(event) => setCourseId(event.target.value)}><option value="">Select a course</option>{courses.data?.map((course) => <option key={course.id} value={course.id}>{course.code} — {course.title}</option>)}</select></Field>}
      <Field label="Topic"><select className="input" value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="">All topics</option>{courseDetails.data?.course.topics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></Field>
      <Field label="Difficulty"><select className="input" value={difficulty} onChange={(event) => setDifficulty(event.target.value)}><option value="">All levels</option>{['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Number of questions"><input className="input" type="number" min="1" max="50" value={count} onChange={(event) => setCount(event.target.value)} /></Field>
      <Field label="Optional timer (minutes)"><input className="input" type="number" min="1" max="120" value={timeLimitMinutes} onChange={(event) => setTimeLimitMinutes(event.target.value)} placeholder="No limit" /></Field>
    </div><Button disabled={!courseId || start.isPending} onClick={() => start.mutate()}>Start random practice</Button></div>
    </>}
    {session && <div className="card practice-session-card"><p className="eyebrow">{session.session.practiceSet?.title ?? 'Random practice'} · Question {session.session.answeredCount + (session.question ? 1 : 0)} of {session.session.totalQuestions}{practiceSeconds !== null ? ` · ${Math.floor(practiceSeconds / 60)}:${String(practiceSeconds % 60).padStart(2, '0')} remaining` : ''}</p>
      {session.question ? <><h2>{session.question.prompt}</h2>
        <PracticeAnswerInput question={session.question} value={answer} onChange={setAnswer} />
        {feedback && <p className="notice">{feedback}</p>}<Button disabled={!hasAnswer(answer) || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Checking…' : 'Check answer'}</Button>
      </> : <><h2>Practice complete</h2>{feedback && <p className="notice">{feedback}</p>}<p>Your score: {session.summary.score}/{session.summary.maxScore} · Accuracy {session.summary.accuracyPercent}%</p>
        <p>Topics to review: {session.summary.weakTopics.length ? session.summary.weakTopics.join(', ') : 'None identified yet.'}</p>
        <Button onClick={() => setSession(null)}>Start another practice</Button></>}
    </div>}
    <div className="card practice-history"><h2>Practice history</h2>{history.data?.sessions.map((item) => <p key={item.id}>{item.practiceSet?.title ?? 'Random practice'} · {item.course.code} · {item.answeredCount}/{item.totalQuestions} questions · {item.score} points</p>)}</div>
  </section>;
  return embeddedCourseId ? content : <div className="portal-layout"><PortalSidebar role={user?.role ?? 'STUDENT'} />{content}</div>;
}

export function StudentAssessmentsPage({ embeddedCourseId }: { embeddedCourseId?: string } = {}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'UPCOMING' | 'OPEN' | 'COMPLETED'>('OPEN');
  const query = useQuery({ queryKey: ['learning', 'student-assessments', embeddedCourseId], queryFn: () => api<{ assessments: Assessment[] }>(`/learning/student/assessments${embeddedCourseId ? `?courseId=${encodeURIComponent(embeddedCourseId)}` : ''}`) });
  const start = useMutation({
    mutationFn: (id: string) => api<{ attempt: Attempt }>(`/learning/student/assessments/${id}/attempts`, { method: 'POST' }),
    onSuccess: ({ attempt }) => navigate(`/student/assessment/${attempt.id}`, {
      state: { returnTo: embeddedCourseId ? `/student/courses/${embeddedCourseId}/assessments` : '/student/courses' },
    }),
  });
  const assessments = query.data?.assessments.filter((item) => {
    if (tab === 'UPCOMING') return item.availability === 'UPCOMING';
    if (tab === 'OPEN') return item.availability === 'OPEN' && (item.attempts?.filter((attempt) => attempt.status !== 'IN_PROGRESS').length ?? 0) < item.maxAttempts;
    return item.attempts?.some((attempt) => attempt.status !== 'IN_PROGRESS');
  }) ?? [];
  const content = <section className="portal-content">
    {!embeddedCourseId && <PageHeader title="My Assessment" backTo="/student/courses" breadcrumbs={['My Course', 'Assessments']} />}
    <div className="button-row">{(['UPCOMING', 'OPEN', 'COMPLETED'] as const).map((value) => <Button key={value} variant={tab === value ? 'primary' : 'secondary'} onClick={() => setTab(value)}>{value[0] + value.slice(1).toLowerCase()}</Button>)}</div>
    {query.error && <p className="notice notice-error" role="alert">{formatError(query.error)}</p>}
    {assessments.map((assessment) => <article className="card" key={assessment.id}><p className="eyebrow">{assessment.course.code} · {assessment.availability}</p><h2>{assessment.title}</h2>
      <p>{assessment.totalMarks} marks · {assessment.durationMinutes} minutes · Attempts {assessment.attempts?.length ?? 0}/{assessment.maxAttempts}</p>
      {assessment.attempts?.filter((attempt) => attempt.status !== 'IN_PROGRESS').map((attempt) => <p key={attempt.id}>Score: {attempt.score ?? 'Results pending'} {attempt.submittedAt && <Link to={`/student/assessment/${attempt.id}/result`} state={{ returnTo: embeddedCourseId ? `/student/courses/${embeddedCourseId}/assessments` : '/student/courses' }}>View result</Link>} {attempt.passed && <Link className="button button-secondary" to="/student/certificates">Collect certificate</Link>}</p>)}
      {assessment.locked ? <Link className="button" to="/student/payments">Pay My Fee</Link> : assessment.availability === 'OPEN' && <Button disabled={start.isPending} onClick={() => start.mutate(assessment.id)}>Start / resume assessment</Button>}
    </article>)}
    {assessments.length === 0 && query.data && <div className="card empty-state"><h2>No assessments in this course</h2><p>Published assessments and results for this course will appear here.</p></div>}
  </section>;
  return embeddedCourseId ? content : <div className="portal-layout"><PortalSidebar role={user?.role ?? 'STUDENT'} />{content}</div>;
}

export function StudentAssessmentAttemptPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = assessmentReturnTo(location.state);
  const queryClient = useQueryClient();
  const expiresAt = useRef<number | null>(null);
  const [seconds, setSeconds] = useState(0);
  const query = useQuery({ queryKey: ['learning', 'attempt', attemptId], queryFn: () => api<{ attempt: Attempt }>(`/learning/student/attempts/${attemptId}`), enabled: Boolean(attemptId) });
  const attempt = query.data?.attempt;
  const attemptStatus = attempt?.status;
  const attemptRemainingSeconds = attempt?.remainingSeconds;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: ({ questionId, answer }: { questionId: string; answer: string }) => api(`/learning/student/attempts/${attemptId}/answers`, { method: 'PUT', body: JSON.stringify({ questionId, answer: parseJsonOrText(answer) }) }),
  });
  const submit = useMutation({
    mutationFn: () => api(`/learning/student/attempts/${attemptId}/submit`, { method: 'POST' }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['learning', 'attempt', attemptId] }); navigate(`/student/assessment/${attemptId}/result`, { replace: true, state: { returnTo } }); },
  });
  useEffect(() => {
    if (attemptRemainingSeconds === undefined) return;
    setSeconds(attemptRemainingSeconds);
    expiresAt.current = Date.now() + attemptRemainingSeconds * 1000;
  }, [attempt?.id, attemptRemainingSeconds]);
  const submitAttemptMutation = submit.mutate;
  useEffect(() => {
    if (attemptStatus !== 'IN_PROGRESS') return;
    const timer = window.setInterval(() => {
      setSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [attemptStatus, attemptId, submitAttemptMutation]);
  useEffect(() => {
    if (attemptStatus === 'IN_PROGRESS' && seconds === 0 && expiresAt.current !== null && Date.now() >= expiresAt.current) {
      submitAttemptMutation();
    }
  }, [attemptStatus, seconds, submitAttemptMutation]);
  useEffect(() => {
    const events = ['copy', 'paste', 'contextmenu'] as const;
    const logEvent = (event: Event) => {
      const eventType = event.type === 'contextmenu' ? 'CONTEXT_MENU' : event.type.toUpperCase();
      void api(`/learning/student/attempts/${attemptId}/events`, { method: 'POST', body: JSON.stringify({ eventType }) });
    };
    const logVisibility = () => { if (document.hidden) void api(`/learning/student/attempts/${attemptId}/events`, { method: 'POST', body: JSON.stringify({ eventType: 'TAB_SWITCH' }) }); };
    events.forEach((name) => document.addEventListener(name, logEvent));
    document.addEventListener('visibilitychange', logVisibility);
    return () => { events.forEach((name) => document.removeEventListener(name, logEvent)); document.removeEventListener('visibilitychange', logVisibility); };
  }, [attemptId]);
  const formattedTime = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  if (query.error) return <section className="portal-content"><PageHeader title="Assessment unavailable" backTo={returnTo} /><p className="notice notice-error">{formatError(query.error)}</p></section>;
  return <div className="portal-layout"><PortalSidebar role="STUDENT" /><section className="portal-content">
    <PageHeader title={attempt?.assessment.title ?? 'Assessment'} backTo={returnTo} hasUnsavedChanges={attempt?.status === 'IN_PROGRESS'} breadcrumbs={['My Course', 'Assessments', 'In progress']} />
    {attempt && <><p className="eyebrow">Server timer · {formattedTime} remaining · {attempt.assessment.totalMarks} marks</p>
      {attempt.status === 'IN_PROGRESS' ? attempt.questions.map((question, index) => <article className="card" key={question.id}>
        <p className="eyebrow">Question {index + 1} · {question.marks} marks</p><h2>{question.prompt}</h2>
        {Array.isArray(question.options) && <ul>{question.options.map((option, optionIndex) => <li key={optionIndex}>{typeof option === 'string' ? option : JSON.stringify(option)}</li>)}</ul>}
        <Field label="Your answer"><textarea className="input" value={answers[question.id] ?? (question.answer == null ? '' : JSON.stringify(question.answer))} onChange={(event) => {
          const value = event.target.value; setAnswers((current) => ({ ...current, [question.id]: value })); save.mutate({ questionId: question.id, answer: value });
        }} /></Field>
      </article>) : <p>This attempt has been submitted.</p>}
      {attempt.status === 'IN_PROGRESS' && <Button disabled={submit.isPending} onClick={() => { if (window.confirm('Submit this assessment now?')) submit.mutate(); }}>Submit assessment</Button>}
    </>}
  </section></div>;
}

export function StudentAssessmentResultPage() {
  const { attemptId = '' } = useParams();
  const location = useLocation();
  const returnTo = assessmentReturnTo(location.state);
  const query = useQuery({ queryKey: ['learning', 'result', attemptId], queryFn: () => api<{ result: Attempt }>(`/learning/student/attempts/${attemptId}/result`) });
  const result = query.data?.result;
  return <div className="portal-layout"><PortalSidebar role="STUDENT" /><section className="portal-content">
    <PageHeader title="Assessment result" backTo={returnTo} breadcrumbs={['My Course', 'Assessments', 'Result']} />
    {query.error && <p className="notice notice-error" role="alert">{formatError(query.error)}</p>}
    {result && <div className="card"><h2>{result.assessment.title}</h2><p>{result.score}/{result.assessment.totalMarks} · {result.percentage?.toFixed(1)}% · {result.passed ? 'Passed' : 'Not passed'}</p>
      <p>Time taken: {result.timeTakenSeconds ?? '—'} seconds</p>
      <h3>Attempt history</h3>{result.history.map((item) => <p key={item.id}>{new Date(item.startedAt).toLocaleString()} · {item.status} · {item.score ?? 'Results pending'}</p>)}
      {result.questions.map((question, index) => <article key={question.id}><h3>{index + 1}. {question.prompt}</h3><p>Your answer: {JSON.stringify(question.answer)}</p>
        {question.correctAnswer !== undefined && <p>Correct answer: {JSON.stringify(question.correctAnswer)}</p>}
        {question.explanation && <p>{question.explanation}</p>}
      </article>)}
    </div>}
  </section></div>;
}
