import path from "path";

const KNOWLEDGE_REFERENCE = `
## Knowledge Base
Before solving novel problems, check the Cascade knowledge base for existing solutions.
Manifest: {MANIFEST_PATH}
Categories: deployment, auth, database, performance, testing, error-handling, integrations, anti-patterns, architecture, tooling
If you discover a reusable lesson, tag it with [LESSON] in your handoff notes.
`.trim();

/**
 * Generate the knowledge base reference block for a project's CLAUDE.md.
 */
export function generateKnowledgeBlock(
  cascadePath: string,
  projectPath: string
): string {
  const manifestAbsolute = path.join(cascadePath, "knowledge", "manifest.md");
  const manifestRelative = path.relative(projectPath, manifestAbsolute);

  return KNOWLEDGE_REFERENCE.replace("{MANIFEST_PATH}", manifestRelative);
}

/**
 * Check if a CLAUDE.md content already has the knowledge base reference.
 */
export function hasKnowledgeReference(claudeContent: string): boolean {
  return claudeContent.includes("## Knowledge Base") &&
    claudeContent.includes("[LESSON]");
}

/**
 * Patch a CLAUDE.md to include the knowledge base reference.
 * Appends the block at the end if not already present.
 */
export function patchClaudeMd(
  existingContent: string,
  cascadePath: string,
  projectPath: string
): string {
  if (hasKnowledgeReference(existingContent)) {
    return existingContent;
  }

  const block = generateKnowledgeBlock(cascadePath, projectPath);
  return `${existingContent.trimEnd()}\n\n${block}\n`;
}
