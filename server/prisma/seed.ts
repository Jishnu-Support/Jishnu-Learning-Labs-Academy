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
  const existing = await prisma.organization.findUnique({ where: { email: input.email } });
  const organization = existing ?? await prisma.organization.create({
    data: {
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
  const existing = input.organizationId
    ? await prisma.user.findUnique({
      where: { organizationId_email: { organizationId: input.organizationId, email: input.email } },
    })
    : await prisma.user.findFirst({ where: { organizationId: null, email: input.email } });
  if (existing) {
    if (existing.role !== input.role) {
      throw new Error(`Seed account ${input.email} already exists with role ${existing.role}, expected ${input.role}`);
    }
    return existing;
  }

  const user = await prisma.user.create({
    data: {
      organizationId: input.organizationId,
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
      isActive: true,
    },
  });
  await ensureSeedAudit(prisma, input.organizationId, 'ACCOUNT_CREATED', 'User', user.id, { role: input.role });
  return user;
}

async function seedInstructor(organizationId: string, passwordHash: string, email: string, name: string, status: AccountStatus) {
  const user = await seedUser({ organizationId, email, name, role: Role.INSTRUCTOR, status, passwordHash });
  const approval = await prisma.accountApproval.findUnique({ where: { userId: user.id } });
  if (!approval) {
    await prisma.accountApproval.create({
      data: {
      organizationId,
      userId: user.id,
      status: studentStatus(user.status),
      approvedAt: user.status === AccountStatus.APPROVED ? user.approvedAt : null,
      },
    });
  }
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
  const staffProfile = await prisma.staffProfile.findUnique({ where: { userId: user.id } });
  if (!staffProfile) {
    const conflictingProfile = await prisma.staffProfile.findUnique({
      where: { organizationId_staffId: { organizationId, staffId } },
    });
    if (conflictingProfile) {
      throw new Error(`Seed staff ID ${staffId} already belongs to another user`);
    }
    await prisma.staffProfile.create({
      data: { organizationId, userId: user.id, staffId, joiningDate: new Date('2026-01-15T00:00:00.000Z') },
    });
  }
  const approval = await prisma.accountApproval.findUnique({ where: { userId: user.id } });
  if (!approval) {
    await prisma.accountApproval.create({
      data: {
      organizationId,
      userId: user.id,
      status: studentStatus(user.status),
      approvedAt: user.status === AccountStatus.APPROVED ? user.approvedAt : null,
      },
    });
  }
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
  const profile = await prisma.studentProfile.findUnique({ where: { userId: user.id } });
  if (!profile) {
    const conflictingProfile = await prisma.studentProfile.findUnique({
      where: { organizationId_studentId: { organizationId, studentId: input.studentId } },
    });
    if (conflictingProfile) {
      throw new Error(`Seed student ID ${input.studentId} already belongs to another user`);
    }
    await prisma.studentProfile.create({
      data: {
        organizationId,
        userId: user.id,
        studentId: input.studentId,
        status: studentStatus(user.status),
        rejectionReason: user.status === AccountStatus.REJECTED ? 'Please contact your instructor.' : null,
        approvedAt: user.status === AccountStatus.APPROVED ? user.approvedAt : null,
      },
    });
  }
  return user;
}

async function seedSampleContent(organizationId: string, authorId: string, code: string, name: string) {
  const title = `${name} welcome notes`;
  const existingNote = await prisma.note.findFirst({ where: { organizationId, title } });
  if (!existingNote) {
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
  if (!existingSession) {
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
      if (!existing) {
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
  {
    code: 'PY101', title: 'Python', category: 'Programming', plannedHours: 40,
    description: 'Learn Python syntax, core data types, functions, object-oriented programming, and build a mini project.',
    topics: [
      ['Python Basics and Syntax', 6], ['Data Types and Control Flow', 8], ['Functions and Modules', 8],
      ['Object-Oriented Programming', 8], ['File Handling and Libraries', 6], ['Mini Project', 4],
    ],
  },
  {
    code: 'CPP101', title: 'C++', category: 'Programming', plannedHours: 45,
    description: 'Practice C++ fundamentals, memory, object-oriented programming, the STL, and a project.',
    topics: [
      ['Basics and Input/Output', 6], ['Control Structures and Functions', 8], ['Pointers and Memory', 8],
      ['Object-Oriented Programming', 10], ['STL', 8], ['Practice Project', 5],
    ],
  },
  {
    code: 'JAV101', title: 'Java', category: 'Programming', plannedHours: 45,
    description: 'Build Java skills across the JVM, object-oriented design, collections, exceptions, and concurrency.',
    topics: [
      ['Java Basics and the JVM', 6], ['OOP Concepts', 10], ['Collections', 8],
      ['Exception Handling and I/O', 7], ['Multithreading Introduction', 6], ['Mini Project', 8],
    ],
  },
  {
    code: 'JS101', title: 'JavaScript', category: 'Web Development', plannedHours: 40,
    description: 'Learn JavaScript fundamentals, browser events, asynchronous code, modern syntax, and build a project.',
    topics: [
      ['JavaScript Fundamentals', 8], ['Functions and Scope', 6], ['DOM and Events', 8],
      ['Async JavaScript and Fetch', 8], ['ES6+ Features', 6], ['Mini Project', 4],
    ],
  },
  {
    code: 'HTML101', title: 'HTML', category: 'Web Development', plannedHours: 20,
    description: 'Create accessible web documents using semantic elements, forms, tables, media, and links.',
    topics: [
      ['Structure and Tags', 4], ['Forms and Tables', 4], ['Semantic HTML', 4],
      ['Media and Links', 4], ['Accessibility and Best Practices', 4],
    ],
  },
  {
    code: 'CSS101', title: 'CSS', category: 'Web Development', plannedHours: 25,
    description: 'Style responsive interfaces with the box model, Flexbox, Grid, and accessible motion.',
    topics: [
      ['Selectors and the Box Model', 5], ['Flexbox Layout', 6], ['Grid Layout', 5],
      ['Responsive Design', 5], ['Animations and Best Practices', 4],
    ],
  },
] as const;

type SeedQuestion = {
  type: QuestionType;
  prompt: string;
  options: Prisma.InputJsonValue | null;
  answer: Prisma.InputJsonValue;
  explanation: string;
};

function seedQuestion(
  type: QuestionType,
  prompt: string,
  options: Prisma.InputJsonValue | null,
  answer: Prisma.InputJsonValue,
  explanation: string,
): SeedQuestion {
  return { type, prompt, options, answer, explanation };
}

const practiceExamples: Record<string, SeedQuestion[]> = {
  SAP101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which SAP module primarily supports financial accounting?', ['FI', 'MM', 'SD', 'HTML'], 'FI', 'FI is SAP Financial Accounting.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are standard SAP business modules?', ['FI', 'MM', 'SD', 'HTML'], ['FI', 'MM', 'SD'], 'FI, MM, and SD are standard SAP modules.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'SAP FI supports financial accounting processes.', ['True', 'False'], 'True', 'FI is the Financial Accounting module.'),
    seedQuestion(QuestionType.MATCH, 'Match each SAP module with its business area.', [{ left: 'FI', right: 'Financial Accounting' }, { left: 'MM', right: 'Materials Management' }, { left: 'SD', right: 'Sales and Distribution' }], { FI: 'Financial Accounting', MM: 'Materials Management', SD: 'Sales and Distribution' }, 'These are the standard module names.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'The SAP module for materials procurement is _____.', null, 'MM', 'MM stands for Materials Management.'),
  ],
  ENG101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Choose the grammatically correct sentence.', ['She goes to school every day.', 'She go to school every day.', 'She going school every day.', 'She gone to school every day.'], 'She goes to school every day.', 'Use goes with the third-person singular subject she.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which words are nouns?', ['teacher', 'quickly', 'library', 'blue'], ['teacher', 'library'], 'A teacher and a library name a person and a place.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'An adjective can describe a noun.', ['True', 'False'], 'True', 'Adjectives describe qualities of nouns.'),
    seedQuestion(QuestionType.MATCH, 'Match each part of speech with its role.', [{ left: 'Noun', right: 'Names a person, place, or thing' }, { left: 'Verb', right: 'Expresses an action' }, { left: 'Adjective', right: 'Describes a noun' }], { Noun: 'Names a person, place, or thing', Verb: 'Expresses an action', Adjective: 'Describes a noun' }, 'These are basic grammar roles.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'She _____ her homework every evening.', null, 'does', 'Does is the correct present-tense form.'),
  ],
  TAM101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which Tamil word is a வினைச்சொல் (verb)?', ['மரம்', 'ஓடுதல்', 'அழகு', 'பள்ளி'], 'ஓடுதல்', 'ஓடுதல் describes an action.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Select the Tamil உயிரெழுத்துக்கள் (vowels).', ['அ', 'ஆ', 'இ', 'க'], ['அ', 'ஆ', 'இ'], 'அ, ஆ, and இ are vowels; க is a consonant.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'வினைச்சொல் ஒரு செயலைக் குறிக்கும்.', ['True', 'False'], 'True', 'A verb names or expresses an action.'),
    seedQuestion(QuestionType.MATCH, 'Match each Tamil grammar term with its meaning.', [{ left: 'பெயர்ச்சொல்', right: 'பெயர்' }, { left: 'வினைச்சொல்', right: 'செயல்' }, { left: 'உரிச்சொல்', right: 'பண்பு' }], { பெயர்ச்சொல்: 'பெயர்', வினைச்சொல்: 'செயல்', உரிச்சொல்: 'பண்பு' }, 'These terms describe nouns, actions, and qualities.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'அவன் பள்ளிக்குச் _____.', null, 'சென்றான்', 'சென்றான் completes the sentence in past tense.'),
  ],
  MAT101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'What is 7 × 8?', ['54', '56', '64', '78'], '56', 'Seven groups of eight equal 56.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which numbers are factors of 12?', ['2', '3', '5', '6'], ['2', '3', '6'], '12 is divisible by 2, 3, and 6.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'The interior angles of a triangle add up to 180 degrees.', ['True', 'False'], 'True', 'This is the triangle angle-sum property.'),
    seedQuestion(QuestionType.MATCH, 'Match each calculation with its answer.', [{ left: '2²', right: '4' }, { left: 'Perimeter of a square with side 4', right: '16' }, { left: 'Area of a triangle with base 8 and height 3', right: '12' }], { '2²': '4', 'Perimeter of a square with side 4': '16', 'Area of a triangle with base 8 and height 3': '12' }, 'Apply the square, perimeter, and triangle-area formulas.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, '15 + _____ = 23.', null, '8', '23 minus 15 equals 8.'),
  ],
  SOC101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'What is the capital of India?', ['Mumbai', 'New Delhi', 'Chennai', 'Kolkata'], 'New Delhi', 'New Delhi is the national capital.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are branches of the Indian government?', ['Legislature', 'Executive', 'Judiciary', 'Monarchy'], ['Legislature', 'Executive', 'Judiciary'], 'India has legislative, executive, and judicial branches.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'The Equator divides Earth into the Northern and Southern Hemispheres.', ['True', 'False'], 'True', 'The Equator is at zero degrees latitude.'),
    seedQuestion(QuestionType.MATCH, 'Match each civics or geography term with its purpose.', [{ left: 'Map', right: 'Shows locations' }, { left: 'Constitution', right: 'Defines governing principles' }, { left: 'Parliament', right: 'Makes laws' }], { Map: 'Shows locations', Constitution: 'Defines governing principles', Parliament: 'Makes laws' }, 'These are common geography and civics references.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'A person who studies the past using evidence is a _____.', null, 'historian', 'Historians study and interpret evidence about the past.'),
  ],
  SCI101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'What is the chemical formula for water?', ['CO₂', 'H₂O', 'O₂', 'NaCl'], 'H₂O', 'A water molecule contains two hydrogen atoms and one oxygen atom.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are common states of matter?', ['Solid', 'Liquid', 'Gas', 'Shadow'], ['Solid', 'Liquid', 'Gas'], 'Solid, liquid, and gas are common states of matter.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'Green plants can make food through photosynthesis.', ['True', 'False'], 'True', 'Photosynthesis uses light energy to make sugars.'),
    seedQuestion(QuestionType.MATCH, 'Match each body part with a basic function.', [{ left: 'Roots', right: 'Absorb water from soil' }, { left: 'Leaves', right: 'Make food using light' }, { left: 'Heart', right: 'Pumps blood' }], { Roots: 'Absorb water from soil', Leaves: 'Make food using light', Heart: 'Pumps blood' }, 'Each part has a distinct biological function.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'The force that pulls objects toward Earth is _____.', null, 'gravity', 'Gravity attracts objects with mass.'),
  ],
  PY101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'What does len([1, 2, 3]) return in Python?', ['2', '3', '4', 'An error'], '3', 'The list contains three items.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are mutable Python collection types?', ['list', 'dict', 'set', 'tuple'], ['list', 'dict', 'set'], 'Lists, dictionaries, and sets are mutable; tuples are immutable.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'Python variable names are case-sensitive.', ['True', 'False'], 'True', 'Name and name are distinct identifiers in Python.'),
    seedQuestion(QuestionType.MATCH, 'Match each Python keyword with its purpose.', [{ left: 'def', right: 'Defines a function' }, { left: 'import', right: 'Loads a module' }, { left: 'return', right: 'Sends a value back' }], { def: 'Defines a function', import: 'Loads a module', return: 'Sends a value back' }, 'These keywords support functions and modules.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Complete the function header: _____ greet():', null, 'def', 'Python functions are declared with def.'),
  ],
  CPP101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which C++ stream is commonly used for console output?', ['std::cout', 'std::cin', 'std::cerrin', 'std::input'], 'std::cout', 'std::cout writes output to the console.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are C++ Standard Library containers or types?', ['std::vector', 'std::map', 'std::string', 'HTMLDiv'], ['std::vector', 'std::map', 'std::string'], 'These are standard C++ library types.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'A pointer can store the memory address of an object.', ['True', 'False'], 'True', 'Pointers hold addresses.'),
    seedQuestion(QuestionType.MATCH, 'Match each C++ type with its use.', [{ left: 'std::vector', right: 'Resizable sequence' }, { left: 'std::map', right: 'Key-value collection' }, { left: 'std::string', right: 'Text value' }], { 'std::vector': 'Resizable sequence', 'std::map': 'Key-value collection', 'std::string': 'Text value' }, 'These are common STL and standard library types.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Complete the program exit: int main() { _____ }', null, 'return 0;', 'A successful main function commonly returns zero.'),
  ],
  JAV101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'What executes Java bytecode?', ['The JVM', 'The CSS engine', 'The HTML parser', 'The SQL schema'], 'The JVM', 'The Java Virtual Machine runs Java bytecode.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are Java collection interfaces?', ['List', 'Set', 'Map', 'Thread'], ['List', 'Set', 'Map'], 'List, Set, and Map are collection interfaces.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'An ArrayList can grow as elements are added.', ['True', 'False'], 'True', 'ArrayList is a resizable list implementation.'),
    seedQuestion(QuestionType.MATCH, 'Match each Java item with its purpose.', [{ left: 'try', right: 'Starts an exception-handling block' }, { left: 'Thread', right: 'Supports concurrent execution' }, { left: 'HashMap', right: 'Stores key-value entries' }], { try: 'Starts an exception-handling block', Thread: 'Supports concurrent execution', HashMap: 'Stores key-value entries' }, 'These are common Java language and library elements.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Complete the Java output call: System._____("Hello");', null, 'println', 'println writes a line to standard output.'),
  ],
  JS101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which JavaScript declaration is block-scoped and can be reassigned?', ['let', 'var', 'function', 'package'], 'let', 'let is block-scoped and allows reassignment.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which JavaScript declarations are block-scoped?', ['let', 'const', 'var', 'window'], ['let', 'const'], 'let and const are block-scoped declarations.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'A JavaScript closure can retain access to its lexical environment.', ['True', 'False'], 'True', 'Closures preserve access to surrounding scope.'),
    seedQuestion(QuestionType.MATCH, 'Match each JavaScript feature with its purpose.', [{ left: 'const', right: 'Declares a non-reassignable binding' }, { left: 'fetch', right: 'Makes a network request' }, { left: 'addEventListener', right: 'Registers an event handler' }], { const: 'Declares a non-reassignable binding', fetch: 'Makes a network request', addEventListener: 'Registers an event handler' }, 'These are common JavaScript features and APIs.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Use _____ to wait for a promise inside an async function.', null, 'await', 'await pauses the async function until the promise settles.'),
  ],
  HTML101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which HTML element creates a hyperlink?', ['<a>', '<p>', '<table>', '<strong>'], '<a>', 'The anchor element creates links.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which are semantic HTML elements?', ['<main>', '<nav>', '<article>', '<div>'], ['<main>', '<nav>', '<article>'], 'These elements communicate meaning; div is generic.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'Useful alternative text helps make images accessible.', ['True', 'False'], 'True', 'Alt text communicates image information to assistive technology.'),
    seedQuestion(QuestionType.MATCH, 'Match each HTML tag with its purpose.', [{ left: '<h1>', right: 'Top-level heading' }, { left: '<a>', right: 'Link to a resource' }, { left: '<form>', right: 'Collects user input' }], { '<h1>': 'Top-level heading', '<a>': 'Link to a resource', '<form>': 'Collects user input' }, 'These tags represent headings, links, and forms.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Complete the closing tag for an anchor: _____', null, '</a>', 'Anchor elements close with </a>.'),
  ],
  CSS101: [
    seedQuestion(QuestionType.MCQ_SINGLE, 'Which set lists the CSS box-model layers from inside to outside?', ['Content, padding, border, margin', 'Margin, content, padding, border', 'Border, margin, content, padding', 'Padding, margin, border, content'], 'Content, padding, border, margin', 'The box model expands outward from content.'),
    seedQuestion(QuestionType.MCQ_MULTIPLE, 'Which properties form the outer edges of the CSS box model?', ['padding', 'border', 'margin', 'font-style'], ['padding', 'border', 'margin'], 'Padding, border, and margin surround content.'),
    seedQuestion(QuestionType.TRUE_FALSE, 'With the default content-box sizing, width excludes padding and border.', ['True', 'False'], 'True', 'content-box applies width to the content area only.'),
    seedQuestion(QuestionType.MATCH, 'Match each CSS feature with its purpose.', [{ left: 'display: flex', right: 'One-dimensional layout' }, { left: 'display: grid', right: 'Two-dimensional layout' }, { left: '@media', right: 'Responsive conditional styles' }], { 'display: flex': 'One-dimensional layout', 'display: grid': 'Two-dimensional layout', '@media': 'Responsive conditional styles' }, 'These features support layout and responsive design.'),
    seedQuestion(QuestionType.FILL_IN_BLANK, 'Use @_____ (max-width: 600px) to apply responsive styles.', null, 'media', '@media introduces a CSS media query.'),
  ],
};

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
    let course = await database.course.findUnique({
      where: { organizationId_code: { organizationId: organization.id, code: fixture.code } },
    });
    if (!course) {
      course = await database.course.create({
        data: {
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
    } else if (course.status !== 'PUBLISHED') {
      course = await database.course.update({
        where: { id: course.id },
        data: { status: 'PUBLISHED' },
      });
    }

    await database.courseInstructor.createMany({
      data: [{ organizationId: organization.id, courseId: course.id, instructorId: instructor.id }],
      skipDuplicates: true,
    });

    const topics = [];
    for (const [topicIndex, [title, plannedHours]] of fixture.topics.entries()) {
      const covered = (fixture.code === 'SAP101' && topicIndex === 0)
        || (fixture.code === 'ENG101' && topicIndex < 2)
        || (fixture.code === 'MAT101' && topicIndex === 0)
        || (fixture.code === 'PY101' && topicIndex < 2)
        || (fixture.code === 'JS101' && topicIndex === 0)
        || (fixture.code === 'CSS101' && topicIndex < 2);
      const existingTopic = await database.courseTopic.findUnique({
        where: {
          organizationId_courseId_order: {
            organizationId: organization.id,
            courseId: course.id,
            order: topicIndex + 1,
          },
        },
      });
      topics.push(existingTopic ?? await database.courseTopic.create({
        data: {
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
    if (!existingNote) {
      const note = await database.note.create({ data: noteData });
      await ensureSeedAudit(database, organization.id, 'NOTE_CREATED', 'Note', note.id, { published: true, courseCode: fixture.code });
    }

    const examples = practiceExamples[fixture.code];
    if (!examples) throw new Error(`No practice question fixtures configured for ${fixture.code}`);
    const assessmentId = `seed-assessment-${organization.id}-${fixture.code}`;
    const assessmentTitle = `${fixture.title} Course Assessment`;
    const existingAssessment = await database.assessment.findFirst({
      where: {
        organizationId: organization.id,
        courseId: course.id,
        OR: [{ id: assessmentId }, { title: assessmentTitle }],
      },
    });
    let assessment = existingAssessment?.status === AssessmentStatus.PUBLISHED ? existingAssessment : null;
    if (!assessment) {
      const supplementalId = `${assessmentId}-published`;
      const existingSupplement = await database.assessment.findUnique({ where: { id: supplementalId } });
      assessment = existingSupplement ?? await database.assessment.create({
        data: {
          id: existingAssessment ? supplementalId : assessmentId,
          organizationId: organization.id,
          courseId: course.id,
          createdById: instructor.id,
          title: existingAssessment ? `${fixture.title} Published Sample Assessment` : assessmentTitle,
          instructions: `Sample assessment for ${fixture.title}.`,
          totalMarks: examples.length,
          passMark: Math.ceil(examples.length / 2),
          durationMinutes: 30,
          status: AssessmentStatus.PUBLISHED,
        },
      });
    }

    const lastAssessmentQuestion = await database.assessmentQuestion.findFirst({
      where: { organizationId: organization.id, assessmentId: assessment.id },
      orderBy: { order: 'desc' },
      select: { order: true },
    });
    let nextAssessmentOrder = (lastAssessmentQuestion?.order ?? 0) + 1;
    for (const [questionIndex, example] of examples.entries()) {
      const topic = topics[questionIndex % topics.length]!;
      const existingAssessmentQuestion = await database.assessmentQuestion.findFirst({
        where: { organizationId: organization.id, assessmentId: assessment.id, prompt: example.prompt },
      });
      const questionOptions = example.options === null ? Prisma.JsonNull : example.options;
      if (!existingAssessmentQuestion) {
        await database.assessmentQuestion.create({
          data: {
            organizationId: organization.id,
            assessmentId: assessment.id,
            type: example.type,
            prompt: example.prompt,
            options: questionOptions,
            correctAnswer: example.answer,
            marks: 1,
            explanation: example.explanation,
            order: nextAssessmentOrder,
          },
        });
        nextAssessmentOrder += 1;
      }
      const existingPractice = await database.practiceQuestion.findFirst({
        where: { organizationId: organization.id, courseId: course.id, prompt: example.prompt },
      });
      if (!existingPractice) {
        await database.practiceQuestion.create({
          data: {
            organizationId: organization.id,
            courseId: course.id,
            topicId: topic.id,
            createdById: instructor.id,
            type: example.type,
            prompt: example.prompt,
            options: questionOptions,
            correctAnswer: example.answer,
            explanation: example.explanation,
            topic: topic.title,
            difficulty: QuestionDifficulty.BEGINNER,
          },
        });
      }
    }
    seededCourseCodes.push(fixture.code);
  }

  const enrollments = activeStudents.map((student, studentIndex) => ({
    student,
    courseIndexes: organization.code === 'northstar-academy'
      ? studentIndex === 0 ? [7] : []
      : studentIndex === 0 ? [0, 1, 2, 3, 9, 10, 11]
        : studentIndex === 1 ? [0, 4, 6, 8]
          : studentIndex === 2 ? [7] : [],
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
