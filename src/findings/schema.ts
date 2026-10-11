// Контракт Codicora Findings v0.1: ../FINDINGS.md; совместим со схемой Esgardeor.
import { z } from "zod";

export const FINDING_SCHEMA = "codicora.finding/0.1" as const;

export const toolNameSchema = z.string().regex(/^[a-z][a-z0-9-]*$/, "tool name: lowercase slug");
export const categorySchema = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, "category: dotted lowercase, ≥ 2 segments");
export const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/, "sha256:<64 hex>");

export const kindSchema = z.enum(["defect", "concern", "suggestion"]);
export const severitySchema = z.enum(["critical", "high", "medium", "low", "info"]);
export const scopeSchema = z.enum(["scene", "chapter", "book", "project"]);
/** Порядок серьёзности: info < low < medium < high < critical. */
export const SEVERITY_ORDER = ["info", "low", "medium", "high", "critical"] as const;

export const toolSchema = z.object({ name: toolNameSchema, version: z.string().min(1) });

export const fingerprintPrimarySchema = z.object({
  category: categorySchema,
  chapter: z.string().min(1).nullable(),
  scene: z.string().min(1).nullable(),
  key: z.string(),
});
export const fingerprintSchema = z.object({
  primary: fingerprintPrimarySchema,
  evidence: hashSchema,
});

export const anchorSchema = z.object({
  chapter: z.string().min(1),
  scene: z.string().min(1).nullable(),
  path: z.string().min(1),
  file: z.string().min(1),
  lines: z.tuple([z.number().int().positive(), z.number().int().positive()]).nullable(),
  content_hash: hashSchema,
});
export const relatedAnchorSchema = z.object({
  chapter: z.string().min(1),
  scene: z.string().min(1).optional(),
  path: z.string().min(1),
  role: z.string().optional(),
});
export const locationSchema = z.object({
  primary: anchorSchema,
  related: z.array(relatedAnchorSchema).default([]),
});

export const quoteEvidenceSchema = z.object({
  type: z.literal("quote"),
  scene: z.string().min(1),
  text: z.string().min(1),
  hash: hashSchema,
});
export const metricEvidenceSchema = z.object({
  type: z.literal("metric"),
  name: z.string().min(1),
  value: z.number(),
  baseline: z.number().nullable(),
  unit: z.string().min(1),
});
export const referenceEvidenceSchema = z.object({
  type: z.literal("reference"),
  uri: z.string().min(1),
  note: z.string().optional(),
});
export const evidenceSchema = z.discriminatedUnion("type", [quoteEvidenceSchema, metricEvidenceSchema, referenceEvidenceSchema]);

export const findingSchema = z
  .object({
    schema: z.literal(FINDING_SCHEMA),
    id: z.string().regex(/^[a-z][a-z0-9-]*:[0-9a-f]{16}$/, "id: <tool>:<16 hex>"),
    fingerprint: fingerprintSchema,
    run_id: z.string().min(1),
    tool: toolSchema,
    category: categorySchema,
    kind: kindSchema,
    severity: severitySchema,
    confidence: z.number().min(0).max(1),
    scope: scopeSchema,
    location: locationSchema.nullable(),
    evidence: z.array(evidenceSchema),
    summary: z.string().min(1).refine((s) => !s.includes("\n"), "summary is one line"),
    explanation: z.string(),
    suggestion: z.string().optional(),
    status: z.literal("open"),
    metadata: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((f, ctx) => {
    if ((f.location === null) !== (f.scope === "project")) {
      ctx.addIssue({ code: "custom", path: ["location"], message: "location is null if and only if scope is \"project\"" });
    }
    if (f.kind === "defect" && !f.evidence.some((e) => e.type === "quote")) {
      ctx.addIssue({ code: "custom", path: ["evidence"], message: "a defect needs at least one quote evidence" });
    }
    if (f.category !== f.fingerprint.primary.category) {
      ctx.addIssue({ code: "custom", path: ["fingerprint", "primary", "category"], message: "must equal category" });
    }
    if (!f.id.startsWith(`${f.tool.name}:`)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: "id must be prefixed with tool.name" });
    }
    const primary = f.fingerprint.primary;
    const chapterScoped = f.scope === "scene" || f.scope === "chapter";
    if ((primary.chapter !== null) !== chapterScoped) {
      ctx.addIssue({ code: "custom", path: ["fingerprint", "primary", "chapter"], message: "chapter required for scene/chapter scope, null for book/project scope" });
    }
    if ((f.scope === "scene" && primary.scene === null) || (!chapterScoped && primary.scene !== null)) {
      ctx.addIssue({ code: "custom", path: ["fingerprint", "primary", "scene"], message: "scene required for scene scope, optional for chapter scope, null for book/project scope" });
    }
    if (chapterScoped && f.location && primary.chapter !== f.location.primary.chapter) {
      ctx.addIssue({ code: "custom", path: ["fingerprint", "primary", "chapter"], message: "must equal location.primary.chapter" });
    }
    if (chapterScoped && f.location && primary.scene !== f.location.primary.scene) {
      ctx.addIssue({ code: "custom", path: ["fingerprint", "primary", "scene"], message: "must equal location.primary.scene" });
    }
  });

export type Finding = z.infer<typeof findingSchema>;
export type FindingInput = z.input<typeof findingSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Kind = z.infer<typeof kindSchema>;
export type Severity = z.infer<typeof severitySchema>;
export type Scope = z.infer<typeof scopeSchema>;
