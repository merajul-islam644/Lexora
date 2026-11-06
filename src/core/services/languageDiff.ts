import { normalizeWord } from "../db/ids.js";
import type {
  GrammarRule,
  LanguageProfile,
  VocabularyItem,
} from "../../shared/schemas.js";

/* Version compare (design.md §16.10): a pure, provider-independent diff
 * between two language profiles. Pure on purpose -- no store access -- so it
 * is unit-testable and reusable wherever two snapshots meet. */

export interface RulesChanged {
  before: GrammarRule;
  after: GrammarRule;
}

export interface ProfileDiff {
  fromName: string;
  toName: string;
  nameChanged: boolean;
  fromWordOrder: string;
  toWordOrder: string;
  wordOrderChanged: boolean;
  rulesAdded: GrammarRule[];
  rulesRemoved: GrammarRule[];
  rulesChanged: RulesChanged[];
  vocabAdded: VocabularyItem[];
  vocabRemoved: VocabularyItem[];
  newWarnings: string[];
  resolvedWarnings: string[];
  summary: string;
}

function ruleKey(rule: GrammarRule): string {
  return rule.id;
}

function ruleSignature(rule: GrammarRule): string {
  return JSON.stringify([
    rule.name,
    rule.category,
    rule.explanationEnglish,
    rule.explanationBengali,
    rule.pattern,
    rule.validExamples,
    rule.invalidExamples,
    rule.introducedInVersion,
  ]);
}

export function diffProfiles(
  before: LanguageProfile,
  after: LanguageProfile,
): ProfileDiff {
  const beforeRules = new Map(before.grammarRules.map((r) => [ruleKey(r), r]));
  const afterRules = new Map(after.grammarRules.map((r) => [ruleKey(r), r]));

  const rulesAdded = after.grammarRules.filter(
    (r) => !beforeRules.has(ruleKey(r)),
  );
  const rulesRemoved = before.grammarRules.filter(
    (r) => !afterRules.has(ruleKey(r)),
  );
  const rulesChanged: RulesChanged[] = after.grammarRules.flatMap((r) => {
    const old = beforeRules.get(ruleKey(r));
    return old && ruleSignature(old) !== ruleSignature(r)
      ? [{ before: old, after: r }]
      : [];
  });

  const beforeVocab = new Map(
    before.vocabulary.map((v) => [normalizeWord(v.word), v]),
  );
  const afterVocab = new Map(
    after.vocabulary.map((v) => [normalizeWord(v.word), v]),
  );
  const vocabAdded = [...afterVocab.entries()]
    .filter(([k]) => !beforeVocab.has(k))
    .map(([, v]) => v);
  const vocabRemoved = [...beforeVocab.entries()]
    .filter(([k]) => !afterVocab.has(k))
    .map(([, v]) => v);

  const beforeWarnings = new Set(before.consistencyWarnings);
  const afterWarnings = new Set(after.consistencyWarnings);
  const newWarnings = [...afterWarnings].filter((w) => !beforeWarnings.has(w));
  const resolvedWarnings = [...beforeWarnings].filter(
    (w) => !afterWarnings.has(w),
  );

  const wordOrderChanged = before.wordOrder !== after.wordOrder;
  const nameChanged =
    normalizeWord(before.name) !== normalizeWord(after.name);

  const parts: string[] = [];
  if (nameChanged) parts.push(`name ${before.name} → ${after.name}`);
  if (rulesAdded.length) parts.push(`${rulesAdded.length} rules added`);
  if (rulesRemoved.length) parts.push(`${rulesRemoved.length} rules removed`);
  if (rulesChanged.length) parts.push(`${rulesChanged.length} rules updated`);
  if (vocabAdded.length) parts.push(`${vocabAdded.length} words added`);
  if (vocabRemoved.length) parts.push(`${vocabRemoved.length} words removed`);
  if (wordOrderChanged)
    parts.push(`word order ${before.wordOrder} → ${after.wordOrder}`);

  return {
    fromName: before.name,
    toName: after.name,
    nameChanged,
    fromWordOrder: before.wordOrder,
    toWordOrder: after.wordOrder,
    wordOrderChanged,
    rulesAdded,
    rulesRemoved,
    rulesChanged,
    vocabAdded,
    vocabRemoved,
    newWarnings,
    resolvedWarnings,
    summary: parts.length > 0 ? parts.join(", ") : "No visible changes",
  };
}
