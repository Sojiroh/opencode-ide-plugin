import { describe, expect, it } from "vitest"
import { appendPartTextDelta, applyPartDelta, getMessagesBySession, mergeSessionMessages, updateMessageInfo } from "./messagesStore"
import type { Message, SDKMessage, TextPart } from "../types/messages"

type MessageTime = {
  created: number
  updated?: number
  completed?: number
}

function assistantMessage(input: {
  messageID: string
  sessionID: string
  created: number
  updated?: number
  completed?: number
  text?: string
}): Message {
  return {
    info: {
      id: input.messageID,
      sessionID: input.sessionID,
      role: "assistant",
      time: {
        created: input.created,
        ...(typeof input.updated === "number" ? { updated: input.updated } : {}),
        ...(typeof input.completed === "number" ? { completed: input.completed } : {}),
      },
    } as unknown as SDKMessage,
    parts: input.text
      ? [
          {
            id: `${input.messageID}-part-1`,
            type: "text",
            sessionID: input.sessionID,
            messageID: input.messageID,
            text: input.text,
            time: {
              start: input.created,
              ...(typeof input.completed === "number" ? { end: input.completed } : {}),
            },
          } as TextPart,
        ]
      : [],
  }
}

describe("messagesStore", () => {
  it("keeps a streamed part that arrives before its message info", () => {
    const part: TextPart = {
      id: "part-1",
      type: "text",
      sessionID: "ses-1",
      messageID: "msg-1",
      text: "",
    } as TextPart

    const withPart = applyPartDelta([], "msg-1", part, "hello")

    expect(withPart).toHaveLength(1)
    expect(withPart[0]?.info.id).toBe("msg-1")
    expect(withPart[0]?.info.sessionID).toBe("ses-1")
    expect(withPart[0]?.parts).toHaveLength(1)
    expect(withPart[0]?.parts[0]).toMatchObject({ id: "part-1", type: "text", text: "hello" })

    const info: SDKMessage = {
      id: "msg-1",
      sessionID: "ses-1",
      role: "assistant",
      time: {
        created: 1,
      },
    } as unknown as SDKMessage

    const withInfo = updateMessageInfo(withPart, "msg-1", info)

    expect(withInfo).toHaveLength(1)
    expect(withInfo[0]?.info).toBe(info)
    expect(withInfo[0]?.parts).toHaveLength(1)
    expect(withInfo[0]?.parts[0]).toMatchObject({ id: "part-1", type: "text", text: "hello" })
  })

  it("appends delta to an existing text part", () => {
    const info: SDKMessage = {
      id: "msg-2",
      sessionID: "ses-2",
      role: "assistant",
      time: {
        created: 1,
      },
    } as unknown as SDKMessage

    const part: TextPart = {
      id: "part-2",
      type: "text",
      sessionID: "ses-2",
      messageID: "msg-2",
      text: "hel",
    } as TextPart

    const messages = [{ info, parts: [part] }]
    const updated = appendPartTextDelta(messages, "msg-2", "part-2", "lo")

    expect(updated[0]?.parts[0]).toMatchObject({ id: "part-2", text: "hello" })
  })

  it("appends delta to an existing reasoning part", () => {
    const info: SDKMessage = {
      id: "msg-2b",
      sessionID: "ses-2b",
      role: "assistant",
      time: {
        created: 1,
      },
    } as unknown as SDKMessage

    const part = {
      id: "part-2b",
      type: "reasoning",
      sessionID: "ses-2b",
      messageID: "msg-2b",
      text: "hel",
      time: {
        start: 1,
      },
    } as const

    const messages = [{ info, parts: [part] }]
    const updated = applyPartDelta(messages, "msg-2b", part, "lo")

    expect(updated[0]?.parts[0]).toMatchObject({ id: "part-2b", type: "reasoning", text: "hello" })
  })

  it("keeps newer live assistant text when a stale session load resolves later", () => {
    const local = assistantMessage({
      messageID: "msg-3",
      sessionID: "ses-3",
      created: 1,
      updated: 20,
      text: "hello live",
    })

    const loaded = assistantMessage({
      messageID: "msg-3",
      sessionID: "ses-3",
      created: 1,
      updated: 10,
    })

    const merged = mergeSessionMessages([local], "ses-3", [loaded])

    expect(merged).toHaveLength(1)
    expect((merged[0]?.info.time as MessageTime | undefined)?.updated).toBe(20)
    expect(merged[0]?.parts).toHaveLength(1)
    expect(merged[0]?.parts[0]).toMatchObject({ type: "text", text: "hello live" })
  })

  it("uses the loaded assistant text when the server snapshot is newer", () => {
    const local = assistantMessage({
      messageID: "msg-4",
      sessionID: "ses-4",
      created: 1,
      updated: 10,
      text: "hello",
    })

    const loaded = assistantMessage({
      messageID: "msg-4",
      sessionID: "ses-4",
      created: 1,
      updated: 20,
      completed: 21,
      text: "hello world",
    })

    const merged = mergeSessionMessages([local], "ses-4", [loaded])

    expect(merged).toHaveLength(1)
    expect((merged[0]?.info.time as MessageTime | undefined)?.updated).toBe(20)
    expect((merged[0]?.info.time as MessageTime | undefined)?.completed).toBe(21)
    expect(merged[0]?.parts[0]).toMatchObject({ type: "text", text: "hello world" })
  })

  it("preserves the existing session ID when live message info omits it", () => {
    const part: TextPart = {
      id: "part-5",
      type: "text",
      sessionID: "ses-5",
      messageID: "msg-5",
      text: "hello",
    } as TextPart

    const withPart = applyPartDelta([], "msg-5", part, "hello")

    const infoWithoutSession = {
      id: "msg-5",
      role: "assistant",
      time: { created: 1 },
    } as unknown as SDKMessage

    const updated = updateMessageInfo(withPart, "msg-5", infoWithoutSession)

    expect(updated[0]?.info.sessionID).toBe("ses-5")
    expect(getMessagesBySession(updated, "ses-5")).toHaveLength(1)
  })

  it("filters messages by part session ID when info session ID is missing", () => {
    const messages = [
      {
        info: {
          id: "msg-6",
          role: "assistant",
          time: { created: 1 },
        } as unknown as SDKMessage,
        parts: [
          {
            id: "part-6",
            type: "text",
            sessionID: "ses-6",
            messageID: "msg-6",
            text: "hello",
          } as TextPart,
        ],
      },
    ]

    expect(getMessagesBySession(messages, "ses-6")).toHaveLength(1)
  })
})
