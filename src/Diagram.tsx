import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Maximize, Minus, Plus } from 'lucide-react';
import { download } from './api';
import { HEADER_HEIGHT, layoutDiagram, NODE_HEIGHT, NODE_WIDTH, wrapLabel } from './diagram-layout';
import { STEP_LABELS, type Analysis, type StepType } from './types';

const tones: Record<StepType, { ink: string; fill: string; border: string }> = {
  task: { ink: '#37516a', fill: '#eef4fb', border: '#d5e1ed' },
  decision: { ink: '#a24b13', fill: '#fff1e6', border: '#f0b78d' },
  wait: { ink: '#8c5d10', fill: '#fdf4df', border: '#ead69d' },
  handoff: { ink: '#5c53a0', fill: '#f0edf9', border: '#d9d2ed' },
  rework: { ink: '#a63e50', fill: '#fceef1', border: '#edc6cf' },
  manual_input: { ink: '#217367', fill: '#e9f6f2', border: '#bce0d7' },
};

type DrawingProps = {
  analysis: Analysis;
  layout: ReturnType<typeof layoutDiagram>;
  width?: number;
  selected?: string;
  onSelect?: (id: string) => void;
};

function Drawing({ analysis, layout, width = layout.width, selected, onSelect }: DrawingProps) {
  const marker = useId().replace(/[^a-z\d-]/gi, '');
  const normal = `arrow-${marker}`;
  const back = `return-${marker}`;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={width} height={layout.height * width / layout.width}
      viewBox={`0 0 ${layout.width} ${layout.height}`} fontFamily="system-ui, sans-serif"
      role={onSelect ? 'group' : 'img'} aria-label={`Схема процесса «${analysis.title}»`}>
      <title>{analysis.title}</title>
      <defs>
        {[[normal, '#687c92'], [back, '#c7574b']].map(([id, color]) => (
          <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 7 4 L 0 8 Z" fill={color} />
          </marker>
        ))}
      </defs>
      {analysis.roles.map((role, index) => {
        const x = index * layout.laneWidth;
        return (
          <g key={role.id}>
            <title>{role.name}</title>
            <rect x={x} y={0} width={layout.laneWidth} height={layout.height} fill={index % 2 ? '#f6f8fb' : '#fcfdff'} />
            <rect x={x} y={0} width={layout.laneWidth} height={HEADER_HEIGHT} fill="#eef1f5" />
            <path d={`M ${x} ${HEADER_HEIGHT} H ${x + layout.laneWidth} M ${x + layout.laneWidth} 0 V ${layout.height}`}
              stroke="#dce2eb" fill="none" />
            <text x={x + 17} y={19} fill="#66758a" fontSize="9" letterSpacing="1.1" fontWeight="700">РОЛЬ</text>
            {wrapLabel(role.name, 31, 2).map((line, row) =>
              <text key={row} x={x + 17} y={37 + row * 14} fill="#263346" fontSize="13" fontWeight="700">{line}</text>,
            )}
          </g>
        );
      })}
      {layout.edges.map(edge => (
        <polyline key={edge.id} points={edge.points.map(point => point.join(',')).join(' ')}
          fill="none" stroke={edge.backward ? '#c7574b' : '#687c92'}
          strokeWidth={1.6} strokeDasharray={edge.backward ? '5 3' : undefined}
          strokeLinejoin="round" markerEnd={`url(#${edge.backward ? back : normal})`}>
          <title>{edge.label || 'Переход'}</title>
        </polyline>
      ))}
      {layout.edges.filter(edge => edge.label).map(edge => (
        <text key={edge.id} x={edge.labelAt[0]} y={edge.labelAt[1]} textAnchor="middle"
          fontSize="10" fontWeight="700" fill={edge.backward ? '#a63e43' : '#4b6076'}
          stroke="#fbfcfe" strokeWidth="4" paintOrder="stroke" strokeLinejoin="round">
          <title>{edge.label}</title>
          {wrapLabel(edge.label, 26, 1)[0]}
        </text>
      ))}
      {layout.nodes.map(({ step, x, y, order }) => {
        const tone = tones[step.type];
        const active = selected === step.id;
        return (
          <g key={step.id} transform={`translate(${x},${y})`}
            className={onSelect ? 'diagram-node' : undefined}
            tabIndex={onSelect ? 0 : undefined} role={onSelect ? 'button' : undefined}
            aria-pressed={onSelect ? active : undefined}
            aria-label={onSelect ? `Шаг ${order + 1}. ${step.title}` : undefined}
            onClick={onSelect ? () => onSelect(step.id) : undefined}
            onKeyDown={onSelect ? event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(step.id);
              }
            } : undefined}>
            <title>{step.title}</title>
            <rect className="diagram-node-body" width={NODE_WIDTH} height={NODE_HEIGHT} rx="9" fill={active ? '#fff9f5' : '#fff'}
              stroke={active ? '#e86425' : tone.border} strokeWidth={active ? 2 : 1.4} />
            <rect x="9" y="9" width="20" height="17" rx="4" fill={tone.fill} />
            {step.type === 'decision' ? <path d="M19 11.5 L25 17.5 L19 23.5 L13 17.5 Z" fill="none" stroke={tone.ink} strokeWidth="1.4" />
              : <text x="19" y="21" textAnchor="middle" fontSize="9" fontWeight="800" fill={tone.ink}>{order + 1}</text>}
            <text x="35" y="21" fontSize="10" fontWeight="700" fill={tone.ink}>{STEP_LABELS[step.type]}</text>
            {wrapLabel(step.title, 22, 2).map((line, row) => (
              <text key={row} x="10" y={41 + row * 15} fill="#263346" fontSize="12" fontWeight="700">{line}</text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function exportDiagram(analysis: Analysis) {
  const layout = layoutDiagram(analysis.roles, analysis.steps, analysis.edges);
  download(renderToStaticMarkup(<Drawing analysis={analysis} layout={layout} />), 'svg', 'image/svg+xml;charset=utf-8');
}

export function Diagram({ analysis, selected, onSelect, stepId }: {
  analysis: Analysis; selected?: string; onSelect?: (id: string) => void; stepId?: string;
}) {
  const layout = useMemo(() => layoutDiagram(analysis.roles, analysis.steps, analysis.edges), [analysis]);
  const viewport = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(560);
  const [zoom, setZoom] = useState<number | 'fit' | null>(null);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const resize = new ResizeObserver(() => setAvailable(element.clientWidth));
    resize.observe(element);
    return () => resize.disconnect();
  }, []);

  const fitted = Math.min(1, Math.max(1, available - 2) / layout.width);
  const scale = zoom === 'fit' ? fitted : zoom ?? Math.max(0.7, fitted);

  useEffect(() => {
    if (!stepId || !viewport.current) return;
    const node = layout.nodes.find(item => item.step.id === stepId);
    if (node) {
      const element = viewport.current;
      element.scrollTo({
        top: Math.max(0, node.y * scale - Math.min(105, element.clientHeight * 0.3)),
        left: Math.max(0, node.x * scale - element.clientWidth * 0.15),
      });
    }
  }, [stepId, layout, scale]);

  return (
    <section className="card diagram-card" aria-label="Диаграмма процесса">
      <div className="diagram-toolbar">
        <div>
          <h2>Карта процесса</h2>
          <p>Выберите шаг, чтобы открыть его детали.</p>
        </div>
        <div className="zoom-controls" aria-label="Масштаб">
          <button className="icon-button" aria-label="Уменьшить масштаб" onClick={() => setZoom(Math.max(0.1, scale - 0.15))} disabled={scale <= 0.1}><Minus size={15} /></button>
          <span aria-live="polite">{Math.round(scale * 100)}%</span>
          <button className="icon-button" aria-label="Увеличить масштаб" onClick={() => setZoom(Math.min(2, scale + 0.15))} disabled={scale >= 2}><Plus size={15} /></button>
          <button className="icon-button fit" aria-label="Вписать по ширине" title="Вписать по ширине" onClick={() => {
            setZoom('fit');
            viewport.current?.scrollTo({ left: 0 });
          }}><Maximize size={14} /></button>
        </div>
      </div>
      <div className="diagram-viewport" ref={viewport} role="region" tabIndex={0} aria-label="Область прокрутки диаграммы">
        {analysis.steps.length
          ? <Drawing analysis={analysis} layout={layout} width={layout.width * scale} selected={selected} onSelect={onSelect} />
          : <p className="diagram-empty">В тексте не удалось выделить шаги процесса.</p>}
      </div>
      <div className="diagram-legend"><span><i className="legend-line" /> Переход</span><span><i className="legend-line return" /> Возврат</span></div>
    </section>
  );
}
