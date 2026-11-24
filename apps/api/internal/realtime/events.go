package realtime

import "skillconnect/api/internal/service"

const Version = 1

const (
	MessageCreated = "message.created"
	MessageUpdated = "message.updated"
	MessageDeleted = "message.deleted"
	TypingStarted  = "typing.started"
	TypingStopped  = "typing.stopped"
)

type CreatedEvent struct {
	Version        int             `json:"version"`
	Type           string          `json:"type"`
	ConversationID string          `json:"conversation_id"`
	Message        service.Message `json:"message"`
}

// UpdatedEvent has the same payload as a created event with a different type.
type UpdatedEvent = CreatedEvent

type DeletedEvent struct {
	Version        int    `json:"version"`
	Type           string `json:"type"`
	ConversationID string `json:"conversation_id"`
	MessageID      string `json:"message_id"`
}

type TypingEvent struct {
	Version        int    `json:"version"`
	Type           string `json:"type"`
	ConversationID string `json:"conversation_id"`
	EmployeeID     string `json:"employee_id"`
}

type command struct {
	Version        int    `json:"version"`
	Type           string `json:"type"`
	ConversationID string `json:"conversation_id"`
}

type response struct {
	Version        int    `json:"version"`
	Type           string `json:"type"`
	ConversationID string `json:"conversation_id,omitempty"`
	Code           string `json:"code,omitempty"`
}
