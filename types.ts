export interface ArticleContent {
  enTitle: string;
  title: string;
  metadata: string;
  body: string;
  images: Record<string, string>; // Map of ID to Base64 Data URL
}

export interface TemplateProps {
  data: ArticleContent;
}

export interface EditorProps {
  onChange: (data: ArticleContent) => void;
  initialData?: ArticleContent;
}

export type ArticleState = ArticleContent;
