import { StrictMode, useEffect, useRef, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, Building2, ChevronRight, CircleAlert,
  Code2, FilePlus2, FileText, FlaskConical, GitBranch, Image, Microscope, ScanLine,
  ShieldCheck, ShoppingBag, Users, Upload, Workflow, Zap,
} from 'lucide-react';
import { api, download } from './api';
import { Diagram, exportDiagram } from './Diagram';
import { Bottlenecks, Recommendations, Report } from './Findings';
import { Inspector } from './Inspector';
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
  const currentSection = sections.find(section => section.id === view);
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
      <aside className="sidebar">
        <button type="button" className="brand" disabled={busy !== null} onClick={() => navigate('input')} aria-label="Axenix · к исходному тексту">
          <span className="brand-mark"><Microscope size={21} strokeWidth={2.1} /></span>
          <span><strong>Axenix</strong><small>Process Lens</small></span>
        </button>
        <nav className="side-nav" aria-label="Разделы">
          <p>Рабочая область</p>
          <button className={view === 'input' ? 'current' : ''} disabled={busy !== null} aria-current={view === 'input' ? 'page' : undefined} onClick={() => navigate('input')}>
            <FilePlus2 size={18} /> <span>Исходный текст</span>
          </button>
          <div className="nav-divider" />
          <p>Результаты</p>
          {sections.map(({ id, label, Icon }) => (
            <button key={id} className={view === id ? 'current' : ''} disabled={!analysis || busy !== null} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}>
              <Icon size={18} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer"><ShieldCheck size={16} /> <span>Текст и результаты доступны в текущей вкладке.</span></div>
      </aside>

      <div className="main-shell">
        <header className="top-bar">
          <div className="breadcrumb"><span>Рабочая область</span><ChevronRight size={14} /><strong>{currentSection?.label ?? 'Исходный текст'}</strong></div>
          <Status connection={connection} retry={() => setAttempt(attempt + 1)} />
        </header>

        {view === 'input' && (
          <main className="workspace intro">
            <div className="page-heading">
              <h1>Процесс под микроскопом</h1>
              <p>Постройте схему процесса по записи совещания, найдите узкие места и идеи для автоматизации.</p>
            </div>

            <div className="input-grid">
              <form className="card input-card" onSubmit={analyze}>
                <div className="input-card-head">
                  <span className="card-icon"><FileText size={20} /></span>
                  <div><h2>Исходный текст</h2><p>Стенограмма, интервью или описание процесса.</p></div>
                </div>
                <div className="input-body">
                  <div className="textarea-bar"><label htmlFor="source">Текст для анализа</label>
                    {demo && <span className="tag demo"><FlaskConical size={13} /> Демопример</span>}
                  </div>
                  <textarea id="source" className="source-input" value={source} disabled={busy !== null} aria-describedby="source-count source-length"
                    placeholder="Например, менеджер принимает заявку, проверяет данные в CRM и передаёт её на согласование…"
                    onChange={event => {
                      setSource(event.target.value);
                      setChosenExample(null);
                      setIssue('');
                    }} />
                  <div className="input-meta">
                    <button type="button" className="button upload" disabled={busy !== null} onClick={() => input.current?.click()}>
                      {busy === 'import' ? <span className="spinner" /> : <Upload size={15} />} {busy === 'import' ? 'Импортируем…' : 'Импорт файла'}
                    </button>
                    <input type="file" ref={input} accept=".txt,.docx" hidden onChange={event => {
                      void importFile(event.target.files?.[0]);
                      event.target.value = '';
                    }} />
                    <span className="file-formats">TXT, DOCX · до 2 МБ</span>
                    <span id="source-count" className={count > 5000 ? 'count invalid' : 'count'}>{charNumber.format(count)} / 5 000</span>
                  </div>
                  {filename && <p className="imported"><FileText size={14} /> {filename}</p>}
                  <p id="source-length" className="length-help">От 1 000 до 5 000 символов.</p>
                </div>

                {issue && <div className="notice danger input-notice" role="alert"><CircleAlert size={17} /> <span>{issue}</span></div>}
                <div className="input-footer">
                  <p><ShieldCheck size={16} /> {demo ? 'Демопример доступен без запроса к модели.' : live
                    ? 'При анализе текст отправляется внешней модели. Удалите конфиденциальные данные.'
                    : 'Для анализа своего текста подключите ИИ-модель.'}</p>
                  <button className="button primary analyze-button" type="submit"
                    disabled={busy !== null || invalidLength || connection === 'offline' || connection === 'checking'}>
                    {busy === 'analyze' ? <span className="spinner" /> : <ScanLine size={17} />}
                    {busy === 'analyze' ? 'Анализируем…' : 'Проанализировать'}
                  </button>
                </div>
              </form>

              <section className="examples" aria-label="Демопримеры">
                <div className="examples-head">
                  <span className="card-icon demo-icon"><FlaskConical size={20} /></span>
                  <div><h2>Демопримеры</h2><p>Выберите готовый текст для анализа.</p></div>
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
                      <span className={`example-icon ${theme}`}><Icon size={19} /></span>
                      <span className="example-content"><span className="example-sector">{example.sector}</span><strong>{example.title}</strong><span>{example.description}</span></span>
                    </button>
                  );
                })}
              </section>
            </div>
            {analysis && <button type="button" className="text-button previous-result" disabled={busy !== null} onClick={() => navigate('diagram')}>Открыть последний результат <ArrowRight size={15} /></button>}
          </main>
        )}

        {view !== 'input' && analysis && (
          <main className="workspace result">
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

            {analysis.warnings.length > 0 && <div className="notice caution result-warning"><CircleAlert size={17} />
              <div>{analysis.warnings.map((warning, index) => <p key={index}>{warning}</p>)}</div>
            </div>}

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
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
