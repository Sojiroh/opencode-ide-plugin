import { useState, useEffect, useRef } from "react"
import type { Session } from "@opencode-ai/sdk/client"

interface UseSessionActionsProps {
  sessions: Session[]
  currentSessionId?: string | null
  updateSessionTitle: (sessionId: string, title: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<boolean>
}

export function useSessionActions({
  sessions,
  currentSessionId,
  updateSessionTitle,
  deleteSession,
}: UseSessionActionsProps) {
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const editInputRef = useRef<HTMLInputElement>(null)

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingSessionId])

  const handleEditStart = (sessionId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(sessionId)
    setEditingTitle(currentTitle || "Untitled")
  }

  const handleEditSave = async (sessionId: string) => {
    if (editingTitle.trim() && editingTitle !== (sessions.find((s) => s.id === sessionId)?.title || "Untitled")) {
      await updateSessionTitle(sessionId, editingTitle.trim())
    }
    setEditingSessionId(null)
  }

  const handleEditCancel = () => {
    setEditingSessionId(null)
    setEditingTitle("")
  }

  const handleDeleteStart = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteConfirm(sessionId)
  }

  const handleBulkDeleteStart = (selectedSessions: Set<string>) => {
    if (selectedSessions.size > 0) {
      setDeleteConfirm("bulk")
    }
  }

  const handleDeleteConfirm = async (
    deleteTarget: string | null,
    selectedSessions: Set<string>,
    onSuccess?: () => void,
  ) => {
    if (!deleteTarget) return

    setIsDeleting(true)
    let success = true

    if (deleteTarget === "bulk") {
      const orderedSessionIds = Array.from(selectedSessions).filter((sessionId) => sessionId !== currentSessionId)
      if (currentSessionId && selectedSessions.has(currentSessionId)) {
        orderedSessionIds.push(currentSessionId)
      }

      // Handle bulk delete
      for (const sessionId of orderedSessionIds) {
        const result = await deleteSession(sessionId)
        if (!result) {
          success = false
          break
        }
      }

      if (success && onSuccess) {
        onSuccess()
      }
    } else {
      // Handle single session delete
      success = await deleteSession(deleteTarget)
    }

    setIsDeleting(false)

    if (success) {
      setDeleteConfirm(null)
    }
  }

  const handleDeleteCancel = () => {
    setDeleteConfirm(null)
  }

  return {
    editingSessionId,
    editingTitle,
    setEditingTitle,
    deleteConfirm,
    setDeleteConfirm,
    isDeleting,
    editInputRef,
    handleEditStart,
    handleEditSave,
    handleEditCancel,
    handleDeleteStart,
    handleBulkDeleteStart,
    handleDeleteConfirm,
    handleDeleteCancel,
  }
}
