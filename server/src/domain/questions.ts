export interface SnapshotOption {
  id: string;
  label: string;
  text: string;
}

export interface QuestionSnapshot {
  id: string;
  subjectId: string;
  chapterId: string;
  chapterName: string;
  type: "single" | "multiple" | "judge" | "fill_blank" | "short_answer";
  stem: string;
  code: string;
  images: Array<{ src: string; alt: string; caption?: string }>;
  options: SnapshotOption[];
  correctOptionIds: string[];
  acceptedAnswers: string[][];
  answerConfig: { caseSensitive?: boolean; punctuationSensitive?: boolean };
  referenceAnswer: string;
  explanation: string;
  difficulty: number;
  tags: string[];
  version: number;
}

export function normalizedOptionIds(optionIds: string[]): string[] {
  return Array.from(new Set(optionIds)).sort();
}

export function sameAnswer(left: string[], right: string[]): boolean {
  const a = normalizedOptionIds(left);
  const b = normalizedOptionIds(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function publicQuestion(snapshot: QuestionSnapshot, isFavorite: boolean) {
  const {
    correctOptionIds: _correct,
    acceptedAnswers: _accepted,
    referenceAnswer: _reference,
    answerConfig: _answerConfig,
    explanation: _explanation,
    ...safe
  } = snapshot;
  return Object.assign({}, safe, {
    isFavorite,
    blankCount: snapshot.type === "fill_blank" ? snapshot.acceptedAnswers.length : 0
  });
}

export function shuffle<T>(values: T[], random: () => number = Math.random): T[] {
  const result = values.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

export function validateSelection(snapshot: QuestionSnapshot, selected: string[]): string[] {
  if (!["single", "multiple", "judge"].includes(snapshot.type)) throw new Error("INVALID_ANSWER_TYPE");
  const normalized = normalizedOptionIds(selected);
  if (!normalized.length) throw new Error("ANSWER_REQUIRED");
  if (normalized.some((id) => !snapshot.options.some((option) => option.id === id))) throw new Error("INVALID_OPTION");
  if (snapshot.type !== "multiple" && normalized.length !== 1) throw new Error("INVALID_OPTION");
  return normalized;
}
