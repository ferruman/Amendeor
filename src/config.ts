import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const priceSchema = z.object({ input_per_m: z.number().nonnegative(), output_per_m: z.number().nonnegative(), currency: z.string().min(1) });
export const providerSchema = z.object({
  transport: z.enum(['anthropic', 'openai', 'local']), endpoint: z.string().optional(), family: z.string().optional(),
  api_key: z.string().optional(), api_key_env: z.string().optional(), api_key_file: z.string().optional(), price: priceSchema.optional()
}).passthrough();
export const profileSchema = z.object({
  provider: z.string().min(1), model: z.string().min(1), temperature: z.number().min(0).max(2).optional(),
  context_budget: z.number().int().positive().optional(), passes: z.number().int().positive().optional(),
  family: z.string().optional(), thinking: z.boolean().optional(), reasoning: z.boolean().optional()
}).passthrough();
export const configSchema = z.object({
  language: z.string().optional(), preserve: z.array(z.string()).default([]),
  normalize: z.object({ spelling: z.string().optional(), quotes: z.string().optional(), yo: z.enum(['keep', 'yo', 'e']).default('keep'), dashes: z.string().optional(), ellipsis: z.boolean().default(false) }).passthrough().default({ yo: 'keep', ellipsis: false }),
  avoid: z.array(z.string()).default([]), auto_accept: z.array(z.enum(['mechanical'])).default([]),
  rules: z.record(z.string(), z.union([z.literal('on'), z.literal('off'), z.boolean()])).default({}),
  providers: z.record(z.string(), providerSchema).default({}), profiles: z.record(z.string(), profileSchema).default({})
}).passthrough();
export type Config = z.infer<typeof configSchema>;
export type ConfigLayer = 'defaults' | 'user' | 'workspace' | 'environment' | 'cli';
export interface LoadedConfig { config: Config; winningLayer: Record<string, ConfigLayer>; warnings: string[] }

const defaults: Config = configSchema.parse({});
const reservedEnv = new Set(['AMENDEOR_CONFIG']);
const configKeys = new Set(Object.keys(configSchema.shape));

function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

function overlay(target: Record<string, unknown>, source: Record<string, unknown>, layer: ConfigLayer, winners: Record<string, ConfigLayer>, prefix = ''): void {
  for (const [key, value] of Object.entries(source)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isRecord(value)) {
      if (!isRecord(target[key])) target[key] = {};
      overlay(target[key] as Record<string, unknown>, value, layer, winners, name);
    } else { target[key] = value; winners[name] = layer; }
  }
}

function fromEnvironment(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('AMENDEOR_') || reservedEnv.has(key) || value === undefined) continue;
    const parts = key.slice('AMENDEOR_'.length).toLowerCase().split('__');
    // Только известные ключи: иначе секреты вроде AMENDEOR_OPENROUTER_API_KEY попадут в run.json.
    if (!configKeys.has(parts[0]!)) continue;
    let cursor = values;
    for (const part of parts.slice(0, -1)) { cursor[part] ??= {}; if (!isRecord(cursor[part])) throw new Error(`invalid environment config path: ${key}`); cursor = cursor[part] as Record<string, unknown>; }
    let parsed: unknown = value;
    try { parsed = parseYaml(value); } catch { /* Строковое значение допустимо. */ }
    cursor[parts.at(-1)!] = parsed;
  }
  return values;
}

async function readYaml(file: string): Promise<Record<string, unknown>> {
  let body: string;
  try { body = await readFile(file, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  const parsed: unknown = parseYaml(body);
  if (!isRecord(parsed)) throw new Error(`configuration must be a YAML mapping: ${file}`);
  return parsed;
}

function validateKey(value: string, field: string): void {
  if (/…|\.\.\.|<[^>]+>|paste.key.here/i.test(value)) throw new Error(`${field}: replace the placeholder API key`);
  if ([...value].some((char) => char.codePointAt(0)! > 255 || /[\x00-\x1f\x7f]/.test(char))) throw new Error(`${field}: API key contains characters an HTTP header cannot carry`);
}

export async function loadConfig(options: { workspaceDir?: string; cli?: Record<string, unknown>; env?: NodeJS.ProcessEnv } = {}): Promise<LoadedConfig> {
  const env = options.env ?? process.env;
  const home = env.HOME ?? os.homedir();
  const userFile = env.AMENDEOR_CONFIG ?? path.join(env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'codicora', 'amendeor.yaml');
  const winners: Record<string, ConfigLayer> = {};
  const merged = structuredClone(defaults) as Record<string, unknown>;
  overlay({}, defaults, 'defaults', winners);
  overlay(merged, await readYaml(userFile), 'user', winners);
  if (options.workspaceDir) {
    const workspace = await readYaml(path.join(options.workspaceDir, 'amendeor.yaml'));
    // Ключ — машины и учётной записи, а не книги: папка книги переносима и уходит в git (WORKSPACE.md).
    for (const [name, provider] of Object.entries(isRecord(workspace.providers) ? workspace.providers : {})) {
      if (isRecord(provider) && provider.api_key !== undefined) throw new Error(`workspace amendeor.yaml: providers.${name}.api_key is no longer supported — a credential does not belong in the book's folder. Move it to the environment (providers.${name}.api_key_env: <VARIABLE>), a key file outside the workspace (api_key_file), or the user config ${userFile}`);
    }
    overlay(merged, workspace, 'workspace', winners);
  }
  overlay(merged, fromEnvironment(env), 'environment', winners);
  if (options.cli) overlay(merged, options.cli, 'cli', winners);
  const config = configSchema.parse(merged);
  for (const [name, provider] of Object.entries(config.providers)) {
    if (provider.api_key) validateKey(provider.api_key, `providers.${name}.api_key`);
    if (provider.api_key_env && env[provider.api_key_env]) validateKey(env[provider.api_key_env]!, `providers.${name}.api_key_env`);
  }
  return { config, winningLayer: winners, warnings: [] };
}
