import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import type { Role } from '../types';
import { BrandLogo } from './brand-logo';

type PortalLink = { href: string; label: string; group?: string };

const linksByRole: Partial<Record<Role, PortalLink[]>> = {
  ORG_ADMIN: [
    { href: '/org-admin', label: 'Overview' },
    { href: '/org-admin/courses', label: 'Courses' },
    { href: '/org-admin/tutors/pending', label: 'Pending Tutors' },
    { href: '/org-admin/create-tutor', label: 'Create Tutor' },
    { href: '/org-admin/students', label: 'Student Details' },
    { href: '/org-admin/tutors', label: 'Tutor Details' },
    { href: '/org-admin/notes', label: 'Publish Notes' },
    { href: '/org-admin/media', label: 'Upload Media' },
    { href: '/org-admin/learning/questions', label: 'Practice Q/A' },
    { href: '/org-admin/learning/assessments', label: 'Assessments' },
  ],
  INSTRUCTOR: [
    { href: '/tutor', label: 'Overview' },
    { href: '/tutor/courses', label: 'Courses' },
    { href: '/tutor/approvals', label: 'Pending Students' },
    { href: '/tutor/students', label: 'Student Details' },
    { href: '/tutor/tutors', label: 'Tutor Details' },
    { href: '/tutor/notes', label: 'Publish Notes' },
    { href: '/tutor/media', label: 'Upload Media' },
    { href: '/tutor/learning/questions', label: 'Practice Q/A' },
    { href: '/tutor/learning/assessments', label: 'Assessments' },
  ],
  TUTOR: [
    { href: '/tutor', label: 'Overview' },
    { href: '/tutor/students', label: 'Student Details' },
    { href: '/tutor/notes', label: 'Notes' },
    { href: '/tutor/media', label: 'Upload Media' },
  ],
  STUDENT: [
    { href: '/student', label: 'Dashboard' },
    { href: '/student/courses', label: 'My Courses', group: 'LEARN' },
    { href: '/student/media', label: 'Videos & Audios', group: 'LEARN' },
    { href: '/student/notes', label: 'Notes', group: 'LEARN' },
    { href: '/student/practice', label: 'Practice Q/A', group: 'PRACTICE' },
    { href: '/student/assessments', label: 'My Assessment', group: 'PRACTICE' },
  ],
};

export function PortalSidebar({ role }: { role: Role }) {
  const links = [...(linksByRole[role] ?? []), { href: '/notifications', label: 'Notifications' }, { href: '/my-profile', label: 'My Profile' }];
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
      <aside className={`portal-sidebar ${isOpen ? 'open' : ''}`} aria-label={`${role === 'INSTRUCTOR' || role === 'TUTOR' ? 'Tutor' : role.replace('_', ' ')} navigation`}>
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
