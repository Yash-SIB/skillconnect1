package migrations

import (
	"context"
	"crypto/sha256"
	"embed"
	"fmt"
	"io/fs"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var sqlFiles embed.FS

const migrationLock int64 = 0x534B494C4C434F4E

// Apply serializes runners and commits the SQL and history together.
func Apply(ctx context.Context, pool *pgxpool.Pool) (int, error) {
	return apply(ctx, pool, sqlFiles)
}

func apply(ctx context.Context, pool *pgxpool.Pool, source fs.FS) (int, error) {
	names, err := fs.Glob(source, "*.sql")
	if err != nil {
		return 0, err
	}
	count := 0

	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLock); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
			name text PRIMARY KEY,
			checksum text NOT NULL,
			applied_at timestamptz NOT NULL DEFAULT now()
		)`); err != nil {
			return err
		}
		rows, err := tx.Query(ctx, "SELECT name, checksum FROM schema_migrations ORDER BY name COLLATE \"C\"")
		if err != nil {
			return err
		}
		type applied struct{ Name, Checksum string }
		history, err := pgx.CollectRows(rows, pgx.RowToStructByPos[applied])
		if err != nil {
			return err
		}
		if len(history) > len(names) {
			return fmt.Errorf("database has migrations absent from this build")
		}

		for i, name := range names {
			raw, err := fs.ReadFile(source, name)
			if err != nil {
				return err
			}
			sql := strings.ReplaceAll(string(raw), "\r\n", "\n")
			checksum := fmt.Sprintf("%x", sha256.Sum256([]byte(sql)))
			if i < len(history) {
				if history[i].Name != name || history[i].Checksum != checksum {
					return fmt.Errorf("migration history mismatch at %s", name)
				}
				continue
			}
			if _, err := tx.Exec(ctx, sql); err != nil {
				return fmt.Errorf("apply %s: %w", name, err)
			}
			if _, err := tx.Exec(ctx, "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", name, checksum); err != nil {
				return err
			}
			count++
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return count, nil
}
