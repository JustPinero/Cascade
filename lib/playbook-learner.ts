export interface PlaybookSuggestion {
  type: "recurring-lesson" | "recurring-blocker";
  summary: string;
  occurrences: number;
  projects: string[];
  examples: string[];
}

interface SessionInput {
  projectName: string;
  content: string;
}

/**
 * Extract tagged signals from session content.
 */
function extractTaggedSignals(
  content: string,
  tag: string
): string[] {
  const regex = new RegExp(`\\[${tag}\\]\\s*(.*)`, "g");
  const signals: string[] = [];
  for (const match of content.matchAll(regex)) {
    const message = match[1].trim();
    if (message) signals.push(message);
  }
  return signals;
}

/**
 * Normalize a message for grouping: lowercase, strip punctuation, collapse whitespace.
 */
function normalizeForGrouping(message: string): string {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find common keywords across messages to determine if they're about the same topic.
 * Returns true if messages share enough significant words.
 */
function messagesRelated(a: string, b: string): boolean {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "must", "shall", "can", "to", "of", "in",
    "for", "on", "with", "at", "by", "from", "it", "this", "that", "and",
    "or", "but", "not", "no", "if", "then", "than", "so", "as", "up",
    "out", "about", "into", "after", "before", "always", "never", "run",
    "need", "needs", "must",
  ]);

  const wordsA = new Set(
    normalizeForGrouping(a)
      .split(" ")
      .filter((w) => w.length > 2 && !stopWords.has(w))
  );
  const wordsB = new Set(
    normalizeForGrouping(b)
      .split(" ")
      .filter((w) => w.length > 2 && !stopWords.has(w))
  );

  if (wordsA.size === 0 || wordsB.size === 0) return false;

  let shared = 0;
  const sharedWords: string[] = [];
  for (const w of wordsA) {
    if (wordsB.has(w)) {
      shared++;
      sharedWords.push(w);
    }
  }

  // 2+ shared significant words, or 1 shared word that's 4+ chars (domain-specific)
  if (shared >= 2) return true;
  if (shared === 1 && sharedWords[0].length >= 4) return true;

  return false;
}

/**
 * Group related messages together.
 * Returns clusters of related messages with their source projects.
 */
function clusterMessages(
  entries: Array<{ project: string; message: string }>
): Array<{ messages: string[]; projects: Set<string> }> {
  const clusters: Array<{ messages: string[]; projects: Set<string> }> = [];

  for (const entry of entries) {
    let placed = false;
    for (const cluster of clusters) {
      // Check if this message relates to any message in the cluster
      if (cluster.messages.some((m) => messagesRelated(m, entry.message))) {
        cluster.messages.push(entry.message);
        cluster.projects.add(entry.project);
        placed = true;
        break;
      }
    }
    if (!placed) {
      clusters.push({
        messages: [entry.message],
        projects: new Set([entry.project]),
      });
    }
  }

  return clusters;
}

/**
 * Analyze session logs across multiple projects for recurring patterns.
 *
 * Looks for:
 * - [LESSON] tags that appear in 3+ different project sessions → recurring lesson
 * - [NEEDS ATTENTION] tags with similar topics across projects → recurring blocker
 *
 * Returns suggestions for playbook additions.
 */
export function analyzeSessionPatterns(
  sessions: SessionInput[]
): PlaybookSuggestion[] {
  if (sessions.length === 0) return [];

  const suggestions: PlaybookSuggestion[] = [];

  // Collect all lessons with their projects
  const lessons: Array<{ project: string; message: string }> = [];
  const blockers: Array<{ project: string; message: string }> = [];

  for (const session of sessions) {
    const lessonMessages = extractTaggedSignals(session.content, "LESSON");
    for (const msg of lessonMessages) {
      lessons.push({ project: session.projectName, message: msg });
    }

    const blockerMessages = extractTaggedSignals(
      session.content,
      "NEEDS ATTENTION"
    );
    for (const msg of blockerMessages) {
      blockers.push({ project: session.projectName, message: msg });
    }
  }

  // Cluster lessons and find recurring ones (3+ occurrences across different projects)
  const lessonClusters = clusterMessages(lessons);
  for (const cluster of lessonClusters) {
    if (cluster.projects.size >= 3) {
      suggestions.push({
        type: "recurring-lesson",
        summary: cluster.messages[0],
        occurrences: cluster.messages.length,
        projects: [...cluster.projects],
        examples: cluster.messages.slice(0, 3),
      });
    }
  }

  // Cluster blockers
  const blockerClusters = clusterMessages(blockers);
  for (const cluster of blockerClusters) {
    if (cluster.projects.size >= 3) {
      suggestions.push({
        type: "recurring-blocker",
        summary: cluster.messages[0],
        occurrences: cluster.messages.length,
        projects: [...cluster.projects],
        examples: cluster.messages.slice(0, 3),
      });
    }
  }

  // Sort by occurrence count descending
  suggestions.sort((a, b) => b.occurrences - a.occurrences);

  return suggestions;
}
