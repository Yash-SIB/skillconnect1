package service

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrForbidden = errors.New("active workspace membership required")
	ErrNotFound  = errors.New("resource not found")
	ErrConflict  = errors.New("resource conflicts with an existing record")
	idPattern    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	channelName  = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
)

type InputError string

func (e InputError) Error() string { return string(e) }

type Conversation struct {
	ID          string    `json:"id"`
	WorkspaceID string    `json:"workspace_id"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name,omitempty"`
	Visibility  string    `json:"visibility,omitempty"`
	PeerID      string    `json:"peer_id,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type ConversationInput struct {
	WorkspaceID string `json:"workspace_id"`
	Kind        string `json:"kind"`
	Name        string `json:"name,omitempty"`
	Visibility  string `json:"visibility,omitempty"`
	PeerID      string `json:"peer_id,omitempty"`
}

type Member struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversation_id"`
	SenderID       string    `json:"sender_id"`
	ClientID       string    `json:"client_id"`
	Body           string    `json:"body"`
	CreatedAt      time.Time `json:"created_at"`
	WorkspaceID    string    `json:"-"`
}

type MessageInput struct {
	ClientID string `json:"client_id"`
	Body     string `json:"body"`
}

type MessagePage struct {
	Messages   []Message `json:"messages"`
	NextCursor string    `json:"next_cursor,omitempty"`
}

type MessagingStore interface {
	ListConversations(ctx context.Context, employeeID, workspaceID string) ([]Conversation, error)
	CreateConversation(ctx context.Context, employeeID string, input ConversationInput) (Conversation, bool, error)
	ListMembers(ctx context.Context, employeeID, conversationID string) ([]Member, error)
	ListMessages(ctx context.Context, employeeID, conversationID string, before MessageCursor, limit int) ([]Message, error)
	CreateMessage(ctx context.Context, employeeID, conversationID string, input MessageInput) (Message, bool, error)
}

type Messaging struct {
	Store     MessagingStore
	Publisher MessagePublisher
}

// MessagePublisher receives only newly created, committed messages.
type MessagePublisher interface {
	PublishMessageCreated(Message)
}

func NormalizeConversationID(id string) (string, error) {
	if !idPattern.MatchString(id) {
		return "", InputError("conversation id must be a UUID")
	}
	return strings.ToLower(id), nil
}

func (s Messaging) ListConversations(ctx context.Context, employeeID, workspaceID string) ([]Conversation, error) {
	if !idPattern.MatchString(workspaceID) {
		return nil, InputError("workspace_id must be a UUID")
	}
	return s.Store.ListConversations(ctx, employeeID, strings.ToLower(workspaceID))
}

func (s Messaging) CreateConversation(ctx context.Context, employeeID string, input ConversationInput) (Conversation, bool, error) {
	if err := validateConversation(employeeID, &input); err != nil {
		return Conversation{}, false, err
	}
	return s.Store.CreateConversation(ctx, employeeID, input)
}

func validateConversation(employeeID string, input *ConversationInput) error {
	if !idPattern.MatchString(input.WorkspaceID) {
		return InputError("workspace_id must be a UUID")
	}
	input.WorkspaceID = strings.ToLower(input.WorkspaceID)

	switch input.Kind {
	case "channel":
		if len(input.Name) > 64 || !channelName.MatchString(input.Name) {
			return InputError("name must contain up to 64 lowercase letters, digits, or single hyphens between words")
		}
		if input.Visibility != "public" && input.Visibility != "private" {
			return InputError("visibility must be public or private")
		}
		if input.PeerID != "" {
			return InputError("peer_id is only valid for a direct message")
		}
	case "dm":
		if input.Name != "" || input.Visibility != "" {
			return InputError("name and visibility are only valid for channels")
		}
		if !idPattern.MatchString(input.PeerID) || strings.EqualFold(input.PeerID, employeeID) {
			return InputError("peer_id must be the UUID of a different employee")
		}
		input.PeerID = strings.ToLower(input.PeerID)
	default:
		return InputError("kind must be channel or dm")
	}
	return nil
}

func (s Messaging) ListMembers(ctx context.Context, employeeID, conversationID string) ([]Member, error) {
	id, err := NormalizeConversationID(conversationID)
	if err != nil {
		return nil, err
	}
	return s.Store.ListMembers(ctx, employeeID, id)
}

func (s Messaging) ListMessages(ctx context.Context, employeeID, conversationID, cursor, limit string) (MessagePage, error) {
	conversationID, err := NormalizeConversationID(conversationID)
	if err != nil {
		return MessagePage{}, err
	}
	pageSize := 50
	if limit != "" {
		n, err := strconv.Atoi(limit)
		if err != nil || n < 1 || n > 100 {
			return MessagePage{}, InputError("limit must be an integer from 1 to 100")
		}
		pageSize = n
	}

	before, err := parseCursor(cursor, conversationID)
	if err != nil {
		return MessagePage{}, err
	}
	messages, err := s.Store.ListMessages(ctx, employeeID, conversationID, before, pageSize+1)
	if err != nil {
		return MessagePage{}, err
	}
	page := MessagePage{Messages: messages}
	if len(messages) > pageSize {
		page.Messages = messages[:pageSize]
		last := page.Messages[pageSize-1]
		page.NextCursor = MessageCursor{CreatedAt: last.CreatedAt, ID: last.ID}.encode(conversationID)
	}
	return page, nil
}

func (s Messaging) CreateMessage(ctx context.Context, employeeID, conversationID string, input MessageInput) (Message, bool, error) {
	id, err := NormalizeConversationID(conversationID)
	if err != nil {
		return Message{}, false, err
	}
	if !idPattern.MatchString(input.ClientID) {
		return Message{}, false, InputError("client_id must be a UUID")
	}
	if strings.TrimSpace(input.Body) == "" || strings.ContainsRune(input.Body, 0) ||
		!utf8.ValidString(input.Body) || utf8.RuneCountInString(input.Body) > 4000 {
		return Message{}, false, InputError("body must contain nonblank text of up to 4000 characters, without NUL bytes")
	}
	input.ClientID = strings.ToLower(input.ClientID)
	message, created, err := s.Store.CreateMessage(ctx, employeeID, id, input)
	if err == nil && created && s.Publisher != nil {
		s.Publisher.PublishMessageCreated(message)
	}
	return message, created, err
}
