import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
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
    { href: '/org-admin/media', label: 'Upload Media' },
    { href: '/org-admin/learning/questions', label: 'Practice Q/A' },
    { href: '/org-admin/learning/assessments', label: 'Assessments' },
  ],
  INSTRUCTOR: [
    { href: '/instructor', label: 'Overview' },
    { href: '/instructor/courses', label: 'Courses' },
    { href: '/instructor/approvals', label: 'Pending Students' },
    { href: '/instructor/students', label: 'Student Details' },
    { href: '/instructor/staff', label: 'Staff Details' },
    { href: '/instructor/notes', label: 'Publish Notes' },
    { href: '/instructor/media', label: 'Upload Media' },
    { href: '/instructor/learning/questions', label: 'Practice Q/A' },
    { href: '/instructor/learning/assessments', label: 'Assessments' },
  ],
  STAFF: [
    { href: '/staff', label: 'Overview' },
    { href: '/staff/students', label: 'Student Details' },
    { href: '/staff/notes', label: 'Notes' },
    { href: '/staff/media', label: 'Upload Media' },
  ],
  STUDENT: [
    { href: '/student', label: 'Dashboard' },
    { href: '/student/courses', label: 'My Courses' },
    { href: '/student/notes', label: 'Notes' },
    { href: '/student/assessments', label: 'My Assessment' },
    { href: '/student/practice', label: 'Practice Q/A' },
  ],
};

export function PortalSidebar({ role }: { role: Role }) {
  const links = linksByRole[role];
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [role]);

  if (!links) return null;

  return (
    <>
      <button type="button" className="sidebar-toggle" aria-label="Open navigation" onClick={() => setIsOpen((current) => !current)}>
        <Menu size={18} aria-hidden="true" />
      </button>
      {isOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setIsOpen(false)} />}
      <aside className={`portal-sidebar ${isOpen ? 'open' : ''}`} aria-label={`${role.replace('_', ' ')} navigation`}>
        <div className="sidebar-header">
          <BrandLogo className="sidebar-logo" />
          <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setIsOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <nav>
          {links.map((link) => (
            <NavLink key={link.href} end={link.href === `/${role.toLowerCase().replace('_', '-')}`} to={link.href} onClick={() => setIsOpen(false)}>
              <span>{link.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
}
