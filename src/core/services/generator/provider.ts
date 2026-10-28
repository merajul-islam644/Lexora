import { GenerationEngine, validateProfileOrThrow, type GenerationInput } from "./index.js";
import type { StageId } from "./index.js";
import type { LanguageProfile } from "../../../shared/schemas.js";
import { env } from "../../env.js";
import { HttpError } from "../../lib/http.js";

export const ENGINE_STAGES: readonly Exclude<StageId, "saving">[] = [
  "reviewing_dictionary",
  "sound_rules",
  "vocabulary",
  "grammar",
  "consistency"
];

export interface GenerationProvider {
  name: string;
  isConfigured(): boolean;
  generate(input: GenerationInput, onStage: (stage: StageId) => void): Promise<LanguageProfile>;
}

/**
 * Deterministic local provider. This is a real rule-based conlang generator —
 * the same engine that powers the offline build — not a stub. It needs no
 * network access and no API key.
 */
export const localProvider: GenerationProvider = {
  name: "local-deterministic",
  isConfigured: () => true,
  async generate(input, onStage): Promise<LanguageProfile> {
    const engine = new GenerationEngine(input);
    for (const stage of ENGINE_STAGES) {
      onStage(stage);
      engine.runStage(stage);
    }
    return engine.buildProfile();
  }
};

/**
 * Anthropic provider: sends the generation contract as a structured-output
 * request and validates the reply with the same Zod schema before it can be
 * saved. NOTE: implemented against the Messages API but not exercised in this
 * environment (no API key); the local provider is the tested default.
 */
const ANTHROPIC_MODEL = "claude-sonnet-5-5";

export const anthropicProvider: GenerationProvider = {
  name: "anthropic",
  isConfigured: () => Boolean(env.aiApiKey),
  async generate(input, onStage): Promise<LanguageProfile> {
    if (!env.aiApiKey) {
      throw new HttpError(
        503,
        "The AI provider is not configured on this server (missing API key). The local generation engine is used instead when LEXORA_AI_PROVIDER=local.",
        "provider_not_configured"
      );
    }
    onStage("reviewing_dictionary");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": env.aiApiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: ANTHROPIC_MODEL,
          max_tokens: 8000,
          messages: [{ role: "user", content: buildProviderPrompt(input) }]
        })
      });
      if (!response.ok) {
        throw new HttpError(502, "The AI provider could not be reached. Nothing was saved — you can retry.", "provider_error");
      }
      const data = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content?.find((c) => c.type === "text")?.text ?? "";
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        throw new HttpError(502, "The AI provider returned an unreadable result. Nothing was saved.", "provider_invalid");
      }
      const raw = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as unknown;
      for (const stage of ENGINE_STAGES) onStage(stage);
      return validateProfileOrThrow(raw);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new HttpError(504, "The AI provider took too long to respond. Nothing was saved — you can retry.", "provider_timeout");
      }
      throw new HttpError(502, "The AI provider request failed. Nothing was saved — you can retry.", "provider_error");
    } finally {
      clearTimeout(timeout);
    }
  }
};

function buildProviderPrompt(input: GenerationInput): string {
  const words = input.entries
    .slice(0, 400)
    .map((e) => `${e.word || "(unnamed)"} = ${e.english_meaning || "?"} / ${e.bengali_meaning || "?"} [${e.part_of_speech}]`)
    .join("\n");
  return [
    "Design a small constructed language for a private business workspace.",
    "Return ONLY a JSON object matching this shape (no markdown):",
    `{"name","nativeName","description","writingSystem":{"type","description","alphabet":[],"numerals","capitalization"},"phonology":{"consonants":[],"vowels":[],"syllableStructures":[],"stressRule","forbiddenClusters":[],"pronunciationConventions":[{"symbol","guide"}]},"wordOrder":"SOV"|"SVO"|"VSO","wordFormation":{"prefixes":[{"affix","meaning"}],"suffixes":[{"affix","meaning"}]},"grammarRules":[{"id","name","category","explanationEnglish","explanationBengali","pattern","validExamples":[],"invalidExamples":[{"example","why"}],"introducedInVersion":1}],"vocabulary":[{"entryId","source":"user"|"generated","word","bengaliMeaning","englishMeaning","partOfSpeech","pronunciationGuide","root","formation"}],"derivedWords":[],"exampleSentences":[{"id","constructed","bengali","english","gloss":[{"token","meaning"}],"grammarNotes","reviewStatus":"draft"}],"consistencyWarnings":[],"versionSummary","style":"${input.style}","seed":${input.seed}}`,
    `Language name style hint: ${input.style}. Do not use any of these taken names: ${[...input.existingNames].slice(0, 50).join(", ")}.`,
    `Workspace: ${input.workspaceName}. Dictionary to map (preserve these meanings exactly):`,
    words
  ].join("\n");
}

export function getProvider(): GenerationProvider {
  if (env.aiProvider === "anthropic") return anthropicProvider;
  return localProvider;
}
