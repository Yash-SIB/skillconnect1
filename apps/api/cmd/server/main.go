package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"skillconnect/api/internal/database"
	"skillconnect/api/internal/httpapi"
	"skillconnect/api/internal/realtime"
	"skillconnect/api/internal/repository"
	"skillconnect/api/internal/service"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	addr := os.Getenv("API_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}

	var health service.Health
	var messaging service.Messaging
	var authorizer realtime.Authorizer
	if url := strings.TrimSpace(os.Getenv("DATABASE_URL")); url != "" {
		pool, err := database.Open(ctx, url)
		if err != nil {
			return err
		}
		defer pool.Close()
		health.Database = repository.PostgresHealth{Pool: pool}
		store := repository.Messaging{Pool: pool}
		messaging.Store = store
		authorizer = store
	} else {
		log.Print("DATABASE_URL is unset; serving health without a database check")
	}

	hub := realtime.NewHub()
	socket, err := realtime.NewEndpoint(hub, authorizer, os.Getenv("WS_ALLOWED_ORIGINS"))
	if err != nil {
		return err
	}
	messaging.Publisher = hub

	server := &http.Server{
		Addr:              addr,
		Handler:           httpapi.NewRouter(health, messaging, nil, socket), // Real verifier is pending Google OAuth.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	done := make(chan error, 1)
	go func() {
		log.Printf("SkillConnect API listening on %s", addr)
		done <- server.ListenAndServe()
	}()

	var serveErr error
	select {
	case err := <-done:
		if !errors.Is(err, http.ErrServerClosed) {
			serveErr = err
		}
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	httpDone := make(chan error, 1)
	go func() { httpDone <- server.Shutdown(shutdown) }()
	return errors.Join(serveErr, hub.Shutdown(shutdown), <-httpDone)
}
