import { Navigate, Route, Routes, useSearchParams } from 'react-router-dom';
import { RouteGuard } from './components/route-guard';
import { Shell } from './components/shell';
import { PageHeader } from './components/page-header';

function NotFoundPage() {
  return (
    <section className="narrow-card card">
      <PageHeader title="Page not found" backTo="/student" breadcrumbs={['Not found']} />
      <p className="muted">The page you requested does not exist or is no longer available.</p>
    </section>
  );
}
import { ApprovalsPage } from './pages/approvals-page';
import { ChangePasswordPage } from './pages/change-password-page';
import { CourseDetailPage } from './pages/course-detail-page';
import { CourseFormPage, CoursesPage } from './pages/courses-page';
import { Dashboard } from './pages/dashboard';
import { TutorApprovalsPage } from './pages/tutor-approvals-page';
import { LoginPage } from './pages/login-page';
import { NotificationsPage } from './pages/notifications-page';
import { MyProfilePage } from './pages/my-profile-page';
import { MediaPage } from './pages/media-page';
import { AssessmentReportsPage } from './pages/assessment-reports-page';
import { NotesPage } from './pages/notes-page';
import { OrganizationApprovalsPage } from './pages/organization-approvals-page';
import { OrganizationRegistrationPage } from './pages/organization-registration-page';
import { RegisterPage } from './pages/register-page';
import { StudentRegistrationStatusPage } from './pages/student-registration-status-page';
import { TutorDetailsPage, TutorManagementPage } from './pages/tutor-page';
import { StudentCourseDetailPage } from './pages/student-course-detail-page';
import { StudentCourseCatalogPage, StudentCoursesPage } from './pages/student-courses-page';
import { StudentTutorsPage } from './pages/student-tutors-page';
import { OrganizationTutorRatingsPage } from './pages/tutor-ratings-page';
import { StudentMediaPlayerPage } from './pages/student-media-page';
import { StudentReportsPage } from './pages/student-reports-page';
import { QuestionPaperGeneratorPage } from './pages/question-paper-generator-page';
import { TutorCourseAssessmentPage } from './pages/tutor-course-assessment-page';
import { StudentPaymentsPage } from './pages/student-payments-page';
import { PaymentsManagementPage } from './pages/payments-management-page';
import { StudentsPage } from './pages/students-page';
import {
  PracticeQuestionBankPage, StudentAssessmentAttemptPage, StudentAssessmentResultPage,
  TeacherAssessmentsPage,
} from './pages/learning-pages';
import {
  CertificateDetailPage, CertificateVerificationPage, ExpertSessionsPage, LibraryPage,
  MyAttendancePage, MyCertificatesPage, SessionAttendeesPage, SessionHostPage, StudentSessionPreparePage,
  TrackKnowledgePage,
} from './pages/student-portal-pages';

const authenticatedRoles = ['STUDENT', 'TUTOR', 'ORG_ADMIN', 'SUPER_ADMIN'] as const;

function TutorDashboard() {
  return <Dashboard role="TUTOR" />;
}

function LegacyTutorAdminRoute() {
  return <Navigate to="/org-admin/tutors" replace />;
}

export function LegacyStudentLearningRedirect({ tab }: { tab: 'media' | 'sessions' | 'materials' | 'practice' | 'assessments' }) {
  const [searchParams] = useSearchParams();
  const courseId = searchParams.get('courseId');
  return <Navigate to={courseId ? `/student/courses/${encodeURIComponent(courseId)}/${tab}` : '/student/courses'} replace />;
}

function Unauthorized() {
  return <section className="narrow-card card"><PageHeader title="Access unavailable" backTo="/student/register" breadcrumbs={['Access', 'Unavailable']} /><p className="muted">This account does not have permission to open this page.</p></section>;
}

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/student/login" replace />} />
        <Route path="/organizations/register" element={<OrganizationRegistrationPage />} />
        <Route path="/student/login" element={<LoginPage portal="student" />} />
        <Route path="/student/register" element={<RegisterPage role="STUDENT" />} />
        <Route path="/student/registration-status" element={<StudentRegistrationStatusPage />} />
        <Route path="/certificate-verify/:verificationCode" element={<CertificateVerificationPage />} />
        <Route path="/tutor/login" element={<LoginPage portal="tutor" />} />
        <Route path="/tutor/register" element={<RegisterPage role="TUTOR" />} />
        <Route path="/org-admin/login" element={<LoginPage portal="org-admin" />} />
        <Route path="/super-admin/login" element={<LoginPage portal="super-admin" />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route element={<RouteGuard roles={[...authenticatedRoles]} />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>
        <Route element={<RouteGuard roles={['STUDENT']} />}>
          <Route path="/student" element={<Dashboard role="STUDENT" />} />
          <Route path="/student/courses" element={<StudentCoursesPage />} />
          <Route path="/student/courses/reports" element={<StudentReportsPage />} />
          <Route path="/student/course-catalog" element={<StudentCourseCatalogPage />} />
          <Route path="/student/question-paper" element={<QuestionPaperGeneratorPage />} />
          <Route path="/student/tutors" element={<StudentTutorsPage />} />
          <Route path="/student/payments" element={<StudentPaymentsPage />} />
          <Route path="/student/courses/:courseId/:tab?" element={<StudentCourseDetailPage />} />
          <Route path="/student/courses/:courseId/media/:mediaId" element={<StudentMediaPlayerPage />} />
          <Route path="/student/media" element={<LegacyStudentLearningRedirect tab="media" />} />
          <Route path="/student/media/:mediaId" element={<LegacyStudentLearningRedirect tab="media" />} />
          <Route path="/student/notes" element={<LegacyStudentLearningRedirect tab="materials" />} />
          <Route path="/student/assessments" element={<LegacyStudentLearningRedirect tab="assessments" />} />
          <Route path="/student/assessment/:attemptId" element={<StudentAssessmentAttemptPage />} />
          <Route path="/student/assessment/:attemptId/result" element={<StudentAssessmentResultPage />} />
          <Route path="/student/practice" element={<LegacyStudentLearningRedirect tab="practice" />} />
          <Route path="/student/sessions" element={<LegacyStudentLearningRedirect tab="sessions" />} />
          <Route path="/student/sessions/:sessionId/prepare" element={<StudentSessionPreparePage />} />
          <Route path="/student/library" element={<LibraryPage />} />
          <Route path="/student/library/:itemId" element={<LibraryPage />} />
          <Route path="/student/attendance" element={<MyAttendancePage />} />
          <Route path="/student/knowledge" element={<TrackKnowledgePage />} />
          <Route path="/student/certificates" element={<MyCertificatesPage />} />
          <Route path="/student/certificates/:certificateId" element={<CertificateDetailPage />} />
          <Route path="/student/online-classes" element={<LegacyStudentLearningRedirect tab="sessions" />} />
          <Route path="/student/experts-session" element={<LegacyStudentLearningRedirect tab="sessions" />} />
          <Route path="/student/my-attendance" element={<Navigate to="/student/attendance" replace />} />
          <Route path="/student/my-certificates" element={<Navigate to="/student/certificates" replace />} />
          <Route path="/student/track-my-knowledge" element={<Navigate to="/student/knowledge" replace />} />
          <Route path="/student/videos-audios" element={<LegacyStudentLearningRedirect tab="media" />} />
        </Route>
        <Route element={<RouteGuard roles={['TUTOR']} />}>
          <Route path="/tutor" element={<TutorDashboard />} />
          <Route path="/tutor/registrations" element={<ApprovalsPage />} />
          <Route path="/tutor/approvals" element={<Navigate to="/tutor/registrations" replace />} />
          <Route path="/tutor/ratings" element={<Navigate to="/my-profile#ratings" replace />} />
          <Route path="/tutor/payments" element={<PaymentsManagementPage />} />
          <Route path="/tutor/students" element={<StudentsPage />} />
          <Route path="/tutor/tutors" element={<Navigate to="/my-profile" replace />} />
          <Route path="/tutor/materials" element={<NotesPage />} />
          <Route path="/tutor/notes" element={<Navigate to="/tutor/materials" replace />} />
          <Route path="/tutor/media" element={<MediaPage />} />
          <Route path="/tutor/library" element={<LibraryPage />} />
          <Route path="/tutor/library/:itemId" element={<LibraryPage />} />
          <Route path="/tutor/sessions" element={<ExpertSessionsPage />} />
          <Route path="/tutor/sessions/:sessionId/attendees" element={<SessionAttendeesPage />} />
          <Route path="/tutor/sessions/:sessionId/host" element={<SessionHostPage />} />
          <Route element={<RouteGuard roles={['TUTOR']} />}>
            <Route path="/tutor/learning/questions" element={<Navigate to="/tutor/courses" replace />} />
            <Route path="/tutor/learning/assessments" element={<Navigate to="/tutor/courses" replace />} />
            <Route path="/tutor/learning/reports" element={<Navigate to="/tutor/courses" replace />} />
            <Route path="/tutor/courses/:courseId/assessments/new" element={<TutorCourseAssessmentPage />} />
            <Route path="/tutor/courses" element={<CoursesPage />} />
            <Route path="/tutor/courses/new" element={<CourseFormPage />} />
            <Route path="/tutor/courses/:courseId/edit" element={<CourseFormPage />} />
            <Route path="/tutor/courses/:courseId" element={<CourseDetailPage />} />
          </Route>
        </Route>
        <Route element={<RouteGuard roles={['ORG_ADMIN']} />}>
          <Route path="/org-admin" element={<Dashboard role="ORG_ADMIN" />} />
          <Route path="/org-admin/payments" element={<PaymentsManagementPage />} />
          <Route path="/org-admin/tutors/pending" element={<TutorApprovalsPage />} />
          <Route path="/org-admin/students/pending" element={<Navigate to="/org-admin" replace />} />
          <Route path="/org-admin/create-tutor" element={<TutorManagementPage />} />
          <Route path="/org-admin/students" element={<StudentsPage />} />
          <Route path="/org-admin/tutors" element={<TutorDetailsPage />} />
          <Route path="/org-admin/tutor-ratings" element={<OrganizationTutorRatingsPage />} />
          <Route path="/org-admin/materials" element={<NotesPage />} />
          <Route path="/org-admin/notes" element={<Navigate to="/org-admin/materials" replace />} />
          <Route path="/org-admin/media" element={<MediaPage />} />
          <Route path="/org-admin/library" element={<LibraryPage />} />
          <Route path="/org-admin/library/:itemId" element={<LibraryPage />} />
          <Route path="/org-admin/sessions" element={<ExpertSessionsPage />} />
          <Route path="/org-admin/sessions/:sessionId/attendees" element={<SessionAttendeesPage />} />
          <Route path="/org-admin/sessions/:sessionId/host" element={<SessionHostPage />} />
          <Route path="/org-admin/learning/questions" element={<PracticeQuestionBankPage />} />
          <Route path="/org-admin/learning/assessments" element={<TeacherAssessmentsPage />} />
          <Route path="/org-admin/learning/reports" element={<AssessmentReportsPage />} />
          <Route path="/org-admin/courses" element={<CoursesPage />} />
          <Route path="/org-admin/courses/new" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId/edit" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId" element={<CourseDetailPage />} />
        </Route>
        <Route path="/org-admin/staff/*" element={<LegacyTutorAdminRoute />} />
        <Route path="/org-admin/create-staff" element={<LegacyTutorAdminRoute />} />
        <Route element={<RouteGuard roles={[...authenticatedRoles]} />}>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/my-profile" element={<MyProfilePage />} />
        </Route>
        <Route element={<RouteGuard roles={['SUPER_ADMIN']} />}>
          <Route path="/super-admin" element={<Navigate to="/super-admin/dashboard" replace />} />
          <Route path="/super-admin/dashboard" element={<Dashboard role="SUPER_ADMIN" />} />
          <Route path="/super-admin/payments" element={<PaymentsManagementPage />} />
          <Route path="/super-admin/organizations" element={<OrganizationApprovalsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
