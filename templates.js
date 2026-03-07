const DEFAULT_TEMPLATE_ID = 'default';

export const TEMPLATES = {
  [DEFAULT_TEMPLATE_ID]: {
    id: DEFAULT_TEMPLATE_ID,
    name: 'Default',
    css: '',
  },
};

export const listTemplates = () => Object.values(TEMPLATES).map(({ id, name }) => ({ id, name }));

export const resolveTemplate = (templateId) => {
  if (templateId && Object.prototype.hasOwnProperty.call(TEMPLATES, templateId)) {
    return TEMPLATES[templateId];
  }
  return TEMPLATES[DEFAULT_TEMPLATE_ID];
};

