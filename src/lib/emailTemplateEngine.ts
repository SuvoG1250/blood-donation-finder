import { escapeHtmlText } from "@/lib/mailjet";

export type EmailTemplateRow = {
  template_key: string;
  subject_template: string;
  preheader_template: string | null;
  html_template: string;
  text_template: string;
  updated_at?: string;
};

export function fillTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = vars[key];
    return v === undefined ? "" : v;
  });
}

export function fillHtmlTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  const escapedVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    escapedVars[k] = escapeHtmlText(v);
  }
  return fillTemplate(template, escapedVars);
}

