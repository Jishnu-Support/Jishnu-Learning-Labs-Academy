import 'dotenv/config';

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Set TEST_DATABASE_URL in server/.env to a dedicated, disposable test database.');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.REQUIRE_ORG_APPROVAL = 'false';
process.env.PAYMENT_PROVIDER = 'MOCK';
process.env.STUDY_MATERIALS_SAVED_ONLY = 'true';
process.env.STUDENT_ID_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
