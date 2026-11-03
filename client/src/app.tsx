import { Navigate, Route, Routes } from 'react-router-dom';
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
        <Route path="/instructor/login" element={<LoginPage portal="instructor" />} />
        <Route path="/instructor/register" element={<RegisterPage role="INSTRUCTOR" />} />
        <Route path="/staff/login" element={<LoginPage portal="staff" />} />
        <Route path="/staff/register" element={<RegisterPage role="STAFF" />} />
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
        <Route element={<RouteGuard roles={['INSTRUCTOR']} />}>
          <Route path="/instructor" element={<Dashboard role="INSTRUCTOR" />} />
          <Route path="/instructor/approvals" element={<ApprovalsPage />} />
          <Route path="/instructor/students" element={<StudentsPage />} />
          <Route path="/instructor/staff" element={<StaffDetailsPage />} />
          <Route path="/instructor/notes" element={<NotesPage />} />
          <Route path="/instructor/media" element={<MediaPage />} />
          <Route path="/instructor/learning/questions" element={<PracticeQuestionBankPage />} />
          <Route path="/instructor/learning/assessments" element={<TeacherAssessmentsPage />} />
          <Route path="/instructor/courses" element={<CoursesPage />} />
          <Route path="/instructor/courses/new" element={<CourseFormPage />} />
          <Route path="/instructor/courses/:courseId/edit" element={<CourseFormPage />} />
          <Route path="/instructor/courses/:courseId" element={<CourseDetailPage />} />
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
        <Route element={<RouteGuard roles={['STAFF']} />}>
          <Route path="/staff" element={<Dashboard role="STAFF" />} />
          <Route path="/staff/students" element={<StudentsPage />} />
          <Route path="/staff/notes" element={<NotesPage />} />
          <Route path="/staff/media" element={<MediaPage />} />
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
