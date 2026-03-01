import React, { useState, useRef } from 'react';
import InputPanel from './components/CodeEditor';
import PreviewCard from './components/PreviewCard';
import { Eye, Smartphone, Sparkles, Download, Loader2, Check } from 'lucide-react';
import { ArticleContent } from './types';
import { DEFAULT_ARTICLE } from './constants';
import html2canvas from 'html2canvas';
import JSZip from 'jszip';

const App: React.FC = () => {
  // Use ArticleContent object instead of HTML string
  const [articleData, setArticleData] = useState<ArticleContent>(DEFAULT_ARTICLE);
  const [mobileView, setMobileView] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  const handleExport = async () => {
    if (!cardRef.current) return;
    
    setIsExporting(true);
    try {
      // 1. Generate high-res canvas from the DOM element
      const canvas = await html2canvas(cardRef.current, {
        scale: 4, // 4x resolution for ultra-high quality
        backgroundColor: null, // Transparent
      });

      // 2. Calculate slicing dimensions
      // RedNote standard ratio is 3:4 (vertical)
      // We keep the width fixed and slice the height
      const sliceWidth = canvas.width;
      const sliceHeight = Math.floor(sliceWidth * (4 / 3));
      const totalHeight = canvas.height;
      const numSlices = Math.ceil(totalHeight / sliceHeight);

      const zip = new JSZip();

      // 3. Slice the canvas
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

          ctx.drawImage(
            canvas,
            0, sourceY, sliceWidth, drawHeight, // Source
            0, 0, sliceWidth, drawHeight        // Destination
          );

          // Convert slice to blob and add to zip
          const blob = await new Promise<Blob | null>(resolve => sliceCanvas.toBlob(resolve, 'image/png'));
          if (blob) {
            zip.file(`rednote-page-${i + 1}.png`, blob);
          }
        }
      }

      // 4. Generate and download zip
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `rednote-export-${Date.now()}.zip`;
      link.click();
      URL.revokeObjectURL(link.href);
      
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
