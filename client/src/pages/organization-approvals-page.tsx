import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { PageHeader } from '../components/page-header';
import { api, ApiError } from '../lib/api';

type Organization = {
  id: string;
  name: string;
  headName: string;
  email: string;
  contactNumber: string;
  city: string;
  country: string;
  isPlatformOwner: boolean;
  status: 'ACTIVE' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'SUSPENDED';
  createdAt: string;
  counts: { students: number; staff: number; instructors: number };
};
type Action = 'suspend' | 'reactivate' | 'approve' | 'reject';

export function OrganizationApprovalsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(searchParams.get('search') ?? '');
  const [selected, setSelected] = useState<{ organization: Organization; action: Action } | null>(null);
  const [ownerCandidate, setOwnerCandidate] = useState<Organization | null>(null);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (debouncedSearch) next.set('search', debouncedSearch);
      else next.delete('search');
      return next;
    }, { replace: true });
  }, [debouncedSearch, setSearchParams]);
  const query = useQuery({
    queryKey: ['platform-organizations', debouncedSearch],
    queryFn: () => api<{ organizations: Organization[] }>(
      `/super-admin/organizations${debouncedSearch ? `?search=${encodeURIComponent(debouncedSearch)}` : ''}`,
    ),
  });
  const mutation = useMutation({
    mutationFn: ({ organization, action, rejectionReason }: {
      organization: Organization;
      action: Action;
      rejectionReason?: string;
    }) => api<{ organization: { status: string } }>(
      `/super-admin/organizations/${encodeURIComponent(organization.id)}/${action}`,
      { method: 'POST', body: JSON.stringify(rejectionReason ? { reason: rejectionReason } : {}) },
    ),
    onSuccess: async (_data, variables) => {
      setSelected(null);
      setReason('');
      const actionLabel: Record<Action, string> = {
        suspend: 'suspended',
        reactivate: 'reactivated',
        approve: 'approved',
        reject: 'rejected',
      };
      setNotice(`${variables.organization.name}: ${actionLabel[variables.action]}.`);
      await queryClient.invalidateQueries({ queryKey: ['platform-organizations'] });
    },
  });
  const ownerMutation = useMutation({
    mutationFn: (organization: Organization) => api<{ organization: Organization }>(
      `/super-admin/organizations/${encodeURIComponent(organization.id)}/platform-owner`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
    onSuccess: async (_data, organization) => {
      setOwnerCandidate(null);
      setNotice(`${organization.name} is now the platform owner.`);
      await queryClient.invalidateQueries({ queryKey: ['platform-organizations'] });
    },
  });
  const requestAction = (organization: Organization, action: Action) => {
    setSelected({ organization, action });
    setReason('');
  };
  if (query.isLoading) return <p className="loading">Loading organizations…</p>;
  if (query.error) return <p className="notice notice-error">{query.error instanceof ApiError ? query.error.message : 'Could not load organizations.'}</p>;
  const organizations = query.data?.organizations ?? [];
  return (
    <section>
      <p className="eyebrow">SUPER ADMIN PORTAL</p>
      <PageHeader title="Organizations" backTo="/super-admin/dashboard" breadcrumbs={['Dashboard', 'Organizations']} />
      <p className="muted">Monitor platform organizations and suspend or reactivate access. User records are not shown here.</p>
      <label className="field organization-search">
        <span>Search organizations</span>
        <input className="input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, head, email, city or country" />
      </label>
      {notice && <p className="notice" role="status">{notice}</p>}
      {mutation.error && <p className="notice notice-error" role="alert">{mutation.error instanceof ApiError ? mutation.error.message : 'The organization action could not be completed.'}</p>}
      {organizations.length === 0
        ? <div className="card empty-state"><h2>No organizations found</h2><p>Try a different search.</p></div>
        : <div className="approval-list">{organizations.map((organization) => (
          <article className="card approval-row" key={organization.id}>
            <div>
              <span className={`status-pill status-${organization.status.toLowerCase()}`}>{organization.status}</span>
              <h2>{organization.name}</h2>
              <p>{organization.headName} · {organization.email}</p>
              <p className="muted">{organization.contactNumber} · {organization.city}, {organization.country}</p>
              <p className="muted">Registered {new Date(organization.createdAt).toLocaleDateString()} · {organization.counts.students} students · {organization.counts.staff} staff · {organization.counts.instructors} instructors</p>
              {organization.isPlatformOwner && <span className="status-pill status-published">Platform owner</span>}
            </div>
            <div className="row-actions">
              {!organization.isPlatformOwner && (
                <Button variant="secondary" disabled={ownerMutation.isPending} onClick={() => setOwnerCandidate(organization)}>
                  Set as platform owner
                </Button>
              )}
              {organization.status === 'PENDING' && <Button disabled={mutation.isPending} onClick={() => requestAction(organization, 'approve')}>Approve</Button>}
              {organization.status === 'ACTIVE' || organization.status === 'APPROVED'
                ? <Button variant="danger" disabled={mutation.isPending} onClick={() => requestAction(organization, 'suspend')}>Suspend</Button>
                : organization.status === 'SUSPENDED' && <Button disabled={mutation.isPending} onClick={() => requestAction(organization, 'reactivate')}>Reactivate</Button>}
              {organization.status === 'PENDING' && <Button variant="secondary" disabled={mutation.isPending} onClick={() => requestAction(organization, 'reject')}>Reject</Button>}
            </div>
          </article>
        ))}</div>}
      {selected && (
        <div className="dialog-backdrop">
          <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="organization-action-title">
            <p className="eyebrow">PLATFORM ORGANIZATION ACTION</p>
            <h2 id="organization-action-title">{selected.action === 'reject' ? 'Reject' : selected.action === 'approve' ? 'Approve' : selected.action === 'suspend' ? 'Suspend' : 'Reactivate'} {selected.organization.name}?</h2>
            {selected.action === 'reject' && (
              <label className="field">
                <span>Reason (required)</span>
                <textarea className="input textarea" value={reason} maxLength={1000} onChange={(event) => setReason(event.target.value)} />
              </label>
            )}
            {ownerCandidate && (
              <div className="dialog-backdrop">
                <section className="dialog card" role="dialog" aria-modal="true" aria-labelledby="platform-owner-title">
                  <p className="eyebrow">PLATFORM BRANDING</p>
                  <h2 id="platform-owner-title">Set {ownerCandidate.name} as platform owner?</h2>
                  <p className="muted">This changes the welcome intro shown to users. The current platform owner will be unset.</p>
                  {ownerMutation.error && (
                    <p className="notice notice-error" role="alert">
                      {ownerMutation.error instanceof ApiError ? ownerMutation.error.message : 'The platform owner could not be changed.'}
                    </p>
                  )}
                  <div className="row-actions">
                    <Button variant="secondary" onClick={() => setOwnerCandidate(null)}>Cancel</Button>
                    <Button disabled={ownerMutation.isPending} onClick={() => ownerMutation.mutate(ownerCandidate)}>
                      {ownerMutation.isPending ? 'Updating…' : 'Confirm'}
                    </Button>
                  </div>
                </section>
              </div>
            )}
            <div className="row-actions">
              <Button variant="secondary" onClick={() => setSelected(null)}>Cancel</Button>
              <Button
                variant={selected.action === 'suspend' || selected.action === 'reject' ? 'danger' : 'primary'}
                disabled={mutation.isPending || (selected.action === 'reject' && !reason.trim())}
                onClick={() => mutation.mutate({
                  ...selected,
                  ...(selected.action === 'reject' ? { rejectionReason: reason } : {}),
                })}
              >
                Confirm {selected.action}
              </Button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
