package database

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Open(ctx context.Context, url string) (*pgxpool.Pool, error) {
	if strings.TrimSpace(url) == "" {
		return nil, errors.New("DATABASE_URL is required")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, errors.New("invalid DATABASE_URL or PostgreSQL settings")
	}
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, errors.New("could not initialize PostgreSQL connection pool")
	}
	return pool, nil
}
