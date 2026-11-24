package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"skillconnect/api/internal/service"
)

const messageColumns = `id::text, conversation_id::text, sender_id::text, client_id::text, body, created_at, workspace_id::text`

func (r Messaging) ListMessages(ctx context.Context, employeeID, conversationID string, before service.MessageCursor, limit int) ([]service.Message, error) {
	var result []service.Message
	err := pgx.BeginTxFunc(ctx, r.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		access, err := requireConversationMember(ctx, tx, employeeID, conversationID)
		if err != nil {
			return err
		}
		var cursorTime, cursorID any
		if before.ID != "" {
			cursorTime, cursorID = before.CreatedAt, before.ID
		}
		rows, err := tx.Query(ctx, `SELECT `+messageColumns+` FROM messages
			WHERE workspace_id = $1 AND conversation_id = $2 AND deleted_at IS NULL
			AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
			ORDER BY created_at DESC, id DESC LIMIT $5`, access.workspaceID, conversationID, cursorTime, cursorID, limit)
		if err != nil {
			return err
		}
		result, err = pgx.CollectRows(rows, pgx.RowToStructByPos[service.Message])
		return err
	})
	return result, err
}

func (r Messaging) CreateMessage(ctx context.Context, employeeID, conversationID string, input service.MessageInput) (service.Message, bool, error) {
	var message service.Message
	var created bool
	err := pgx.BeginTxFunc(ctx, r.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		access, err := requireConversationMember(ctx, tx, employeeID, conversationID)
		if err != nil {
			return err
		}
		if access.peerID != "" {
			if err := requireWorkspaceMember(ctx, tx, access.peerID, access.workspaceID); err != nil {
				return err
			}
		}
		args := []any{access.workspaceID, conversationID, employeeID, input.ClientID}
		rows, err := tx.Query(ctx, `INSERT INTO messages (workspace_id, conversation_id, sender_id, client_id, body)
			VALUES ($1, $2, $3, $4, $5)
			ON CONFLICT (workspace_id, conversation_id, sender_id, client_id) DO NOTHING
			RETURNING `+messageColumns, append(args, input.Body)...)
		if err != nil {
			return err
		}
		message, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[service.Message])
		if err == nil {
			created = true
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}

		// A second statement sees the committed winner of a concurrent insert.
		rows, err = tx.Query(ctx, `SELECT `+messageColumns+` FROM messages
			WHERE workspace_id = $1 AND conversation_id = $2 AND sender_id = $3 AND client_id = $4
			AND deleted_at IS NULL FOR SHARE`, args...)
		if err != nil {
			return err
		}
		message, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[service.Message])
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && message.Body != input.Body) {
			return service.ErrConflict
		}
		return err
	})
	return message, created && err == nil, err
}
