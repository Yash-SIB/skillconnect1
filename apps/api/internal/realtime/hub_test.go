package realtime

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"skillconnect/api/internal/service"
)

func TestHubDisconnectsSlowConnection(t *testing.T) {
	hub := newHub(2)
	slow, fast := hub.register("employee"), hub.register("employee")
	defer hub.unregister(slow)
	defer hub.unregister(fast)
	key := room{"workspace", "conversation"}
	hub.subscribe(slow, key)
	hub.subscribe(fast, key)
	<-fast.outbound

	message := service.Message{ID: "message", WorkspaceID: key.workspaceID, ConversationID: key.conversationID}
	for range 3 {
		hub.PublishMessageCreated(message)
		select {
		case frame := <-fast.outbound:
			if frame.value.(CreatedEvent).Message.ID != message.ID {
				t.Fatal("fast client received wrong message")
			}
		default:
			t.Fatal("slow client blocked delivery to fast client")
		}
	}
	if cause, ok := context.Cause(slow.ctx).(closeReason); !ok || cause.code != websocket.CloseTryAgainLater {
		t.Fatalf("slow connection did not disconnect: %v", context.Cause(slow.ctx))
	}
	if fast.ctx.Err() != nil {
		t.Fatal("fast connection was disconnected")
	}
}

func TestHubConcurrentPublishUnsubscribeAndShutdown(t *testing.T) {
	hub := NewHub()
	key := room{"workspace", "conversation"}
	message := service.Message{WorkspaceID: key.workspaceID, ConversationID: key.conversationID}
	var clients sync.WaitGroup
	for range maxConnections {
		c := hub.register("employee")
		hub.subscribe(c, key)
		clients.Go(func() {
			defer hub.unregister(c)
			for c.ctx.Err() == nil {
				select {
				case <-c.ctx.Done():
				case <-c.outbound:
				}
			}
		})
	}
	if c := hub.register("employee"); c != nil {
		t.Fatal("employee connection cap was not enforced")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	var workers sync.WaitGroup
	workers.Go(func() {
		for range 100 {
			hub.PublishMessageCreated(message)
		}
	})
	workers.Go(func() {
		for range 100 {
			c := hub.register("other")
			if c == nil {
				return
			}
			hub.subscribe(c, key)
			hub.unsubscribe(c, key.conversationID)
			c.stop(context.Canceled)
			hub.unregister(c)
		}
	})
	if err := hub.Shutdown(ctx); err != nil {
		t.Fatal(err)
	}
	workers.Wait()
	clients.Wait()
	if len(hub.clients)+len(hub.rooms)+len(hub.employees) != 0 || hub.register("employee") != nil {
		t.Fatal("shutdown left registrations or subscriptions behind")
	}
}
