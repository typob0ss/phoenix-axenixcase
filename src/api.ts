import type { Analysis, Example, Health } from './types';

function errorDetail(detail: unknown, status: number): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail.flatMap(issue =>
      typeof issue?.msg === 'string' ? [issue.msg.replace(/^Value error, /, '')] : [],
    );
    if (messages.length) return messages.join(' · ');
  }
  return `Сервер вернул ошибку (${status}). Попробуйте ещё раз.`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch {
    throw new Error('Нет связи с сервером. Проверьте соединение и повторите попытку.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorDetail(body?.detail, response.status));
  if (body === null) throw new Error('Сервер вернул ответ в неожиданном формате.');
  return body as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export const api = {
  health: () => request<Health>('/health'),
  examples: () => request<Example[]>('/examples'),
  analyze: (text: string, demoId: string | null) => post<Analysis>('/analyze', { text, demo_id: demoId }),
  importFile(file: File) {
    const data = new FormData();
    data.append('file', file);
    return request<{text: string; filename: string}>('/import', { method: 'POST', body: data });
  },
  validate: (analysis: Analysis) => post<Analysis>('/validate', analysis),
  report: (analysis: Analysis) => post<{ markdown: string }>('/report', analysis),
};

export function download(contents: string, extension: string, contentType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: contentType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `axenix-process.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
