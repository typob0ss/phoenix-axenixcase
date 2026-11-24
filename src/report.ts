const escapedMarkdown = "\\`*_{[]#|";
const htmlEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>' };

export function decodeReportText(text: string): string {
  return text
    .replace(/\\(.)/g, (match, character) => escapedMarkdown.includes(character) ? character : match)
    .replace(/&(amp|lt|gt);/g, (_, entity: string) => htmlEntities[entity]);
}
