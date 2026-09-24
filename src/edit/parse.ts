import { z } from 'zod';
import { categories } from '../proposal/schema.ts';

const editSchema = z.object({ target: z.string().min(1), replacement: z.string(), category: z.enum(categories), reason: z.string().min(1) });
const answerSchema = z.object({ edits: z.array(editSchema) });
export type ParsedEdit = z.infer<typeof editSchema>;
export function parseEdits(output: string, editable: string): { edits: ParsedEdit[]; discarded: Array<{ reason: string; target?: string }> } {
  let parsed: z.infer<typeof answerSchema>;
  try { parsed = answerSchema.parse(JSON.parse(output)); }
  catch (error) { throw new Error('invalid edit JSON: ' + (error instanceof Error ? error.message : String(error))); }
  const edits: ParsedEdit[] = []; const discarded: Array<{ reason: string; target?: string }> = [];
  for (const edit of parsed.edits) {
    if (!editable.includes(edit.target)) { discarded.push({ reason: 'target-not-verbatim-in-window', target: edit.target }); continue; }
    if (edit.target.includes('\n\n') || edit.replacement.includes('\n\n')) { discarded.push({ reason: 'multi-paragraph-replacement', target: edit.target }); continue; }
    if (edit.target === edit.replacement) { discarded.push({ reason: 'no-op', target: edit.target }); continue; }
    edits.push(edit);
  }
  return { edits, discarded };
}
