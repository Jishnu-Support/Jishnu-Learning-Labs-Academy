import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';

describe('out-of-scope course routes', () => {
  it('does not expose course management in the multi-tenant foundation phase', async () => {
    expect((await request(app).get('/api/instructor/courses')).status).toBe(404);
    expect((await request(app).post('/api/instructor/courses').send({ title: 'Not in this phase' })).status).toBe(404);
  });
});
