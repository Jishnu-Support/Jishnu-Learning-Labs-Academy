import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { Role } from '../types';
import { BrandLogo } from './brand-logo';

type PortalLink = { href: string; label: string; group?: string };

const linksByRole: Partial<Record<Role, PortalLink[]>> = {
  ORG_ADMIN: [
    { href: '/org-admin', label: 'Overview' },
    { href: '/org-admin/payments', label: 'Payments' },
    { href: '/org-admin/courses', label: 'Courses' },
    { href: '/org-admin/opportunities', label: 'Job Openings' },
    { href: '/org-admin/tutors/pending', label: 'Pending Tutors' },
    { href: '/org-admin/create-tutor', label: 'Create Tutor' },
    { href: '/org-admin/students', label: 'Student Details' },
    { href: '/org-admin/tutors', label: 'Tutor Details' },
    { href: '/org-admin/tutor-ratings', label: 'Tutor Ratings' },
    { href: '/org-admin/materials', label: 'Publish Study Materials' },
    { href: '/org-admin/library', label: 'Library' },
    { href: '/org-admin/sessions', label: 'Experts Session' },
    { href: '/org-admin/media', label: 'Upload Media' },
    { href: '/org-admin/learning/questions', label: 'Practice Q/A' },
    { href: '/org-admin/learning/assessments', label: 'Assessments' },
    { href: '/org-admin/learning/reports', label: 'Assessment Reports' },
  ],
  TUTOR: [
    { href: '/tutor', label: 'Dashboard' },
    { href: '/tutor/courses', label: 'My Course' },
    { href: '/tutor/sessions', label: 'Expert Sessions' },
    { href: '/my-profile', label: 'My Profile' },
  ],
  STUDENT: [
    { href: '/student', label: 'Dashboard' },
    { href: '/student/courses', label: 'My Course' },
    { href: '/student/completed-courses', label: 'My Completed Courses' },
    { href: '/student/opportunities', label: 'Opportunities' },
    { href: '/student/question-paper', label: 'Question Paper Generator' },
    { href: '/student/library', label: 'Library' },
    { href: '/student/attendance', label: 'My Attendance' },
    { href: '/student/certificates', label: 'My Certificates' },
    { href: '/student/knowledge', label: 'Track My Knowledge' },
    { href: '/student/payments', label: 'Pay My Fee' },
    { href: '/my-profile', label: 'My Profile' },
  ],
  SUPER_ADMIN: [
    { href: '/super-admin/dashboard', label: 'Overview' },
    { href: '/super-admin/payments', label: 'Payments' },
    { href: '/super-admin/organizations', label: 'Organizations' },
    { href: '/super-admin/opportunities', label: 'Job Openings' },
    { href: '/super-admin/audit', label: 'Audit' },
  ],
};

export function PortalSidebar({ role }: { role: Role }) {
  const links = role === 'STUDENT'
    ? [...(linksByRole[role] ?? [])]
    : role === 'TUTOR'
      ? [...(linksByRole[role] ?? [])]
      : [...(linksByRole[role] ?? []), { href: '/notifications', label: 'Notifications' }, { href: '/my-profile', label: 'My Profile' }];
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    setIsOpen(false);
  }, [role]);

  if (!links) return null;

  const ungroupedLinks = links.filter((link) => !link.group);
  const groupedLinks = new Map<string, PortalLink[]>();
  for (const link of links) {
    if (link.group) {
      if (!groupedLinks.has(link.group)) groupedLinks.set(link.group, []);
      groupedLinks.get(link.group)?.push(link);
    }
  }

  return (
    <>
      <button type="button" className="sidebar-toggle" aria-label="Open navigation" onClick={() => setIsOpen((current) => !current)}>
        <Menu size={18} aria-hidden="true" />
      </button>
      {isOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setIsOpen(false)} />}
      <aside className={`portal-sidebar ${isOpen ? 'open' : ''}`} aria-label={`${role === 'TUTOR' ? 'Tutor' : role.replace('_', ' ')} navigation`}>
        <div className="sidebar-header">
          <BrandLogo className="sidebar-logo" />
          <button type="button" className="sidebar-close" aria-label="Close navigation" onClick={() => setIsOpen(false)}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <p className="eyebrow">WORKSPACE</p>
        <nav>
          {ungroupedLinks.map((link) => (
            <NavLink key={link.href} end={link.href === '/tutor' || link.href === `/${role.toLowerCase().replace('_', '-')}`} to={link.href} onClick={() => setIsOpen(false)}>
              <span>{link.label}</span>
            </NavLink>
          ))}
          {Array.from(groupedLinks.entries()).map(([group, groupLinks]) => (
            <div key={group} className="sidebar-group">
              <span className="sidebar-group-label">{group}</span>
              {groupLinks.map((link) => (
                <NavLink key={link.href} end={link.href === '/tutor' || link.href === `/${role.toLowerCase().replace('_', '-')}`} to={link.href} onClick={() => setIsOpen(false)}>
                  <span>{link.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
