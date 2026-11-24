package realtime

import (
	"context"
	"sync"

	"github.com/gorilla/websocket"

	"skillconnect/api/internal/service"
)

const (
	queueCapacity    = 64
	maxConnections   = 8
	maxSubscriptions = 64
)

type room struct {
	workspaceID    string
	conversationID string
}

type subscription struct {
	room room
}

type outbound struct {
	value any
	sub   *subscription
}

type client struct {
	employeeID string
	ctx        context.Context
	stop       context.CancelCauseFunc
	outbound   chan outbound
}

type closeReason struct {
	code int
	text string
}

func (r closeReason) Error() string { return r.text }

type Hub struct {
	mu        sync.Mutex
	clients   map[*client]map[string]*subscription
	rooms     map[room]map[*client]*subscription
	employees map[string]int
	queueSize int
	closed    bool
	drained   chan struct{}
}

func NewHub() *Hub {
	return newHub(queueCapacity)
}

func newHub(queueSize int) *Hub {
	return &Hub{
		clients:   make(map[*client]map[string]*subscription),
		rooms:     make(map[room]map[*client]*subscription),
		employees: make(map[string]int),
		queueSize: queueSize,
		drained:   make(chan struct{}),
	}
}

func (h *Hub) register(employeeID string) *client {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.employees[employeeID] >= maxConnections {
		return nil
	}
	ctx, stop := context.WithCancelCause(context.Background())
	c := &client{employeeID: employeeID, ctx: ctx, stop: stop, outbound: make(chan outbound, h.queueSize)}
	h.clients[c] = make(map[string]*subscription)
	h.employees[employeeID]++
	return c
}

func (h *Hub) unregister(c *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs, exists := h.clients[c]
	if !exists {
		return
	}
	for id := range subs {
		h.removeSubscription(c, subs, id)
	}
	delete(h.clients, c)
	h.employees[c.employeeID]--
	if h.employees[c.employeeID] == 0 {
		delete(h.employees, c.employeeID)
	}
	if h.closed && len(h.clients) == 0 {
		close(h.drained)
	}
}

func (h *Hub) subscribe(c *client, key room) {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs := h.clients[c]
	if subs == nil || c.ctx.Err() != nil {
		return
	}
	sub := subs[key.conversationID]
	if sub == nil {
		if len(subs) >= maxSubscriptions {
			c.reply("error", key.conversationID, "subscription_limit")
			return
		}
		sub = &subscription{room: key}
		subs[key.conversationID] = sub
		if h.rooms[key] == nil {
			h.rooms[key] = make(map[*client]*subscription)
		}
		h.rooms[key][c] = sub
	}
	// Keep the subscription acknowledgement ahead of any event for this room.
	c.reply("conversation.subscribed", key.conversationID, "")
}

func (h *Hub) unsubscribe(c *client, conversationID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.removeSubscription(c, h.clients[c], conversationID)
	c.reply("conversation.unsubscribed", conversationID, "")
}

// removeSubscription requires h.mu.
func (h *Hub) removeSubscription(c *client, subs map[string]*subscription, conversationID string) {
	if sub := subs[conversationID]; sub != nil {
		delete(subs, conversationID)
		delete(h.rooms[sub.room], c)
		if len(h.rooms[sub.room]) == 0 {
			delete(h.rooms, sub.room)
		}
	}
}

func (h *Hub) subscriptions(c *client) []*subscription {
	h.mu.Lock()
	defer h.mu.Unlock()
	subs := make([]*subscription, 0, len(h.clients[c]))
	for _, sub := range h.clients[c] {
		subs = append(subs, sub)
	}
	return subs
}

func (h *Hub) active(c *client, sub *subscription) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.clients[c][sub.room.conversationID] == sub
}

func (h *Hub) PublishMessageCreated(message service.Message) {
	key := room{workspaceID: message.WorkspaceID, conversationID: message.ConversationID}
	event := CreatedEvent{
		Version: Version, Type: MessageCreated, ConversationID: key.conversationID, Message: message,
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for c, sub := range h.rooms[key] {
		c.enqueue(outbound{value: event, sub: sub})
	}
}

func (c *client) reply(kind, conversationID, code string) {
	c.enqueue(outbound{value: response{Version: Version, Type: kind, ConversationID: conversationID, Code: code}})
}

func (c *client) enqueue(frame outbound) {
	if c.ctx.Err() != nil {
		return
	}
	select {
	case c.outbound <- frame:
	default:
		c.stop(closeReason{websocket.CloseTryAgainLater, "outbound queue full"})
	}
}

// Shutdown stops registration, closes active sockets, and waits for their handlers.
func (h *Hub) Shutdown(ctx context.Context) error {
	h.mu.Lock()
	if !h.closed {
		h.closed = true
		for c := range h.clients {
			c.stop(closeReason{websocket.CloseGoingAway, "server shutting down"})
		}
		if len(h.clients) == 0 {
			close(h.drained)
		}
	}
	h.mu.Unlock()
	select {
	case <-h.drained:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
