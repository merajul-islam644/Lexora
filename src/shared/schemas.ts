import { z } from "zod";

/* ---------------------------------- enums --------------------------------- */

export const PARTS_OF_SPEECH = [
  "noun",
  "verb",
  "adjective",
  "adverb",
  "pronoun",
  "preposition",
  "conjunction",
  "interjection",
  "phrase",
] as const;
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number];

export const LEARNING_STATUSES = [
  "new",
  "learning",
  "remembered",
  "needs_revision",
] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

// TODO(iam-roles): local workspace roles, not IAM directory roles -- see the
// ROLE_RANK note in src/core/types.ts
export const WORKSPACE_ROLES = ["owner", "admin", "editor", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const GEN_STYLES = [
  "naturalistic",
  "concise",
  "formal",
  "futuristic",
  "original",
] as const;
export type GenStyle = (typeof GEN_STYLES)[number];

export const REFERENCE_LANGS = ["bengali", "english", "both"] as const;
export type ReferenceLangs = (typeof REFERENCE_LANGS)[number];

export const LANG_SOURCES = ["user", "generated", "imported"] as const;
export type LangSource = (typeof LANG_SOURCES)[number];

export const PRACTICE_MODES = [
  "word_to_bengali",
  "word_to_english",
  "bengali_to_word",
  "english_to_word",
  "fill_blank",
  "choose_word",
  "pronunciation",
] as const;
export type PracticeMode = (typeof PRACTICE_MODES)[number];

/* ------------------------------- auth schemas ------------------------------ */

// Claims relayed from a Blocks hosted-login session (IAM's GET /iam/v4/auth/me).
// SSO is the only sign-in -- there are no email/password auth schemas.
export const ssoLoginSchema = z.object({
  sub: z.string().min(1).max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  name: z.string().trim().max(200).optional(),
});

/* ----------------------------- workspace schemas --------------------------- */

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(2, "Workspace name is too short").max(80),
  // Optional tag linking the workspace to a SELISE Blocks organization.
  organizationId: z.string().trim().max(120).optional(),
});

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export const memberAddSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  role: z.enum(WORKSPACE_ROLES).default("editor"),
});

export const memberUpdateSchema = z.object({ role: z.enum(WORKSPACE_ROLES) });

export const avatarSchema = z.object({
  fileId: z.string().min(1).max(200)
});

export const avatarUploadSchema = z.object({
  fileName: z.string().min(1).max(200),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"])
});

/* ---------------------------- dictionary schemas --------------------------- */

export const exampleSentenceSchema = z.object({
  id: z.string().default(() => Math.random().toString(36).slice(2, 10)),
  constructed: z.string().trim().max(400).default(""),
  bengali: z.string().trim().max(400).default(""),
  english: z.string().trim().max(400).default(""),
  gloss: z
    .array(
      z.object({ token: z.string().max(80), meaning: z.string().max(120) }),
    )
    .max(60)
    .default([]),
  grammarNotes: z.string().trim().max(600).default(""),
  reviewStatus: z.enum(["draft", "approved"]).default("draft"),
});
export type ExampleSentence = z.infer<typeof exampleSentenceSchema>;

export const dictionaryEntrySchema = z.object({
  word: z.string().trim().min(1, "Constructed word is required").max(80),
  bengaliMeaning: z.string().trim().max(200).default(""),
  englishMeaning: z.string().trim().max(200).default(""),
  pronunciationGuide: z.string().trim().max(120).default(""),
  ipa: z.string().trim().max(120).default(""),
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
  root: z.string().trim().max(120).default(""),
  wordFormationExplanation: z.string().trim().max(600).default(""),
  prefixes: z.string().trim().max(120).default(""),
  suffixes: z.string().trim().max(120).default(""),
  grammarNotes: z.string().trim().max(600).default(""),
  exampleSentences: z.array(exampleSentenceSchema).max(20).default([]),
  mnemonic: z.string().trim().max(400).default(""),
  status: z.enum(["draft", "approved"]).default("approved"),
  learningStatus: z.enum(LEARNING_STATUSES).default("new"),
});
export type DictionaryEntryInput = z.infer<typeof dictionaryEntrySchema>;

export const entryUpdateSchema = dictionaryEntrySchema.partial();

export const importRowSchema = z.object({
  word: z.string().trim().min(1, "word is required").max(80),
  bengaliMeaning: z.string().trim().max(200).optional(),
  englishMeaning: z.string().trim().max(200).optional(),
  pronunciationGuide: z.string().trim().max(120).optional(),
  ipa: z.string().trim().max(120).optional(),
  partOfSpeech: z.enum(PARTS_OF_SPEECH).optional(),
  root: z.string().trim().max(120).optional(),
  mnemonic: z.string().trim().max(400).optional(),
  grammarNotes: z.string().trim().max(600).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importPreviewSchema = z.object({
  format: z.enum(["csv", "json"]),
  content: z
    .string()
    .min(1, "File content is empty")
    .max(2_000_000, "File is too large (max 2MB)"),
});

export const importCommitSchema = z.object({
  rows: z.array(importRowSchema).min(1).max(2000),
});

/* ------------------------------ language schemas --------------------------- */

export const generateRequestSchema = z.object({
  style: z.enum(GEN_STYLES).default("naturalistic"),
  referenceLangs: z.enum(REFERENCE_LANGS).default("both"),
  preferredName: z.string().trim().max(40).optional(),
});

export const languageRenameSchema = z.object({
  name: z.string().trim().min(2).max(40),
});

/* --------------------------- AI generation contract ------------------------ */
/* Shape of the structured output every generation provider must return.
   The backend validates this with Zod before anything is saved (spec §16). */

export const phonologySchema = z.object({
  consonants: z.array(z.string().min(1).max(4)).min(6).max(24),
  vowels: z.array(z.string().min(1).max(4)).min(3).max(10),
  syllableStructures: z.array(z.string().min(1).max(6)).min(1).max(8),
  stressRule: z.string().min(3).max(300),
  forbiddenClusters: z.array(z.string().min(1).max(60)).max(20),
  pronunciationConventions: z
    .array(
      z.object({
        symbol: z.string().min(1).max(6),
        guide: z.string().min(1).max(120),
      }),
    )
    .min(3)
    .max(40),
});

export const grammarRuleSchema = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(2).max(120),
  category: z.string().min(2).max(60),
  explanationEnglish: z.string().min(3).max(1200),
  explanationBengali: z.string().max(1200).default(""),
  pattern: z.string().max(300).default(""),
  validExamples: z.array(z.string().max(300)).max(6).default([]),
  invalidExamples: z
    .array(
      z.object({
        example: z.string().max(300),
        why: z.string().max(300),
      }),
    )
    .max(6)
    .default([]),
  introducedInVersion: z.number().int().min(1).default(1),
});

export const wordFormationSchema = z.object({
  prefixes: z
    .array(
      z.object({
        affix: z.string().min(1).max(8),
        meaning: z.string().min(1).max(120),
      }),
    )
    .max(10)
    .default([]),
  suffixes: z
    .array(
      z.object({
        affix: z.string().min(1).max(8),
        meaning: z.string().min(1).max(120),
      }),
    )
    .max(12)
    .default([]),
});

export const vocabularyItemSchema = z.object({
  entryId: z.string().nullable().default(null),
  source: z.enum(LANG_SOURCES),
  word: z.string().min(1).max(80),
  bengaliMeaning: z.string().max(200).default(""),
  englishMeaning: z.string().max(200).default(""),
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
  pronunciationGuide: z.string().max(120).default(""),
  root: z.string().max(120).default(""),
  formation: z.string().max(300).default(""),
});

export const languageProfileSchema = z.object({
  name: z.string().trim().min(2).max(40),
  nativeName: z.string().trim().max(80).default(""),
  description: z.string().trim().min(10).max(400),
  writingSystem: z.object({
    type: z.string().min(2).max(80),
    description: z.string().min(3).max(1200),
    alphabet: z.array(z.string().min(1).max(4)).max(60).default([]),
    numerals: z.string().max(300).default(""),
    capitalization: z.string().max(300).default(""),
  }),
  phonology: phonologySchema,
  wordOrder: z.enum(["SOV", "SVO", "VSO"]).default("SOV"),
  affixes: z
    .object({
      plural: z.string().default(""),
      past: z.string().default(""),
      future: z.string().default(""),
      negation: z.string().default(""),
      question: z.string().default(""),
      genitive: z.string().default(""),
      formal: z.string().default(""),
    })
    .optional(),
  wordFormation: wordFormationSchema,
  grammarRules: z.array(grammarRuleSchema).min(5).max(60),
  vocabulary: z.array(vocabularyItemSchema).max(5000),
  derivedWords: z.array(z.string().max(80)).max(1000).default([]),
  exampleSentences: z.array(exampleSentenceSchema).max(40).default([]),
  consistencyWarnings: z.array(z.string().max(300)).max(40).default([]),
  versionSummary: z.string().min(3).max(600),
  style: z.enum(GEN_STYLES),
  seed: z.number().int(),
});
export type LanguageProfile = z.infer<typeof languageProfileSchema>;
export type GrammarRule = z.infer<typeof grammarRuleSchema>;
export type VocabularyItem = z.infer<typeof vocabularyItemSchema>;

/* ---------------------------- word builder schemas ------------------------- */

export const suggestWordSchema = z.object({
  concept: z.string().trim().min(1, "Enter a concept").max(200),
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
});

export const approveWordSchema = z.object({
  word: z.string().trim().min(1).max(80),
  bengaliMeaning: z.string().trim().max(200).default(""),
  englishMeaning: z.string().trim().max(200).default(""),
  pronunciationGuide: z.string().trim().max(120).default(""),
  partOfSpeech: z.enum(PARTS_OF_SPEECH).default("noun"),
  root: z.string().trim().max(120).default(""),
  wordFormationExplanation: z.string().trim().max(600).default(""),
  mnemonic: z.string().trim().max(400).default(""),
});

/* ---------------------------- translation schemas -------------------------- */

export const TRANSLATE_LANGS = ["bengali", "english", "language"] as const;

export const translateSchema = z
  .object({
    text: z.string().trim().min(1, "Enter text to translate").max(2000),
    from: z.enum(TRANSLATE_LANGS),
    to: z.enum(TRANSLATE_LANGS),
  })
  .refine((v) => v.from !== v.to, {
    message: "Choose two different languages",
    path: ["to"],
  });

export const phrasebookAddSchema = z.object({
  sourceText: z.string().trim().min(1).max(2000),
  sourceLang: z.enum(TRANSLATE_LANGS),
  translatedText: z.string().trim().min(1).max(2000),
  targetLang: z.enum(TRANSLATE_LANGS),
  note: z.string().trim().max(400).default(""),
});

/* ------------------------------ practice schemas --------------------------- */

export const practiceReviewSchema = z.object({
  entryId: z.string().min(1),
  mode: z.enum(PRACTICE_MODES),
  correct: z.boolean(),
});

/* ------------------------------- shared types ------------------------------ */

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole;
  isDemo: boolean;
  languageName: string | null;
  wordCount: number;
  createdAt: string;
}

export interface DashboardData {
  workspace: { id: string; name: string; isDemo: boolean; role: WorkspaceRole };
  language: {
    id: string;
    name: string;
    nativeName: string;
    description: string;
    version: number;
    status: string;
    createdAt: string;
    updatedAt: string;
  } | null;
  metrics: {
    words: number;
    grammarRules: number;
    mappedPercent: number;
    updatedAt: string | null;
  };
  preview: Array<{
    id: string;
    word: string;
    bengaliMeaning: string;
    englishMeaning: string;
    partOfSpeech: string;
    pronunciationGuide: string;
    source: string;
  }>;
  activity: Array<{
    id: string;
    action: string;
    resourceType: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
}

export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}
