import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadCertificatePdf } from './certificate-pdf';
import { renderCertificateSvg } from './certificate-artwork';

const pdfMocks = vi.hoisted(() => ({
  addImage: vi.fn(),
  save: vi.fn(),
  jsPDF: vi.fn(),
}));

vi.mock('jspdf', () => ({ jsPDF: pdfMocks.jsPDF }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('certificate artwork', () => {
  it('uses the brand logo and dynamic certificate details and marks sample artwork clearly', () => {
    const svg = renderCertificateSvg({
      studentName: 'Sample & Student',
      courseName: 'Web Development',
      completionDate: 'June 15, 2026',
      certificateId: 'SAMPLE ONLY',
      organizationName: 'Jishnu Learning Labs',
      sample: true,
    }, 'data:image/png;base64,LOGO', {
      navy: '#14246B',
      magenta: '#9B1D80',
      lime: '#8DC63F',
    });

    expect(svg).toContain('data:image/png;base64,LOGO');
    expect(svg).toContain('Sample &amp; Student');
    expect(svg).toContain('Web Development');
    expect(svg).toContain('June 15, 2026');
    expect(svg).toContain('SAMPLE · NOT ISSUED');
    expect(svg).toContain('DESIGN PREVIEW · NOT ISSUED');
    expect(svg).toContain('SAMPLE PREVIEW · NOT ISSUED');
    expect(svg).toContain('For successfully completing the course');
    expect(svg).toContain('<tspan x="561.5" dy="0">Web Development</tspan>');
  });

  it('wraps long course titles into two centered, complete lines', () => {
    const courseName = 'Advanced TypeScript and Responsive Web Application Engineering';
    const svg = renderCertificateSvg({
      studentName: 'Student Name',
      courseName,
      completionDate: 'June 15, 2026',
      certificateId: 'JLL-2026-ABC12345',
      organizationName: 'Jishnu Learning Labs',
    }, 'data:image/png;base64,LOGO', {
      navy: '#14246B',
      magenta: '#9B1D80',
      lime: '#8DC63F',
    });

    expect(svg).toContain('>Advanced TypeScript and Responsive</tspan><tspan x="561.5" dy="25">Web Application Engineering</tspan>');
    expect(svg).toContain('at Jishnu Learning Labs.');
    expect(svg).toContain('JLL-2026-ABC12345');
  });

  it('creates a high-resolution landscape PDF from the same branded certificate artwork', async () => {
    const context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: '',
    };
    class MockImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_source: string) { this.onload?.(); }
    }

    pdfMocks.jsPDF.mockImplementation(function () {
      return {
        internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } },
        addImage: pdfMocks.addImage,
        save: pdfMocks.save,
      };
    });
    document.documentElement.style.setProperty('--brand-navy', '#14246B');
    document.documentElement.style.setProperty('--brand-magenta', '#9B1D80');
    document.documentElement.style.setProperty('--brand-lime', '#8DC63F');
    vi.stubGlobal('btoa', vi.fn(() => 'AAEC'));
    vi.stubGlobal('Image', MockImage);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([0, 1, 2]).buffer,
    })));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,RENDERED');

    await downloadCertificatePdf({
      certificateNo: 'JLL-2026-ABC12345',
      verificationCode: 'verification-code-123456',
      issuedAt: '2026-05-01T00:00:00.000Z',
      student: { name: 'Student Name' },
      course: { title: 'Course Name' },
      organization: { name: 'Demo Organization' },
    });

    expect(context.drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 3369, 2382);
    expect(pdfMocks.addImage).toHaveBeenCalledWith('data:image/png;base64,RENDERED', 'PNG', 0, 0, 297, 210, undefined, 'FAST');
    expect(pdfMocks.save).toHaveBeenCalledWith('certificate-JLL-2026-ABC12345.pdf');
  });
});
