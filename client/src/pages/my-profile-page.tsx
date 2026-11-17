import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { PageHeader } from '../components/page-header';
import { Toast } from '../components/feedback';
import { Button } from '../components/ui/button';
import { api, apiBlob, ApiError } from '../lib/api';
import { roleHomeRoute } from '../lib/auth-routes';
import { TutorRatingsPanel } from './tutor-ratings-page';

const categories = [
  ['CONTENT', 'Learning content'],
  ['SESSIONS', 'Learning sessions'],
  ['ASSESSMENTS', 'Assessments and results'],
  ['ACCOUNT', 'Account and registration updates'],
  ['REQUESTS', 'Requests'],
  ['PAYMENTS', 'Payments and refunds'],
  ['SUBSCRIPTIONS', 'Subscriptions'],
  ['CERTIFICATES', 'Certificates'],
  ['ATTENDANCE', 'Attendance'],
  ['CLASSES', 'Class bookings'],
  ['PAYOUTS', 'Tutor payouts'],
  ['SYSTEM', 'Platform updates'],
] as const;
type Preference = { category: string; enabled: boolean };
type StudentProfile = {
  fatherName: string | null;
  motherName: string | null;
  currentEducation: string | null;
  educationLevel: string | null;
  educationYear: string | null;
  currentCourse: string | null;
  institutionName: string | null;
  aadhaarNumber: string | null;
  apaarId: string | null;
  piiConsentAt: string | null;
  isDemoIdentityData: boolean;
  aadhaarFieldEnabled: boolean;
  studentId: string;
  organization: { name: string; code: string | null };
  hasPhoto: boolean;
  user: { name: string; email: string; phone: string | null };
};
type ProfileForm = {
  name: string; email: string; phone: string; fatherName: string; motherName: string;
  currentEducation: string; currentCourse: string; institutionName: string; aadhaarNumber: string; apaarId: string;
  educationLevel: string; educationYear: string; piiConsent: boolean;
};

type SampleTutorProfile = { name: string; phone: string; qualification: string; organization: string };
const initialSampleTutorProfile: SampleTutorProfile = {
  name: 'Demo Tutor',
  phone: '+91 90000 00001',
  qualification: 'M.Sc. Mathematics',
  organization: 'Jishnu Learning Labs — Sample Organization',
};

export function TutorSampleProfile() {
  const [profile, setProfile] = useState(initialSampleTutorProfile);
  const [draft, setDraft] = useState(profile);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const save = () => {
    if (!draft.name.trim() || !draft.phone.trim() || !draft.qualification.trim() || !draft.organization.trim()) return;
    setProfile(draft);
    setEditing(false);
    setSaved(true);
  };

  return <section className="card tutor-sample-profile">
    <div className="tutor-sample-heading">
      <img src="/brand/sample-tutor-avatar.svg" alt="Sample tutor profile portrait" />
      <div><p className="eyebrow">Sample profile preview</p><h2>{profile.name}</h2><p className="muted">All details below are fictional sample data.</p></div>
    </div>
    <div className="tutor-sample-fields">
      <label className="field"><span>Name</span><input className="input" value={editing ? draft.name : profile.name} readOnly={!editing} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
      <label className="field"><span>Contact number</span><input className="input" value={editing ? draft.phone : profile.phone} readOnly={!editing} maxLength={20} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} /></label>
      <label className="field"><span>Qualification</span><input className="input" value={editing ? draft.qualification : profile.qualification} readOnly={!editing} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, qualification: event.target.value }))} /></label>
      <label className="field"><span>Organization name</span><input className="input" value={editing ? draft.organization : profile.organization} readOnly={!editing} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, organization: event.target.value }))} /></label>
      <label className="field"><span>Aadhaar card number (masked sample)</span><input className="input" value="XXXX-XXXX-1234" readOnly /></label>
      <div className="field"><span>Rating (sample)</span><strong className="tutor-sample-rating" aria-label="4.5 out of 5 stars">★★★★☆ <span>4.5 / 5</span></strong></div>
    </div>
    <div className="button-row">
      {editing
        ? <><Button onClick={save}>Save sample profile</Button><Button variant="secondary" onClick={() => { setDraft(profile); setEditing(false); }}>Cancel</Button></>
        : <Button variant="secondary" onClick={() => { setDraft(profile); setSaved(false); setEditing(true); }}>Edit profile</Button>}
    </div>
    {saved && <p className="notice notice-success" role="status">Sample profile updated in this browser session.</p>}
  </section>;
}

export function MyProfilePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: '', email: '', phone: '', fatherName: '', motherName: '', currentEducation: '',
    currentCourse: '', institutionName: '', aadhaarNumber: '', apaarId: '', educationLevel: '',
    educationYear: '', piiConsent: false,
  });
  const [revealPassword, setRevealPassword] = useState('');
  const [revealedIdentifiers, setRevealedIdentifiers] = useState<{ aadhaar?: string | null; apaar?: string | null }>({});
  const revealTimers = useRef<Partial<Record<'aadhaar' | 'apaar', number>>>({});
  const [toast, setToast] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const isStudent = user?.role === 'STUDENT';
  const profileQuery = useQuery({
    queryKey: ['student-my-profile'],
    queryFn: () => api<{ profile: StudentProfile }>('/students/me'),
    enabled: isStudent,
  });
  useEffect(() => {
    const profile = profileQuery.data?.profile;
    if (!profile) return;
    setProfileForm({
      name: profile.user.name,
      email: profile.user.email,
      phone: profile.user.phone ?? '',
      fatherName: profile.fatherName ?? '',
      motherName: profile.motherName ?? '',
      currentEducation: profile.currentEducation ?? '',
      educationLevel: profile.educationLevel ?? '',
      educationYear: profile.educationYear ?? '',
      currentCourse: profile.currentCourse ?? '',
      institutionName: profile.institutionName ?? '',
      aadhaarNumber: '',
      apaarId: '',
      piiConsent: Boolean(profile.piiConsentAt),
    });
  }, [profileQuery.data]);
  useEffect(() => {
    if (!profileQuery.data?.profile.hasPhoto) {
      setPhotoUrl('');
      return;
    }
    let active = true;
    let objectUrl = '';
    void apiBlob('/students/me/photo').then((blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setPhotoUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    }).catch(() => {
      if (active) setPhotoUrl('');
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [profileQuery.data?.profile.hasPhoto]);
  const query = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: () => api<{ preferences: Preference[] }>('/notifications/preferences'),
  });
  useEffect(() => {
    if (query.data) setPreferences(query.data.preferences);
  }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<{ preferences: Preference[] }>('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ preferences }) }),
    onSuccess: async (result) => {
      setPreferences(result.preferences);
      await queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
  const saveProfile = useMutation({
    mutationFn: () => {
      const { aadhaarNumber, apaarId, ...rest } = profileForm;
      return api<{ profile: StudentProfile }>('/students/me', {
        method: 'PUT',
        body: JSON.stringify({
          name: rest.name,
          phone: rest.phone || null,
          fatherName: rest.fatherName || null,
          motherName: rest.motherName || null,
          currentEducation: rest.currentEducation || null,
          educationLevel: rest.educationLevel || null,
          educationYear: rest.educationYear || null,
          currentCourse: rest.currentCourse || null,
          institutionName: rest.institutionName || null,
          piiConsent: rest.piiConsent,
          ...(aadhaarNumber ? { aadhaarNumber } : {}),
          ...(apaarId ? { apaarId } : {}),
        }),
      });
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(['student-my-profile'], result);
      setProfileForm((current) => ({ ...current, aadhaarNumber: '', apaarId: '' }));
      setToast('Student profile saved.');
      await queryClient.invalidateQueries({ queryKey: ['student-my-profile'] });
    },
  });
  const revealIdentifier = useMutation({
    mutationFn: (field: 'aadhaar' | 'apaar') => api<{ identifier: { field: 'aadhaar' | 'apaar'; value: string | null } }>(
      '/students/me/sensitive/reveal',
      { method: 'POST', body: JSON.stringify({ field, password: revealPassword }) },
    ),
    onSuccess: ({ identifier }) => {
      setRevealedIdentifiers((current) => ({ ...current, [identifier.field]: identifier.value }));
      setRevealPassword('');
      window.clearTimeout(revealTimers.current[identifier.field]);
      revealTimers.current[identifier.field] = window.setTimeout(() => {
        setRevealedIdentifiers((current) => ({ ...current, [identifier.field]: undefined }));
        delete revealTimers.current[identifier.field];
      }, 60_000);
    },
  });
  useEffect(() => () => {
    Object.values(revealTimers.current).forEach((timer) => window.clearTimeout(timer));
  }, []);
  const savePhoto = useMutation({
    mutationFn: () => {
      if (!photoFile) throw new Error('Select a profile photo first.');
      const body = new FormData();
      body.append('photo', photoFile);
      return api('/students/me/photo', { method: 'PUT', body });
    },
    onSuccess: async () => {
      setPhotoFile(null);
      await queryClient.invalidateQueries({ queryKey: ['student-my-profile'] });
    },
  });
  const updateProfileField = (field: keyof ProfileForm, value: string) =>
    setProfileForm((current) => ({ ...current, [field]: value }));
  const studentProfile = profileQuery.data?.profile;
  const completionValues = studentProfile ? [
    profileForm.name,
    profileForm.phone,
    profileForm.fatherName,
    profileForm.motherName,
    profileForm.educationLevel,
    profileForm.educationYear,
    profileForm.currentCourse,
    profileForm.institutionName,
    studentProfile.hasPhoto,
  ] : [];
  const completion = completionValues.length
    ? Math.round((completionValues.filter(Boolean).length / completionValues.length) * 100)
    : 0;
  const isDirty = Boolean(studentProfile && (
    profileForm.name !== studentProfile.user.name
    || profileForm.phone !== (studentProfile.user.phone ?? '')
    || profileForm.fatherName !== (studentProfile.fatherName ?? '')
    || profileForm.motherName !== (studentProfile.motherName ?? '')
    || profileForm.currentEducation !== (studentProfile.currentEducation ?? '')
    || profileForm.educationLevel !== (studentProfile.educationLevel ?? '')
    || profileForm.educationYear !== (studentProfile.educationYear ?? '')
    || profileForm.currentCourse !== (studentProfile.currentCourse ?? '')
    || profileForm.institutionName !== (studentProfile.institutionName ?? '')
    || profileForm.aadhaarNumber.length > 0
    || profileForm.apaarId.length > 0
    || profileForm.piiConsent !== Boolean(studentProfile.piiConsentAt)
  ));

  return (
    <section className="portal-content profile-page">
      <PageHeader title="My Profile" backTo={roleHomeRoute(user?.role ?? 'STUDENT')} breadcrumbs={['Workspace', 'My Profile']} hasUnsavedChanges={isDirty} />
      <div className="card profile-summary"><h2>{user?.name}</h2><p>{user?.email}</p><p className="muted">{user?.role === 'TUTOR' ? 'Tutor' : user?.role}</p></div>
      {user?.role === 'TUTOR' && <><TutorSampleProfile /><TutorRatingsPanel /></>}
      {isStudent && <section className="card student-profile-form">
        <h2>Student information</h2>
        <p className="muted">Keep your personal, education, and contact information up to date. Your registered email, Student ID, and organization are read-only.</p>
        {profileQuery.isLoading && <p className="loading">Loading your profile…</p>}
        {profileQuery.error && <p className="notice notice-error" role="alert">{profileQuery.error instanceof ApiError ? profileQuery.error.message : 'Could not load your profile.'}</p>}
        {studentProfile && <>
          <div className="profile-completeness" aria-label={`Profile ${completion}% complete`}>
            <div className="row-between"><strong>Profile completeness</strong><span>{completion}%</span></div>
            <progress max={100} value={completion}>{completion}%</progress>
          </div>
          {completion < 100 && <div className="notice notice-info" role="status">Complete your profile to help your organization keep your student record accurate.</div>}
          <div className="student-photo-editor">
            {photoUrl ? <img src={photoUrl} alt="Your profile" className="student-profile-photo" /> : <div className="student-photo-placeholder" aria-hidden="true">{profileForm.name.slice(0, 1).toUpperCase()}</div>}
            <label className="field"><span>Profile photo (PNG, JPG, WEBP · max 5 MB)</span><input className="input file-input" type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} /></label>
            <Button disabled={!photoFile || savePhoto.isPending} onClick={() => savePhoto.mutate()}>{savePhoto.isPending ? 'Uploading…' : 'Upload photo'}</Button>
          </div>
          <div className="form-grid">
            <label className="field"><span>Student full name</span><input className="input" required maxLength={120} value={profileForm.name} onChange={(event) => updateProfileField('name', event.target.value)} /></label>
            <label className="field"><span>Student ID (read-only)</span><input className="input" value={studentProfile.studentId} readOnly /></label>
            <label className="field"><span>Organization (read-only)</span><input className="input" value={studentProfile.organization.name} readOnly /></label>
            <label className="field"><span>Registered email (read-only)</span><input className="input" type="email" value={studentProfile.user.email} readOnly /></label>
            <label className="field"><span>Student mobile number (+91)</span><input className="input" type="tel" maxLength={20} placeholder="+91 98765 43210" value={profileForm.phone} onChange={(event) => updateProfileField('phone', event.target.value)} onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              if (/^\d{10}$/.test(value)) updateProfileField('phone', `+91 ${value}`);
            }} /></label>
            <label className="field"><span>Father's name</span><input className="input" maxLength={120} value={profileForm.fatherName} onChange={(event) => updateProfileField('fatherName', event.target.value)} /></label>
            <label className="field"><span>Mother's name</span><input className="input" maxLength={120} value={profileForm.motherName} onChange={(event) => updateProfileField('motherName', event.target.value)} /></label>
            <label className="field"><span>Current education level</span><select className="input" value={profileForm.educationLevel} onChange={(event) => updateProfileField('educationLevel', event.target.value)}>
              <option value="">Select education level</option>
              <option value="SCHOOL">School</option><option value="DIPLOMA">Diploma</option>
              <option value="UG">Undergraduate</option><option value="PG">Postgraduate</option><option value="OTHER">Other</option>
            </select></label>
            {profileForm.educationLevel === 'SCHOOL'
              ? <label className="field"><span>Class</span><select className="input" value={profileForm.educationYear} onChange={(event) => updateProfileField('educationYear', event.target.value)}>
                <option value="">Select class</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={String(index + 1)}>Class {index + 1}</option>)}
              </select></label>
              : <label className="field"><span>Class or year</span><input className="input" maxLength={80} value={profileForm.educationYear} onChange={(event) => updateProfileField('educationYear', event.target.value)} /></label>}
            <label className="field"><span>Course, class details, or branch</span><input className="input" maxLength={160} value={profileForm.currentCourse} onChange={(event) => updateProfileField('currentCourse', event.target.value)} /></label>
            <label className="field"><span>Institution / college</span><input className="input" maxLength={200} value={profileForm.institutionName} onChange={(event) => updateProfileField('institutionName', event.target.value)} /></label>
            <label className="field"><span>Additional education details (optional)</span><input className="input" maxLength={160} value={profileForm.currentEducation} onChange={(event) => updateProfileField('currentEducation', event.target.value)} /></label>
          </div>
          <section className="sensitive-id-fields">
            <h3>Optional identity numbers</h3>
            <p className="muted">Only provide these identifiers if legally permitted and needed. Values are encrypted at rest and shown masked. Never enter them in a comment or message.</p>
            {studentProfile.aadhaarFieldEnabled
              ? <label className="field"><span>Aadhaar number (12 digits)</span><input className="input" inputMode="numeric" autoComplete="off" maxLength={12} value={profileForm.aadhaarNumber} onChange={(event) => updateProfileField('aadhaarNumber', event.target.value.replace(/\D/g, ''))} /></label>
              : <p className="muted">Aadhaar collection is disabled by this organization.</p>}
            <label className="field"><span>APAAR ID (12 digits)</span><input className="input" inputMode="numeric" autoComplete="off" maxLength={12} value={profileForm.apaarId} onChange={(event) => updateProfileField('apaarId', event.target.value.replace(/\D/g, ''))} /></label>
            <p className="muted">For students under 18, confirm that required parent or guardian consent has been obtained. You may withdraw consent; doing so removes stored identifiers.</p>
            <label className="preference-row"><span>I consent to secure storage of these optional identifiers for account verification and administration.</span><input type="checkbox" checked={profileForm.piiConsent} onChange={(event) => setProfileForm((current) => ({ ...current, piiConsent: event.target.checked }))} /></label>
            <div className="row-actions">
              <span>Aadhaar: {revealedIdentifiers.aadhaar ?? studentProfile.aadhaarNumber ?? 'Not provided'}</span>
              {studentProfile.aadhaarNumber && studentProfile.aadhaarFieldEnabled && <Button variant="secondary" disabled={!revealPassword || revealIdentifier.isPending} onClick={() => revealIdentifier.mutate('aadhaar')}>Reveal Aadhaar</Button>}
            </div>
            <div className="row-actions">
              <span>APAAR ID: {revealedIdentifiers.apaar ?? studentProfile.apaarId ?? 'Not provided'}</span>
              {studentProfile.apaarId && <Button variant="secondary" disabled={!revealPassword || revealIdentifier.isPending} onClick={() => revealIdentifier.mutate('apaar')}>Reveal APAAR ID</Button>}
            </div>
            {(studentProfile.aadhaarNumber || studentProfile.apaarId) && <label className="field"><span>Re-enter your password to reveal an identifier (visible for 60 seconds)</span><input className="input" type="password" autoComplete="current-password" value={revealPassword} onChange={(event) => setRevealPassword(event.target.value)} /></label>}
            {studentProfile.isDemoIdentityData && <p className="notice notice-info" role="status">These identifiers are fake demo data and must not be used as real identity numbers.</p>}
            {studentProfile.piiConsentAt && <p className="muted">Consent recorded {new Date(studentProfile.piiConsentAt).toLocaleDateString()}.</p>}
            {revealIdentifier.error && <p className="notice notice-error" role="alert">{revealIdentifier.error instanceof ApiError ? revealIdentifier.error.message : 'Identifier could not be revealed.'}</p>}
          </section>
          {saveProfile.error && <p className="notice notice-error" role="alert">{saveProfile.error instanceof ApiError ? saveProfile.error.message : 'Your profile could not be saved.'}</p>}
          {savePhoto.error && <p className="notice notice-error" role="alert">{savePhoto.error instanceof ApiError ? savePhoto.error.message : 'Your photo could not be uploaded.'}</p>}
          <Button disabled={saveProfile.isPending || !profileForm.name.trim()} onClick={() => saveProfile.mutate()}>{saveProfile.isPending ? 'Saving…' : 'Save student information'}</Button>
        </>}
      </section>}
      <section className="card preference-card">
        <h2>Notification preferences</h2>
        <p className="muted">Choose which in-app updates you receive. Email notifications are currently disabled.</p>
        {query.isLoading && <p className="loading">Loading preferences…</p>}
        {query.error && <p className="notice notice-error" role="alert">{query.error instanceof ApiError ? query.error.message : 'Could not load preferences.'}</p>}
        {query.data && <div className="preference-list">{categories.map(([category, label]) => {
          const preference = preferences.find((item) => item.category === category);
          return <label className="preference-row" key={category}><span>{label}</span><input type="checkbox" checked={preference?.enabled ?? true} onChange={(event) => setPreferences((current) => current.map((item) => item.category === category ? { ...item, enabled: event.target.checked } : item))} /></label>;
        })}</div>}
        {save.error && <p className="notice notice-error" role="alert">{save.error instanceof ApiError ? save.error.message : 'Could not save preferences.'}</p>}
        <Button disabled={save.isPending || query.isLoading || Boolean(query.error)} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save preferences'}</Button>
      </section>
      {toast && <Toast message={toast} onDismiss={() => setToast('')} />}
    </section>
  );
}
