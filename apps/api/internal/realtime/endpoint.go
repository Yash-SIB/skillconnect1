package realtime

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gorilla/websocket"

	"skillconnect/api/internal/auth"
	"skillconnect/api/internal/service"
)

const (
	inboundLimit = 2048
	inboundRate  = 20
	pingInterval = 15 * time.Second
	pongTimeout  = 35 * time.Second
	writeTimeout = 3 * time.Second
	checkTimeout = 3 * time.Second
)

type Authorizer interface {
	ActiveConversationWorkspace(ctx context.Context, employeeID, conversationID string) (string, error)
}

type Endpoint struct {
	hub        *Hub
	authorizer Authorizer
	upgrader   websocket.Upgrader
	pingEvery  time.Duration
	pongWithin time.Duration
}

func NewEndpoint(hub *Hub, authorizer Authorizer, allowedOrigins string) (*Endpoint, error) {
	if hub == nil {
		return nil, errors.New("realtime hub is required")
	}
	origins := make(map[string]struct{})
	if strings.TrimSpace(allowedOrigins) != "" {
		for raw := range strings.SplitSeq(allowedOrigins, ",") {
			origin, ok := canonicalOrigin(strings.TrimSpace(raw))
			if !ok {
				return nil, errors.New("WS_ALLOWED_ORIGINS must contain exact HTTP(S) origins")
			}
			origins[origin] = struct{}{}
		}
	}
	return &Endpoint{
		hub: hub, authorizer: authorizer, pingEvery: pingInterval, pongWithin: pongTimeout,
		upgrader: websocket.Upgrader{
			HandshakeTimeout: 3 * time.Second,
			CheckOrigin: func(r *http.Request) bool {
				headers := r.Header.Values("Origin")
				if len(headers) != 1 {
					return false
				}
				origin, ok := canonicalOrigin(headers[0])
				_, allowed := origins[origin]
				return ok && allowed
			},
		},
	}, nil
}

func canonicalOrigin(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" ||
		raw != u.Scheme+"://"+u.Host || strings.ContainsAny(u.Host, "*?\\") {
		return "", false
	}
	return u.Scheme + "://" + strings.ToLower(u.Host), true
}

func (e *Endpoint) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	session, ok := auth.SessionFromContext(r.Context())
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	if e.authorizer == nil {
		http.Error(w, "Realtime is unavailable", http.StatusServiceUnavailable)
		return
	}
	conn, err := e.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	c := e.hub.register(session.Principal.EmployeeID)
	if c == nil {
		sendClose(conn, closeReason{websocket.CloseTryAgainLater, "connection limit or shutdown"})
		return
	}
	defer e.hub.unregister(c)

	conn.SetReadLimit(inboundLimit)
	_ = conn.SetReadDeadline(time.Now().Add(e.pongWithin))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(e.pongWithin))
	})
	written := make(chan struct{})
	go func() {
		defer close(written)
		defer conn.Close()
		e.writeLoop(c, conn, session)
		if reason, ok := context.Cause(c.ctx).(closeReason); ok {
			sendClose(conn, reason)
		}
	}()
	c.stop(e.readLoop(c, conn, session))
	<-written
}

func sendClose(conn *websocket.Conn, reason closeReason) {
	_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(reason.code, reason.text), time.Now().Add(500*time.Millisecond))
}

func (e *Endpoint) readLoop(c *client, conn *websocket.Conn, session auth.Session) closeReason {
	window := time.Now()
	count := 0
	for c.ctx.Err() == nil {
		kind, payload, err := conn.ReadMessage()
		if err != nil {
			break
		}
		if now := time.Now(); now.Sub(window) >= time.Second {
			window, count = now, 0
		}
		count++
		if count > inboundRate {
			return closeReason{websocket.ClosePolicyViolation, "event rate exceeded"}
		}
		if kind != websocket.TextMessage {
			return closeReason{websocket.CloseUnsupportedData, "expected JSON text"}
		}

		var cmd command
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		if !utf8.Valid(payload) || decoder.Decode(&cmd) != nil || decoder.Decode(new(any)) != io.EOF || cmd.Version != Version {
			c.reply("error", "", "invalid_event")
			continue
		}
		id, err := service.NormalizeConversationID(cmd.ConversationID)
		if err != nil {
			c.reply("error", "", "invalid_event")
			continue
		}

		ctx, cancel := context.WithTimeout(c.ctx, checkTimeout)
		if !session.Valid(ctx) {
			cancel()
			return closeReason{websocket.ClosePolicyViolation, "session expired or revoked"}
		}
		switch cmd.Type {
		case "conversation.subscribe":
			workspaceID, err := e.authorizer.ActiveConversationWorkspace(ctx, c.employeeID, id)
			switch {
			case errors.Is(err, service.ErrNotFound), errors.Is(err, service.ErrForbidden):
				c.reply("error", id, "subscription_denied")
			case err != nil || workspaceID == "":
				c.reply("error", id, "subscription_unavailable")
			default:
				e.hub.subscribe(c, room{workspaceID, id})
			}
		case "conversation.unsubscribe":
			e.hub.unsubscribe(c, id)
		default:
			c.reply("error", id, "unsupported_event")
		}
		cancel()
	}
	return closeReason{websocket.CloseNormalClosure, "connection closed"}
}

func (e *Endpoint) writeLoop(c *client, conn *websocket.Conn, session auth.Session) {
	ticker := time.NewTicker(e.pingEvery)
	defer ticker.Stop()
	for c.ctx.Err() == nil {
		select {
		case <-c.ctx.Done():
			return
		case next := <-c.outbound:
			if next.sub != nil {
				if !e.hub.active(c, next.sub) {
					continue
				}
				if !e.authorize(c, session, []*subscription{next.sub}) {
					return
				}
				if !e.hub.active(c, next.sub) {
					continue
				}
			}
			if c.ctx.Err() != nil {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(writeTimeout))
			if err := conn.WriteJSON(next.value); err != nil {
				c.stop(closeReason{websocket.CloseGoingAway, "write failed"})
				return
			}
		case <-ticker.C:
			if !e.authorize(c, session, e.hub.subscriptions(c)) {
				return
			}
			if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(writeTimeout)); err != nil {
				c.stop(closeReason{websocket.CloseGoingAway, "heartbeat failed"})
				return
			}
		}
	}
}

func (e *Endpoint) authorize(c *client, session auth.Session, subs []*subscription) bool {
	ctx, cancel := context.WithTimeout(c.ctx, checkTimeout)
	defer cancel()
	if !session.Valid(ctx) {
		c.stop(closeReason{websocket.ClosePolicyViolation, "session expired or revoked"})
		return false
	}
	for _, sub := range subs {
		if !e.hub.active(c, sub) {
			continue
		}
		id, err := e.authorizer.ActiveConversationWorkspace(ctx, c.employeeID, sub.room.conversationID)
		if e.hub.active(c, sub) && (err != nil || id != sub.room.workspaceID) {
			c.stop(closeReason{websocket.ClosePolicyViolation, "subscription no longer authorized"})
			return false
		}
	}
	if ctx.Err() != nil {
		c.stop(closeReason{websocket.ClosePolicyViolation, "authorization check expired"})
		return false
	}
	return true
}
