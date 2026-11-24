package service

import (
	"encoding/base64"
	"strings"
	"time"
)

type MessageCursor struct {
	CreatedAt time.Time
	ID        string
}

func (c MessageCursor) encode(conversationID string) string {
	raw := conversationID + "|" + c.CreatedAt.UTC().Format(time.RFC3339Nano) + "|" + c.ID
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func parseCursor(value, conversationID string) (MessageCursor, error) {
	if value == "" {
		return MessageCursor{}, nil
	}
	const invalid = InputError("cursor is not valid for this conversation")
	if len(value) > 160 {
		return MessageCursor{}, invalid
	}
	raw, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		return MessageCursor{}, invalid
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 3 || parts[0] != conversationID || !idPattern.MatchString(parts[2]) {
		return MessageCursor{}, invalid
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil || createdAt.IsZero() {
		return MessageCursor{}, invalid
	}
	return MessageCursor{CreatedAt: createdAt, ID: strings.ToLower(parts[2])}, nil
}
