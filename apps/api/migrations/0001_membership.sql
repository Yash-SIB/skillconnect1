CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL CHECK (email = btrim(email) AND length(email) BETWEEN 1 AND 254),
    display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
    oidc_issuer text,
    oidc_subject text,
    created_at timestamptz NOT NULL DEFAULT now(),
    disabled_at timestamptz,
    UNIQUE (oidc_issuer, oidc_subject),
    CHECK (
        (oidc_issuer IS NULL AND oidc_subject IS NULL) OR
        (oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
         AND length(btrim(oidc_issuer)) > 0 AND length(btrim(oidc_subject)) > 0)
    )
);

CREATE TABLE workspaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE CHECK (length(slug) <= 64 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspace_members (
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    user_id uuid NOT NULL REFERENCES users (id),
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz,
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX workspace_members_user ON workspace_members (user_id, workspace_id);

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces (id),
    kind text NOT NULL CHECK (kind IN ('channel', 'dm')),
    channel_name text,
    channel_visibility text,
    dm_user_low uuid,
    dm_user_high uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, id, kind),
    UNIQUE (workspace_id, id, dm_user_low, dm_user_high),
    CHECK (
        (kind = 'channel' AND channel_name IS NOT NULL AND length(channel_name) <= 64
         AND channel_name ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
         AND channel_visibility IS NOT NULL AND channel_visibility IN ('public', 'private')
         AND dm_user_low IS NULL AND dm_user_high IS NULL)
        OR
        (kind = 'dm' AND channel_name IS NULL AND channel_visibility IS NULL
         AND dm_user_low IS NOT NULL AND dm_user_high IS NOT NULL AND dm_user_low < dm_user_high)
    )
);

CREATE UNIQUE INDEX conversations_channel_name ON conversations (workspace_id, channel_name)
    WHERE kind = 'channel';
CREATE UNIQUE INDEX conversations_dm_pair ON conversations (workspace_id, dm_user_low, dm_user_high)
    WHERE kind = 'dm';

CREATE TABLE conversation_members (
    workspace_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    conversation_kind text NOT NULL,
    dm_peer_id uuid,
    dm_user_low uuid GENERATED ALWAYS AS (
        CASE WHEN dm_peer_id IS NOT NULL THEN least(user_id, dm_peer_id) END
    ) STORED,
    dm_user_high uuid GENERATED ALWAYS AS (
        CASE WHEN dm_peer_id IS NOT NULL THEN greatest(user_id, dm_peer_id) END
    ) STORED,
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    PRIMARY KEY (workspace_id, conversation_id, user_id),
    FOREIGN KEY (workspace_id, user_id) REFERENCES workspace_members (workspace_id, user_id),
    FOREIGN KEY (workspace_id, conversation_id, conversation_kind)
        REFERENCES conversations (workspace_id, id, kind),
    FOREIGN KEY (workspace_id, conversation_id, dm_user_low, dm_user_high)
        REFERENCES conversations (workspace_id, id, dm_user_low, dm_user_high),
    CHECK (
        (conversation_kind = 'channel' AND dm_peer_id IS NULL)
        OR
        (conversation_kind = 'dm' AND dm_peer_id IS NOT NULL AND dm_peer_id <> user_id AND left_at IS NULL)
    )
);

CREATE INDEX conversation_members_user ON conversation_members (workspace_id, user_id, conversation_id);

-- Both participants must be inserted in the same transaction as the DM.
ALTER TABLE conversations
    ADD CONSTRAINT dm_low_is_member FOREIGN KEY (workspace_id, id, dm_user_low)
        REFERENCES conversation_members (workspace_id, conversation_id, user_id) DEFERRABLE INITIALLY DEFERRED,
    ADD CONSTRAINT dm_high_is_member FOREIGN KEY (workspace_id, id, dm_user_high)
        REFERENCES conversation_members (workspace_id, conversation_id, user_id) DEFERRABLE INITIALLY DEFERRED;
