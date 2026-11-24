import type { Analysis } from './types';

export function measurementQuestions(analysis: Pick<Analysis, 'steps' | 'bottlenecks' | 'recommendations'>): string[] {
  const questions: string[] = [];
  if (analysis.bottlenecks.some(item => item.time_minutes === null)) {
    questions.push('Сколько минут занимает лишняя работа или ожидание для каждой выявленной проблемы?');
  }
  if (analysis.bottlenecks.some(item => item.time_minutes === null || item.cost_rub === null)) {
    questions.push('Сколько раз за день или месяц возникает каждая проблема?');
  }
  if (analysis.bottlenecks.some(item => item.cost_rub === null)) {
    questions.push('Какова стоимость часа участников и какие прямые расходы связаны с проблемой?');
  }
  if (analysis.steps.some(item => item.duration_minutes === null)) {
    questions.push('Сколько времени занимают шаги, длительность которых пока не подтверждена?');
  }
  if (analysis.recommendations.some(item => item.estimated_saving_minutes === null)) {
    questions.push('Как изменится время выполнения операций в пилоте по сравнению с текущим процессом?');
  }
  return questions;
}
