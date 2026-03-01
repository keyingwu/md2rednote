import React, { forwardRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { TemplateProps } from '../types';

const PreviewCard = forwardRef<HTMLDivElement, TemplateProps>(({ data }, ref) => {
  const { enTitle, title, metadata, body, images } = data;

  // Pre-process body to support ==highlight== syntax
  const processedBody = body.replace(/==(.*?)==/g, '<mark>$1</mark>');

  // Custom components for ReactMarkdown
  const components = {
    img: ({ src, alt, ...props }: any) => {
      // Check if src is an image ID in our map
      const imageSrc = (src && images && images[src]) ? images[src] : src;
      return (
        <img 
          src={imageSrc} 
          alt={alt || 'Article Image'} 
          className="rounded-lg shadow-md my-4 w-full"
          crossOrigin="anonymous"
          {...props} 
        />
      );
    }
  };

  return (
    <div className="flex flex-col items-center pt-6 pb-10 min-h-full gap-6">
      {/* 
        Main Card Container 
        Dimensions: 600px x 1000px (desktop), responsive on mobile
        Shadows: Three-layer 3D shadow
      */}
      <div 
        ref={ref}
        className={`
          relative bg-white rounded-xl overflow-hidden flex-shrink-0
          w-full max-w-[600px] min-h-[800px]
          shadow-[0_25px_50px_rgba(0,0,0,0.4),0_10px_30px_rgba(0,10,20,0.3),0_5px_15px_rgba(0,5,15,0.25)]
          transition-all duration-300
        `}
      >
        {/* Scrollable Content Area */}
        <div className="h-full p-[40px] md:p-[50px]">
          {/* 
            Typography Styles 
            We use a style block here to strictly scope the CSS to the user content
            without bleeding into the editor UI, mapping exactly to the prompt's specs.
          */}
          <style>{`
            /* Google Fonts Import */
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700;800&family=JetBrains+Mono:wght@400;700&family=Noto+Serif+SC:wght@700&display=swap');

            /* Highlight.js GitHub Theme */
            pre code.hljs{display:block;overflow-x:auto;padding:1em}code.hljs{padding:3px 5px}
            .hljs{color:#24292e;background:#fff}.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:#d73a49}.hljs-title,.hljs-title.class_,.hljs-title.class_.inherited__,.hljs-title.function_{color:#6f42c1}.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id,.hljs-variable{color:#005cc5}.hljs-meta .hljs-string,.hljs-regexp,.hljs-string{color:#032f62}.hljs-built_in,.hljs-symbol{color:#e36209}.hljs-code,.hljs-comment,.hljs-formula{color:#6a737d}.hljs-name,.hljs-quote,.hljs-selector-pseudo,.hljs-selector-tag{color:#22863a}.hljs-subst{color:#24292e}.hljs-section{color:#005cc5;font-weight:700}.hljs-bullet{color:#735c0f}.hljs-emphasis{color:#24292e;font-style:italic}.hljs-strong{color:#24292e;font-weight:700}.hljs-addition{color:#22863a;background-color:#f0fff4}.hljs-deletion{color:#b31d28;background-color:#ffeef0}

            .typo-content h1 {
              font-family: 'Noto Serif SC', serif;
              font-size: 36px;
              font-weight: 700;
              color: #000000;
              line-height: 1.3;
              margin-bottom: 30px;
            }
            @media (min-width: 650px) {
              .typo-content h1 { font-size: 48px; }
            }

            .typo-content h2 {
              font-family: 'Times New Roman', serif;
              font-size: 24px;
              font-weight: 700;
              color: #000000;
              margin-top: 40px;
              margin-bottom: 20px;
            }
            @media (min-width: 650px) {
              .typo-content h2 { font-size: 26px; }
            }

            .typo-content h3 {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-size: 22px;
              font-weight: 600;
              color: #2c3e50;
              margin-top: 30px;
              margin-bottom: 15px;
            }

            .typo-content h4 {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-size: 20px;
              font-weight: 600;
              color: #5a6c7d;
              margin-top: 25px;
              margin-bottom: 12px;
            }

            .typo-content p {
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-size: 18px;
              color: #333333;
              line-height: 1.8;
              margin-bottom: 20px;
            }
            @media (min-width: 650px) {
              .typo-content p { font-size: 20px; }
            }

            .typo-content .en-title {
              font-family: 'Inter', sans-serif;
              font-size: 16px;
              color: #888888;
              font-weight: 300;
              display: block;
              margin-bottom: 10px;
              letter-spacing: 1px;
              text-transform: uppercase;
            }

            .typo-content .metadata {
              font-family: system-ui;
              font-size: 14px;
              color: #888;
              margin-bottom: 30px;
              border-bottom: 1px solid #eee;
              padding-bottom: 20px;
            }

            .typo-content a {
              color: #4a9eff;
              text-decoration: none;
              transition: all 0.2s ease;
            }
            .typo-content a:hover {
              text-decoration: underline;
            }

            .typo-content em {
              color: #000000;
              font-style: normal;
              font-weight: 500; /* Subtle emphasis */
            }

            .typo-content strong {
              font-weight: 700;
              color: #000;
            }

            .typo-content mark {
              background-color: #fff59d;
              color: #000000;
              font-weight: bold;
              border-bottom: 2px solid #ff9800;
              border-radius: 4px;
              padding: 2px 6px;
            }

            .typo-content ul, .typo-content ol {
              font-size: 18px;
              padding-left: 20px;
              margin-bottom: 20px;
              list-style-position: outside;
              color: #333;
            }
            @media (min-width: 650px) {
              .typo-content ul, .typo-content ol { font-size: 20px; }
            }

            .typo-content li {
              margin-bottom: 8px;
            }
            .typo-content ul { list-style-type: disc; }
            .typo-content ol { list-style-type: decimal; }

            .typo-content blockquote {
              border-left: 4px solid #4a9eff;
              padding-left: 20px;
              font-style: italic;
              margin: 20px 0;
              color: #555;
              background: #f8fbff;
              padding: 16px 20px;
              border-radius: 0 8px 8px 0;
            }

            .typo-content img {
              max-width: 100%;
              border-radius: 8px;
              margin: 20px 0;
              box-shadow: 0 4px 12px rgba(0,0,0,0.1);
              display: block;
            }

            /* Code Block Styling - Fixed Colors */
            .typo-content pre {
              background: #f6f8fa !important; /* Force light background */
              padding: 16px;
              border-radius: 8px;
              overflow-x: auto;
              margin-bottom: 20px;
              border: 1px solid #e1e4e8;
            }
            
            .typo-content code {
              font-family: 'JetBrains Mono', monospace;
              font-size: 14px;
              color: #24292e !important; /* Force dark text color */
              background-color: rgba(27, 31, 35, 0.05);
              padding: 0.2em 0.4em;
              border-radius: 3px;
            }
            
            /* Reset for code blocks to let highlight.js handle colors */
            .typo-content pre code {
              color: #24292e !important; /* Force dark text color for block code */
              background-color: transparent;
              padding: 0;
              border-radius: 0;
              font-size: 13px;
              white-space: pre;
            }

            /* Ensure highlight.js classes are visible */
            .hljs-comment,
            .hljs-quote {
              color: #6a737d !important;
              font-style: italic;
            }
            .hljs-keyword,
            .hljs-selector-tag {
              color: #d73a49 !important;
            }
            .hljs-string,
            .hljs-doctag {
              color: #032f62 !important;
            }
            .hljs-title,
            .hljs-section,
            .hljs-selector-id {
              color: #6f42c1 !important;
            }
            .hljs-literal {
              color: #005cc5 !important;
            }

            @media (min-width: 650px) {
              .typo-content code { font-size: 15px; }
              .typo-content pre code { font-size: 14px; }
            }
          `}</style>
          
          <div className="typo-content">
            {enTitle && <span className="en-title">{enTitle}</span>}
            {title && <h1>{title}</h1>}
            {metadata && <div className="metadata">{metadata}</div>}
            <ReactMarkdown 
              remarkPlugins={[remarkGfm]} 
              rehypePlugins={[rehypeRaw, rehypeHighlight]}
              components={components}
            >
              {processedBody}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
});

export default PreviewCard;
