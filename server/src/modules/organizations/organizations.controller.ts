import type { RequestHandler } from 'express';
import * as service from './organizations.service.js';
import { organizationSearchSchema } from './organizations.schemas.js';

export const register: RequestHandler = async (req, res) => {
  const organization = await service.register(req.body);
  res.status(201).json({
    data: {
      organization,
      message: organization.status === 'PENDING'
        ? 'Registration received. The organization is waiting for Super Admin approval.'
        : 'Organization registered and activated. Save the organization code to sign in.',
    },
  });
};

export const listOrganizations: RequestHandler = async (req, res) => {
  const parsed = organizationSearchSchema.safeParse(req.query);
  if (!parsed.success) throw parsed.error;
  const organizations = await service.listOrganizations(parsed.data.search);
  res.json({ data: { organizations } });
};

export const listPending: RequestHandler = async (_req, res) => {
  const organizations = await service.listOrganizations().then((items) => items.filter(({ status }) => status === 'PENDING'));
  res.json({ data: { organizations } });
};

export const approve: RequestHandler = async (req, res) => {
  const organization = await service.approve(req.params.organizationId as string, req.auth!.userId);
  res.json({ data: { organization } });
};

export const suspend: RequestHandler = async (req, res) => {
  const organization = await service.suspend(req.params.organizationId as string, req.auth!.userId);
  res.json({ data: { organization } });
};

export const reactivate: RequestHandler = async (req, res) => {
  const organization = await service.reactivate(req.params.organizationId as string, req.auth!.userId);
  res.json({ data: { organization } });
};

export const reject: RequestHandler = async (req, res) => {
  const organization = await service.reject(req.params.organizationId as string, req.auth!.userId, req.body.reason);
  res.json({ data: { organization } });
};
