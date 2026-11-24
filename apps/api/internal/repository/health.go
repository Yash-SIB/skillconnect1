package repository

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresHealth struct {
	Pool *pgxpool.Pool
}

func (r PostgresHealth) Check(ctx context.Context) error {
	return r.Pool.Ping(ctx)
}
