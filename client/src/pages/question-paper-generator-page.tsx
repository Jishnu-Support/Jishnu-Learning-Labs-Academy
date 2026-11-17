import { useMemo, useState, type CSSProperties } from 'react';
import { PageHeader } from '../components/page-header';
import { PortalSidebar } from '../components/portal-sidebar';
import { Button } from '../components/ui/button';
import questionBank from '../data/questions.json';
import { gradeOmrAnswers, readOmrAnswers, selectQuestions, type OmrGrade, type OmrQuestion } from './omr-utils';

const bank = questionBank as OmrQuestion[];
const optionLetters = ['A', 'B', 'C', 'D'];
const subjects = Array.from(new Set(bank.map((question) => question.subject)));
const difficulties = ['EASY', 'MEDIUM', 'HARD'] as const;

async function decodeOmrImage(file: File, questionCount: number) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file of your completed answer sheet.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (Math.abs(bitmap.width / bitmap.height - (210 / 297)) > 0.055) {
      throw new Error('Use a portrait photo or scan that shows the complete answer sheet, without cropping.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1400;
    canvas.height = 1980;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('This browser cannot read the answer sheet image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return readOmrAnswers(context.getImageData(0, 0, canvas.width, canvas.height), questionCount);
  } finally {
    bitmap.close();
  }
}

export function QuestionPaperGeneratorPage() {
  const [subject, setSubject] = useState(subjects[0] ?? '');
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>('EASY');
  const [questionCount, setQuestionCount] = useState(5);
  const [marksPerQuestion, setMarksPerQuestion] = useState(1);
  const [questions, setQuestions] = useState<OmrQuestion[]>([]);
  const [answers, setAnswers] = useState<string[]>([]);
  const [grade, setGrade] = useState<OmrGrade | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanMessage, setScanMessage] = useState('');
  const [error, setError] = useState('');
  const pool = useMemo(() => bank.filter((item) => item.subject === subject && item.difficulty === difficulty), [subject, difficulty]);
  const availableCount = Math.min(20, pool.length);

  const generate = () => {
    try {
      const selected = selectQuestions(bank, subject, difficulty, questionCount);
      setQuestions(selected);
      setAnswers(Array(selected.length).fill(''));
      setGrade(null);
      setScanFile(null);
      setScanMessage('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The question paper could not be generated.');
    }
  };

  const scan = async () => {
    if (!scanFile || !questions.length) return;
    try {
      const detected = await decodeOmrImage(scanFile, questions.length);
      const nextAnswers = detected.map((answer) => answer ?? '');
      const detectedCount = nextAnswers.filter(Boolean).length;
      setAnswers(nextAnswers);
      setScanMessage(`Detected ${detectedCount} of ${questions.length} answers. Check the entries and fill any unclear responses manually below.`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The answer sheet could not be scanned. Enter answers manually below.');
      setScanMessage('Manual answer entry is available below.');
    }
  };

  const submit = () => {
    try {
      setGrade(gradeOmrAnswers(questions, answers, marksPerQuestion));
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The answers could not be checked.');
    }
  };

  return <div className="portal-layout">
    <PortalSidebar role="STUDENT" />
    <section className="portal-content question-paper-page">
      <PageHeader title="Question Paper Generator" backTo="/student/courses" breadcrumbs={['My Course', 'Question Paper Generator']} />
      <p className="muted">Build a sample practice paper, print its OMR sheet, then scan it locally or enter answers manually.</p>
      <section className="card question-paper-controls">
        <h2>Paper settings</h2>
        <div className="form-grid">
          <label className="field"><span>Subject</span><select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}>{subjects.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="field"><span>Difficulty</span><select className="input" value={difficulty} onChange={(event) => setDifficulty(event.target.value as (typeof difficulties)[number])}>{difficulties.map((value) => <option key={value} value={value}>{value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</select></label>
          <label className="field"><span>Number of questions</span><select className="input" value={Math.min(questionCount, availableCount)} onChange={(event) => setQuestionCount(Number(event.target.value))}>{Array.from({ length: availableCount }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="field"><span>Marks per question</span><input className="input" type="number" min={1} max={20} step={1} value={marksPerQuestion} onChange={(event) => setMarksPerQuestion(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        </div>
        <div className="button-row"><Button disabled={!availableCount} onClick={generate}>Generate question paper</Button>{questions.length > 0 && <Button variant="secondary" onClick={() => window.print()}>Print paper + OMR sheet</Button>}</div>
      </section>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {questions.length > 0 && <div className="question-paper-print-area">
        <section className="card question-paper-preview">
          <p className="eyebrow">Sample practice paper · {difficulty.toLowerCase()}</p>
          <h2>{subject}</h2>
          <p>{questions.length} questions · {marksPerQuestion} mark{marksPerQuestion === 1 ? '' : 's'} each · Total {questions.length * marksPerQuestion} marks</p>
          {questions.map((question, index) => <article className="question-paper-question" key={question.id}>
            <h3>{index + 1}. {question.question}</h3>
            <ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol>
          </article>)}
        </section>
        <section className="omr-sheet" aria-label="Printable OMR answer sheet">
          <div className="omr-sheet-heading">
            <p className="eyebrow">Jishnu Learning Labs · Sample practice</p>
            <h2>{subject} — Answer Sheet</h2>
            <p>Mark one bubble clearly for each question. Keep this entire sheet inside the photo frame for scanning.</p>
            <div className="omr-option-heading"><span>Question</span>{optionLetters.map((letter) => <strong key={letter}>{letter}</strong>)}</div>
          </div>
          <div className="omr-answer-rows" style={{ '--question-count': questions.length } as CSSProperties}>
            {questions.map((_question, index) => <div className="omr-answer-row" key={`omr-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              {optionLetters.map((letter) => <span className="omr-option-cell" key={letter}><i aria-hidden="true" /></span>)}
            </div>)}
          </div>
          <p className="omr-sheet-footer">One mark per answer · Fill the bubble completely · Unclear or multiple marks are left for manual entry</p>
        </section>
      </div>}
      {questions.length > 0 && <section className="card omr-scan-panel">
        <h2>Check your answers</h2>
        <p className="muted">The image is processed only in this browser and is not uploaded. Use a portrait photo or scan showing the full answer sheet; if any answer is unclear, enter it manually.</p>
        <label className="field"><span>Upload completed OMR sheet photo</span><input className="input file-input" type="file" accept="image/*" onChange={(event) => { setScanFile(event.target.files?.[0] ?? null); setScanMessage(''); setError(''); }} /></label>
        <Button variant="secondary" disabled={!scanFile} onClick={() => void scan()}>Scan answer sheet</Button>
        {scanMessage && <p className="notice notice-info" role="status">{scanMessage}</p>}
        <div className="omr-manual-answers">
          <h3>Manual answer entry / review</h3>
          {questions.map((question, index) => <label className="field" key={`answer-${question.id}`}><span>Question {index + 1}: {question.question}</span><select className="input" value={answers[index] ?? ''} disabled={Boolean(grade)} onChange={(event) => setAnswers((current) => current.map((answer, answerIndex) => answerIndex === index ? event.target.value : answer))}>
            <option value="">No answer</option>{optionLetters.map((letter) => <option key={letter} value={letter}>{letter}. {question.options[optionLetters.indexOf(letter)]}</option>)}
          </select></label>)}
        </div>
        <Button disabled={Boolean(grade)} onClick={submit}>Submit answers and show result</Button>
      </section>}
      {grade && <section className="card omr-result" aria-live="polite">
        <h2>Practice result</h2>
        <p className="omr-result-score">{grade.marks} / {grade.totalMarks} marks · {grade.percentage}%</p>
        <p>{grade.correctCount} of {questions.length} answers correct.</p>
        <div className="omr-result-list">{questions.map((question, index) => {
          const result = grade.answers[index]!;
          return <article className="omr-result-item" key={`result-${question.id}`}>
            <strong className={result.correct ? 'omr-correct' : 'omr-incorrect'}>Question {index + 1}: {result.correct ? 'Correct' : 'Incorrect'}</strong>
            <p>Your answer: {result.selected || 'Not answered'} · Correct answer: {question.correctAnswer}</p>
            <p className="muted">{question.explanation}</p>
          </article>;
        })}</div>
      </section>}
    </section>
  </div>;
}
