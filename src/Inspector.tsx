import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Check, ChevronDown, Clock3, FileText, Link2, Pencil, Quote, ScanLine } from 'lucide-react';
import { applyDraft } from './edit';
import { STEP_LABELS, type Analysis, type Edge, type Step, type StepType } from './types';

function SourceExcerpt({ text, quote }: { text: string; quote: string }) {
  const box = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLElement>(null);
  const start = quote ? text.indexOf(quote) : -1;
  useEffect(() => {
    if (box.current && highlight.current) {
      box.current.scrollTop = highlight.current.offsetTop - 14;
    }
  }, [text, quote]);

  return (
    <div className="source-excerpt" ref={box} tabIndex={0} role="region" aria-label="Исходный текст с выделенной цитатой">
      {start < 0 ? text : <>{text.slice(0, start)}<mark ref={highlight}>{quote}</mark>{text.slice(start + quote.length)}</>}
    </div>
  );
}

export function Inspector({ analysis, step, onSave }: {
  analysis: Analysis;
  step: Step;
  onSave: (candidate: Analysis) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step);
  const [edgeDrafts, setEdgeDrafts] = useState<Edge[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [evidenceEdge, setEvidenceEdge] = useState<string | null>(null);
  const related = analysis.edges.filter(edge => edge.from_step === step.id || edge.to_step === step.id);
  const sourceEdge = related.find(edge => edge.id === evidenceEdge);
  const index = analysis.steps.findIndex(item => item.id === step.id);

  function startEditing() {
    setDraft(step);
    setEdgeDrafts(related);
    setError('');
    setSaved(false);
    setEditing(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSave(applyDraft(analysis, draft, edgeDrafts));
      setEditing(false);
      setSaved(true);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function changeEdge(id: string, changes: Partial<Edge>) {
    setEdgeDrafts(edges => edges.map(edge => edge.id === id ? { ...edge, ...changes } : edge));
  }

  function stepName(id: string) {
    return analysis.steps.find(item => item.id === id)?.title ?? id;
  }

  return (
    <aside className="card inspector" aria-label="Детали шага">
      <div className="inspector-top">
        <span className="section-kicker"><ScanLine size={15} /> Инспектор шага</span>
        {!editing && <button className="icon-button edit-trigger" aria-label="Редактировать шаг и переходы" title="Редактировать шаг и переходы" onClick={startEditing}><Pencil size={15} /></button>}
      </div>
      {editing ? (
        <form onSubmit={save} className="editor-form">
          <h2>Редактирование</h2>
          <fieldset disabled={saving}>
            <label>Название шага<input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} required /></label>
            <label>Роль<select value={draft.role_id} onChange={event => setDraft({ ...draft, role_id: event.target.value })}>
              {analysis.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
            </select></label>
            <label>Тип шага<select value={draft.type} onChange={event => setDraft({ ...draft, type: event.target.value as StepType })}>
              {Object.entries(STEP_LABELS).map(([type, title]) => <option key={type} value={type}>{title}</option>)}
            </select></label>
            <label>Цитата из исходного текста<textarea rows={3} value={draft.quote} onChange={event => setDraft({ ...draft, quote: event.target.value })} required /></label>
            {edgeDrafts.length > 0 && <div className="edit-edges">
              <h3>Переходы</h3>
              {edgeDrafts.map((edge, edgeIndex) => (
                <details key={edge.id} className="edge-edit">
                  <summary>Переход {edgeIndex + 1}{edge.label && ` · ${edge.label}`} <ChevronDown size={14} /></summary>
                  <label>Из шага<select value={edge.from_step} onChange={event => changeEdge(edge.id, { from_step: event.target.value })}>
                    {analysis.steps.map(step => <option key={step.id} value={step.id}>{step.title}</option>)}
                  </select></label>
                  <label>В шаг<select value={edge.to_step} onChange={event => changeEdge(edge.id, { to_step: event.target.value })}>
                    {analysis.steps.map(step => <option key={step.id} value={step.id}>{step.title}</option>)}
                  </select></label>
                  <label>Подпись<input value={edge.label} onChange={event => changeEdge(edge.id, { label: event.target.value })} required /></label>
                  <label>Цитата перехода<textarea rows={3} value={edge.quote} onChange={event => changeEdge(edge.id, { quote: event.target.value })} required /></label>
                </details>
              ))}
            </div>}
          </fieldset>
          <details className="source-details">
            <summary><FileText size={14} /> Исходный текст <ChevronDown size={14} /></summary>
            <SourceExcerpt text={analysis.source_text} quote={draft.quote} />
          </details>
          {error && <div className="notice danger" role="alert">{error}</div>}
          <div className="editor-actions">
            <button className="button secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Отмена</button>
            <button className="button primary" type="submit" disabled={saving}>{saving ? 'Проверяем…' : 'Сохранить'}</button>
          </div>
        </form>
      ) : (
        <>
          {saved && <div className="saved-state" role="status"><Check size={14} /> Изменения сохранены</div>}
          <div className="step-heading">
            <div className={`tag step-${step.type}`}>Шаг {index + 1} · {STEP_LABELS[step.type]}</div>
            <h2>{step.title}</h2>
            <p>{analysis.roles.find(role => role.id === step.role_id)?.name}</p>
          </div>
          <div className="step-metadata">
            <div><Clock3 size={15} /><span>Длительность</span><strong>{step.duration_minutes === null ? 'Нет подтверждённого замера в интервью' : `${step.duration_minutes} мин`}</strong></div>
            <div><ScanLine size={15} /><span>{analysis.mode === 'live' ? 'Оценка модели' : 'Оценка в демоданных'}</span><strong>{Math.round(step.confidence * 100)}%</strong></div>
          </div>
          {analysis.mode === 'live' && <p className="small-note">Модель оценивает уверенность в своём выводе. Сервер проверяет, что цитата есть в тексте. Связь цитаты с выводом оценивает читатель.</p>}
          {(step.systems.length > 0 || step.documents.length > 0) && <div className="step-resources">
            {step.systems.length > 0 && <p><b>Системы</b> {step.systems.join(', ')}</p>}
            {step.documents.length > 0 && <p><b>Документы</b> {step.documents.join(', ')}</p>}
          </div>}
          <div className="quote-block"><h3><Quote size={15} /> {sourceEdge ? 'Цитата перехода' : 'Цитата из текста'}</h3>
            <blockquote>{sourceEdge?.quote ?? step.quote}</blockquote>
          </div>
          <details className="source-details" open>
            <summary><FileText size={14} /> Исходный текст <ChevronDown size={14} /></summary>
            <SourceExcerpt text={analysis.source_text} quote={sourceEdge?.quote ?? step.quote} />
          </details>
          {related.length > 0 && <div className="related-edges">
            <h3><Link2 size={15} /> Переходы</h3>
            {related.map(edge => (
              <button type="button" className="related-edge" key={edge.id} aria-pressed={sourceEdge?.id === edge.id}
                onClick={() => setEvidenceEdge(sourceEdge?.id === edge.id ? null : edge.id)}>
                <ArrowRight size={13} /><span>{edge.from_step === step.id ? stepName(edge.to_step) : `Из шага «${stepName(edge.from_step)}»`}{edge.label && <small>{edge.label}</small>}</span>
              </button>
            ))}
          </div>}
        </>
      )}
    </aside>
  );
}
