-- Denormalised: store the workspace sender email address that owns this
-- thread. Every LEAD_REPLIED webhook carries `data.sender_email.email` —
-- that's the OUR-side address (e.g. "sender@brokerstaffer.com"). Pinning
-- it on the thread row means the UI can always show "(our@email) You"
-- without having to traverse messages, and reply composers can pre-fill
-- the From field even before the user has sent anything.

alter table threads add column if not exists outbound_sender_email text;

-- Index isn't strictly needed (we always look this up by thread id), but a
-- partial index keeps null rows out of any future filtered queries.
create index if not exists threads_outbound_sender_email_idx
  on threads (outbound_sender_email) where outbound_sender_email is not null;
