/**
 * createChatStore() lets tab-scoped query widgets (Casemap/Persona, Phase J
 * entity-relation-plan.md) get their own conversation list instead of
 * sharing the main Chat tab's — this guards that two instances stay
 * independent.
 */
import { describe, it, expect } from "vitest"
import { createChatStore, useChatStore } from "./chat-store"

describe("createChatStore", () => {
  it("gives each instance its own conversations/messages state", () => {
    const storeA = createChatStore()
    const storeB = createChatStore()

    const idA = storeA.getState().createConversation()
    storeA.getState().addMessage("user", "hello from A")

    expect(storeA.getState().activeConversationId).toBe(idA)
    expect(storeA.getState().messages).toHaveLength(1)

    // storeB is untouched by storeA's activity.
    expect(storeB.getState().activeConversationId).toBeNull()
    expect(storeB.getState().messages).toHaveLength(0)
    expect(storeB.getState().conversations).toHaveLength(0)
  })

  it("does not affect the default useChatStore instance", () => {
    const before = useChatStore.getState().conversations.length
    const scoped = createChatStore()
    scoped.getState().createConversation()

    expect(useChatStore.getState().conversations).toHaveLength(before)
  })
})
