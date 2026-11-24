# API v1 — фиксированный контракт

Все маршруты с префиксом `/api`. Ошибки: JSON `{"detail":"Понятное сообщение"}` либо стандартная ошибка Pydantic. Клиент должен обрабатывать оба вида.

```ts
type StepType = 'task'|'decision'|'wait'|'handoff'|'rework'|'manual_input';
type Evidence = { quote: string };
type Step = { id: string; title: string; role_id: string; type: StepType; quote: string; confidence: number; systems: string[]; documents: string[]; duration_minutes: number|null };
type Edge = { id: string; from_step: string; to_step: string; label: string; quote: string };
type Bottleneck = { id: string; title: string; step_ids: string[]; loss_type: string; cause: string; quote: string; time_minutes: number|null; cost_rub: number|null; metric_basis: string };
type Recommendation = { id: string; title: string; description: string; bottleneck_ids: string[]; quote: string; effect: string; estimated_saving_minutes: number|null; calculation: string; complexity: 'low'|'medium'|'high'; risk: 'low'|'medium'|'high'; priority: number };
type Analysis = { schema_version: '1.0'; title: string; source_text: string; mode: 'demo'|'live'; demo_id: string|null; roles: {id:string; name:string}[]; steps: Step[]; edges: Edge[]; bottlenecks: Bottleneck[]; recommendations: Recommendation[]; warnings: string[]; edited: boolean };
type Example = {id:string; title:string; sector:string; description:string; text:string};
```

- `GET /health` → `{status:'ok', llm_configured:boolean, model:string|null}` (no secrets)
- `GET /examples` → `Example[]` ids `bank`, `retail`, `hr`
- `POST /analyze` body `{text:string, demo_id?:string|null}` → Analysis. With demo_id require exact example text, return saved demo. Otherwise call LLM, never silently use fixture.
- `POST /import` multipart field `file` → `{text:string, filename:string}`. Supports TXT UTF-8/UTF-8-BOM and DOCX.
- `POST /validate` body Analysis → validated Analysis, server sets `edited:true` and adds warning about reviewing dependent findings. Validate citations and graph references, reject forged facts. Frontend uses this on save.
- `POST /report` body Analysis → `{markdown:string}` (validate current edited data, concise report with quotes).
- `POST /report/pdf` body Analysis → binary `application/pdf`, attachment `phoenix-report.pdf`. One A4 summary with up to three grounded losses and three automation priorities; long content is excerpted. Detailed report remains in Markdown; JSON preserves complete evidence. Uses the same source and quote validation as other exports.

SVG is produced on frontend from actual current graph. JSON uses current Analysis, no separate API. Vite proxies /api to localhost:8000; production frontend served by FastAPI if dist exists.
