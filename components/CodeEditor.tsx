import React, { useState, useEffect, useRef } from 'react';
import { EditorProps, ArticleState } from '../types';
import { DEFAULT_ARTICLE } from '../constants';
import { 
  Type, 
  Heading2, 
  Quote, 
  Highlighter, 
  List, 
  Bold, 
  Eraser,
  Image as ImageIcon
} from 'lucide-react';

const InputPanel: React.FC<EditorProps> = ({ onChange, initialData }) => {
  const [article, setArticle] = useState<ArticleState>(initialData || DEFAULT_ARTICLE);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Emit Changes ---
  useEffect(() => {
    onChange(article);
  }, [article, onChange]);

  // --- Helpers for Toolbar ---
  const handleInputChange = (field: keyof ArticleState, value: string) => {
    setArticle(prev => ({ ...prev, [field]: value }));
  };

  const insertSyntax = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = article.body;
    
    const before = text.substring(0, start);
    const selection = text.substring(start, end);
    const after = text.substring(end);

    // If no selection and prefix is a line starter (like '## '), add newline if needed
    let newText = '';
    let newCursorPos = 0;

    if (prefix.trim() === '-' || prefix.trim() === '>' || prefix.trim() === '##') {
        // Block level insertion
        const isStartOfLine = start === 0 || text[start - 1] === '\n';
        const insertion = isStartOfLine ? `${prefix} ` : `\n${prefix} `;
        newText = before + insertion + selection + after;
        newCursorPos = start + insertion.length + selection.length;
    } else {
        // Inline insertion (bold, mark)
        newText = before + prefix + selection + suffix + after;
        newCursorPos = end + prefix.length + suffix.length; // Move to end of selection
    }

    handleInputChange('body', newText);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      const imageId = `img-${Date.now()}`;
      
      setArticle(prev => {
        const newBody = insertImageMarkdown(prev.body, imageId);
        return {
          ...prev,
          images: { ...(prev.images || {}), [imageId]: base64 },
          body: newBody
        };
      });
    };
    reader.readAsDataURL(file);
    
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Helper to insert image markdown at cursor position
  const insertImageMarkdown = (currentBody: string, imageId: string) => {
    const textarea = textareaRef.current;
    // If no textarea ref, just append to end
    if (!textarea) return currentBody + `\n![Image](${imageId})\n`;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    
    const before = currentBody.substring(0, start);
    const after = currentBody.substring(end);
    
    const isStartOfLine = start === 0 || currentBody[start - 1] === '\n';
    const prefix = isStartOfLine ? '' : '\n';
    
    return before + `${prefix}![Image](${imageId})\n` + after;
  };

  return (
    <div className="flex flex-col h-full bg-slate-900 border-r border-slate-700 font-sans">
      
      {/* Top Form Section */}
      <div className="p-6 border-b border-slate-700 bg-slate-800/50 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Eng Subtitle</label>
          <input 
            type="text" 
            value={article.enTitle}
            onChange={(e) => handleInputChange('enTitle', e.target.value)}
            className="w-full bg-slate-800 text-slate-300 px-3 py-2 rounded-md border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors text-sm font-serif italic"
            placeholder="e.g. Design Philosophy"
          />
        </div>
        
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Main Title</label>
          <input 
            type="text" 
            value={article.title}
            onChange={(e) => handleInputChange('title', e.target.value)}
            className="w-full bg-slate-800 text-white px-3 py-2 rounded-md border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors text-lg font-bold"
            placeholder="文章主标题..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Metadata</label>
          <input 
            type="text" 
            value={article.metadata}
            onChange={(e) => handleInputChange('metadata', e.target.value)}
            className="w-full bg-slate-800 text-slate-400 px-3 py-2 rounded-md border border-slate-700 focus:border-purple-500 focus:outline-none transition-colors text-sm"
            placeholder="日期 · 作者"
          />
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-4 py-2 bg-slate-800 border-b border-slate-700 flex flex-wrap gap-1">
        <ToolButton icon={<Heading2 size={16} />} label="H2" onClick={() => insertSyntax('##')} />
        <ToolButton icon={<Bold size={16} />} label="Bold" onClick={() => insertSyntax('**', '**')} />
        <ToolButton icon={<Highlighter size={16} />} label="Mark" onClick={() => insertSyntax('==', '==')} />
        <ToolButton icon={<Quote size={16} />} label="Quote" onClick={() => insertSyntax('>')} />
        <ToolButton icon={<List size={16} />} label="List" onClick={() => insertSyntax('-')} />
        <ToolButton icon={<ImageIcon size={16} />} label="Image" onClick={() => fileInputRef.current?.click()} />
        <input 
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*"
          onChange={handleImageUpload}
        />
        <div className="flex-1"></div>
        <button 
          onClick={() => setArticle({enTitle: '', title: '', metadata: '', body: ''})}
          className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
          title="Clear All"
        >
          <Eraser size={16} />
        </button>
      </div>

      {/* Body Editor */}
      <div className="flex-1 relative flex flex-col">
        <textarea
          ref={textareaRef}
          className="flex-1 w-full bg-[#1e1e2e] text-slate-300 p-6 text-sm leading-relaxed focus:outline-none resize-none font-mono"
          value={article.body}
          onChange={(e) => handleInputChange('body', e.target.value)}
          placeholder="在此输入正文内容...&#10;&#10;支持 Markdown 语法：&#10;## 二级标题&#10;> 引用文本&#10;- 列表项&#10;**加粗文字**&#10;==高亮文字=="
        />
        <div className="bg-[#1e1e2e] p-2 text-center border-t border-white/5">
          <p className="text-xs text-slate-500">Supports Markdown shortcuts</p>
        </div>
      </div>
    </div>
  );
};

const ToolButton: React.FC<{ icon: React.ReactNode, label: string, onClick: () => void }> = ({ icon, label, onClick }) => (
  <button 
    onClick={onClick}
    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-all hover:translate-y-[-1px]"
    title={label}
  >
    {icon}
    <span className="hidden sm:inline">{label}</span>
  </button>
);

export default InputPanel;
