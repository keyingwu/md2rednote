import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import InputPanel from './components/CodeEditor';
import PreviewCard from './components/PreviewCard';
import { Eye, Smartphone, Sparkles, Download, Loader2, Check, LayoutGrid, RefreshCw, ChevronLeft, ChevronRight, Monitor } from 'lucide-react';
import { ArticleContent } from './types';
import { DEFAULT_ARTICLE } from './constants';

type PreviewMode = 'live' | 'pages';

type TemplateInfo = { id: string; name: string; css?: string };

type ExportResponse = {
  zipUrl: string;
  pageUrls: string[];
  pages: number;
  missingImages?: string[];
  templateId?: string;
};

const sanitizeFileName = (value: string) => value
  .replace(/[\\/:*?"<>|]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

const downloadBlobFromUrl = async (url: string, filename: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const App: React.FC = () => {
  // Use ArticleContent object instead of HTML string
  const [articleData, setArticleData] = useState<ArticleContent>(DEFAULT_ARTICLE);
  const [mobileView, setMobileView] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const [previewMode, setPreviewMode] = useState<PreviewMode>('pages');
  const [isRenderingPages, setIsRenderingPages] = useState(false);
  const [pagesDirty, setPagesDirty] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pageUrls, setPageUrls] = useState<string[]>([]);
  const [zipUrl, setZipUrl] = useState<string | null>(null);
  const [missingImages, setMissingImages] = useState<string[]>([]);
  const [activePage, setActivePage] = useState(1);
  const pagesScrollerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Array<HTMLDivElement | null>>([]);
  const scrollRafRef = useRef<number | null>(null);
  const hasAutoRenderedPagesRef = useRef(false);
  const contentVersionRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);

  const [templates, setTemplates] = useState<TemplateInfo[]>([{ id: 'default', name: 'Default', css: '' }]);
  const [templateId, setTemplateId] = useState('default');
  const [exportSecret, setExportSecret] = useState(() => (
    typeof window === 'undefined' ? '' : window.localStorage.getItem('md2rn_export_secret') ?? ''
  ));

  const deferredBody = useDeferredValue(articleData.body);
  const previewData = useMemo<ArticleContent>(() => ({
    enTitle: articleData.enTitle,
    title: articleData.title,
    metadata: articleData.metadata,
    images: articleData.images,
    body: deferredBody,
  }), [articleData.enTitle, articleData.title, articleData.metadata, articleData.images, deferredBody]);

  const handleArticleChange = useCallback((data: ArticleContent) => {
    contentVersionRef.current += 1;
    setArticleData(data);
    setPagesDirty(true);
    setPagesError(null);
  }, []);

  const selectedTemplateCss = useMemo(() => templates.find((tpl) => tpl.id === templateId)?.css ?? '', [templates, templateId]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/templates', { signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { templates?: TemplateInfo[] };
        if (!Array.isArray(data.templates)) return;
        setTemplates(data.templates);
      } catch {
        // ignore
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (templates.some((tpl) => tpl.id === templateId)) return;
    setTemplateId('default');
  }, [templates, templateId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!exportSecret) {
      window.localStorage.removeItem('md2rn_export_secret');
      return;
    }
    window.localStorage.setItem('md2rn_export_secret', exportSecret);
  }, [exportSecret]);

  const handleTemplateChange = useCallback((next: string) => {
    if (next === templateId) return;
    contentVersionRef.current += 1;
    setTemplateId(next);
    setPagesDirty(true);
    setPagesError(null);
  }, [templateId]);

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
    const totalPages = pageUrls.length;
    if (totalPages < 1) return;
    const clamped = Math.min(Math.max(pageNumber, 1), totalPages);
    setActivePage(clamped);
    pageRefs.current[clamped - 1]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [pageUrls.length]);

  const requestExport = useCallback(async (): Promise<ExportResponse> => {
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;

    const response = await fetch('/api/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(exportSecret ? { Authorization: `Bearer ${exportSecret}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
        article: articleData,
        templateId,
        options: { width: 600, ratio: 4 / 3, padding: 50, dpr: 3 },
      }),
    });

    const data = await response.json().catch(() => ({} as Partial<ExportResponse> & { error?: string }));
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Export API not found. If running locally, use `vercel dev` or deploy to Vercel.');
      }
      throw new Error((data && typeof data.error === 'string' && data.error) || `Export failed (${response.status})`);
    }

    return data as ExportResponse;
  }, [articleData, exportSecret, templateId]);

  const regeneratePages = useCallback(async () => {
    if (isRenderingPages) return;
    setPagesError(null);
    setIsRenderingPages(true);

    const versionAtStart = contentVersionRef.current;
    try {
      const data = await requestExport();
      if (contentVersionRef.current !== versionAtStart) return;

      setPageUrls(Array.isArray(data.pageUrls) ? data.pageUrls : []);
      setZipUrl(typeof data.zipUrl === 'string' ? data.zipUrl : null);
      setMissingImages(Array.isArray(data.missingImages) ? data.missingImages : []);
      setActivePage(1);
      setPagesDirty(false);

      setTimeout(() => scrollToPage(1), 0);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setPagesError(err instanceof Error ? err.message : 'Failed to render page previews.');
    } finally {
      setIsRenderingPages(false);
    }
  }, [isRenderingPages, requestExport, scrollToPage]);

  useEffect(() => {
    if (previewMode !== 'pages') return;
    if (hasAutoRenderedPagesRef.current) return;
    hasAutoRenderedPagesRef.current = true;
    void regeneratePages();
  }, [previewMode, regeneratePages]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      setPagesError(null);
      const versionAtStart = contentVersionRef.current;

      let nextZipUrl = zipUrl;
      let nextPageUrls = pageUrls;
      let nextMissing = missingImages;

      if (!nextZipUrl || pagesDirty) {
        const data = await requestExport();
        nextZipUrl = typeof data.zipUrl === 'string' ? data.zipUrl : null;
        nextPageUrls = Array.isArray(data.pageUrls) ? data.pageUrls : [];
        nextMissing = Array.isArray(data.missingImages) ? data.missingImages : [];

        if (contentVersionRef.current === versionAtStart) {
          setZipUrl(nextZipUrl);
          setPageUrls(nextPageUrls);
          setMissingImages(nextMissing);
          setPagesDirty(false);
          setActivePage(1);
        }
      }

      if (!nextZipUrl) {
        throw new Error('Export failed: missing zip URL.');
      }

      const titlePart = sanitizeFileName(articleData.title || 'rednote-export') || 'rednote-export';
      await downloadBlobFromUrl(nextZipUrl, `${titlePart}-${Date.now()}.zip`);
      
      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to export images:', err);
      setPagesError(err instanceof Error ? err.message : 'Export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0f0f1a] text-white overflow-hidden">
      <style>{selectedTemplateCss}</style>
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
                if (pageUrls.length === 0 || pagesDirty) {
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

	          <div className="hidden md:flex items-center gap-2">
	            <span className="text-xs text-slate-400">Template</span>
            <select
              value={templateId}
              onChange={(e) => handleTemplateChange(e.target.value)}
              className="h-8 rounded-md bg-slate-900/40 border border-slate-700 px-2 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
              aria-label="Template"
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
              ))}
	            </select>
	          </div>

          <input
            type="password"
            value={exportSecret}
            onChange={(e) => setExportSecret(e.target.value)}
            placeholder="Export secret (optional)"
            className="hidden md:block h-8 w-48 rounded-md bg-slate-900/40 border border-slate-700 px-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/40"
            aria-label="Export secret"
          />

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
            {exportSuccess ? 'Saved!' : 'Export ZIP'}
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
                if (nextMode === 'pages' && (pageUrls.length === 0 || pagesDirty)) {
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
	                   <PreviewCard data={previewData} />
	                 </div>
	               ) : (
	                 <div className="w-full h-full flex flex-col">
	                   <div
	                     ref={pagesScrollerRef}
	                     onScroll={handlePagesScroll}
	                     className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar snap-x snap-mandatory"
	                   >
	                     <div className="h-full flex items-start gap-8 px-8 py-8">
	                       {pageUrls.length === 0 ? (
	                         <div className="w-full h-full flex items-center justify-center">
	                           <div className="max-w-md text-center space-y-4">
	                             <div className="text-sm text-slate-300">分页预览会生成与导出一致的图片（服务端渲染）。</div>
	                             {pagesError && <div className="text-xs text-red-300">{pagesError}</div>}
	                             {missingImages.length > 0 && (
	                               <div className="text-xs text-orange-200">
	                                 有 {missingImages.length} 张图片未能渲染（请检查图片链接/上传）。
	                               </div>
	                             )}
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
	                         pageUrls.map((url, index) => (
	                           <div
	                             key={`${index}-${url}`}
	                             ref={(el) => { pageRefs.current[index] = el; }}
	                             className="snap-center shrink-0 w-[320px] sm:w-[360px] md:w-[420px] lg:w-[520px]"
	                           >
	                             <div className="bg-white rounded-2xl overflow-hidden shadow-[0_25px_50px_rgba(0,0,0,0.35),0_10px_30px_rgba(0,10,20,0.25),0_5px_15px_rgba(0,5,15,0.2)]">
	                               <img src={url} alt={`Page ${index + 1}`} className="w-full h-auto block" />
	                             </div>
	                             <div className="mt-3 text-center text-xs text-slate-400">第 {index + 1} 页</div>
	                           </div>
	                         ))
	                       )}
                     </div>
                   </div>

	                   <div className="h-14 shrink-0 border-t border-slate-700 bg-[#1a1b26] px-6 flex items-center justify-between">
	                     <div className="text-xs text-slate-400">
	                       {pageUrls.length > 0 ? `第 ${activePage} / ${pageUrls.length} 页` : '未生成分页预览'}
	                       {pagesDirty && pageUrls.length > 0 ? ' · 内容已更新' : ''}
	                       {missingImages.length > 0 && pageUrls.length > 0 ? ` · ${missingImages.length} 张图片未渲染` : ''}
	                     </div>

	                     <div className="flex items-center gap-2">
	                       <button
	                         type="button"
	                         onClick={() => scrollToPage(activePage - 1)}
	                         disabled={pageUrls.length < 2 || activePage <= 1}
	                         className="p-2 rounded-md bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-slate-800"
	                         title="Previous page"
	                       >
                         <ChevronLeft size={16} />
                       </button>

	                       <input
	                         type="range"
	                         min={1}
	                         max={Math.max(1, pageUrls.length)}
	                         value={Math.min(activePage, Math.max(1, pageUrls.length))}
	                         onChange={(e) => scrollToPage(Number(e.target.value))}
	                         disabled={pageUrls.length < 2}
	                         className="w-32 md:w-48 accent-indigo-500 disabled:opacity-40"
	                         aria-label="Page"
	                       />

	                       <button
	                         type="button"
	                         onClick={() => scrollToPage(activePage + 1)}
	                         disabled={pageUrls.length < 2 || activePage >= pageUrls.length}
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
