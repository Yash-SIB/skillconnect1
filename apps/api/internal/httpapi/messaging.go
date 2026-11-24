package httpapi

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"mime"
	"net/http"
	"unicode/utf8"

	"skillconnect/api/internal/auth"
	"skillconnect/api/internal/service"
)

type messagingHandler struct {
	service service.Messaging
}

func (h messagingHandler) register(mux *http.ServeMux, verifier auth.Verifier) {
	protect := func(next func(http.ResponseWriter, *http.Request, string)) http.Handler {
		return auth.Require(verifier, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if h.service.Store == nil {
				writeError(w, http.StatusServiceUnavailable, "unavailable", "Messaging is unavailable")
				return
			}
			principal, _ := auth.PrincipalFromContext(r.Context())
			next(w, r, principal.EmployeeID)
		}))
	}
	mux.Handle("GET /api/v1/conversations", protect(h.listConversations))
	mux.Handle("POST /api/v1/conversations", protect(h.createConversation))
	mux.Handle("GET /api/v1/conversations/{id}/members", protect(h.listMembers))
	mux.Handle("GET /api/v1/conversations/{id}/messages", protect(h.listMessages))
	mux.Handle("POST /api/v1/conversations/{id}/messages", protect(h.createMessage))
}

func (h messagingHandler) listConversations(w http.ResponseWriter, r *http.Request, employeeID string) {
	conversations, err := h.service.ListConversations(r.Context(), employeeID, r.URL.Query().Get("workspace_id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Conversations []service.Conversation `json:"conversations"`
	}{Conversations: conversations})
}

func (h messagingHandler) createConversation(w http.ResponseWriter, r *http.Request, employeeID string) {
	var input service.ConversationInput
	if !readJSON(w, r, &input) {
		return
	}
	conversation, created, err := h.service.CreateConversation(r.Context(), employeeID, input)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, creationStatus(created), conversation)
}

func (h messagingHandler) listMembers(w http.ResponseWriter, r *http.Request, employeeID string) {
	members, err := h.service.ListMembers(r.Context(), employeeID, r.PathValue("id"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Members []service.Member `json:"members"`
	}{Members: members})
}

func (h messagingHandler) listMessages(w http.ResponseWriter, r *http.Request, employeeID string) {
	query := r.URL.Query()
	page, err := h.service.ListMessages(r.Context(), employeeID, r.PathValue("id"), query.Get("cursor"), query.Get("limit"))
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, page)
}

func (h messagingHandler) createMessage(w http.ResponseWriter, r *http.Request, employeeID string) {
	var input service.MessageInput
	if !readJSON(w, r, &input) {
		return
	}
	message, created, err := h.service.CreateMessage(r.Context(), employeeID, r.PathValue("id"), input)
	if err != nil {
		handleError(w, err)
		return
	}
	writeJSON(w, creationStatus(created), message)
}

func creationStatus(created bool) int {
	if created {
		return http.StatusCreated
	}
	return http.StatusOK
}

const maxJSONBytes = 64 * 1024

func readJSON(w http.ResponseWriter, r *http.Request, input any) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported_media_type", "Content-Type must be application/json")
		return false
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "Request body exceeds 64 KiB")
		return false
	}
	if err == nil && utf8.Valid(raw) && bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if decoder.Decode(input) == nil && decoder.Decode(new(any)) == io.EOF {
			return true
		}
	}
	writeError(w, http.StatusBadRequest, "invalid_request", "Expected one valid JSON object with supported fields")
	return false
}

func handleError(w http.ResponseWriter, err error) {
	var invalid service.InputError
	switch {
	case errors.As(err, &invalid):
		writeError(w, http.StatusBadRequest, "invalid_request", invalid.Error())
	case errors.Is(err, service.ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "Active workspace membership is required")
	case errors.Is(err, service.ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "Resource not found")
	case errors.Is(err, service.ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "Request conflicts with an existing record")
	default:
		log.Printf("messaging request failed (%T)", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "Could not complete the request")
	}
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, struct {
		Error errorDetail `json:"error"`
	}{Error: errorDetail{Code: code, Message: message}})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
