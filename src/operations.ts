export type Operation = 'import' | 'analyze' | 'save';

export function createOperations(setBusy: (operation: Operation | null) => void) {
  let active: Operation | null = null;
  return {
    get active() { return active; },
    async run<T>(operation: Operation, work: () => Promise<T>): Promise<T> {
      if (active) throw new Error('Дождитесь окончания текущей операции.');
      active = operation;
      setBusy(active);
      try {
        return await work();
      } finally {
        active = null;
        setBusy(null);
      }
    },
  };
}
