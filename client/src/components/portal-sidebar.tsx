import { NavLink } from 'react-router-dom';
import type { Role } from '../types';
import { BrandLogo } from './brand-logo';

type PortalLink = { href: string; label: string };

const linksByRole: Partial<Record<Role, PortalLink[]>> = {
  ORG_ADMIN: [
    { href: '/org-admin', label: 'Overview' },
    { href: '/org-admin/courses', label: 'Courses' },
    { href: '/org-admin/instructors', label: 'Pending Instructors & Staff' },
    { href: '/org-admin/create-staff', label: 'Create Staff' },
    { href: '/org-admin/students', label: 'Student Details' },
    { href: '/org-admin/staff', label: 'Staff Details' },
    { href: '/org-admin/notes', label: 'Publish Notes' },
  ],
  INSTRUCTOR: [
    { href: '/instructor', label: 'Overview' },
    { href: '/instructor/courses', label: 'Courses' },
    { href: '/instructor/approvals', label: 'Pending Students' },
    { href: '/instructor/students', label: 'Student Details' },
    { href: '/instructor/staff', label: 'Staff Details' },
    { href: '/instructor/notes', label: 'Publish Notes' },
  ],
  STAFF: [
    { href: '/staff', label: 'Overview' },
    { href: '/staff/students', label: 'Student Details' },
    { href: '/staff/notes', label: 'Notes' },
  ],
  STUDENT: [
    { href: '/student', label: 'Overview' },
    { href: '/student/courses', label: 'My Courses' },
    { href: '/student/notes', label: 'Notes' },
  ],
};

export function PortalSidebar({ role }: { role: Role }) {
  const links = linksByRole[role];
  if (!links) return null;
  return (
    <aside className="portal-sidebar" aria-label={`${role.replace('_', ' ')} navigation`}>
      <BrandLogo className="sidebar-logo" />
      <p className="eyebrow">WORKSPACE</p>
      <nav>
        {links.map((link) => (
          <NavLink key={link.href} end={link.href === `/${role.toLowerCase().replace('_', '-')}`} to={link.href}>
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
