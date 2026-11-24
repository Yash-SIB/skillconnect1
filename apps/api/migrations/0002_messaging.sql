CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    client_id uuid NOT NULL,
    body text NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    UNIQUE (workspace_id, conversation_id, id),
    UNIQUE (workspace_id, conversation_id, sender_id, client_id),
    FOREIGN KEY (workspace_id, conversation_id, sender_id)
        REFERENCES conversation_members (workspace_id, conversation_id, user_id)
);

CREATE INDEX messages_timeline ON messages (workspace_id, conversation_id, created_at DESC, id DESC);

CREATE TABLE attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    message_id uuid NOT NULL,
    storage_key text NOT NULL UNIQUE CHECK (length(btrim(storage_key)) > 0),
    file_name text NOT NULL CHECK (length(btrim(file_name)) BETWEEN 1 AND 255),
    content_type text NOT NULL CHECK (length(btrim(content_type)) BETWEEN 1 AND 255),
    size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
    scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending', 'clean', 'rejected')),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (workspace_id, conversation_id, message_id)
        REFERENCES messages (workspace_id, conversation_id, id)
);

CREATE INDEX attachments_message ON attachments (workspace_id, conversation_id, message_id);

CREATE TABLE read_receipts (
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_message_id uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, conversation_id, user_id),
    FOREIGN KEY (workspace_id, conversation_id, user_id)
        REFERENCES conversation_members (workspace_id, conversation_id, user_id),
    FOREIGN KEY (workspace_id, conversation_id, last_read_message_id)
        REFERENCES messages (workspace_id, conversation_id, id)
);
