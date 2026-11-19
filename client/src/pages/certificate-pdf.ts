import { jsPDF } from 'jspdf';
import { certificateArtworkData, certificateArtworkDataUrl } from './certificate-artwork';

type CertificateDocument = {
  certificateNo: string;
  verificationCode: string;
  issuedAt: string;
  isSample?: boolean;
  student: { name: string };
  course: { title: string };
  organization: { name: string };
};

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The certificate artwork could not be rendered for download'));
    image.src = source;
  });
}

export async function downloadCertificatePdf(certificate: CertificateDocument): Promise<void> {
  const artworkUrl = await certificateArtworkDataUrl(certificateArtworkData(certificate));
  const image = await loadImage(artworkUrl);
  const canvas = document.createElement('canvas');
  canvas.width = 3369;
  canvas.height = 2382;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('The certificate artwork could not be prepared for download');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const height = pdf.internal.pageSize.getHeight();
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, width, height, undefined, 'FAST');
  pdf.save(`certificate-${certificate.certificateNo}.pdf`);
}
