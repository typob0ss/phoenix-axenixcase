import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Building2, Check, CircleAlert,
  Code2, Download, FileText, FlaskConical, GitBranch, Image,
  ShieldCheck, ShoppingBag, Users, Upload, Workflow, Zap,
} from 'lucide-react';
import { api, download } from './api';
import { Diagram, exportDiagram } from './Diagram';
import { Bottlenecks, Recommendations, Report } from './Findings';
import { Inspector } from './Inspector';
import { ResultNotes } from './ResultNotes';
import { createOperations, type Operation } from './operations';
import type { Analysis, Example, Health } from './types';
import './styles.css';

const sections = [
  { id: 'diagram', label: 'Схема процесса', Icon: Workflow },
  { id: 'bottlenecks', label: 'Узкие места', Icon: CircleAlert },
  { id: 'automation', label: 'Автоматизация', Icon: Zap },
  { id: 'report', label: 'Отчёт', Icon: FileText },
] as const;
type View = 'input' | typeof sections[number]['id'];
type Connection = 'checking' | 'offline' | Health;

const exampleIcons = {
  bank: { Icon: Building2, theme: 'bank' },
  retail: { Icon: ShoppingBag, theme: 'retail' },
  hr: { Icon: Users, theme: 'hr' },
};
const charNumber = new Intl.NumberFormat('ru-RU');
const plural = new Intl.PluralRules('ru-RU');

function quantity(count: number, forms: { one: string; few: string; other: string }) {
  const form = plural.select(count);
  return `${count} ${form === 'one' ? forms.one : form === 'few' ? forms.few : forms.other}`;
}

function Status({ connection, retry }: { connection: Connection; retry: () => void }) {
  if (connection === 'offline') {
    return <button className="connection offline" onClick={retry} title="Проверить подключение"><span className="status-dot" /> Сервер недоступен</button>;
  }
  const checking = connection === 'checking';
  const live = !checking && connection.llm_configured;
  return <span className={`connection ${live ? 'live' : ''}`}><span className="status-dot" />
    {checking ? 'Подключение…' : live ? 'ИИ-модель настроена' : 'Деморежим'}
  </span>;
}

function App() {
  const [connection, setConnection] = useState<Connection>('checking');
  const [examples, setExamples] = useState<Example[]>([]);
  const [examplesError, setExamplesError] = useState('');
  const [view, setView] = useState<View>('input');
  const [source, setSource] = useState('');
  const [filename, setFilename] = useState('');
  const [chosenExample, setChosenExample] = useState<Example | null>(null);
  const [issue, setIssue] = useState('');
  const [busy, setBusy] = useState<Operation | null>(null);
  const [operations] = useState(() => createOperations(setBusy));
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisRun, setAnalysisRun] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [jump, setJump] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const count = Array.from(source).length;
  const invalidLength = count < 1000 || count > 5000;
  const demo = chosenExample?.text === source ? chosenExample : null;
  const live = typeof connection === 'object' && connection.llm_configured;
  const step = analysis?.steps.find(item => item.id === selected) ?? analysis?.steps[0];

  useEffect(() => {
    let active = true;
    setConnection('checking');
    setExamplesError('');
    api.health().then(status => {
      if (active) setConnection(status);
    }).catch(() => {
      if (active) setConnection('offline');
    });
    api.examples().then(items => {
      if (active) setExamples(items);
    }).catch(reason => {
      if (active) setExamplesError((reason as Error).message);
    });
    return () => { active = false; };
  }, [attempt]);

  function openView(next: View) {
    setView(next);
    window.scrollTo({ top: 0 });
  }

  function navigate(next: View) {
    if (!operations.active) openView(next);
  }

  function chooseExample(example: Example) {
    if (operations.active) return;
    setChosenExample(example);
    setSource(example.text);
    setFilename('');
    setIssue('');
  }

  async function importFile(file?: File) {
    if (!file || operations.active) return;
    if (file.size > 2 * 1024 * 1024) {
      setIssue('Файл превышает 2 МБ.');
      return;
    }
    setIssue('');
    try {
      await operations.run('import', async () => {
        const imported = await api.importFile(file);
        setSource(imported.text);
        setFilename(imported.filename);
        setChosenExample(null);
      });
    } catch (reason) {
      setIssue((reason as Error).message);
    }
  }

  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (operations.active) return;
    if (invalidLength) {
      setIssue('Введите от 1000 до 5000 символов.');
      return;
    }
    setIssue('');
    try {
      await operations.run('analyze', async () => {
        const result = await api.analyze(source, demo?.id ?? null);
        setAnalysis(result);
        setAnalysisRun(run => run + 1);
        setSelected(result.steps[0]?.id);
        setJump(undefined);
        openView('diagram');
      });
    } catch (reason) {
      setIssue((reason as Error).message);
    }
  }

  async function saveDraft(candidate: Analysis) {
    await operations.run('save', async () => {
      setAnalysis(await api.validate(candidate));
    });
  }

  function openStep(id: string) {
    if (operations.active) return;
    setSelected(id);
    setJump(id);
    navigate('diagram');
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#workspace">К рабочей области</a>
      <header className="top-bar">
        <div className="top-bar-inner">
          <button type="button" className="brand" disabled={busy !== null} onClick={() => navigate('input')} aria-label="Феникс · новый анализ">
            <img src="/favicon.svg" width="40" height="40" alt="" />
            <strong>феникс</strong>
          </button>
          <nav className="main-nav" aria-label="Рабочая область">
            <button className={view === 'input' ? 'current' : ''} disabled={busy !== null} aria-current={view === 'input' ? 'page' : undefined} onClick={() => navigate('input')}>Новый анализ</button>
            <button className={view !== 'input' ? 'current' : ''} disabled={!analysis || busy !== null} aria-current={view !== 'input' ? 'page' : undefined} onClick={() => navigate('diagram')}>Результаты</button>
          </nav>
          <Status connection={connection} retry={() => setAttempt(attempt + 1)} />
        </div>
      </header>
      <div className="main-shell">
        {view === 'input' && (
          <main id="workspace" className="workspace intro" tabIndex={-1}>
            <div className="page-heading">
              <img className="phoenix-art" src="/phoenix.webp" srcSet="/phoenix-850.webp 850w, /phoenix.webp 1700w" sizes="(max-width: 600px) 430px, (max-width: 820px) 560px, (max-width: 1100px) 680px, 850px" alt="" width="1700" height="567" fetchPriority="high" />
              <div className="heading-copy">
                <h1>Новый взгляд<br />на ваш процесс.</h1>
                <p>Из записи встречи — в понятную схему<br className="desktop-break" /> и план улучшений.</p>
              </div>
            </div>

            <div className="input-grid">
              <form className="card input-card" onSubmit={analyze} aria-busy={busy === 'analyze'}>
                <div className="input-card-head">
                  <h2>С чего начнём?</h2>
                  <div className="input-methods" role="group" aria-label="Способ ввода">
                    <button type="button" className="method-selected" disabled={busy !== null} onClick={() => document.getElementById('source')?.focus()}>Вставить текст</button>
                    <button type="button" disabled={busy !== null} onClick={() => input.current?.click()}>
                      {busy === 'import' ? <span className="spinner" /> : <Upload size={16} />}
                      {busy === 'import' ? 'Импортируем…' : 'Загрузить файл'}
                    </button>
                  </div>
                </div>
                <div className="input-body">
                  <div className="textarea-bar"><label htmlFor="source">Запись встречи</label>
                    {demo && <span className="tag demo"><FlaskConical size={13} /> Демопример</span>}
                  </div>
                  <textarea id="source" className="source-input" value={source} disabled={busy !== null} aria-describedby="source-count source-length"
                    placeholder="Вставьте стенограмму, интервью или описание процесса…"
                    onChange={event => {
                      setSource(event.target.value);
                      setChosenExample(null);
                      setIssue('');
                    }} />
                  <div className="input-meta">
                    <input type="file" ref={input} accept=".txt,.docx" hidden onChange={event => {
                      void importFile(event.target.files?.[0]);
                      event.target.value = '';
                    }} />
                    <span id="source-length" className="length-help">От 1 000 до 5 000 символов</span>
                    <span id="source-count" className={count > 5000 ? 'count invalid' : 'count'}>{charNumber.format(count)} / 5 000</span>
                    <span className="file-formats">TXT, DOCX · до 2 МБ</span>
                  </div>
                  {filename && <p className="imported"><FileText size={14} /> {filename}</p>}
                </div>

                {issue && <div className="notice danger input-notice" role="alert"><CircleAlert size={17} /> <span>{issue}</span></div>}
                <div className="input-footer">
                  <p><ShieldCheck size={16} /> {demo ? 'Демопример доступен без запроса к модели.' : live
                    ? 'При анализе текст отправляется внешней модели. Удалите конфиденциальные данные.'
                    : 'Для анализа своего текста подключите ИИ-модель.'}</p>
                  <button className="button primary analyze-button" type="submit"
                    disabled={busy !== null || invalidLength || connection === 'offline' || connection === 'checking'}>
                    {busy === 'analyze' && <span className="spinner" />}
                    {busy === 'analyze' ? 'Анализируем…' : 'Разобрать процесс'}
                    {busy !== 'analyze' && <ArrowRight size={18} />}
                  </button>
                </div>
              </form>

              <div className="intro-aside">
              <section className="card examples" aria-label="Демопримеры">
                <div className="examples-head">
                  <h2>Попробуйте на примере</h2>
                </div>

                {examples.length === 0 && !examplesError && <p className="loading-text" role="status"><span className="spinner" /> Загружаем примеры…</p>}
                {examplesError && <div className="notice danger" role="alert">
                  <span>{examplesError}</span><button type="button" className="button secondary" onClick={() => setAttempt(attempt + 1)}>Повторить</button>
                </div>}
                {examples.map(example => {
                  const { Icon, theme } = exampleIcons[example.id as keyof typeof exampleIcons] ?? { Icon: Workflow, theme: 'bank' };
                  return (
                    <button type="button" className={`example-card ${demo?.id === example.id ? 'example-active' : ''}`} key={example.id}
                      disabled={busy !== null} aria-pressed={demo?.id === example.id} onClick={() => chooseExample(example)}>
                      <span className={`example-icon ${theme}`}><Icon size={25} strokeWidth={1.5} /></span>
                      <span className="example-content"><strong>{example.sector}</strong><span>{example.title}</span></span>
                      {demo?.id === example.id ? <Check size={18} className="example-arrow" /> : <ArrowRight size={18} className="example-arrow" />}
                    </button>
                  );
                })}
                <a className="text-button defense-example" href="/examples/axenix-defense.txt" download><Download size={15} /> Скачать учебный текст</a>
                <p className="example-help">Загрузите его файлом, чтобы попробовать живой анализ.</p>
              </section>
              <section className="card outcome-preview" aria-label="Что получится">
                <h2>Что получится</h2>
                <div className="preview-flow" aria-label="Пример схемы: заявка, проверка, решение">
                  <span>Заявка</span><ArrowRight size={18} aria-hidden="true" /><span className="preview-active">Проверка</span><ArrowRight size={18} aria-hidden="true" /><span>Решение</span>
                </div>
                <p>Схема, узкие места и гипотезы автоматизации — с опорой на исходный текст.</p>
              </section>
              </div>
            </div>
            {analysis && <button type="button" className="text-button previous-result" disabled={busy !== null} onClick={() => navigate('diagram')}>Открыть последний результат <ArrowRight size={15} /></button>}
          </main>
        )}

        {view !== 'input' && analysis && (
          <main id="workspace" className="workspace result" tabIndex={-1}>
            <button className="text-button back-button" disabled={busy !== null} onClick={() => navigate('input')}><ArrowLeft size={15} /> К исходному тексту</button>
            <div className="result-heading">
              <div className="result-title">
                <div className="result-badges">
                  <span className={`tag ${analysis.mode === 'demo' ? 'demo' : 'live-badge'}`}>
                    {analysis.mode === 'demo' ? <FlaskConical size={13} /> : <Zap size={13} />}
                    {analysis.mode === 'demo' ? 'Деморезультат' : 'Анализ модели'}
                  </span>
                  {analysis.edited && <span className="tag neutral">Отредактировано</span>}
                </div>
                <h1>{analysis.title}</h1>
                <p><GitBranch size={16} /> {quantity(analysis.roles.length, { one: 'роль', few: 'роли', other: 'ролей' })} <span>·</span> {quantity(analysis.steps.length, { one: 'шаг', few: 'шага', other: 'шагов' })} <span>·</span> {quantity(analysis.edges.length, { one: 'переход', few: 'перехода', other: 'переходов' })}</p>
              </div>
              <div className="exports" aria-label="Экспорт">
                <button className="button secondary" disabled={busy !== null} title="Скачать результат в JSON" onClick={() => download(JSON.stringify(analysis, null, 2), 'json', 'application/json;charset=utf-8')}><Code2 size={16} /> JSON <ArrowDownToLine size={14} className="export-arrow" /></button>
                <button className="button secondary" disabled={busy !== null} title="Скачать схему в SVG" onClick={() => exportDiagram(analysis)}><Image size={16} /> SVG <ArrowDownToLine size={14} className="export-arrow" /></button>
              </div>
            </div>

            <ResultNotes key={`${analysisRun}-${analysis.edited}`} analysis={analysis} />

            <nav className="section-tabs" aria-label="Результаты анализа">
              {sections.map(({ id, label, Icon }) => (
                <button type="button" key={id} className={view === id ? 'active-tab' : ''} disabled={busy !== null} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
                  <Icon size={16} /> {label}
                  {id === 'bottlenecks' && <span>{analysis.bottlenecks.length}</span>}
                  {id === 'automation' && <span>{analysis.recommendations.length}</span>}
                </button>
              ))}
            </nav>

            {view === 'diagram' && <div className={`diagram-grid ${step ? '' : 'one-column'}`}>
              <Diagram analysis={analysis} selected={step?.id} onSelect={busy ? undefined : id => {
                if (!operations.active) {
                  setSelected(id);
                  setJump(undefined);
                }
              }} stepId={jump} />
              {step && <Inspector key={`${analysisRun}:${step.id}`} analysis={analysis} step={step} onSave={saveDraft} />}
            </div>}
            {view === 'bottlenecks' && <Bottlenecks analysis={analysis} onOpenStep={openStep} />}
            {view === 'automation' && <Recommendations analysis={analysis} />}
            {view === 'report' && <Report analysis={analysis} />}
          </main>
        )}
      </div>
      <footer className="app-footer"><span>Команда Феникс</span><span>Выводы проверяются по цитатам из текста</span></footer>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
