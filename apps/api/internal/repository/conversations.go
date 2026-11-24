package repository

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"skillconnect/api/internal/service"
)

type Messaging struct {
	Pool *pgxpool.Pool
}

const conversationColumns = `c.id::text, c.workspace_id::text, c.kind,
	COALESCE(c.channel_name, ''), COALESCE(c.channel_visibility, ''),
	COALESCE(CASE WHEN c.dm_user_low = $1 THEN c.dm_user_high ELSE c.dm_user_low END::text, ''),
	c.created_at`

func (r Messaging) ListConversations(ctx context.Context, employeeID, workspaceID string) ([]service.Conversation, error) {
	var result []service.Conversation
	err := pgx.BeginTxFunc(ctx, r.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if err := requireWorkspaceMember(ctx, tx, employeeID, workspaceID); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+conversationColumns+`
			FROM conversations c JOIN conversation_members m ON
				m.workspace_id = c.workspace_id AND m.conversation_id = c.id
			WHERE m.user_id = $1 AND c.workspace_id = $2 AND m.left_at IS NULL
			ORDER BY c.created_at DESC, c.id DESC`, employeeID, workspaceID)
		if err != nil {
			return err
		}
		result, err = pgx.CollectRows(rows, pgx.RowToStructByPos[service.Conversation])
		return err
	})
	return result, err
}

func (r Messaging) CreateConversation(ctx context.Context, employeeID string, input service.ConversationInput) (service.Conversation, bool, error) {
	var conversation service.Conversation
	var created bool
	err := pgx.BeginTxFunc(ctx, r.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		if err := requireWorkspaceMember(ctx, tx, employeeID, input.WorkspaceID); err != nil {
			return err
		}
		var id string
		var err error
		if input.Kind == "channel" {
			id, err = insertChannel(ctx, tx, employeeID, input)
			created = true
		} else {
			id, created, err = findOrCreateDM(ctx, tx, employeeID, input)
		}
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `SELECT `+conversationColumns+` FROM conversations c WHERE c.id = $2`, employeeID, id)
		if err != nil {
			return err
		}
		conversation, err = pgx.CollectExactlyOneRow(rows, pgx.RowToStructByPos[service.Conversation])
		return err
	})
	return conversation, created && err == nil, err
}

func insertChannel(ctx context.Context, tx pgx.Tx, employeeID string, input service.ConversationInput) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO conversations (workspace_id, kind, channel_name, channel_visibility)
		VALUES ($1, 'channel', $2, $3)
		ON CONFLICT (workspace_id, channel_name) WHERE kind = 'channel' DO NOTHING
		RETURNING id::text`, input.WorkspaceID, input.Name, input.Visibility).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", service.ErrConflict
	}
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO conversation_members (workspace_id, conversation_id, user_id, conversation_kind)
		VALUES ($1, $2, $3, 'channel')`, input.WorkspaceID, id, employeeID)
	return id, err
}

func findOrCreateDM(ctx context.Context, tx pgx.Tx, employeeID string, input service.ConversationInput) (string, bool, error) {
	if err := requireWorkspaceMember(ctx, tx, input.PeerID, input.WorkspaceID); err != nil {
		if errors.Is(err, service.ErrForbidden) {
			return "", false, service.ErrNotFound
		}
		return "", false, err
	}
	var id string
	err := tx.QueryRow(ctx, `
		INSERT INTO conversations (workspace_id, kind, dm_user_low, dm_user_high)
		VALUES ($1, 'dm', LEAST($2::uuid, $3::uuid), GREATEST($2::uuid, $3::uuid))
		ON CONFLICT (workspace_id, dm_user_low, dm_user_high) WHERE kind = 'dm' DO NOTHING
		RETURNING id::text`, input.WorkspaceID, employeeID, input.PeerID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			SELECT id::text FROM conversations WHERE workspace_id = $1 AND kind = 'dm'
			AND dm_user_low = LEAST($2::uuid, $3::uuid)
			AND dm_user_high = GREATEST($2::uuid, $3::uuid)`, input.WorkspaceID, employeeID, input.PeerID).Scan(&id)
		return id, false, err
	}
	if err != nil {
		return "", false, err
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO conversation_members (workspace_id, conversation_id, user_id, conversation_kind, dm_peer_id)
		VALUES ($1, $2, $3, 'dm', $4), ($1, $2, $4, 'dm', $3)`, input.WorkspaceID, id, employeeID, input.PeerID)
	return id, true, err
}

func (r Messaging) ListMembers(ctx context.Context, employeeID, conversationID string) ([]service.Member, error) {
	var result []service.Member
	err := pgx.BeginTxFunc(ctx, r.Pool, pgx.TxOptions{IsoLevel: pgx.ReadCommitted}, func(tx pgx.Tx) error {
		access, err := requireConversationMember(ctx, tx, employeeID, conversationID)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `
			SELECT u.id::text, u.display_name
			FROM conversation_members m
			JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
			JOIN users u ON u.id = m.user_id
			WHERE m.workspace_id = $1 AND m.conversation_id = $2 AND m.left_at IS NULL
			AND wm.removed_at IS NULL AND u.disabled_at IS NULL
			ORDER BY u.display_name, u.id`, access.workspaceID, conversationID)
		if err != nil {
			return err
		}
		result, err = pgx.CollectRows(rows, pgx.RowToStructByPos[service.Member])
		return err
	})
	return result, err
}

func requireWorkspaceMember(ctx context.Context, tx pgx.Tx, employeeID, workspaceID string) error {
	var present int
	err := tx.QueryRow(ctx, `
		SELECT 1 FROM workspace_members wm JOIN users u ON u.id = wm.user_id
		WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.removed_at IS NULL AND u.disabled_at IS NULL
		FOR SHARE OF wm, u`, workspaceID, employeeID).Scan(&present)
	if errors.Is(err, pgx.ErrNoRows) {
		return service.ErrForbidden
	}
	return err
}

type conversationAccess struct {
	workspaceID string
	peerID      string
}

func (r Messaging) ActiveConversationWorkspace(ctx context.Context, employeeID, conversationID string) (string, error) {
	access, err := requireConversationMember(ctx, r.Pool, employeeID, conversationID)
	return access.workspaceID, err
}

type conversationQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// In a REST transaction the row locks hold the caller's membership stable
// until commit. The socket checks the same rows immediately before delivery.
func requireConversationMember(ctx context.Context, query conversationQuerier, employeeID, conversationID string) (conversationAccess, error) {
	var access conversationAccess
	err := query.QueryRow(ctx, `
		SELECT c.workspace_id::text, COALESCE(m.dm_peer_id::text, '')
		FROM conversations c
		JOIN conversation_members m ON m.workspace_id = c.workspace_id AND m.conversation_id = c.id
		JOIN workspace_members wm ON wm.workspace_id = m.workspace_id AND wm.user_id = m.user_id
		JOIN users u ON u.id = m.user_id
		WHERE c.id = $1 AND m.user_id = $2 AND m.left_at IS NULL
		AND wm.removed_at IS NULL AND u.disabled_at IS NULL
		FOR SHARE OF m, wm, u`, conversationID, employeeID).Scan(&access.workspaceID, &access.peerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return conversationAccess{}, service.ErrNotFound
	}
	return access, err
}
