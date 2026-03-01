import React, { Children, cloneElement, forwardRef, isValidElement, memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { TemplateProps } from '../types';

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw, rehypeHighlight];

const PreviewCard = memo(forwardRef<HTMLDivElement, TemplateProps>(function PreviewCard({ data }, ref) {
  const { enTitle, title, metadata, body, images } = data;

  // Pre-process body to support ==highlight== syntax
  const processedBody = useMemo(() => body.replace(/==(.*?)==/g, '<mark>$1</mark>'), [body]);

  // Custom components for ReactMarkdown
  const components = useMemo<Components>(() => ({
    img: ({ src, alt, ...props }) => {
      // Check if src is an image ID in our map
      const imageSrc = src && images[src] ? images[src] : src;
      return (
        <img 
          src={imageSrc} 
          alt={alt || 'Article Image'} 
          className="rounded-lg shadow-md my-4 w-full"
          {...props} 
        />
      );
    },
    ol: ({ children, start, ...props }) => {
      const parsedStart = Number(start);
      let nextOrder = Number.isFinite(parsedStart) && parsedStart > 0 ? parsedStart : 1;

      const orderedChildren = Children.map(children, (child) => {
        if (!isValidElement(child)) return child;
        const childTagName = (child.props as { node?: { tagName?: string } }).node?.tagName;
        if (childTagName && childTagName !== 'li') return child;

        const childClassName = (child.props as { className?: string }).className ?? '';
        const mergedClassName = `${childClassName} ordered-list-item`.trim();

        return cloneElement(child, {
          className: mergedClassName,
          'data-ordered-index': nextOrder++,
        });
      });

      return (
        <ol start={start} {...props}>
          {orderedChildren}
        </ol>
      );
    },
    li: ({ children, className = '', ...props }) => {
      const orderedIndex = (props as { ['data-ordered-index']?: number })['data-ordered-index'];
      if (typeof orderedIndex === 'number') {
        delete (props as { ['data-ordered-index']?: number })['data-ordered-index'];
        return (
          <li className={className} {...props}>
            <span className="ordered-list-marker" aria-hidden="true">{orderedIndex}.</span>
            <div className="ordered-list-content">{children}</div>
          </li>
        );
      }

      return (
        <li className={className} {...props}>
          {children}
        </li>
      );
    },
  }), [images]);

  return (
    <div className="flex flex-col items-center pt-6 pb-10 min-h-full gap-6">
      {/* 
        Main Card Container 
        Dimensions: 600px x 1000px (desktop), responsive on mobile
        Shadows: Three-layer 3D shadow
      */}
      <div 
        ref={ref}
        data-export-root="true"
        className={`
          relative bg-white rounded-xl overflow-hidden flex-shrink-0
          w-full max-w-[600px] min-h-[800px]
          shadow-[0_25px_50px_rgba(0,0,0,0.4),0_10px_30px_rgba(0,10,20,0.3),0_5px_15px_rgba(0,5,15,0.25)]
          transition-all duration-300
        `}
      >
        {/* Scrollable Content Area */}
        <div className="h-full p-[40px] md:p-[50px]">
          <div className="typo-content">
            {enTitle && <span className="en-title">{enTitle}</span>}
            {title && <h1>{title}</h1>}
            {metadata && <div className="metadata">{metadata}</div>}
            <ReactMarkdown 
              remarkPlugins={remarkPlugins} 
              rehypePlugins={rehypePlugins}
              components={components}
            >
              {processedBody}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}));

export default PreviewCard;
