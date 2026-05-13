/**
 * Centralized message state mutation utilities
 * Eliminates duplicate array cloning logic and type casting from MessagesProvider
 */

import type { Message, WebguiPart, SDKMessage, TextPart } from "../types/messages"

type MessageTime = {
  created: number
  updated?: number
  completed?: number
}

function messageUpdatedAt(message: Message): number {
  const time = message.info.time as MessageTime
  return time.updated ?? time.completed ?? time.created
}

function mergePart(existing: WebguiPart, loaded: WebguiPart): WebguiPart {
  if (existing.type === "text" && loaded.type === "text") {
    const loadedEnded = loaded.time?.end ?? 0
    const existingEnded = existing.time?.end ?? 0
    if (loadedEnded < existingEnded) return existing
    if (loaded.text.length < existing.text.length && loadedEnded === 0 && existing.text.length > 0) {
      return existing
    }
  }

  if (existing.type === "reasoning" && loaded.type === "reasoning") {
    const loadedEnded = loaded.time?.end ?? 0
    const existingEnded = existing.time?.end ?? 0
    if (loadedEnded < existingEnded) return existing
    if (loaded.text.length < existing.text.length && loadedEnded === 0 && existing.text.length > 0) {
      return existing
    }
  }

  return loaded
}

function mergeParts(existing: WebguiPart[], loaded: WebguiPart[]): WebguiPart[] {
  const existingByID = new Map(existing.map((part) => [part.id, part]))
  const loadedIDs = new Set(loaded.map((part) => part.id))

  return [
    ...loaded.map((part) => {
      const current = existingByID.get(part.id)
      if (!current) return part
      return mergePart(current, part)
    }),
    ...existing.filter((part) => !loadedIDs.has(part.id)),
  ]
}

function mergeMessage(existing: Message, loaded: Message): Message {
  return {
    info: messageUpdatedAt(loaded) >= messageUpdatedAt(existing) ? loaded.info : existing.info,
    parts: mergeParts(existing.parts, loaded.parts),
  }
}

function messageSessionID(message: Message): string | undefined {
  if (typeof message.info.sessionID === "string" && message.info.sessionID.length > 0) {
    return message.info.sessionID
  }

  const firstPart = message.parts[0]
  if (firstPart && typeof firstPart.sessionID === "string" && firstPart.sessionID.length > 0) {
    return firstPart.sessionID
  }

  return undefined
}

function placeholderMessage(messageID: string, sessionID: string): Message {
  const now = Date.now()
  return {
    info: {
      id: messageID,
      sessionID,
      role: "assistant",
      time: {
        created: now,
      },
    } as unknown as SDKMessage,
    parts: [],
  }
}

/**
 * Upsert a message (add new or update existing)
 */
export function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((m) => m.info.id === message.info.id)

  if (index >= 0) {
    const updated = [...messages]
    updated[index] = message
    return updated
  }

  return [...messages, message]
}

/**
 * Update message info while preserving parts
 */
export function updateMessageInfo(messages: Message[], messageID: string, info: SDKMessage): Message[] {
  const index = messages.findIndex((m) => m.info.id === messageID)

  if (index >= 0) {
    const updated = [...messages]
    const existing = updated[index]
    updated[index] = {
      ...existing,
      info:
        typeof info.sessionID === "string" && info.sessionID.length > 0
          ? info
          : ({ ...info, sessionID: messageSessionID(existing) } as SDKMessage),
    }
    return updated
  }

  // Create new message if not found
  return [...messages, { info, parts: [] }]
}

/**
 * Update message with partial data
 */
export function updateMessage(messages: Message[], messageID: string, update: Partial<Message>): Message[] {
  const index = messages.findIndex((m) => m.info.id === messageID)

  if (index < 0) return messages

  const updated = [...messages]
  updated[index] = { ...updated[index], ...update }
  return updated
}

/**
 * Remove a message by ID
 */
export function removeMessage(messages: Message[], messageID: string): Message[] {
  return messages.filter((m) => m.info.id !== messageID)
}

/**
 * Upsert a part in a message (add new or update existing)
 */
export function upsertPart(messages: Message[], messageID: string, part: WebguiPart): Message[] {
  const updated = [...messages]
  let messageIndex = updated.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) {
    updated.push(placeholderMessage(messageID, part.sessionID))
    messageIndex = updated.length - 1
  }

  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === part.id)

  if (partIndex >= 0) {
    // Update existing part
    const updatedParts = [...message.parts]
    updatedParts[partIndex] = part
    updated[messageIndex] = { ...message, parts: updatedParts }
  } else {
    // Add new part
    updated[messageIndex] = { ...message, parts: [...message.parts, part] }
  }

  return updated
}

/**
 * Apply a text delta to a part (for streaming)
 */
export function applyPartDelta(messages: Message[], messageID: string, part: WebguiPart, delta: string): Message[] {
  if (!("text" in part) || typeof part.text !== "string") {
    // For non-text parts, just upsert normally
    return upsertPart(messages, messageID, part)
  }

  const updated = [...messages]
  let messageIndex = updated.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) {
    updated.push(placeholderMessage(messageID, part.sessionID))
    messageIndex = updated.length - 1
  }

  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === part.id)

  if (partIndex >= 0) {
    // Append delta to an existing text-bearing part (text/reasoning)
    const existingPart = message.parts[partIndex]
    if ("text" in existingPart && typeof existingPart.text === "string") {
      const updatedParts = [...message.parts]
      updatedParts[partIndex] = {
        ...existingPart,
        text: (existingPart.text || "") + delta,
      } as WebguiPart
      updated[messageIndex] = { ...message, parts: updatedParts }
    }
  } else {
    // New text-bearing part with delta as initial text
    const newPart: TextPart = { ...(part as TextPart), text: delta }
    updated[messageIndex] = { ...message, parts: [...message.parts, newPart] }
  }

  return updated
}

/**
 * Append a text delta to an existing part by IDs.
 * Returns the original array when the part does not exist yet.
 */
export function appendPartTextDelta(messages: Message[], messageID: string, partID: string, delta: string): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)
  if (messageIndex < 0) return messages

  const message = messages[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === partID)
  if (partIndex < 0) return messages

  const existing = message.parts[partIndex]
  if (!("text" in existing) || typeof existing.text !== "string") return messages

  const updated = [...messages]
  const updatedParts = [...message.parts]
  updatedParts[partIndex] = {
    ...existing,
    text: existing.text + delta,
  } as WebguiPart
  updated[messageIndex] = { ...message, parts: updatedParts }
  return updated
}

/**
 * Update a specific part in a message
 */
export function updatePart(messages: Message[], messageID: string, partID: string, update: Partial<WebguiPart>): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === partID)

  if (partIndex < 0) return messages

  const updatedParts = [...message.parts]
  updatedParts[partIndex] = { ...updatedParts[partIndex], ...update } as WebguiPart
  updated[messageIndex] = { ...message, parts: updatedParts }

  return updated
}

/**
 * Remove a part from a message
 */
export function removePart(messages: Message[], messageID: string, partID: string): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  updated[messageIndex] = {
    ...message,
    parts: message.parts.filter((p) => p.id !== partID),
  }

  return updated
}

/**
 * Get messages for a specific session
 */
export function getMessagesBySession(messages: Message[], sessionID: string): Message[] {
  return messages.filter((message) => messageSessionID(message) === sessionID)
}

/**
 * Merge a server snapshot into the local session slice without dropping newer
 * in-flight live updates that may have arrived before the snapshot resolved.
 */
export function mergeSessionMessages(messages: Message[], sessionID: string, loadedMessages: Message[]): Message[] {
  const otherSessions = messages.filter((message) => message.info.sessionID !== sessionID)
  const existingSession = messages.filter((message) => message.info.sessionID === sessionID)
  const existingByID = new Map(existingSession.map((message) => [message.info.id, message]))
  const loadedIDs = new Set(loadedMessages.map((message) => message.info.id))

  return [
    ...otherSessions,
    ...loadedMessages.map((message) => {
      const current = existingByID.get(message.info.id)
      if (!current) return message
      return mergeMessage(current, message)
    }),
    ...existingSession.filter((message) => !loadedIDs.has(message.info.id)),
  ]
}
