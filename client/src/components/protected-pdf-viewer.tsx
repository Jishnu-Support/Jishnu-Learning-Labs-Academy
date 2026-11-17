import { getDocument, GlobalWorkerOptions, type PDFPageProxy } from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { useCallback, useEffect, useRef, useState } from 'react';

GlobalWorkerOptions.workerSrc = pdfWorker;

function PdfPage({ page, onRenderError }: { page: PDFPageProxy; onRenderError: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const viewport = page.getViewport({ scale: 1.25 });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const task = page.render({ canvas, canvasContext: context, viewport });
    void task.promise.catch((error: unknown) => {
      if (error instanceof Error && error.name !== 'RenderingCancelledException') onRenderError();
    });
    return () => task.cancel();
  }, [onRenderError, page]);
  return <canvas ref={canvasRef} />;
}

export function ProtectedPdfViewer({ blob, watermark }: { blob: Blob; watermark: string }) {
  const [pages, setPages] = useState<PDFPageProxy[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let loadingTask: ReturnType<typeof getDocument> | undefined;
    void (async () => {
      try {
        loadingTask = getDocument({ data: await blob.arrayBuffer() });
        const document = await loadingTask.promise;
        const loadedPages = await Promise.all(
          Array.from({ length: document.numPages }, (_, index) => document.getPage(index + 1)),
        );
        if (active) setPages(loadedPages);
      } catch {
        if (active) setError('This PDF could not be displayed.');
      }
    })();
    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [blob]);
  const handleRenderError = useCallback(() => setError('A page in this PDF could not be rendered.'), []);
  if (error) return <p className="notice notice-error" role="alert">{error}</p>;
  if (!pages.length) return <p className="loading">Preparing document viewer…</p>;
  return <div className="pdf-pages">{pages.map((page, index) => (
    <div className="protected-page" key={index + 1}>
      <PdfPage page={page} onRenderError={handleRenderError} />
      <div className="page-watermark" aria-hidden="true">{Array.from({ length: 9 }, (_, markIndex) => <span key={markIndex}>{watermark}</span>)}</div>
    </div>
  ))}</div>;
}
