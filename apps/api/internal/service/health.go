package service

import (
	"context"
	"time"
)

type DependencyCheck interface {
	Check(context.Context) error
}

type Health struct {
	Database DependencyCheck
}

func (h Health) Check(ctx context.Context) error {
	if h.Database == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	return h.Database.Check(ctx)
}
