declare module '*.mjs' {
  export interface ParseResult {
    locale: string;
    intent: string;
    risk: 'low' | 'medium' | 'high';
    requiresApproval: boolean;
  }
  export function parseCommand(text: string): ParseResult;
}
