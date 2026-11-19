export type CertificateArtworkData = {
  studentName: string;
  courseName: string;
  completionDate: string;
  certificateId: string;
  organizationName: string;
  verificationUrl?: string;
  sample?: boolean;
};

type CertificateRecord = {
  certificateNo: string;
  verificationCode: string;
  issuedAt: string;
  isSample?: boolean;
  student: { name: string };
  course: { title: string };
  organization: { name: string };
};

type CertificatePalette = {
  navy: string;
  magenta: string;
  lime: string;
};

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[character] ?? character);
}

function splitCertificateName(value: string): string[] {
  const trimmed = value.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 2 || trimmed.length <= 36) return [trimmed];
  const midpoint = trimmed.length / 2;
  let bestIndex = 1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index += 1) {
    const firstLineLength = words.slice(0, index).join(' ').length;
    const distance = Math.abs(firstLineLength - midpoint);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return [words.slice(0, bestIndex).join(' '), words.slice(bestIndex).join(' ')];
}

function tokenColor(token: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  if (!/^#[\da-f]{6}$/i.test(value)) throw new Error(`The design token ${token} is not a six-digit hex color`);
  return value;
}

async function logoDataUrl(): Promise<string> {
  const response = await fetch('/brand/jishnu-logo.png');
  if (!response.ok) throw new Error('The Jishnu Learning Labs logo could not be loaded');
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:image/png;base64,${btoa(binary)}`;
}

export function certificateArtworkData(certificate: CertificateRecord): CertificateArtworkData {
  const completedAt = new Date(certificate.issuedAt);
  if (Number.isNaN(completedAt.getTime())) throw new Error('The certificate completion date is invalid');
  return {
    studentName: certificate.student.name,
    courseName: certificate.course.title,
    completionDate: completedAt.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    certificateId: certificate.certificateNo,
    organizationName: certificate.organization.name,
    verificationUrl: certificate.isSample
      ? undefined
      : `${window.location.origin}/certificate-verify/${encodeURIComponent(certificate.verificationCode)}`,
    sample: certificate.isSample,
  };
}

export function renderCertificateSvg(
  data: CertificateArtworkData,
  logo: string,
  palette: CertificatePalette,
) {
  const studentName = escapeXml(data.studentName);
  const courseName = escapeXml(data.courseName);
  const completionDate = escapeXml(data.completionDate);
  const certificateId = escapeXml(data.certificateId);
  const organizationName = escapeXml(data.organizationName);
  const nameFontSize = Math.min(54, Math.max(14, 820 / (Math.max(data.studentName.length, 1) * 0.55)));
  const courseLines = splitCertificateName(data.courseName);
  const longestCourseLine = Math.max(...courseLines.map((line) => line.length));
  const courseFontSize = Math.max(14, Math.min(26, 820 / Math.max(1, longestCourseLine * 0.58)));
  const courseNameMarkup = courseLines.map((line, index) =>
    `<tspan x="561.5" dy="${index === 0 ? 0 : 25}">${escapeXml(line)}</tspan>`).join('');
  const sampleMark = data.sample
    ? `<text x="561" y="470" transform="rotate(-17 561 470)" text-anchor="middle" fill="${palette.navy}" fill-opacity=".07" font-family="Arial, sans-serif" font-size="64" font-weight="800" letter-spacing="6">SAMPLE · NOT ISSUED</text>`
    : '';
  const sampleLabel = data.sample
    ? `<text x="1050" y="55" text-anchor="end" fill="${palette.magenta}" font-family="Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="1.5">DESIGN PREVIEW · NOT ISSUED</text>`
    : '';
  const displayedCertificateId = data.sample ? 'SAMPLE ONLY · NO CERTIFICATE ID' : certificateId;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1123 794" role="img">
    <title>Course Completion Certificate for ${studentName} — ${courseName}</title>
    <defs>
      <linearGradient id="navy-teal" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${palette.navy}"/>
        <stop offset=".62" stop-color="${palette.navy}"/>
        <stop offset="1" stop-color="${palette.magenta}"/>
      </linearGradient>
    </defs>
    <rect width="1123" height="794" fill="#FFFFFF"/>
    <rect x="44" y="44" width="1035" height="706" fill="none" stroke="#DDE3E8" stroke-width="2"/>
    <rect x="55" y="55" width="1013" height="684" fill="none" stroke="#E9EDF0" stroke-width="1"/>

    <path d="M44 44H1079V207C998 230 907 240 808 223C657 197 555 101 378 72C249 51 144 68 44 127Z" fill="url(#navy-teal)"/>
    <path d="M44 44H1079V83H44Z" fill="${palette.navy}"/>
    <path d="M44 127C144 68 249 51 378 72C555 101 657 197 808 223C907 240 998 230 1079 207V247C966 272 858 275 743 252C603 224 512 134 363 108C223 84 120 111 44 176Z" fill="${palette.navy}"/>
    <path d="M44 176C120 111 223 84 363 108C512 134 603 224 743 252C858 275 966 272 1079 247V278C952 306 827 307 696 279C548 247 462 160 324 142C209 127 116 158 44 215Z" fill="${palette.magenta}" fill-opacity=".82"/>
    <path d="M44 215C116 158 209 127 324 142C462 160 548 247 696 279C827 307 952 306 1079 278V307C944 338 814 338 681 308C539 276 449 190 312 176C190 164 100 201 44 257Z" fill="#F5F7F8"/>
    <path d="M44 257C100 201 190 164 312 176C449 190 539 276 681 308C814 338 944 338 1079 307V333C939 365 809 365 673 334C529 301 437 216 299 203C182 192 96 233 44 291Z" fill="#C9CBD5"/>
    <path d="M44 291C96 233 182 192 299 203C437 216 529 301 673 334C809 365 939 365 1079 333V356C927 389 804 386 665 354C523 321 430 235 287 225C168 217 88 265 44 322Z" fill="#F5F7F8"/>

    <rect x="73" y="67" width="330" height="82" rx="8" fill="#FFFFFF"/>
    <image href="${logo}" xlink:href="${logo}" x="88" y="78" width="300" height="60" preserveAspectRatio="xMidYMid meet"/>
    ${sampleLabel}
    ${sampleMark}

    <text x="561.5" y="365" text-anchor="middle" fill="#151A25" font-family="Georgia, 'Times New Roman', serif" font-size="47" font-weight="700" letter-spacing=".7">COURSE COMPLETION</text>
    <text x="561.5" y="405" text-anchor="middle" fill="#151A25" font-family="Georgia, 'Times New Roman', serif" font-size="47" font-weight="700" letter-spacing=".7">CERTIFICATE</text>
    <text x="561.5" y="433" text-anchor="middle" fill="#151A25" font-family="Arial, sans-serif" font-size="14" font-weight="800" letter-spacing="2">OF ACHIEVEMENT</text>

    <path d="M260 450H863L828 486H295Z" fill="${palette.navy}"/>
    <path d="M295 450H828V486H295Z" fill="${palette.navy}"/>
    <path d="M295 450L260 450L278 468L260 486H295Z" fill="${palette.magenta}"/>
    <path d="M828 450L863 450L845 468L863 486H828Z" fill="${palette.magenta}"/>
    <text x="561.5" y="473" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="14" font-weight="800" letter-spacing=".8">This Certificate is Proudly Presented to</text>

    <text x="561.5" y="535" text-anchor="middle" fill="#151A25" font-family="Brush Script MT, Segoe Script, cursive" font-size="${nameFontSize}" font-weight="600" font-style="italic">${studentName}</text>
    <line x1="365" y1="551" x2="758" y2="551" stroke="#151A25" stroke-width="1.6"/>

    <text x="561.5" y="579" text-anchor="middle" fill="#343A43" font-family="Arial, sans-serif" font-size="15">For successfully completing the course</text>
    <text x="561.5" y="610" text-anchor="middle" fill="${palette.navy}" font-family="Georgia, 'Times New Roman', serif" font-size="${courseFontSize}" font-weight="700">${courseNameMarkup}</text>
    <text x="561.5" y="${courseLines.length === 2 ? 654 : 638}" text-anchor="middle" fill="#343A43" font-family="Arial, sans-serif" font-size="14">at Jishnu Learning Labs.</text>
    <text x="253" y="730" text-anchor="middle" fill="#73767C" font-family="Arial, sans-serif" font-size="8">${data.sample ? 'SAMPLE PREVIEW · NOT ISSUED' : `${displayedCertificateId} · ${organizationName}`}</text>

    <text x="253" y="680" text-anchor="middle" fill="#151A25" font-family="Arial, sans-serif" font-size="12" font-weight="700">${completionDate}</text>
    <line x1="125" y1="692" x2="381" y2="692" stroke="#151A25" stroke-width="1.5"/>
    <text x="253" y="710" text-anchor="middle" fill="#343A43" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing="1">COMPLETION DATE</text>

    <text x="870" y="680" text-anchor="middle" fill="#151A25" font-family="Brush Script MT, Segoe Script, cursive" font-size="17" font-style="italic">Jishnu Learning Labs</text>
    <line x1="741" y1="692" x2="999" y2="692" stroke="#151A25" stroke-width="1.5"/>
    <text x="870" y="710" text-anchor="middle" fill="#343A43" font-family="Arial, sans-serif" font-size="10" font-weight="700" letter-spacing=".8">AUTHORIZED SIGNATURE</text>

    <circle cx="561.5" cy="709" r="35" fill="#FFFFFF" stroke="${palette.navy}" stroke-width="3"/>
    <circle cx="561.5" cy="709" r="28" fill="${palette.magenta}" fill-opacity=".10" stroke="#BFC0CB" stroke-width="2"/>
    <circle cx="561.5" cy="709" r="22" fill="${palette.navy}" stroke="#FFFFFF" stroke-width="2"/>
    <path d="M551 682L561.5 672L572 682L567 689H556Z" fill="${palette.lime}" stroke="${palette.navy}" stroke-width="1"/>
    <circle cx="561.5" cy="697" r="4" fill="${palette.lime}"/>
    <text x="561.5" y="713" text-anchor="middle" fill="#FFFFFF" font-family="Georgia, 'Times New Roman', serif" font-size="10" font-weight="700">JLL</text>
    <text x="561.5" y="725" text-anchor="middle" fill="#FFFFFF" font-family="Arial, sans-serif" font-size="5.5" font-weight="800" letter-spacing=".6">COURSE COMPLETED</text>
    <path d="M546 737L551 749L561.5 741L572 749L577 737Z" fill="${palette.navy}"/>
    <circle cx="561.5" cy="745" r="4.5" fill="${palette.lime}" stroke="${palette.navy}" stroke-width="1"/>
  </svg>`;
}

export async function certificateArtworkDataUrl(data: CertificateArtworkData): Promise<string> {
  const [logo, navy, magenta, lime] = await Promise.all([
    logoDataUrl(),
    Promise.resolve(tokenColor('--brand-navy')),
    Promise.resolve(tokenColor('--brand-magenta')),
    Promise.resolve(tokenColor('--brand-lime')),
  ]);
  const svg = renderCertificateSvg(data, logo, { navy, magenta, lime });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

