## STRICT Reference-Word Separation Rules

These rules are mandatory. Never silently ignore or weaken them.

### 1. Reference-Word Independence

- Every newly invented constructed-language word must be independently coined.
- Do not directly copy, transliterate, respell, abbreviate, or make a trivial variation of its Bengali or English reference word.
- Do not create a word merely by changing one letter, adding a prefix or suffix, reversing letters, changing capitalization, or replacing a single sound in the reference word.
- Do not use Bengali or English reference words as the phonological template for newly coined words.
- Bengali and English meanings are semantic references only. They explain what the constructed word means; they must not determine how it is spelled or pronounced.

### 2. Strict Spelling-Distance Checks

- Compare each candidate word against its Bengali and English reference terms, including common variants and known transliterations.
- Normalize text before comparing: case, Unicode normalization, whitespace, punctuation, and relevant script-specific formatting.
- Reject exact matches and near-identical spellings.
- Use normalized Levenshtein distance and character n-gram similarity as screening methods. Set configurable minimum thresholds and document them.
- For short words, apply stricter checks because one-character differences can still create obvious similarity.
- Do not rely on a similarity score alone. A candidate may look copied even when its score passes.
- If a candidate fails, discard it and generate a genuinely different candidate.

### 3. Strict Pronunciation Separation

- Compare phonetic representations, not spelling alone.
- Reject candidates that sound identical or confusingly similar to their Bengali or English reference words.
- Consider IPA where reliable, syllable count, consonant sequences, vowel patterns, stress, and syllable structure.
- Avoid simply changing an accent, stress, or one phoneme to disguise a reference word.
- If pronunciation cannot be reliably assessed, mark the candidate for review instead of claiming it passed.

### 4. Independent Word Structure

- Define the constructed language's own phoneme inventory, syllable rules, spelling system, and word-formation system.
- Generate candidates from those rules rather than from Bengali or English spelling.
- Maintain consistent constructed-language morphology without copying reference-language morphology mechanically.
- Do not reuse a reference word's recognizable root or distinctive sound sequence merely to make the meaning easier to remember.
- Mnemonics may explain a concept, but must not encourage users to pronounce or spell the constructed word like its reference word.

### 5. Mandatory Candidate Validation

Before accepting any new word:

1. Check exact spelling matches.
2. Check near-spelling matches against Bengali and English references.
3. Check transliterations and common variants where available.
4. Check pronunciation and phonetic similarity.
5. Check internal collisions with existing words in the same constructed language.
6. Check compliance with the language's phonology and spelling rules.
7. Reject, regenerate, and recheck any candidate that fails.
8. Record the validation result and any unresolved uncertainty.

A candidate must not be marked PASS if a mandatory check failed or was skipped. Use REVIEW when evidence is insufficient.

### 6. Structured Validation Results

When returning a word candidate, include:

- constructed_word
- bengali_meaning
- english_meaning
- pronunciation
- ipa_if_available
- spelling_similarity_result
- pronunciation_similarity_result
- internal_collision_result
- validation_status: PASS, REJECT, or REVIEW
- validation_notes

Do not fabricate similarity scores or claim that a comparison was executed unless it actually ran.

### 7. Honest Limits

- These checks reduce accidental similarity; they cannot prove that a word has never existed in any language.
- A language with a small vocabulary may inevitably have coincidences with existing words.
- For strong validation, compare against maintained reference lexicons and the application's existing dictionary.
- Keep the validation rules versioned so future changes do not silently weaken them.
  EOF
