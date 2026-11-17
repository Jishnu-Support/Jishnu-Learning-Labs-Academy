export type Role = 'STUDENT' | 'TUTOR' | 'ORG_ADMIN' | 'SUPER_ADMIN';
export type AccountStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
export type StudentStatus = AccountStatus;

export function roleLabel(role: Role): string {
  if (role === 'TUTOR') return 'Tutor';
  return role === 'ORG_ADMIN' ? 'Organization Admin' : role === 'SUPER_ADMIN' ? 'Super Admin' : 'Student';
}
