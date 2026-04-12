/**
 * Shared validation for chat message arrays sent to Claude API endpoints.
 * Protects against malformed messages, excessive length, and invalid roles.
 */

const VALID_ROLES = new Set(["user", "assistant"]);
const MAX_MESSAGE_LENGTH = 15000;
const MAX_MESSAGE_COUNT = 50;

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ValidationResult {
  valid: boolean;
  error: string | null;
  messages: ChatMessage[];
}

/**
 * Validate and sanitize a messages array for the Claude API.
 * - Ensures messages is an array
 * - Filters to valid roles (user, assistant only)
 * - Truncates overly long messages
 * - Caps total message count
 */
export function validateMessages(
  messages: unknown
): ValidationResult {
  if (!messages || !Array.isArray(messages)) {
    return { valid: false, error: "messages array is required", messages: [] };
  }

  if (messages.length === 0) {
    return { valid: false, error: "messages array cannot be empty", messages: [] };
  }

  const validated: ChatMessage[] = [];

  for (const msg of messages.slice(0, MAX_MESSAGE_COUNT)) {
    if (!msg || typeof msg !== "object") continue;

    const role = String(msg.role || "");
    const content = String(msg.content || "");

    if (!VALID_ROLES.has(role)) continue;
    if (!content.trim()) continue;

    validated.push({
      role,
      content: content.slice(0, MAX_MESSAGE_LENGTH),
    });
  }

  if (validated.length === 0) {
    return {
      valid: false,
      error: "No valid messages found (role must be 'user' or 'assistant')",
      messages: [],
    };
  }

  // Anthropic API requires the conversation to end with a user message.
  // Trim any trailing assistant messages.
  while (
    validated.length > 0 &&
    validated[validated.length - 1].role !== "user"
  ) {
    validated.pop();
  }

  if (validated.length === 0) {
    return {
      valid: false,
      error: "Conversation must contain at least one user message",
      messages: [],
    };
  }

  return { valid: true, error: null, messages: validated };
}
