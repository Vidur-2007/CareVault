-- CareVault share store. Run once in the Supabase SQL editor.
-- The server only ever stores ciphertext: the key stays in the link's fragment on the phone.
create table if not exists shares (
  id uuid primary key default gen_random_uuid(),
  ciphertext text not null,
  iv text not null,
  expires_at timestamptz not null,
  revoke_token_hash text not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);

-- No policies: only the service role, used by the server, can read or write.
alter table shares enable row level security;
