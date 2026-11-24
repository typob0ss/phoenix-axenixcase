import { useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, Clock3, Download, FileText, Gauge, Lightbulb, Quote } from 'lucide-react';
import { api, download } from './api';
import { decodeReportText } from './report';
import type { Analysis } from './types';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const level = { low: 'Низкая', medium: 'Средняя', high: 'Высокая' };
const riskLevel = { low: 'Низкий', medium: 'Средний', high: 'Высокий' };
const measured = (value: number | null, unit: string) => value === null ? 'Нет данных' : `${number.format(value)} ${unit}`;

export function Bottlenecks({ analysis, onOpenStep }: { analysis: Analysis; onOpenStep: (id: string) => void }) {
  return (
    <section className="findings">
      <div className="section-heading"><h2>Узкие места</h2><p>Где участники процесса теряют время или выполняют лишнюю работу.</p></div>
      {analysis.bottlenecks.length === 0 && <div className="card empty-state">В исходном тексте недостаточно подтверждений, чтобы выделить узкие места.</div>}
      <div className="findings-grid">
        {analysis.bottlenecks.map(item => (
          <article key={item.id} className="card finding">
            <div className="finding-icon loss"><CircleAlert size={19} /></div>
            <span className="tag neutral">{item.loss_type}</span>
            <h3>{item.title}</h3>
            <p>{item.cause}</p>
            <blockquote><Quote size={14} /> {item.quote}</blockquote>
            <dl className="finding-metrics">
              <div><dt>Потери времени</dt><dd>{measured(item.time_minutes, 'мин')}</dd></div>
              <div><dt>Стоимость</dt><dd>{measured(item.cost_rub, '₽')}</dd></div>
            </dl>
            {item.metric_basis && <p className="small-note">{item.metric_basis}</p>}
            <div className="step-links">
              {item.step_ids.map(id => <button key={id} className="text-button" onClick={() => onOpenStep(id)}>
                {analysis.steps.find(step => step.id === id)?.title ?? id} <ArrowRight size={13} />
              </button>)}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Recommendations({ analysis }: { analysis: Analysis }) {
  return (
    <section className="findings">
      <div className="section-heading"><h2>Приоритеты автоматизации</h2><p>Гипотезы, которые можно проверить на реальных данных процесса.</p></div>
      {analysis.recommendations.length === 0 && <div className="card empty-state">В исходном тексте недостаточно подтверждений, чтобы предложить автоматизацию.</div>}
      <div className="findings-grid">
        {[...analysis.recommendations].sort((a, b) => a.priority - b.priority).map(item => (
          <article key={item.id} className="card finding">
            <div className="finding-icon idea"><Lightbulb size={19} /></div>
            <span className="tag priority">Приоритет {item.priority}</span>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <p className="finding-effect"><b>Ожидаемый эффект</b> {item.effect}</p>
            <dl className="finding-metrics">
              <div><dt><Gauge size={14} /> Сложность</dt><dd>{level[item.complexity]}</dd></div>
              <div><dt>Риск</dt><dd>{riskLevel[item.risk]}</dd></div>
            </dl>
            <div className="saving"><Clock3 size={16} /><div><strong>Оценка экономии времени</strong><span>{measured(item.estimated_saving_minutes, 'мин')}</span></div></div>
            {item.calculation && <p className="small-note">{item.calculation}</p>}
            <blockquote><Quote size={14} /> {item.quote}</blockquote>
            {item.bottleneck_ids.length > 0 && <p className="small-note">
              <b>Связанные узкие места</b> {item.bottleneck_ids.map(id => analysis.bottlenecks.find(bottleneck => bottleneck.id === id)?.title ?? id).join(' · ')}
            </p>}
          </article>
        ))}
      </div>
    </section>
  );
}

export function Report({ analysis }: { analysis: Analysis }) {
  const [markdown, setMarkdown] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setMarkdown('');
    setError('');
    api.report(analysis).then(({ markdown }) => {
      if (current) setMarkdown(markdown);
    }).catch(reason => {
      if (current) setError((reason as Error).message);
    });
    return () => { current = false; };
  }, [analysis, attempt]);

  return (
    <section className="card report">
      <div className="report-top">
        <div className="finding-icon report-icon"><FileText size={20} /></div>
        <div><h2>Отчёт о процессе</h2><p>Краткие выводы, подтверждающие цитаты и ограничения расчётов.</p></div>
        <button className="button secondary" disabled={!markdown} onClick={() => download(markdown, 'md', 'text/markdown;charset=utf-8')}>
          <Download size={16} /> Скачать Markdown
        </button>
      </div>
      {error && <div className="notice danger" role="alert">{error}<button className="button secondary" onClick={() => setAttempt(attempt + 1)}>Повторить</button></div>}
      {!error && !markdown && <p className="loading-text" role="status"><span className="spinner" /> Готовим отчёт…</p>}
      {markdown && <article className="report-body">
        {markdown.split('\n').map(line => line.trimStart()).filter(Boolean).map((line, index) => {
          if (line.startsWith('# ')) return <h3 key={index}>{decodeReportText(line.slice(2))}</h3>;
          if (line.startsWith('## ')) return <h4 key={index}>{decodeReportText(line.slice(3))}</h4>;
          if (line.startsWith('### ')) return <h5 key={index}>{decodeReportText(line.slice(4))}</h5>;
          if (line.startsWith('> ')) return <blockquote key={index}>{decodeReportText(line.slice(2))}</blockquote>;
          const content = line.split(/(\*\*(?:\\.|[^*\\])+?\*\*)/g).map((part, i) =>
            i % 2 === 1 ? <strong key={i}>{decodeReportText(part.slice(2, -2))}</strong> : decodeReportText(part));
          return <p key={index}>{content}</p>;
        })}
      </article>}
    </section>
  );
}
