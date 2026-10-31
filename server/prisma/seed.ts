import 'dotenv/config';
import bcrypt from 'bcrypt';
import { PrismaClient, Role, StudentStatus } from '@prisma/client';

const prisma = new PrismaClient();
const developmentPassword = process.env.SEED_PASSWORD ?? 'JishnuDevOnly!2026';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed development credentials in production');
  const passwordHash = await bcrypt.hash(developmentPassword, 12);
  const makeUser = async (email: string, name: string, role: Role) => prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash, isActive: true },
    create: { email, name, role, passwordHash },
  });
  await makeUser('admin@jishnu.local', 'Development Super Admin', Role.SUPER_ADMIN);
  const instructor1 = await makeUser('instructor1@jishnu.local', 'Asha Instructor', Role.INSTRUCTOR);
  const instructor2 = await makeUser('instructor2@jishnu.local', 'Ravi Instructor', Role.INSTRUCTOR);
  await makeUser('staff@jishnu.local', 'Development Staff', Role.STAFF);

  const batch1 = await prisma.batch.upsert({ where: { name: 'Foundations A' }, update: {}, create: { name: 'Foundations A' } });
  const batch2 = await prisma.batch.upsert({ where: { name: 'Foundations B' }, update: {}, create: { name: 'Foundations B' } });
  await prisma.batchInstructor.createMany({ data: [
    { batchId: batch1.id, instructorId: instructor1.id },
    { batchId: batch2.id, instructorId: instructor2.id },
  ], skipDuplicates: true });

  const students = [
    ['STU-1001', 'Pending Student One', 'pending1@jishnu.local', StudentStatus.PENDING],
    ['STU-1002', 'Pending Student Two', 'pending2@jishnu.local', StudentStatus.PENDING],
    ['STU-1003', 'Approved Student One', 'approved1@jishnu.local', StudentStatus.APPROVED],
    ['STU-1004', 'Approved Student Two', 'approved2@jishnu.local', StudentStatus.APPROVED],
    ['STU-1005', 'Rejected Student', 'rejected@jishnu.local', StudentStatus.REJECTED],
  ] as const;
  const studentUsers: Array<{ id: string; studentId: string; email: string }> = [];
  for (const [studentId, name, email, status] of students) {
    const user = await prisma.user.upsert({
      where: { email }, update: { name, passwordHash, role: Role.STUDENT, isActive: true },
      create: { email, name, passwordHash, role: Role.STUDENT },
    });
    await prisma.studentProfile.upsert({
      where: { studentId },
      update: { userId: user.id, status, rejectionReason: status === StudentStatus.REJECTED ? 'Please contact your instructor.' : null, approvedById: status === StudentStatus.APPROVED ? instructor1.id : null, approvedAt: status === StudentStatus.APPROVED ? new Date() : null },
      create: { userId: user.id, studentId, status, rejectionReason: status === StudentStatus.REJECTED ? 'Please contact your instructor.' : null, approvedById: status === StudentStatus.APPROVED ? instructor1.id : null, approvedAt: status === StudentStatus.APPROVED ? new Date() : null },
    });
    studentUsers.push({ id: user.id, studentId, email });
  }
  await prisma.batchStudent.createMany({ data: [
    { batchId: batch1.id, studentId: studentUsers[0]!.id },
    { batchId: batch1.id, studentId: studentUsers[2]!.id },
    { batchId: batch2.id, studentId: studentUsers[3]!.id },
  ], skipDuplicates: true });

  console.log('\n=== DEVELOPMENT-ONLY SEED CREDENTIALS ===');
  console.log(`Password for all seeded accounts: ${developmentPassword}`);
  console.log('Super Admin (Staff portal): admin@jishnu.local');
  console.log('Instructor 1: instructor1@jishnu.local');
  console.log('Instructor 2: instructor2@jishnu.local');
  console.log('Staff: staff@jishnu.local');
  console.log('Pending students: STU-1001, STU-1002');
  console.log('Approved students: STU-1003, STU-1004');
  console.log('Rejected student: STU-1005');
  console.log('Do not use these credentials outside local development.');
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
