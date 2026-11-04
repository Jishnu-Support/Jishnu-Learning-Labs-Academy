export type Role = 'STUDENT' | 'INSTRUCTOR' | 'TUTOR' | 'ORG_ADMIN' | 'SUPER_ADMIN';
export type AccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type StudentStatus = AccountStatus;

export function roleLabel(role: Role): string {
  if (role === 'INSTRUCTOR' || role === 'TUTOR') return 'Tutor';
  return role === 'ORG_ADMIN' ? 'Organization Admin' : role === 'SUPER_ADMIN' ? 'Super Admin' : 'Student';
}
