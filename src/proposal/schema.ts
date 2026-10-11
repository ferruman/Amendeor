import { z } from 'zod';

export const categories = ['spelling', 'grammar', 'punctuation', 'typography', 'capitalization', 'word-choice', 'clarity', 'sentence-structure', 'redundancy', 'repetition', 'dialogue-mechanics', 'terminology', 'consistency', 'prose-pattern'] as const;
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const proposalSchema = z.object({
  schema: z.literal('amendeor.proposal/0.1'),
  id: z.string().regex(/^amendeor:[0-9a-f]{16}$/),
  fingerprint: z.object({ primary: z.object({ category: z.enum(categories), chapter: z.string(), scene: z.string(), key: hash, occurrence: z.number().int().positive().optional() }), evidence: hash }),
  run_id: z.string().min(1),
  tool: z.object({ name: z.literal('amendeor'), version: z.string() }),
  location: z.object({ chapter: z.string(), scene: z.string(), content_hash: hash }),
  target: z.object({ text: z.string().min(1), hash, before: z.string().max(60), after: z.string().max(60), occurrence: z.number().int().nonnegative() }),
  replacement: z.string(),
  category: z.enum(categories),
  impact: z.enum(['mechanical', 'prose']),
  source: z.string().regex(/^(model|rule:[a-z0-9][a-z0-9._-]*)$/),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  source_findings: z.array(z.string()).optional(),
  // Какие проходы редактора независимо предложили эту правку (только при диагностическом проходе).
  passes: z.array(z.enum(['standard', 'diagnostic'])).optional(),
  verification: z.object({ passes: z.number().int().nonnegative(), agreed: z.number().int().nonnegative(), semantic_risk: z.string(), voice: z.string() }),
  unverified: z.literal(true).optional(),
  // Полномочия детерминированного правила (rules/index.ts): mechanical | contextual | semantic. Только у правок правил.
  rule_authority: z.enum(['mechanical', 'contextual', 'semantic']).optional(),
  // Находка на проверку (semantic): текст не меняется без явного решения; здесь — на чём основана находка.
  review: z.object({ evidence: z.record(z.string(), z.union([z.string(), z.number()])) }).optional()
});
export type Proposal = z.infer<typeof proposalSchema>;
