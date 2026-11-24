package migrations

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"skillconnect/api/internal/httpapi"
	"skillconnect/api/internal/repository"
	"skillconnect/api/internal/service"
	"skillconnect/api/internal/testdb"
)

func TestPostgresMigrations(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool := testdb.Open(t, ctx)

	t.Run("concurrent apply and repeat", func(t *testing.T) {
		var wg sync.WaitGroup
		counts := make(chan int, 2)
		for i := 0; i < 2; i++ {
			wg.Go(func() {
				count, err := Apply(ctx, pool)
				if err != nil {
					t.Errorf("apply migrations: %v", err)
				}
				counts <- count
			})
		}
		wg.Wait()
		if got := <-counts + <-counts; got != 2 {
			t.Fatalf("applied %d migrations, want 2", got)
		}
		if count, err := Apply(ctx, pool); count != 0 || err != nil {
			t.Fatalf("rerun applied %d migrations: %v", count, err)
		}
	})

	t.Run("scoped membership and messages", func(t *testing.T) {
		mustExec(t, ctx, pool, `
			INSERT INTO users (id, email, display_name) VALUES
				('00000000-0000-0000-0000-000000000001', 'first@example.test', 'First'),
				('00000000-0000-0000-0000-000000000002', 'second@example.test', 'Second'),
				('00000000-0000-0000-0000-000000000003', 'third@example.test', 'Third');
			INSERT INTO workspaces (id, slug, name) VALUES
				('00000000-0000-0000-0000-000000000011', 'main', 'Main'),
				('00000000-0000-0000-0000-000000000012', 'other', 'Other');
		`)
		first := "00000000-0000-0000-0000-000000000001"
		second := "00000000-0000-0000-0000-000000000002"
		third := "00000000-0000-0000-0000-000000000003"
		main := "00000000-0000-0000-0000-000000000011"
		other := "00000000-0000-0000-0000-000000000012"
		channel := "00000000-0000-0000-0000-000000000021"
		otherChannel := "00000000-0000-0000-0000-000000000022"
		dm := "00000000-0000-0000-0000-000000000023"
		message := "00000000-0000-0000-0000-000000000031"
		client := "00000000-0000-0000-0000-000000000032"

		mustExec(t, ctx, pool, "INSERT INTO workspace_members (workspace_id, user_id) VALUES ($1,$2), ($1,$3), ($1,$4), ($5,$2)", main, first, second, third, other)
		mustExec(t, ctx, pool, `INSERT INTO conversations (id, workspace_id, kind, channel_name, channel_visibility)
			VALUES ($1,$2,'channel','general','public'), ($3,$4,'channel','general','private')`, channel, main, otherChannel, other)
		const addChannelMember = "INSERT INTO conversation_members (workspace_id, conversation_id, user_id, conversation_kind) VALUES ($1,$2,$3,'channel')"
		mustExec(t, ctx, pool, addChannelMember, main, channel, first)
		mustExec(t, ctx, pool, addChannelMember, other, otherChannel, first)
		wantError(t, ctx, pool, "23503", addChannelMember, other, otherChannel, second)
		wantError(t, ctx, pool, "23503", addChannelMember, other, channel, first)

		const addDM = "INSERT INTO conversations (id, workspace_id, kind, dm_user_low, dm_user_high) VALUES ($1,$2,'dm',$3,$4)"
		wantError(t, ctx, pool, "23503", addDM, dm, main, first, second)
		err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, addDM, dm, main, first, second); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `INSERT INTO conversation_members (workspace_id, conversation_id, user_id, conversation_kind, dm_peer_id)
				VALUES ($1,$2,$3,'dm',$4), ($1,$2,$4,'dm',$3)`, main, dm, first, second)
			return err
		})
		if err != nil {
			t.Fatalf("create DM with both participants: %v", err)
		}
		wantError(t, ctx, pool, "23505", addDM, "00000000-0000-0000-0000-000000000024", main, first, second)
		wantError(t, ctx, pool, "23503", `INSERT INTO conversation_members (workspace_id, conversation_id, user_id, conversation_kind, dm_peer_id)
			VALUES ($1,$2,$3,'dm',$4)`, main, dm, third, first)

		mustExec(t, ctx, pool, `INSERT INTO messages (id, workspace_id, conversation_id, sender_id, client_id, body)
			VALUES ($1,$2,$3,$4,$5,'hello')`, message, main, channel, first, client)
		const sendMessage = "INSERT INTO messages (workspace_id, conversation_id, sender_id, client_id) VALUES ($1,$2,$3,$4)"
		wantError(t, ctx, pool, "23503", sendMessage, main, channel, second, client)
		wantError(t, ctx, pool, "23505", sendMessage, main, channel, first, client)
		mustExec(t, ctx, pool, sendMessage, main, dm, second, client)

		const attach = `INSERT INTO attachments (workspace_id, conversation_id, message_id, storage_key, file_name, content_type, size_bytes)
			VALUES ($1,$2,$3,$4,'memo.txt','text/plain',20)`
		wantError(t, ctx, pool, "23503", attach, other, otherChannel, message, "foreign-memo")
		mustExec(t, ctx, pool, attach, main, channel, message, "memo")
		const receipt = "INSERT INTO read_receipts (workspace_id, conversation_id, user_id, last_read_message_id) VALUES ($1,$2,$3,$4)"
		wantError(t, ctx, pool, "23503", receipt, main, dm, first, message)
		mustExec(t, ctx, pool, receipt, main, channel, first, message)
	})

	t.Run("live database health", func(t *testing.T) {
		handler := httpapi.NewRouter(service.Health{Database: repository.PostgresHealth{Pool: pool}}, service.Messaging{}, nil, nil)
		res := httptest.NewRecorder()
		handler.ServeHTTP(res, httptest.NewRequest(http.MethodGet, "/health", nil))
		if res.Code != http.StatusOK {
			t.Fatalf("health returned %d", res.Code)
		}
	})

	t.Run("reject changed history", func(t *testing.T) {
		if count, err := apply(ctx, pool, fstest.MapFS{
			"0001_membership.sql": {Data: []byte("SELECT 1;")},
			"0002_messaging.sql":  {Data: []byte("SELECT 2;")},
		}); count != 0 || err == nil {
			t.Fatalf("changed migration history accepted: %d, %v", count, err)
		}
	})
}

func TestPostgresMigrationRollback(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool := testdb.Open(t, ctx)

	if count, err := apply(ctx, pool, fstest.MapFS{
		"0001_create.sql": {Data: []byte("CREATE TABLE rollback_probe (id int);")},
		"0002_fail.sql":   {Data: []byte("SELECT * FROM missing_probe;")},
	}); count != 0 || err == nil {
		t.Fatalf("broken migration batch accepted: %d, %v", count, err)
	}
	var tables int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM pg_tables WHERE schemaname = current_schema()
		AND tablename IN ('rollback_probe', 'schema_migrations')`).Scan(&tables); err != nil || tables != 0 {
		t.Fatalf("rollback left %d tables: %v", tables, err)
	}
}

func mustExec(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func wantError(t *testing.T, ctx context.Context, pool *pgxpool.Pool, code, sql string, args ...any) {
	t.Helper()
	_, err := pool.Exec(ctx, sql, args...)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != code {
		t.Fatalf("expected PostgreSQL SQLSTATE %s, got %v", code, err)
	}
}
