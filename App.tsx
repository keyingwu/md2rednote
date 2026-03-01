import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import InputPanel from './components/CodeEditor';
import PreviewCard from './components/PreviewCard';
import { Eye, Smartphone, Sparkles, Download, Loader2, Check, LayoutGrid, RefreshCw, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';
import { ArticleContent } from './types';
import { DEFAULT_ARTICLE } from './constants';

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

const waitForFontsToSettle = async (timeoutMs = 8000) => {
  if (!('fonts' in document)) return;
  try {
    const ready = document.fonts.ready;
    await Promise.race([
      ready,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Ignore font readiness issues and proceed with export.
  }
};

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

type PreviewMode = 'live' | 'pages';

const App: React.FC = () => {
  // Use ArticleContent object instead of HTML string
  const [articleData, setArticleData] = useState<ArticleContent>(DEFAULT_ARTICLE);
  const [mobileView, setMobileView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const [previewMode, setPreviewMode] = useState<PreviewMode>('pages');
  const [isRenderingPages, setIsRenderingPages] = useState(false);
  const [pagesDirty, setPagesDirty] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pagePreviews, setPagePreviews] = useState<Array<{ url: string; blob: Blob }>>([]);
  const [activePage, setActivePage] = useState(1);
  const pagesScrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollRafRef = useRef<number | null>(null);
  const hasAutoRenderedPagesRef = useRef(false);
  const contentVersionRef = useRef(0);
  const [, startPageTransition] = useTransition();

  useEffect(() => () => {
    pagePreviews.forEach((page) => URL.revokeObjectURL(page.url));
  }, [pagePreviews]);

  const deferredBody = useDeferredValue(articleData.body);
  const isCapturing = isExporting || isRenderingPages;
  const previewBody = isCapturing ? articleData.body : deferredBody;
  const previewData = useMemo<ArticleContent>(() => ({
    enTitle: articleData.enTitle,
    title: articleData.title,
    metadata: articleData.metadata,
    images: articleData.images,
    body: previewBody,
  }), [articleData.enTitle, articleData.title, articleData.metadata, articleData.images, previewBody]);

  const handleArticleChange = useCallback((data: ArticleContent) => {
    contentVersionRef.current += 1;
    setArticleData(data);
    setPagesDirty(true);
  }, []);

  const updateActivePageFromScroll = useCallback(() => {
    const container = pagesScrollerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const containerCenter = containerRect.left + containerRect.width / 2;
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    pageRefs.current.forEach((page, index) => {
      if (!page) return;
      const rect = page.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const distance = Math.abs(center - containerCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    setActivePage(bestIndex + 1);
  }, []);

  const handlePagesScroll = useCallback(() => {
    if (scrollRafRef.current != null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      updateActivePageFromScroll();
    });
  }, [updateActivePageFromScroll]);

  const scrollToPage = useCallback((pageNumber: number) => {
    const totalPages = pagePreviews.length;
    if (totalPages < 1) return;
    const clamped = Math.min(Math.max(pageNumber, 1), totalPages);
    setActivePage(clamped);
    pageRefs.current[clamped - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [pagePreviews.length]);

  const renderPageBlobs = useCallback(async (): Promise<Blob[]> => {
    let target = cardRef.current;
    if (!target) {
      await waitNextFrame();
      target = cardRef.current;
    }
    if (!target) {
      throw new Error('Preview card is not ready yet.');
    }

    const html2canvasPromise = import('html2canvas');
    await waitNextFrame();

    const display = window.getComputedStyle(target).display;
    if (display === 'none') {
      throw new Error('Preview card is hidden. Please switch to preview before exporting.');
    }

    const sourceBounds = target.getBoundingClientRect();
    const sourceWidth = Math.max(Math.ceil(sourceBounds.width), target.clientWidth, target.scrollWidth);
    if (sourceWidth < 1) {
      throw new Error('Preview card is not visible yet. Please try again after it is rendered.');
    }

    const sandbox = document.createElement('div');
    sandbox.style.position = 'fixed';
    sandbox.style.left = '-100000px';
    sandbox.style.top = '0';
    sandbox.style.pointerEvents = 'none';
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
      await waitForFontsToSettle();
      await waitForImagesToSettle(clonedTarget);

      const cloneBounds = clonedTarget.getBoundingClientRect();
      const width = Math.max(Math.ceil(cloneBounds.width), clonedTarget.clientWidth, clonedTarget.scrollWidth);
      const height = Math.max(Math.ceil(cloneBounds.height), clonedTarget.clientHeight, clonedTarget.scrollHeight);

      if (width < 1 || height < 1) {
        throw new Error('Export failed because preview content has zero size.');
      }

      const { default: html2canvas } = await html2canvasPromise;
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
    const sliceHeight = Math.max(1, Math.round(sliceWidth * (4 / 3)));
    const totalHeight = canvas.height;
    const numSlices = Math.max(1, Math.ceil(totalHeight / sliceHeight));

    const blobs: Blob[] = [];
    for (let i = 0; i < numSlices; i++) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = sliceWidth;
      sliceCanvas.height = sliceHeight;
      const ctx = sliceCanvas.getContext('2d');
      if (!ctx) continue;

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

      const blob = await new Promise<Blob>((resolve, reject) => {
        sliceCanvas.toBlob((value) => {
          if (!value) {
            reject(new Error('Failed to encode image.'));
            return;
          }
          resolve(value);
        }, 'image/png');
      });

      blobs.push(blob);
    }

    return blobs;
  }, []);

  const regeneratePages = useCallback(async () => {
    if (isRenderingPages) return;
    setPagesError(null);
    setIsRenderingPages(true);

    const versionAtStart = contentVersionRef.current;
    try {
      const blobs = await renderPageBlobs();
      if (contentVersionRef.current !== versionAtStart) {
        return;
      }

      const previews = blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
      startPageTransition(() => {
        setPagePreviews(previews);
        setActivePage(1);
        setPagesDirty(false);
      });
      setTimeout(() => scrollToPage(1), 0);
    } catch (err) {
      setPagesError(err instanceof Error ? err.message : 'Failed to render page previews.');
    } finally {
      setIsRenderingPages(false);
    }
  }, [isRenderingPages, renderPageBlobs, scrollToPage, startPageTransition]);

  useEffect(() => {
    if (previewMode !== 'pages') return;
    if (hasAutoRenderedPagesRef.current) return;
    hasAutoRenderedPagesRef.current = true;
    void regeneratePages();
  }, [previewMode, regeneratePages]);

  useEffect(() => {
    if (previewMode !== 'pages') return;
    if (!pagesDirty) return;
    if (isRenderingPages || isExporting) return;

    const timer = window.setTimeout(() => {
      void regeneratePages();
    }, 650);

    return () => window.clearTimeout(timer);
  }, [isExporting, isRenderingPages, pagesDirty, previewMode, regeneratePages]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const jszipPromise = import('jszip');
      const blobs = (previewMode === 'pages' && !pagesDirty && pagePreviews.length > 0)
        ? pagePreviews.map((page) => page.blob)
        : await renderPageBlobs();

      if (previewMode === 'pages') {
        const previews = blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }));
        startPageTransition(() => {
          setPagePreviews(previews);
          setActivePage(1);
          setPagesDirty(false);
        });
      }

      const { default: JSZip } = await jszipPromise;
      const zip = new JSZip();
      blobs.forEach((blob, index) => {
        zip.file(`rednote-page-${index + 1}.png`, blob);
      });

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
          <div className="hidden md:flex items-center rounded-lg bg-slate-900/40 border border-slate-700 overflow-hidden">
            <button
              type="button"
              onClick={() => setPreviewMode('live')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                previewMode === 'live' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="Live preview"
            >
              <Monitor size={14} />
              Live
            </button>
            <button
              type="button"
              onClick={() => {
                setPreviewMode('pages');
                if (pagePreviews.length === 0 || pagesDirty) {
                  void regeneratePages();
                }
              }}
              className={`relative flex items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
                previewMode === 'pages' ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`}
              title="Page preview"
            >
              <LayoutGrid size={14} />
              Pages
              {pagesDirty && (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-orange-400" aria-hidden="true" />
              )}
            </button>
          </div>

          <button
            onClick={handleExport}
            disabled={isExporting || isRenderingPages}
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

          {mobileView && (
            <button
              type="button"
              className="md:hidden p-2 text-slate-400 hover:text-white bg-slate-800 rounded-md"
              onClick={() => {
                const nextMode: PreviewMode = previewMode === 'live' ? 'pages' : 'live';
                setPreviewMode(nextMode);
                if (nextMode === 'pages' && (pagePreviews.length === 0 || pagesDirty)) {
                  void regeneratePages();
                }
              }}
              title={previewMode === 'live' ? 'Page preview' : 'Live preview'}
            >
              {previewMode === 'live' ? <LayoutGrid size={20} /> : <Monitor size={20} />}
            </button>
          )}
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: Input Form (Hidden on mobile if preview is active) */}
        <div className={`${mobileView ? 'hidden' : 'flex'} w-full md:w-[450px] lg:w-[500px] flex-col z-20 shadow-2xl`}>
          <InputPanel onChange={handleArticleChange} initialData={DEFAULT_ARTICLE} /> 
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

	           <div className="w-full h-full relative z-10 overflow-hidden">
               {previewMode === 'live' ? (
                 <div className="w-full h-full overflow-y-auto custom-scrollbar">
                   <PreviewCard ref={cardRef} data={previewData} />
                 </div>
               ) : (
                 <div className="w-full h-full flex flex-col">
                   <div className="absolute inset-0 opacity-0 pointer-events-none">
                     <div className="w-full h-full overflow-y-auto">
                       <PreviewCard ref={cardRef} data={previewData} />
                     </div>
                   </div>

                   <div
                     ref={pagesScrollerRef}
                     onScroll={handlePagesScroll}
                     className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar snap-x snap-mandatory"
                   >
                     <div className="h-full flex items-start gap-8 px-8 py-8">
                       {pagePreviews.length === 0 ? (
                         <div className="w-full h-full flex items-center justify-center">
                           <div className="max-w-md text-center space-y-4">
                             <div className="text-sm text-slate-300">分页预览会生成与导出一致的图片。</div>
                             {pagesError && <div className="text-xs text-red-300">{pagesError}</div>}
                             <button
                               type="button"
                               onClick={() => void regeneratePages()}
                               disabled={isRenderingPages || isExporting}
                               className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-60 disabled:hover:bg-indigo-600"
                             >
                               {isRenderingPages ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                               生成分页预览
                             </button>
                           </div>
                         </div>
                       ) : (
                         pagePreviews.map((page, index) => (
                           <div
                             key={page.url}
                             ref={(el) => { pageRefs.current[index] = el; }}
                             className="snap-center shrink-0 w-[320px] sm:w-[360px] md:w-[420px] lg:w-[520px]"
                           >
                             <div className="bg-white rounded-2xl overflow-hidden shadow-[0_25px_50px_rgba(0,0,0,0.35),0_10px_30px_rgba(0,10,20,0.25),0_5px_15px_rgba(0,5,15,0.2)]">
                               <img src={page.url} alt={`Page ${index + 1}`} className="w-full h-auto block" />
                             </div>
                             <div className="mt-3 text-center text-xs text-slate-400">第 {index + 1} 页</div>
                           </div>
                         ))
                       )}
                     </div>
                   </div>

                   <div className="h-14 shrink-0 border-t border-slate-700 bg-[#1a1b26] px-6 flex items-center justify-between">
                     <div className="text-xs text-slate-400">
                       {pagePreviews.length > 0 ? `第 ${activePage} / ${pagePreviews.length} 页` : '未生成分页预览'}
                       {pagesDirty && pagePreviews.length > 0 ? ' · 内容已更新' : ''}
                     </div>

                     <div className="flex items-center gap-2">
                       <button
                         type="button"
                         onClick={() => scrollToPage(activePage - 1)}
                         disabled={pagePreviews.length < 2 || activePage <= 1}
                         className="p-2 rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800"
                         title="Previous page"
                       >
                         <ChevronLeft size={16} />
                       </button>

                       <input
                         type="range"
                         min={1}
                         max={Math.max(1, pagePreviews.length)}
                         value={Math.min(activePage, Math.max(1, pagePreviews.length))}
                         onChange={(e) => scrollToPage(Number(e.target.value))}
                         disabled={pagePreviews.length < 2}
                         className="w-32 md:w-48 accent-indigo-500 disabled:opacity-40"
                         aria-label="Page"
                       />

                       <button
                         type="button"
                         onClick={() => scrollToPage(activePage + 1)}
                         disabled={pagePreviews.length < 2 || activePage >= pagePreviews.length}
                         className="p-2 rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800"
                         title="Next page"
                       >
                         <ChevronRight size={16} />
                       </button>

                       <button
                         type="button"
                         onClick={() => void regeneratePages()}
                         disabled={isRenderingPages || isExporting}
                         className="ml-2 inline-flex items-center gap-2 px-3 py-2 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium disabled:opacity-60 disabled:hover:bg-indigo-600"
                         title={pagesDirty ? 'Refresh preview' : 'Re-render preview'}
                       >
                         {isRenderingPages ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                         刷新
                       </button>
                     </div>
                   </div>
                 </div>
               )}
	           </div>
	        </div>
	      </main>
	    </div>
  );
};

export default App;
