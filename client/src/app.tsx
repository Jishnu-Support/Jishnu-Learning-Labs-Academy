import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RouteGuard } from './components/route-guard';
import { Shell } from './components/shell';
import { PageHeader } from './components/page-header';
import { useAuth } from './auth/auth-context';

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
import { InstructorApprovalsPage } from './pages/instructor-approvals-page';
import { LoginPage } from './pages/login-page';
import { NotificationsPage } from './pages/notifications-page';
import { MyProfilePage } from './pages/my-profile-page';
import { MediaPage } from './pages/media-page';
import { NotesPage } from './pages/notes-page';
import { OrganizationApprovalsPage } from './pages/organization-approvals-page';
import { OrganizationRegistrationPage } from './pages/organization-registration-page';
import { RegisterPage } from './pages/register-page';
import { TutorDetailsPage, TutorManagementPage } from './pages/tutor-page';
import { StudentCourseDetailPage } from './pages/student-course-detail-page';
import { StudentCoursesPage } from './pages/student-courses-page';
import { StudentMediaPage, StudentMediaPlayerPage } from './pages/student-media-page';
import { StudentsPage } from './pages/students-page';
import {
  PracticeQuestionBankPage, StudentAssessmentAttemptPage, StudentAssessmentResultPage,
  StudentAssessmentsPage, StudentPracticePage, TeacherAssessmentsPage,
} from './pages/learning-pages';

const authenticatedRoles = ['STUDENT', 'INSTRUCTOR', 'TUTOR', 'ORG_ADMIN', 'SUPER_ADMIN'] as const;

function TutorDashboard() {
  const { user } = useAuth();
  return <Dashboard role={user?.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'TUTOR'} />;
}

function LegacyTutorRoute() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/(?:staff|instructor)/, '');
  return <Navigate to={`/tutor${suffix}${location.search}`} replace />;
}

function LegacyTutorAdminRoute() {
  const location = useLocation();
  const suffix = location.pathname.replace(/^\/org-admin\/(?:staff|create-staff)/, '');
  return <Navigate to={location.pathname.includes('create-staff') ? `/org-admin/create-tutor${location.search}` : `/org-admin/tutors${suffix}${location.search}`} replace />;
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
        <Route path="/tutor/login" element={<LoginPage portal="tutor" />} />
        <Route path="/tutor/register" element={<RegisterPage role="TUTOR" />} />
        <Route path="/instructor/*" element={<LegacyTutorRoute />} />
        <Route path="/staff/*" element={<LegacyTutorRoute />} />
        <Route path="/org-admin/login" element={<LoginPage portal="org-admin" />} />
        <Route path="/super-admin/login" element={<LoginPage portal="super-admin" />} />
        <Route path="/unauthorized" element={<Unauthorized />} />
        <Route element={<RouteGuard roles={[...authenticatedRoles]} />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
        </Route>
        <Route element={<RouteGuard roles={['STUDENT']} />}>
          <Route path="/student" element={<Dashboard role="STUDENT" />} />
          <Route path="/student/courses" element={<StudentCoursesPage />} />
          <Route path="/student/courses/:courseId" element={<StudentCourseDetailPage />} />
          <Route path="/student/media" element={<StudentMediaPage />} />
          <Route path="/student/media/:mediaId" element={<StudentMediaPlayerPage />} />
          <Route path="/student/notes" element={<NotesPage />} />
          <Route path="/student/assessments" element={<StudentAssessmentsPage />} />
          <Route path="/student/assessment/:attemptId" element={<StudentAssessmentAttemptPage />} />
          <Route path="/student/assessment/:attemptId/result" element={<StudentAssessmentResultPage />} />
          <Route path="/student/practice" element={<StudentPracticePage />} />
        </Route>
        <Route element={<RouteGuard roles={['INSTRUCTOR', 'TUTOR']} />}>
          <Route path="/tutor" element={<TutorDashboard />} />
          <Route path="/tutor/students" element={<StudentsPage />} />
          <Route path="/tutor/tutors" element={<TutorDetailsPage />} />
          <Route path="/tutor/notes" element={<NotesPage />} />
          <Route path="/tutor/media" element={<MediaPage />} />
          <Route element={<RouteGuard roles={['INSTRUCTOR']} />}>
            <Route path="/tutor/approvals" element={<ApprovalsPage />} />
            <Route path="/tutor/learning/questions" element={<PracticeQuestionBankPage />} />
            <Route path="/tutor/learning/assessments" element={<TeacherAssessmentsPage />} />
            <Route path="/tutor/courses" element={<CoursesPage />} />
            <Route path="/tutor/courses/new" element={<CourseFormPage />} />
            <Route path="/tutor/courses/:courseId/edit" element={<CourseFormPage />} />
            <Route path="/tutor/courses/:courseId" element={<CourseDetailPage />} />
          </Route>
        </Route>
        <Route element={<RouteGuard roles={['ORG_ADMIN']} />}>
          <Route path="/org-admin" element={<Dashboard role="ORG_ADMIN" />} />
          <Route path="/org-admin/tutors/pending" element={<InstructorApprovalsPage />} />
          <Route path="/org-admin/create-tutor" element={<TutorManagementPage />} />
          <Route path="/org-admin/students" element={<StudentsPage />} />
          <Route path="/org-admin/tutors" element={<TutorDetailsPage />} />
          <Route path="/org-admin/notes" element={<NotesPage />} />
          <Route path="/org-admin/media" element={<MediaPage />} />
          <Route path="/org-admin/learning/questions" element={<PracticeQuestionBankPage />} />
          <Route path="/org-admin/learning/assessments" element={<TeacherAssessmentsPage />} />
          <Route path="/org-admin/courses" element={<CoursesPage />} />
          <Route path="/org-admin/courses/new" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId/edit" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId" element={<CourseDetailPage />} />
        </Route>
        <Route path="/org-admin/instructors" element={<Navigate to="/org-admin/tutors/pending" replace />} />
        <Route path="/org-admin/staff/*" element={<LegacyTutorAdminRoute />} />
        <Route path="/org-admin/create-staff" element={<LegacyTutorAdminRoute />} />
        <Route element={<RouteGuard roles={[...authenticatedRoles]} />}>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/my-profile" element={<MyProfilePage />} />
        </Route>
        <Route element={<RouteGuard roles={['SUPER_ADMIN']} />}>
          <Route path="/super-admin" element={<Navigate to="/super-admin/dashboard" replace />} />
          <Route path="/super-admin/dashboard" element={<Dashboard role="SUPER_ADMIN" />} />
          <Route path="/super-admin/organizations" element={<OrganizationApprovalsPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
