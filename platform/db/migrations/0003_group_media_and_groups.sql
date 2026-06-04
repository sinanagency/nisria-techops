-- Wave 2: group images in chat + real group identity (icons/subject).
-- Additive only. Live code ignores these, so this is safe to run on the shared
-- database before the redesign swaps in.

-- Link a group message to its stored media object so the chat can render the
-- image/document inline instead of showing a bare "[image]" placeholder.
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS media_mime text;

-- Real WhatsApp group identity: subject + avatar + jid, keyed by the same name
-- the messages.account carries. The group-bot upserts this from its live session
-- (subject + profilePictureUrl); the portal reads it for proper group icons.
CREATE TABLE IF NOT EXISTS public.groups (
  name text PRIMARY KEY,
  jid text,
  subject text,
  avatar_url text,
  participant_count integer,
  updated_at timestamptz DEFAULT now()
);
