import { ChevronDown, FlaskConical } from 'lucide-react';
import { measurementQuestions } from './result-notes';
import type { Analysis } from './types';

export function ResultNotes({ analysis }: { analysis: Analysis }) {
  const questions = measurementQuestions(analysis);
  const synthetic = analysis.mode === 'demo' || analysis.source_text.includes('Учебный пример. Замеры и суммы вымышлены.');
  if (!questions.length && !analysis.warnings.length && !synthetic && !analysis.edited) return null;

  return <aside className="result-notes" aria-label="Уточнения и проверка результата">
    {synthetic && <p className="result-context"><FlaskConical size={15} aria-hidden="true" /> Учебный пример. Замеры и суммы вымышлены.</p>}
    {analysis.edited && <p className="result-context">После ручных изменений перепроверьте связанные выводы и расчёты.</p>}
    {questions.length > 0 && <div className="interview-followups">
      <h2>Что уточнить для точного расчёта</h2>
      <p>Для части численных оценок нужны дополнительные замеры. Уточните их у участников процесса.</p>
      <details className="result-disclosure">
        <summary><span>Уточнения для интервью <span className="notes-count">{questions.length}</span></span><ChevronDown size={16} aria-hidden="true" /></summary>
        <ul>{questions.map(question => <li key={question}>{question}</li>)}</ul>
      </details>
    </div>}
    {analysis.warnings.length > 0 && <details className="result-disclosure review-details">
      <summary><span>Подробности проверки <span className="notes-count">{analysis.warnings.length}</span></span><ChevronDown size={16} aria-hidden="true" /></summary>
      <p>Сведения об обработке и ограничения разбора. Сверьте выводы с исходным текстом.</p>
      <ul>{analysis.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    </details>}
  </aside>;
}
