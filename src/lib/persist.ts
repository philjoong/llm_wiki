import { writeFile, readFile, createDirectory } from "@/commands/fs"
import type { ReviewItem } from "@/stores/review-store"
import type { DisplayMessage, Conversation } from "@/stores/chat-store"
import { normalizePath } from "@/lib/path-utils"

async function ensureDir(projectPath: string): Promise<void> {
  await createDirectory(`${projectPath}/.llm-wiki`).catch(() => {})
  await createDirectory(`${projectPath}/.llm-wiki/chats`).catch(() => {})
}

export async function saveReviewItems(projectPath: string, items: ReviewItem[]): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)
  await writeFile(`${pp}/.llm-wiki/review.json`, JSON.stringify(items, null, 2))
}

export async function loadReviewItems(projectPath: string): Promise<ReviewItem[]> {
  const pp = normalizePath(projectPath)
  try {
    const content = await readFile(`${pp}/.llm-wiki/review.json`)
    const items = JSON.parse(content) as ReviewItem[]
    // Legacy files may contain `type: "schema"` items from the removed
    // schema-proposal flow — drop them; nothing can render or resolve them.
    return items.filter((it) => (it.type as string) !== "schema")
  } catch {
    return []
  }
}

interface PersistedChatData {
  schemaVersion: 2
  conversations: Conversation[]
  messages: DisplayMessage[]
}
interface LoadedChatData { conversations: Conversation[]; messages: DisplayMessage[] }

const CHAT_SCHEMA_VERSION = 2 as const

function sanitizeMessages(messages: DisplayMessage[]): DisplayMessage[] {
  return messages.map((message) => ({
    ...message,
    // Do not adapt legacy path/title references: they are not stable anchors.
    references: message.references?.filter((reference) =>
      typeof reference.citationId === "string" && typeof reference.pageId === "string" &&
      typeof reference.sectionId === "string" && typeof reference.quotedText === "string",
    ),
  }))
}

export async function saveChatHistory(
  projectPath: string,
  conversations: Conversation[],
  messages: DisplayMessage[]
): Promise<void> {
  const pp = normalizePath(projectPath)
  await ensureDir(pp)

  // Save conversation list
  await writeFile(
    `${pp}/.llm-wiki/conversations.json`,
    JSON.stringify({ schemaVersion: CHAT_SCHEMA_VERSION, conversations }, null, 2)
  )

  // Save each conversation's messages separately
  const byConversation = new Map<string, DisplayMessage[]>()
  for (const msg of messages) {
    const list = byConversation.get(msg.conversationId) ?? []
    list.push(msg)
    byConversation.set(msg.conversationId, list)
  }

  for (const [convId, msgs] of byConversation) {
    // Keep last 100 messages per conversation
    const toSave = msgs.slice(-100)
    await writeFile(
      `${pp}/.llm-wiki/chats/${convId}.json`,
      JSON.stringify({ schemaVersion: CHAT_SCHEMA_VERSION, messages: toSave }, null, 2)
    )
  }
}

export async function loadChatHistory(projectPath: string): Promise<LoadedChatData> {
  const pp = normalizePath(projectPath)
  try {
    // Try new format: separate files per conversation
    const convContent = await readFile(`${pp}/.llm-wiki/conversations.json`)
    const conversationFile = JSON.parse(convContent) as Partial<PersistedChatData>
    if (conversationFile.schemaVersion !== CHAT_SCHEMA_VERSION || !Array.isArray(conversationFile.conversations)) {
      throw new Error("Unsupported chat schema version")
    }
    const conversations = conversationFile.conversations

    const allMessages: DisplayMessage[] = []
    for (const conv of conversations) {
      try {
        const msgContent = await readFile(`${pp}/.llm-wiki/chats/${conv.id}.json`)
        const messageFile = JSON.parse(msgContent) as Partial<PersistedChatData>
        if (messageFile.schemaVersion !== CHAT_SCHEMA_VERSION || !Array.isArray(messageFile.messages)) continue
        allMessages.push(...messageFile.messages)
      } catch {
        // Conversation file missing, skip
      }
    }

    return { conversations, messages: sanitizeMessages(allMessages) }
  } catch { return { conversations: [], messages: [] } }
}
