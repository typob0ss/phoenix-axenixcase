export type StepType = 'task' | 'decision' | 'wait' | 'handoff' | 'rework' | 'manual_input';
export type Role = { id: string; name: string };
export type Step = {
  id: string;
  title: string;
  role_id: string;
  type: StepType;
  quote: string;
  confidence: number;
  systems: string[];
  documents: string[];
  duration_minutes: number | null;
};
export type Edge = { id: string; from_step: string; to_step: string; label: string; quote: string };
export type Bottleneck = {
  id: string;
  title: string;
  step_ids: string[];
  loss_type: string;
  cause: string;
  quote: string;
  time_minutes: number | null;
  cost_rub: number | null;
  metric_basis: string;
};
export type Recommendation = {
  id: string;
  title: string;
  description: string;
  bottleneck_ids: string[];
  quote: string;
  effect: string;
  estimated_saving_minutes: number | null;
  calculation: string;
  complexity: 'low' | 'medium' | 'high';
  risk: 'low' | 'medium' | 'high';
  priority: number;
};
export type Analysis = {
  schema_version: '1.0';
  title: string;
  source_text: string;
  mode: 'demo' | 'live';
  demo_id: string | null;
  roles: Role[];
  steps: Step[];
  edges: Edge[];
  bottlenecks: Bottleneck[];
  recommendations: Recommendation[];
  warnings: string[];
  edited: boolean;
};
export type Example = { id: string; title: string; sector: string; description: string; text: string };
export type Health = { status: 'ok'; llm_configured: boolean; model: string | null };

export const STEP_LABELS: Record<StepType, string> = {
  task: 'Действие',
  decision: 'Решение',
  wait: 'Ожидание',
  handoff: 'Передача',
  rework: 'Доработка',
  manual_input: 'Ручной ввод',
};
