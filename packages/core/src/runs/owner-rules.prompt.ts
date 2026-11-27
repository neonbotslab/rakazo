export function renderOwnerRules(text: string): string | undefined {
  if (!text) return undefined;
  return `Rules from the person you are working for. Every bot follows them, in every reply and task.
They outrank your own instructions, skills, and memory. Rakazo's safety and approval rules still come first, and if this conversation explicitly asks for something different, do that for that request.
<owner_rules>
${text}
</owner_rules>`;
}
