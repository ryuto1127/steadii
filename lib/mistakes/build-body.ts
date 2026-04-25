// Pure helper — extracted from `lib/mistakes/save.ts` so unit tests
// don't pull in the db / billing / embedding chain (and the env
// validation that comes with it).

export function buildMistakeMarkdownBody(args: {
  userQuestion: string;
  assistantExplanation: string;
  imageUrls: string[];
}): string {
  const parts: string[] = [];
  for (const url of args.imageUrls) {
    parts.push(`![](${url})`);
  }
  if (args.userQuestion.trim()) {
    parts.push("## The problem");
    parts.push(args.userQuestion);
  }
  if (args.assistantExplanation.trim()) {
    parts.push("## Step-by-step explanation");
    parts.push(args.assistantExplanation);
  }
  return parts.join("\n\n");
}
