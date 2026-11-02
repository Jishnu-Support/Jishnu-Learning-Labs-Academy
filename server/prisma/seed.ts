import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcrypt';
import { AccountStatus, AssessmentStatus, EnrollmentStatus, OrganizationStatus, Prisma, PrismaClient, QuestionDifficulty, QuestionType, Role, StudentStatus, type User } from '@prisma/client';

const prisma = new PrismaClient();
const developmentPassword = process.env.SEED_PASSWORD ?? 'JishnuDevOnly!2026';
const superAdminEmail = process.env.SUPER_ADMIN_EMAIL ?? 'admin@jishnu.local';
const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD ?? 'JishnuDevOnly!2026';

function studentStatus(status: AccountStatus): StudentStatus {
  switch (status) {
    case AccountStatus.PENDING: return StudentStatus.PENDING;
    case AccountStatus.APPROVED: return StudentStatus.APPROVED;
    case AccountStatus.REJECTED: return StudentStatus.REJECTED;
    case AccountStatus.SUSPENDED: return StudentStatus.SUSPENDED;
  }
}

async function ensureSeedAudit(
  database: PrismaClient,
  organizationId: string | null,
  action: string,
  targetType: string,
  targetId: string,
  metadata: object,
) {
  const existing = await database.auditLog.findFirst({
    where: { organizationId, action, targetType, targetId },
    select: { id: true },
  });
  if (!existing) {
    await database.auditLog.create({
      data: { organizationId, action, targetType, targetId, metadata: { ...metadata, source: 'development-seed' } },
    });
  }
}

async function seedOrganization(input: {
  name: string;
  code: string | null;
  headName: string;
  email: string;
  status: OrganizationStatus;
  pendingAdminPasswordHash?: string | null;
}) {
  const organization = await prisma.organization.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      code: input.code,
      headName: input.headName,
      contactNumber: '+15555550100',
      address: '100 Learning Way',
      city: 'Learning City',
      state: 'CA',
      country: 'United States',
      status: input.status,
      rejectionReason: null,
      pendingAdminPasswordHash: input.pendingAdminPasswordHash ?? null,
    },
    create: {
      name: input.name,
      code: input.code,
      headName: input.headName,
      contactNumber: '+15555550100',
      email: input.email,
      address: '100 Learning Way',
      city: 'Learning City',
      state: 'CA',
      country: 'United States',
      status: input.status,
      pendingAdminPasswordHash: input.pendingAdminPasswordHash ?? null,
    },
  });
  await ensureSeedAudit(prisma, organization.id, 'ORGANIZATION_REGISTERED', 'Organization', organization.id, { status: input.status });
  return organization;
}

async function seedUser(input: {
  organizationId: string | null;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
  passwordHash: string;
  phone?: string;
}) {
  let user: User;
  if (!input.organizationId) {
    const existing = await prisma.user.findFirst({
      where: { organizationId: null, email: input.email, role: input.role },
    });
    if (existing) {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          role: input.role,
          status: input.status,
          rejectionReason: null,
          mustChangePassword: false,
          approvedById: null,
          approvedAt: input.status === AccountStatus.APPROVED ? new Date() : null,
          passwordHash: input.passwordHash,
          phone: input.phone,
          isActive: true,
        },
      });
    } else {
      user = await prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          status: input.status,
          rejectionReason: null,
          mustChangePassword: false,
          approvedById: null,
          approvedAt: input.status === AccountStatus.APPROVED ? new Date() : null,
          passwordHash: input.passwordHash,
          phone: input.phone,
        },
      });
    }
  } else {
    user = await prisma.user.upsert({
      where: { organizationId_email: { organizationId: input.organizationId, email: input.email } },
      update: {
        name: input.name,
        role: input.role,
        status: input.status,
        rejectionReason: null,
        mustChangePassword: false,
        approvedById: null,
        approvedAt: input.status === AccountStatus.APPROVED ? new Date() : null,
        passwordHash: input.passwordHash,
        phone: input.phone,
        isActive: true,
      },
      create: {
        organizationId: input.organizationId,
        email: input.email,
        name: input.name,
        role: input.role,
        status: input.status,
        passwordHash: input.passwordHash,
        phone: input.phone,
      },
    });
  }
  await ensureSeedAudit(prisma, input.organizationId, 'ACCOUNT_CREATED', 'User', user.id, { role: input.role });
  return user;
}

async function seedInstructor(organizationId: string, passwordHash: string, email: string, name: string, status: AccountStatus) {
  const user = await seedUser({ organizationId, email, name, role: Role.INSTRUCTOR, status, passwordHash });
  await prisma.accountApproval.upsert({
    where: { userId: user.id },
    update: {
      organizationId,
      status: studentStatus(status),
      rejectionReason: null,
      approvedById: null,
      approvedAt: status === AccountStatus.APPROVED ? new Date() : null,
    },
    create: {
      organizationId,
      userId: user.id,
      status: studentStatus(status),
      approvedAt: status === AccountStatus.APPROVED ? new Date() : null,
    },
  });
  return user;
}

async function seedStaff(
  organizationId: string,
  passwordHash: string,
  email: string,
  staffId: string,
  name: string,
  status: AccountStatus,
) {
  const user = await seedUser({ organizationId, email, name, role: Role.STAFF, status, passwordHash });
  await prisma.staffProfile.upsert({
    where: { organizationId_staffId: { organizationId, staffId } },
    update: { userId: user.id },
    create: { organizationId, userId: user.id, staffId, joiningDate: new Date('2026-01-15T00:00:00.000Z') },
  });
  await prisma.accountApproval.upsert({
    where: { userId: user.id },
    update: {
      organizationId,
      status: studentStatus(status),
      rejectionReason: null,
      approvedById: null,
      approvedAt: status === AccountStatus.APPROVED ? new Date() : null,
    },
    create: {
      organizationId,
      userId: user.id,
      status: studentStatus(status),
      approvedAt: status === AccountStatus.APPROVED ? new Date() : null,
    },
  });
  return user;
}

async function seedStudent(
  organizationId: string,
  passwordHash: string,
  input: { studentId: string; email: string; name: string; status: AccountStatus },
) {
  const user = await seedUser({
    organizationId,
    email: input.email,
    name: input.name,
    role: Role.STUDENT,
    status: input.status,
    passwordHash,
    phone: '+15555550101',
  });
  await prisma.studentProfile.upsert({
    where: { organizationId_studentId: { organizationId, studentId: input.studentId } },
    update: {
      userId: user.id,
      status: studentStatus(input.status),
      rejectionReason: input.status === AccountStatus.REJECTED ? 'Please contact your instructor.' : null,
      approvedById: null,
      approvedAt: input.status === AccountStatus.APPROVED ? new Date() : null,
    },
    create: {
      organizationId,
      userId: user.id,
      studentId: input.studentId,
      status: studentStatus(input.status),
      rejectionReason: input.status === AccountStatus.REJECTED ? 'Please contact your instructor.' : null,
      approvedAt: input.status === AccountStatus.APPROVED ? new Date() : null,
    },
  });
  return user;
}

async function seedSampleContent(organizationId: string, authorId: string, code: string, name: string) {
  const title = `${name} welcome notes`;
  const existingNote = await prisma.note.findFirst({ where: { organizationId, title } });
  if (existingNote) {
    await prisma.note.update({ where: { id: existingNote.id }, data: { authorId, subject: 'Getting started', description: 'A sample note for this organization.', published: true } });
  } else {
    await prisma.note.create({
      data: { organizationId, authorId, title, subject: 'Getting started', description: 'A sample note for this organization.', published: true },
    });
  }

  const roomName = `${code}-sample-session`;
  const existingSession = await prisma.expertSession.findUnique({ where: { roomName } });
  const sessionData = {
    organizationId,
    hostId: authorId,
    title: `${name} welcome session`,
    description: 'Seeded sample expert session.',
    startsAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    durationMinutes: 45,
    audienceType: 'ALL',
  };
  if (existingSession) {
    await prisma.expertSession.update({ where: { id: existingSession.id }, data: sessionData });
  } else {
    await prisma.expertSession.create({ data: { ...sessionData, roomName } });
  }
}

async function seedAuthoredNotes(
  organizationId: string,
  organizationName: string,
  authors: Array<{ user: User; label: string }>,
) {
  for (const author of authors) {
    for (const published of [true, false]) {
      const state = published ? 'published' : 'draft';
      const title = `${organizationName} ${author.label} ${state} sample note`;
      const data = {
        organizationId,
        authorId: author.user.id,
        title,
        subject: 'Getting started',
        description: `A ${state} note authored by the ${author.label} for development testing.`,
        published,
      };
      const existing = await prisma.note.findFirst({ where: { organizationId, title } });
      if (existing) {
        await prisma.note.update({ where: { id: existing.id }, data });
      } else {
        const note = await prisma.note.create({ data });
        await ensureSeedAudit(prisma, organizationId, 'NOTE_CREATED', 'Note', note.id, { published, authorRole: author.label });
      }
    }
  }
}

async function seedTenant(
  organization: { id: string; name: string; code: string },
  passwordHash: string,
  input: {
    adminEmail: string;
    instructors: Array<{ email: string; name: string; status: AccountStatus }>;
    staff: Array<{ email: string; staffId: string; name: string; status: AccountStatus }>;
    students: Array<{ studentId: string; email: string; name: string; status: AccountStatus }>;
  },
) {
  const admin = await seedUser({
    organizationId: organization.id,
    email: input.adminEmail,
    name: `${organization.name} Admin`,
    role: Role.ORG_ADMIN,
    status: AccountStatus.APPROVED,
    passwordHash,
    phone: '+15555550100',
  });
  const instructors = [];
  for (const instructor of input.instructors) {
    instructors.push(await seedInstructor(organization.id, passwordHash, instructor.email, instructor.name, instructor.status));
  }
  const staffUsers: User[] = [];
  for (const staff of input.staff) {
    staffUsers.push(await seedStaff(organization.id, passwordHash, staff.email, staff.staffId, staff.name, staff.status));
  }
  const students = [];
  for (const student of input.students) students.push(await seedStudent(organization.id, passwordHash, student));
  const batch = await prisma.batch.upsert({
    where: { organizationId_name: { organizationId: organization.id, name: 'Foundations' } },
    update: {},
    create: { organizationId: organization.id, name: 'Foundations' },
  });
  await prisma.batchInstructor.createMany({
    data: instructors.filter((user) => user.status === AccountStatus.APPROVED).map((user) => ({
      organizationId: organization.id,
      batchId: batch.id,
      instructorId: user.id,
    })),
    skipDuplicates: true,
  });
  await prisma.batchStudent.createMany({
    data: students.filter((user) => user.status === AccountStatus.APPROVED).map((user) => ({
      organizationId: organization.id,
      batchId: batch.id,
      studentId: user.id,
    })),
    skipDuplicates: true,
  });
  const host = instructors.find((instructor) => instructor.status === AccountStatus.APPROVED);
  const sampleStaff = staffUsers.find((staff) => staff.status === AccountStatus.APPROVED);
  if (!host || !sampleStaff) throw new Error(`Seed data for ${organization.name} needs approved instructor and staff accounts`);
  await seedSampleContent(organization.id, host.id, organization.code, organization.name);
  await seedAuthoredNotes(organization.id, organization.name, [
    { user: admin, label: 'Org Admin' },
    { user: host, label: 'Instructor' },
    { user: sampleStaff, label: 'Staff' },
  ]);
  return { admin, instructors, students };
}

const courseFixtures = [
  {
    code: 'SAP101', title: 'SAP', category: 'IT / Software', plannedHours: 40,
    description: 'Learn core SAP ERP navigation and practical module workflows.',
    topics: [
      ['Introduction to SAP and Navigation', 4], ['SAP FI Basics', 10], ['SAP MM Basics', 10], ['SAP SD Basics', 10], ['Reports and Practice', 6],
    ],
  },
  {
    code: 'ENG101', title: 'English', category: 'Languages', plannedHours: 30,
    description: 'Build practical English grammar, reading, writing, and speaking skills.',
    topics: [
      ['Grammar Basics', 8], ['Vocabulary Building', 6], ['Reading Comprehension', 6], ['Writing Skills', 6], ['Speaking Practice', 4],
    ],
  },
  {
    code: 'TAM101', title: 'Tamil', category: 'Languages', plannedHours: 30,
    description: 'Develop Tamil reading, grammar, poetry, prose, and writing skills.',
    topics: [
      ['Letters and Reading', 6], ['Grammar (இலக்கணம்)', 8], ['Poetry (செய்யுள்)', 6], ['Prose (உரைநடை)', 6], ['Writing Practice', 4],
    ],
  },
  {
    code: 'MAT101', title: 'Maths', category: 'Mathematics', plannedHours: 40,
    description: 'Practice essential number, algebra, geometry, measurement, and data concepts.',
    topics: [
      ['Number System', 8], ['Algebra', 10], ['Geometry', 10], ['Mensuration', 6], ['Statistics and Data Handling', 6],
    ],
  },
  {
    code: 'SOC101', title: 'Social', category: 'Social Science', plannedHours: 30,
    description: 'Explore history, geography, civics, economics, and map skills.',
    topics: [
      ['History', 8], ['Geography', 8], ['Civics', 6], ['Economics Basics', 4], ['Map Skills', 4],
    ],
  },
  {
    code: 'SCI101', title: 'Science', category: 'Science', plannedHours: 40,
    description: 'Introduce core physics, chemistry, biology, environmental, and practical science.',
    topics: [
      ['Physics Basics', 10], ['Chemistry Basics', 10], ['Biology Basics', 10], ['Environmental Science', 6], ['Practical Experiments', 4],
    ],
  },
] as const;

const practiceExamples = [
  {
    type: QuestionType.MCQ_SINGLE,
    prompt: (course: string, topic: string) => `Which statement best describes ${topic} in ${course}?`,
    options: ['A foundational concept', 'An unrelated topic', 'A course date', 'A login credential'],
    answer: 'A foundational concept',
    explanation: 'Choose the option that accurately describes the topic.',
  },
  {
    type: QuestionType.TRUE_FALSE,
    prompt: (course: string, topic: string) => `${topic} is included in the ${course} learning plan.`,
    options: ['True', 'False'],
    answer: 'True',
    explanation: 'This topic is part of the course outline.',
  },
  {
    type: QuestionType.MATCH,
    prompt: (course: string, topic: string) => `Match the ${course} topic with its course section: ${topic}.`,
    options: [{ left: 'Example concept', right: 'Course learning topic' }],
    answer: { 'Example concept': 'Course learning topic' },
    explanation: 'The topic belongs to the course learning outline.',
  },
  {
    type: QuestionType.FILL_IN_BLANK,
    prompt: (_course: string, topic: string) => `Complete the course outline item: ${topic} is a learning _____.`,
    options: null,
    answer: 'topic',
    explanation: 'Each listed item is a course topic.',
  },
] as const;

export async function seedCourses(
  database: PrismaClient,
  organization: { id: string; name: string; code?: string | null },
  admin: User,
  instructors: User[],
  students: User[],
) {
  const activeInstructors = instructors.filter((user) => user.status === AccountStatus.APPROVED);
  const activeStudents = students.filter((user) => user.status === AccountStatus.APPROVED);
  if (!activeInstructors.length) throw new Error(`No approved instructors found for ${organization.name}`);
  const today = new Date();
  const startDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 14));
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 90));
  const seededCourseCodes: string[] = [];

  for (const [index, fixture] of courseFixtures.entries()) {
    const instructor = activeInstructors[index % activeInstructors.length]!;
    const course = await database.course.upsert({
      where: { organizationId_code: { organizationId: organization.id, code: fixture.code } },
      update: {
        title: fixture.title,
        description: fixture.description,
        category: fixture.category,
        plannedHours: fixture.plannedHours,
        startDate,
        endDate,
        status: 'PUBLISHED',
        minimumAttendancePercent: 75,
        requiresAssessmentPass: true,
        createdById: admin.id,
      },
      create: {
        organizationId: organization.id,
        code: fixture.code,
        title: fixture.title,
        description: fixture.description,
        category: fixture.category,
        plannedHours: fixture.plannedHours,
        startDate,
        endDate,
        status: 'PUBLISHED',
        minimumAttendancePercent: 75,
        requiresAssessmentPass: true,
        createdById: admin.id,
      },
    });
    await database.courseInstructor.createMany({
      data: [{ organizationId: organization.id, courseId: course.id, instructorId: instructor.id }],
      skipDuplicates: true,
    });

    const topics = [];
    for (const [topicIndex, [title, plannedHours]] of fixture.topics.entries()) {
      const covered = (fixture.code === 'SAP101' && topicIndex === 0)
        || (fixture.code === 'ENG101' && topicIndex < 2)
        || (fixture.code === 'MAT101' && topicIndex === 0);
      topics.push(await database.courseTopic.upsert({
        where: {
          organizationId_courseId_order: {
            organizationId: organization.id,
            courseId: course.id,
            order: topicIndex + 1,
          },
        },
        update: {
          title,
          plannedHours,
          covered,
          coveredAt: covered ? new Date() : null,
        },
        create: {
          organizationId: organization.id,
          courseId: course.id,
          title,
          plannedHours,
          order: topicIndex + 1,
          covered,
          coveredAt: covered ? new Date() : null,
        },
      }));
    }

    const linkedNoteTitle = `${organization.name} ${fixture.title} course notes`;
    const existingNote = await database.note.findFirst({
      where: { organizationId: organization.id, courseId: course.id, title: linkedNoteTitle },
      select: { id: true },
    });
    const noteData = {
      organizationId: organization.id,
      authorId: instructor.id,
      title: linkedNoteTitle,
      subject: fixture.category,
      description: `Published learning notes for ${fixture.title} (${fixture.code}).`,
      published: true,
      courseId: course.id,
    };
    if (existingNote) {
      await database.note.update({ where: { id: existingNote.id }, data: noteData });
    } else {
      const note = await database.note.create({ data: noteData });
      await ensureSeedAudit(database, organization.id, 'NOTE_CREATED', 'Note', note.id, { published: true, courseCode: fixture.code });
    }

    const assessmentTitle = `${fixture.title} Course Assessment`;
    const assessment = await prisma.assessment.upsert({
      where: { id: (await database.assessment.findFirst({
        where: { organizationId: organization.id, courseId: course.id, title: assessmentTitle },
        select: { id: true },
      }))?.id ?? `seed-assessment-${organization.id}-${fixture.code}` },
      update: {
        organizationId: organization.id,
        courseId: course.id,
        createdById: instructor.id,
        title: assessmentTitle,
        instructions: `Sample assessment for ${fixture.title}.`,
        totalMarks: practiceExamples.length,
        passMark: 2,
        durationMinutes: 30,
        status: AssessmentStatus.PUBLISHED,
      },
      create: {
        id: `seed-assessment-${organization.id}-${fixture.code}`,
        organizationId: organization.id,
        courseId: course.id,
        createdById: instructor.id,
        title: assessmentTitle,
        instructions: `Sample assessment for ${fixture.title}.`,
        totalMarks: practiceExamples.length,
        passMark: 2,
        durationMinutes: 30,
        status: AssessmentStatus.PUBLISHED,
      },
    });

    for (const [questionIndex, example] of practiceExamples.entries()) {
      const topic = topics[questionIndex % topics.length]!;
      const prompt = example.prompt(fixture.title, topic.title);
      const options = example.options === null ? Prisma.JsonNull : example.options;
      const answer = example.answer;
      const questionData = {
        type: example.type,
        prompt,
        options: options as Prisma.InputJsonValue,
        correctAnswer: answer as Prisma.InputJsonValue,
        marks: 1,
        explanation: example.explanation,
      };
      await database.assessmentQuestion.upsert({
        where: {
          organizationId_assessmentId_order: {
            organizationId: organization.id,
            assessmentId: assessment.id,
            order: questionIndex + 1,
          },
        },
        update: questionData,
        create: {
          organizationId: organization.id,
          assessmentId: assessment.id,
          ...questionData,
          order: questionIndex + 1,
        },
      });

      const existingPractice = await database.practiceQuestion.findFirst({
        where: { organizationId: organization.id, courseId: course.id, type: example.type, prompt },
        select: { id: true },
      });
      const practiceData = {
        organizationId: organization.id,
        courseId: course.id,
        topicId: topic.id,
        createdById: instructor.id,
        type: questionData.type,
        prompt: questionData.prompt,
        options: questionData.options,
        correctAnswer: questionData.correctAnswer,
        explanation: questionData.explanation,
        topic: topic.title,
        difficulty: QuestionDifficulty.BEGINNER,
      };
      if (existingPractice) {
        await database.practiceQuestion.update({ where: { id: existingPractice.id }, data: practiceData });
      } else {
        await database.practiceQuestion.create({ data: practiceData });
      }
    }
    seededCourseCodes.push(fixture.code);
  }

  const enrollments = activeStudents.map((student, studentIndex) => ({
    student,
    courseIndexes: organization.code === 'northstar-academy'
      ? []
      : studentIndex === 0 ? [0, 1, 2, 3] : studentIndex === 1 ? [0, 4] : [],
  }));
  for (const { student, courseIndexes } of enrollments) {
    for (const courseIndex of courseIndexes) {
      const course = await database.course.findUniqueOrThrow({
        where: { organizationId_code: { organizationId: organization.id, code: courseFixtures[courseIndex]!.code } },
        select: { id: true },
      });
      await database.enrollment.upsert({
        where: { organizationId_courseId_studentId: { organizationId: organization.id, courseId: course.id, studentId: student.id } },
        update: {},
        create: { organizationId: organization.id, courseId: course.id, studentId: student.id, status: EnrollmentStatus.ACTIVE },
      });
    }
  }
  console.log(`${organization.code ?? organization.id}: seeded course codes ${seededCourseCodes.join(', ')}`);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed development credentials in production');
  const passwordHash = await bcrypt.hash(developmentPassword, 12);
  const superAdminPasswordHash = await bcrypt.hash(superAdminPassword, 12);
  await seedUser({
    organizationId: null,
    email: superAdminEmail.toLowerCase(),
    name: 'Development Super Admin',
    role: Role.SUPER_ADMIN,
    status: AccountStatus.APPROVED,
    passwordHash: superAdminPasswordHash,
  });

  const primaryOrganization = await seedOrganization({
    name: 'Jishnu Learning Labs Demo',
    code: 'jll-demo',
    headName: 'Demo Organization Head',
    email: 'orgadmin@jll-demo.local',
    status: OrganizationStatus.ACTIVE,
  });
  const secondOrganization = await seedOrganization({
    name: 'Northstar Academy',
    code: 'northstar-academy',
    headName: 'Northstar Organization Head',
    email: 'orgadmin@northstar.local',
    status: OrganizationStatus.ACTIVE,
  });
  if (!primaryOrganization.code || !secondOrganization.code) {
    throw new Error('Approved seed organizations must have organization codes');
  }

  const primarySeed = await seedTenant({ ...primaryOrganization, code: primaryOrganization.code }, passwordHash, {
    adminEmail: 'orgadmin@jll-demo.local',
    instructors: [
      { email: 'instructor1@jll-demo.local', name: 'Asha Instructor', status: AccountStatus.APPROVED },
      { email: 'instructor2@jll-demo.local', name: 'Ravi Instructor', status: AccountStatus.APPROVED },
      { email: 'pending-instructor@jll-demo.local', name: 'Pending Instructor', status: AccountStatus.PENDING },
    ],
    staff: [
      { email: 'staff1@jll-demo.local', staffId: 'STF-1001', name: 'Development Staff One', status: AccountStatus.APPROVED },
      { email: 'staff2@jll-demo.local', staffId: 'STF-1002', name: 'Development Staff Two', status: AccountStatus.APPROVED },
      { email: 'pending-staff@jll-demo.local', staffId: 'STF-1003', name: 'Pending Staff', status: AccountStatus.PENDING },
    ],
    students: [
    { studentId: 'STU-1001', email: 'pending1@jll-demo.local', name: 'Pending Student One', status: AccountStatus.PENDING },
    { studentId: 'STU-1002', email: 'pending2@jll-demo.local', name: 'Pending Student Two', status: AccountStatus.PENDING },
    { studentId: 'STU-1003', email: 'approved1@jll-demo.local', name: 'Approved Student One', status: AccountStatus.APPROVED },
    { studentId: 'STU-1004', email: 'approved2@jll-demo.local', name: 'Approved Student Two', status: AccountStatus.APPROVED },
    { studentId: 'STU-1005', email: 'rejected@jll-demo.local', name: 'Rejected Student', status: AccountStatus.REJECTED },
    { studentId: 'STU-1006', email: 'pending3@jll-demo.local', name: 'Additional Pending Student', status: AccountStatus.PENDING },
    ],
  });
  const secondSeed = await seedTenant({ ...secondOrganization, code: secondOrganization.code }, passwordHash, {
    adminEmail: 'orgadmin@northstar.local',
    instructors: [
      { email: 'instructor@northstar.local', name: 'Northstar Instructor', status: AccountStatus.APPROVED },
      { email: 'instructor2@northstar.local', name: 'Northstar Instructor Two', status: AccountStatus.APPROVED },
    ],
    staff: [
      { email: 'staff@northstar.local', staffId: 'STF-2001', name: 'Northstar Staff', status: AccountStatus.APPROVED },
      { email: 'staff2@northstar.local', staffId: 'STF-2002', name: 'Northstar Staff Two', status: AccountStatus.APPROVED },
    ],
    students: [
    { studentId: 'STU-1001', email: 'student1@northstar.local', name: 'Northstar Student One', status: AccountStatus.APPROVED },
    { studentId: 'NST-2002', email: 'student2@northstar.local', name: 'Northstar Student Two', status: AccountStatus.PENDING },
    ],
  });
  await seedCourses(prisma, primaryOrganization, primarySeed.admin, primarySeed.instructors, primarySeed.students);
  await seedCourses(prisma, secondOrganization, secondSeed.admin, secondSeed.instructors, secondSeed.students);

  console.log('\n=== DEVELOPMENT-ONLY SEED CREDENTIALS ===');
  console.log(`Password for all seeded accounts: ${developmentPassword}`);
  console.log(`SUPER_ADMIN: ${superAdminEmail} / ${superAdminPassword} (no organization code)`);
  console.log('Jishnu Learning Labs Demo organization code: jll-demo');
  console.log('ORG_ADMIN: orgadmin@jll-demo.local');
  console.log('INSTRUCTOR: instructor1@jll-demo.local, instructor2@jll-demo.local');
  console.log('PENDING INSTRUCTOR: pending-instructor@jll-demo.local');
  console.log('STAFF: STF-1001 (staff1@jll-demo.local), STF-1002 (staff2@jll-demo.local), pending STF-1003 (pending-staff@jll-demo.local)');
  console.log('STUDENTS: pending STU-1001/STU-1002/STU-1006; approved STU-1003/STU-1004; rejected STU-1005');
  console.log('Northstar Academy organization code: northstar-academy');
  console.log('Northstar ORG_ADMIN: orgadmin@northstar.local');
  console.log('Northstar INSTRUCTORS: instructor@northstar.local, instructor2@northstar.local; STAFF: STF-2001 / STF-2002; STUDENTS: STU-1001 / NST-2002');
  console.log('Do not use these credentials outside local development.');

}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  }).finally(async () => prisma.$disconnect());
}
