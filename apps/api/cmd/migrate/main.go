package main

import (
	"context"
	"log"
	"os"
	"time"

	"skillconnect/api/internal/database"
	"skillconnect/api/migrations"
)

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	pool, err := database.Open(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		log.Fatal(err)
	}
	defer pool.Close()

	count, err := migrations.Apply(ctx, pool)
	if err != nil {
		log.Fatalf("Migration failed: %v", err)
	}
	log.Printf("Migrations complete. Applied %d new migration(s).", count)
}
