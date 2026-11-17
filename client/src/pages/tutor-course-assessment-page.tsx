import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import { ApiError, api } from '../lib/api';

type Course = { id: string; code: string; title: string };
type Difficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
type DraftQuestion = {
  prompt: string;
  options: string[];
  correctIndex: number;
  topic: string;
  difficulty: Difficulty;
  marks: number;
  explanation: string;
};
type GeneratedQuestion = Omit<DraftQuestion, 'correctIndex'> & { correctAnswer: string };
type CreatedAssessment = { id: string; title: string };

const blankQuestion = (): DraftQuestion => ({
  prompt: '',
  options: ['', '', '', ''],
  correctIndex: 0,
  topic: '',
  difficulty: 'BEGINNER',
  marks: 1,
  explanation: '',
});

function errorText(error: unknown) {
  return error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'The request could not be completed.';
}

export function TutorCourseAssessmentPage() {
  const { courseId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const courseQuery = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api<{ course: Course }>(`/courses/${encodeURIComponent(courseId)}`),
    enabled: Boolean(courseId),
  });
  const requestedMode = searchParams.get('mode');
  const [mode, setMode] = useState<'choose' | 'manual' | 'ai'>(
    requestedMode === 'manual' || requestedMode === 'ai' ? requestedMode : 'choose',
  );
  const [title, setTitle] = useState('');
  const [instructions, setInstructions] = useState('');
  const [passMark, setPassMark] = useState('1');
  const [durationMinutes, setDurationMinutes] = useState('30');
  const [questions, setQuestions] = useState<DraftQuestion[]>([blankQuestion()]);
  const [topic, setTopic] = useState('');
  const [questionCount, setQuestionCount] = useState('5');
  const [difficulty, setDifficulty] = useState<Difficulty>('BEGINNER');
  const [marksPerQuestion, setMarksPerQuestion] = useState('1');
  const [createdAssessment, setCreatedAssessment] = useState<CreatedAssessment | null>(null);
  const totalMarks = useMemo(() => questions.reduce((total, question) => total + question.marks, 0), [questions]);

  const generate = useMutation({
    mutationFn: () => api<{ questions: GeneratedQuestion[] }>('/learning/teacher/assessments/generate-questions', {
      method: 'POST',
      body: JSON.stringify({
        courseId,
        topic: topic.trim(),
        count: Number(questionCount),
        difficulty,
        marksPerQuestion: Number(marksPerQuestion),
      }),
    }),
    onSuccess: ({ questions: generated }) => {
      setQuestions(generated.map((question) => ({
        ...question,
        correctIndex: Math.max(0, question.options.indexOf(question.correctAnswer)),
      })));
      setTitle((current) => current.trim() || `${topic.trim()} assessment`);
      setPassMark(String(Math.max(1, Math.ceil(generated.reduce((sum, question) => sum + question.marks, 0) * 0.6))));
    },
  });
  const create = useMutation({
    mutationFn: () => {
      const cleanQuestions = questions.map((question) => ({
        type: 'MCQ_SINGLE',
        prompt: question.prompt.trim(),
        options: question.options.map((option) => option.trim()),
        correctAnswer: question.options[question.correctIndex]?.trim() ?? '',
        topic: question.topic.trim(),
        difficulty: question.difficulty,
        marks: question.marks,
        explanation: question.explanation.trim(),
      }));
      const marks = cleanQuestions.reduce((total, question) => total + question.marks, 0);
      return api<{ assessment: CreatedAssessment }>('/learning/teacher/assessments', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          title: title.trim(),
          instructions: instructions.trim(),
          totalMarks: marks,
          passMark: Number(passMark),
          durationMinutes: Number(durationMinutes),
          questions: cleanQuestions,
        }),
      });
    },
    onSuccess: ({ assessment }) => setCreatedAssessment(assessment),
  });
  const publish = useMutation({
    mutationFn: () => {
      if (!createdAssessment) throw new Error('Create an assessment first.');
      return api(`/learning/teacher/assessments/${encodeURIComponent(createdAssessment.id)}/publish`, { method: 'POST' });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['learning', 'course-assessment-reports', courseId] });
      navigate(`/tutor/courses/${encodeURIComponent(courseId)}`);
    },
  });

  function updateQuestion(index: number, patch: Partial<DraftQuestion>) {
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === index ? { ...question, ...patch } : question));
  }

  function updateOption(questionIndex: number, optionIndex: number, value: string) {
    setQuestions((current) => current.map((question, itemIndex) => itemIndex === questionIndex
      ? { ...question, options: question.options.map((option, index) => index === optionIndex ? value : option) }
      : question));
  }

  const course = courseQuery.data?.course;
  return <div className="portal-layout">
    <PortalSidebar role="TUTOR" />
    <section className="portal-content">
      <PageHeader title="Create assessment" backTo={course ? `/tutor/courses/${encodeURIComponent(course.id)}` : '/tutor/courses'} breadcrumbs={['My Course', course?.code ?? 'Assessment']} />
      {courseQuery.isPending && <p className="loading" role="status">Loading course…</p>}
      {courseQuery.isError && <p className="notice notice-error" role="alert">{errorText(courseQuery.error)}</p>}
      {course && <>
        <p className="muted">{course.code} — {course.title}</p>
        {mode === 'choose' && <section className="card">
          <h2>Generate New Assessment</h2>
          <p>Choose how you want to prepare the course assessment.</p>
          <div className="button-row">
            <Button onClick={() => setMode('manual')}>Create My Own</Button>
            <Button variant="secondary" onClick={() => setMode('ai')}>Generate by AI</Button>
          </div>
        </section>}
        {mode === 'ai' && <section className="card form-grid">
          <h2 className="form-grid-span">Generate questions by AI</h2>
          <p className="muted form-grid-span">Questions are generated for this course only. Review and edit every question before saving.</p>
          <label className="field"><span>Topic</span><input className="input" value={topic} maxLength={120} required onChange={(event) => setTopic(event.target.value)} /></label>
          <label className="field"><span>Number of questions</span><input className="input" type="number" min={1} max={25} value={questionCount} onChange={(event) => setQuestionCount(event.target.value)} /></label>
          <label className="field"><span>Difficulty</span><select className="input" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}><option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option></select></label>
          <label className="field"><span>Marks per question</span><input className="input" type="number" min={1} max={100} value={marksPerQuestion} onChange={(event) => setMarksPerQuestion(event.target.value)} /></label>
          <div className="form-grid-span button-row">
            <Button disabled={generate.isPending || !topic.trim()} onClick={() => generate.mutate()}>{generate.isPending ? 'Generating…' : 'Generate questions'}</Button>
            <Button variant="secondary" onClick={() => setMode('choose')}>Back</Button>
          </div>
          {generate.isError && <p className="notice notice-error form-grid-span" role="alert">{errorText(generate.error)}</p>}
          {generate.isSuccess && <p className="notice notice-success form-grid-span" role="status">Questions generated. Review and edit them below before saving.</p>}
        </section>}
        {mode !== 'choose' && questions.length > 0 && <form className="course-assessment-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <section className="card form-grid">
            <h2 className="form-grid-span">{mode === 'ai' ? 'Review assessment' : 'Assessment details'}</h2>
            <label className="field"><span>Assessment title</span><input className="input" required minLength={2} maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="field"><span>Duration (minutes)</span><input className="input" type="number" min={1} max={1440} required value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.value)} /></label>
            <label className="field"><span>Pass mark (of {totalMarks})</span><input className="input" type="number" min={0} max={totalMarks} required value={passMark} onChange={(event) => setPassMark(event.target.value)} /></label>
            <label className="field form-grid-span"><span>Instructions (optional)</span><textarea className="input" maxLength={5000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          </section>
          {questions.map((question, index) => <section className="card form-grid" key={index}>
            <div className="list-heading form-grid-span"><h2>Question {index + 1}</h2>{questions.length > 1 && <Button type="button" variant="danger" onClick={() => setQuestions((current) => current.filter((_item, itemIndex) => itemIndex !== index))}>Remove</Button>}</div>
            <label className="field form-grid-span"><span>Question</span><textarea className="input" required minLength={2} maxLength={4000} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} /></label>
            <label className="field"><span>Topic</span><input className="input" required maxLength={120} value={question.topic} onChange={(event) => updateQuestion(index, { topic: event.target.value })} /></label>
            <label className="field"><span>Difficulty</span><select className="input" value={question.difficulty} onChange={(event) => updateQuestion(index, { difficulty: event.target.value as Difficulty })}><option value="BEGINNER">Beginner</option><option value="INTERMEDIATE">Intermediate</option><option value="ADVANCED">Advanced</option></select></label>
            <label className="field"><span>Marks</span><input className="input" type="number" min={1} max={100} value={question.marks} onChange={(event) => updateQuestion(index, { marks: Number(event.target.value) })} /></label>
            {question.options.map((option, optionIndex) => <label className="field" key={optionIndex}><span>Option {optionIndex + 1}</span><input className="input" required maxLength={500} value={option} onChange={(event) => updateOption(index, optionIndex, event.target.value)} /></label>)}
            <label className="field"><span>Correct answer</span><select className="input" value={question.correctIndex} onChange={(event) => updateQuestion(index, { correctIndex: Number(event.target.value) })}>{question.options.map((_option, optionIndex) => <option key={optionIndex} value={optionIndex}>Option {optionIndex + 1}</option>)}</select></label>
            <label className="field form-grid-span"><span>Explanation (optional)</span><textarea className="input" maxLength={4000} value={question.explanation} onChange={(event) => updateQuestion(index, { explanation: event.target.value })} /></label>
          </section>)}
          <div className="button-row">
            {mode === 'manual' && <Button type="button" variant="secondary" onClick={() => setQuestions((current) => [...current, blankQuestion()])}>Add question</Button>}
            <Button type="submit" disabled={create.isPending || !questions.length}>{create.isPending ? 'Saving…' : 'Save as draft'}</Button>
          </div>
          {create.isError && <p className="notice notice-error" role="alert">{errorText(create.error)}</p>}
          {createdAssessment && <section className="card notice-success" role="status">
            <h2>{createdAssessment.title} saved as a draft</h2>
            <p>Publish it to make it available to enrolled students.</p>
            <div className="button-row"><Button disabled={publish.isPending} onClick={() => publish.mutate()}>{publish.isPending ? 'Publishing…' : 'Publish assessment'}</Button><Link className="button button-secondary" to={`/tutor/courses/${encodeURIComponent(course.id)}`}>Return to My Course</Link></div>
            {publish.isError && <p className="notice notice-error" role="alert">{errorText(publish.error)}</p>}
          </section>}
        </form>}
      </>}
    </section>
  </div>;
}
