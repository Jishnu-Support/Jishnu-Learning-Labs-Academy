import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/auth-context';
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

function LegacyInstructorRedirect() {
  const location = useLocation();
  const targetPath = location.pathname === '/instructor/register'
    ? '/staff/register/instructor'
    : location.pathname.replace(/^\/instructor(?=\/|$)/, '/staff');
  return <Navigate to={`${targetPath}${location.search}${location.hash}`} replace />;
}

function StaffDashboardRoute() {
  const { user } = useAuth();
  return <Dashboard role={user?.role === 'INSTRUCTOR' ? 'INSTRUCTOR' : 'STAFF'} />;
}

import { ApprovalsPage } from './pages/approvals-page';
import { ChangePasswordPage } from './pages/change-password-page';
import { CourseDetailPage } from './pages/course-detail-page';
import { CourseFormPage, CoursesPage } from './pages/courses-page';
import { Dashboard } from './pages/dashboard';
import { InstructorApprovalsPage } from './pages/instructor-approvals-page';
import { LoginPage } from './pages/login-page';
import { MediaPage } from './pages/media-page';
import { NotesPage } from './pages/notes-page';
import { OrganizationApprovalsPage } from './pages/organization-approvals-page';
import { OrganizationRegistrationPage } from './pages/organization-registration-page';
import { RegisterPage } from './pages/register-page';
import { StaffDetailsPage, StaffManagementPage } from './pages/staff-page';
import { StudentCourseDetailPage } from './pages/student-course-detail-page';
import { StudentCoursesPage } from './pages/student-courses-page';
import { StudentMediaPage, StudentMediaPlayerPage } from './pages/student-media-page';
import { StudentsPage } from './pages/students-page';
import {
  PracticeQuestionBankPage, StudentAssessmentAttemptPage, StudentAssessmentResultPage,
  StudentAssessmentsPage, StudentPracticePage, TeacherAssessmentsPage,
} from './pages/learning-pages';

const authenticatedRoles = ['STUDENT', 'INSTRUCTOR', 'STAFF', 'ORG_ADMIN', 'SUPER_ADMIN'] as const;

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
        <Route path="/instructor" element={<LegacyInstructorRedirect />} />
        <Route path="/instructor/*" element={<LegacyInstructorRedirect />} />
        <Route path="/staff/login" element={<LoginPage portal="staff" />} />
        <Route path="/staff/register" element={<RegisterPage role="STAFF" />} />
        <Route path="/staff/register/instructor" element={<RegisterPage role="INSTRUCTOR" />} />
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
        <Route element={<RouteGuard roles={['ORG_ADMIN']} />}>
          <Route path="/org-admin" element={<Dashboard role="ORG_ADMIN" />} />
          <Route path="/org-admin/instructors" element={<InstructorApprovalsPage />} />
          <Route path="/org-admin/create-staff" element={<StaffManagementPage />} />
          <Route path="/org-admin/students" element={<StudentsPage />} />
          <Route path="/org-admin/staff" element={<StaffDetailsPage />} />
          <Route path="/org-admin/notes" element={<NotesPage />} />
          <Route path="/org-admin/media" element={<MediaPage />} />
          <Route path="/org-admin/learning/questions" element={<PracticeQuestionBankPage />} />
          <Route path="/org-admin/learning/assessments" element={<TeacherAssessmentsPage />} />
          <Route path="/org-admin/courses" element={<CoursesPage />} />
          <Route path="/org-admin/courses/new" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId/edit" element={<CourseFormPage />} />
          <Route path="/org-admin/courses/:courseId" element={<CourseDetailPage />} />
        </Route>
        <Route element={<RouteGuard roles={['STAFF', 'INSTRUCTOR']} />}>
          <Route path="/staff" element={<StaffDashboardRoute />} />
          <Route path="/staff/students" element={<StudentsPage />} />
          <Route path="/staff/notes" element={<NotesPage />} />
          <Route path="/staff/media" element={<MediaPage />} />
        </Route>
        <Route element={<RouteGuard roles={['INSTRUCTOR']} />}>
          <Route path="/staff/approvals" element={<ApprovalsPage />} />
          <Route path="/staff/staff" element={<StaffDetailsPage />} />
          <Route path="/staff/learning/questions" element={<PracticeQuestionBankPage />} />
          <Route path="/staff/learning/assessments" element={<TeacherAssessmentsPage />} />
          <Route path="/staff/courses" element={<CoursesPage />} />
          <Route path="/staff/courses/new" element={<CourseFormPage />} />
          <Route path="/staff/courses/:courseId/edit" element={<CourseFormPage />} />
          <Route path="/staff/courses/:courseId" element={<CourseDetailPage />} />
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
