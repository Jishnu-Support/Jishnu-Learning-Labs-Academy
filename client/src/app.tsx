import { Navigate, Route, Routes } from 'react-router-dom';
import { RouteGuard } from './components/route-guard';
import { Shell } from './components/shell';
import { ApprovalsPage } from './pages/approvals-page';
import { Dashboard } from './pages/dashboard';
import { CoursesPage } from './pages/courses-page';
import { LoginPage } from './pages/login-page';
import { RegisterPage } from './pages/register-page';

function Unauthorized() { return <section className="narrow-card card"><h1>Access unavailable</h1><p className="muted">This account does not have permission to open this page.</p></section>; }

export function App() {
  return <Routes><Route element={<Shell />}>
    <Route path="/" element={<Navigate to="/student/login" replace />} />
    <Route path="/student/login" element={<LoginPage portal="student" />} />
    <Route path="/student/register" element={<RegisterPage />} />
    <Route path="/instructor/login" element={<LoginPage portal="instructor" />} />
    <Route path="/staff/login" element={<LoginPage portal="staff" />} />
    <Route path="/unauthorized" element={<Unauthorized />} />
    <Route element={<RouteGuard roles={['STUDENT']} />}><Route path="/student" element={<Dashboard role="STUDENT" />} /></Route>
    <Route element={<RouteGuard roles={['INSTRUCTOR']} />}>
      <Route path="/instructor" element={<Dashboard role="INSTRUCTOR" />} />
      <Route path="/instructor/approvals" element={<ApprovalsPage />} />
      <Route path="/instructor/courses" element={<CoursesPage />} />
    </Route>
    <Route element={<RouteGuard roles={['STAFF', 'SUPER_ADMIN']} />}><Route path="/staff" element={<Dashboard role="STAFF" />} /></Route>
    <Route path="*" element={<Navigate to="/student/login" replace />} />
  </Route></Routes>;
}
