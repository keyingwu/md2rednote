import React, { useState, useRef } from 'react';
import InputPanel from './components/CodeEditor';
import PreviewCard from './components/PreviewCard';
import { Eye, Smartphone, Sparkles, Download, Loader2, Check } from 'lucide-react';
import { ArticleContent } from './types';
import { DEFAULT_ARTICLE } from './constants';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';

const createExportPlaceholder = (message: string) => {
  const safeMessage = message.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675">
      <rect width="100%" height="100%" fill="#f8fafc"/>
      <rect x="30" y="30" width="1140" height="615" rx="16" fill="#ffffff" stroke="#e2e8f0" stroke-width="2"/>
      <text x="600" y="330" text-anchor="middle" fill="#64748b" font-size="34" font-family="system-ui, -apple-system, Segoe UI, Roboto">${safeMessage}</text>
    </svg>`
  )}`;
};

const isCrossOriginHttpImage = (src: string) => {
  if (!src) return false;
  if (src.startsWith('data:') || src.startsWith('blob:')) return false;

  try {
    const parsed = new URL(src, window.location.href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
};

const waitNextFrame = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

const waitForImagesToSettle = async (root: HTMLElement, timeoutMs = 8000) => {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image) => new Promise<void>((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }

    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      image.removeEventListener('load', done);
      image.removeEventListener('error', done);
      resolve();
    };

    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
    setTimeout(done, timeoutMs);
  })));
};

const App: React.FC = () => {
  // Use ArticleContent object instead of HTML string
  const [articleData, setArticleData] = useState<ArticleContent>(DEFAULT_ARTICLE);
  const [mobileView, setMobileView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleExport = async () => {
    if (!cardRef.current) return;
    const target = cardRef.current;
    
    setIsExporting(true);
    try {
      const display = window.getComputedStyle(target).display;
      if (display === 'none') {
        throw new Error('Preview card is hidden. Please switch to preview before exporting.');
      }

      const sourceBounds = target.getBoundingClientRect();
      const sourceWidth = Math.max(Math.round(sourceBounds.width), target.clientWidth, target.scrollWidth);
      if (sourceWidth < 1) {
        throw new Error('Preview card is not visible yet. Please try again after it is rendered.');
      }

      const sandbox = document.createElement('div');
      sandbox.style.position = 'fixed';
      sandbox.style.left = '-100000px';
      sandbox.style.top = '0';
      sandbox.style.pointerEvents = 'none';
      sandbox.style.opacity = '0';
      sandbox.style.background = '#ffffff';
      sandbox.style.zIndex = '-1';

      const clonedTarget = target.cloneNode(true) as HTMLDivElement;
      clonedTarget.style.width = `${sourceWidth}px`;
      clonedTarget.style.maxWidth = `${sourceWidth}px`;
      clonedTarget.style.minHeight = 'auto';
      clonedTarget.style.height = 'auto';
      clonedTarget.style.transform = 'none';

      const clonedImages = clonedTarget.querySelectorAll('img');
      clonedImages.forEach((img) => {
        if (isCrossOriginHttpImage(img.src)) {
          img.src = createExportPlaceholder('External image skipped during export');
        }
      });

      sandbox.appendChild(clonedTarget);
      document.body.appendChild(sandbox);

      let canvas: HTMLCanvasElement | null = null;
      try {
        await waitNextFrame();
        await waitForImagesToSettle(clonedTarget);

        const cloneBounds = clonedTarget.getBoundingClientRect();
        const width = Math.max(Math.round(cloneBounds.width), clonedTarget.clientWidth, clonedTarget.scrollWidth);
        const height = Math.max(Math.round(cloneBounds.height), clonedTarget.clientHeight, clonedTarget.scrollHeight);

        if (width < 1 || height < 1) {
          throw new Error('Export failed because preview content has zero size.');
        }

        canvas = await html2canvas(clonedTarget, {
          scale: 3,
          backgroundColor: '#ffffff',
          useCORS: true,
          imageTimeout: 15000,
          width,
          height,
        });
      } finally {
        sandbox.remove();
      }

      if (!canvas || canvas.width < 1 || canvas.height < 1) {
        throw new Error('Export failed because captured canvas has zero size. Keep preview visible and try again.');
      }

      const sliceWidth = canvas.width;
      const sliceHeight = Math.max(1, Math.floor(sliceWidth * (4 / 3)));
      const totalHeight = canvas.height;
      const numSlices = Math.max(1, Math.ceil(totalHeight / sliceHeight));

      const zip = new JSZip();

      for (let i = 0; i < numSlices; i++) {
        const sliceCanvas = document.createElement('canvas');
        sliceCanvas.width = sliceWidth;
        sliceCanvas.height = sliceHeight;
        const ctx = sliceCanvas.getContext('2d');
        
        if (ctx) {
          // Draw white background first
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, sliceWidth, sliceHeight);

          const sourceY = i * sliceHeight;
          const remainingHeight = totalHeight - sourceY;
          const drawHeight = Math.min(sliceHeight, remainingHeight);
          if (drawHeight <= 0) continue;

          ctx.drawImage(
            canvas,
            0, sourceY, sliceWidth, drawHeight,
            0, 0, sliceWidth, drawHeight
          );

          const blob = await new Promise<Blob | null>(resolve => sliceCanvas.toBlob(resolve, 'image/png'));
          if (blob) {
            zip.file(`rednote-page-${i + 1}.png`, blob);
          }
        }
      }

      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(content);
      link.href = objectUrl;
      link.download = `rednote-export-${Date.now()}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to export images:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0f0f1a] text-white overflow-hidden">
      {/* Header */}
      <header className="h-14 bg-[#1a1b26] border-b border-slate-700 flex items-center justify-between px-6 shrink-0 z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-purple-500 to-orange-400 flex items-center justify-center shadow-lg shadow-purple-500/20">
            <Sparkles size={16} className="text-white" />
          </div>
          <h1 className="font-bold text-lg tracking-tight text-white">RedNote <span className="font-light text-slate-400">Generator</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={handleExport}
            disabled={isExporting}
            className={`
              hidden md:flex items-center gap-2 px-4 py-1.5 rounded-full font-medium text-xs transition-all
              ${exportSuccess 
                ? 'bg-green-500 text-white hover:bg-green-600' 
                : 'bg-indigo-600 text-white hover:bg-indigo-500'
              }
            `}
          >
            {isExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : exportSuccess ? (
              <Check size={14} />
            ) : (
              <Download size={14} />
            )}
            {exportSuccess ? 'Saved!' : 'Export Image'}
          </button>

          <button 
            className="md:hidden p-2 text-slate-400 hover:text-white bg-slate-800 rounded-md"
            onClick={() => setMobileView(!mobileView)}
          >
            {mobileView ? <Eye size={20} /> : <Smartphone size={20} />}
          </button>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: Input Form (Hidden on mobile if preview is active) */}
        <div className={`${mobileView ? 'hidden' : 'flex'} w-full md:w-[450px] lg:w-[500px] flex-col z-20 shadow-2xl`}>
          <InputPanel onChange={setArticleData} initialData={DEFAULT_ARTICLE} /> 
        </div>

        {/* Right Pane: Preview */}
        <div className={`
          ${!mobileView ? 'hidden' : 'flex'} md:flex 
          flex-1
          bg-[linear-gradient(135deg,#1e1e2e_0%,#2d2b55_50%,#3e3a5f_100%)] 
          background-attachment-fixed
          items-center justify-center
          relative
          overflow-hidden
        `}>
           {/* Background Grid Pattern Overlay */}
           <div className="absolute inset-0 opacity-10 pointer-events-none" 
                style={{
                  backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
                  backgroundSize: '24px 24px'
                }}>
           </div>

           <div className="w-full h-full overflow-y-auto custom-scrollbar relative z-10">
             <PreviewCard ref={cardRef} data={articleData} />
           </div>
        </div>
      </main>
    </div>
  );
};

export default App;
