-- Enable pgvector extension
create extension if not exists vector with schema extensions;

-- RAG document chunks table
create table if not exists public.rag_documents (
  id bigint generated always as identity primary key,
  source_file text not null,
  chunk_index int not null,
  title text,
  content text not null,
  embedding extensions.vector(1536),
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

-- Index for fast similarity search
create index if not exists rag_documents_embedding_idx on public.rag_documents
  using ivfflat (embedding extensions.vector_cosine_ops)
  with (lists = 10);

-- RPC function: match_documents
-- Uses explicit schema-qualified operator to avoid cross-schema issues
create or replace function public.match_documents(
  query_embedding text,
  match_threshold float default 0.5,
  match_count int default 3
)
returns table (
  id bigint,
  source_file text,
  title text,
  content text,
  similarity float
)
language plpgsql stable
as $$
declare
  query_vec extensions.vector(1536);
begin
  -- Cast the JSON text input to vector
  query_vec := query_embedding::extensions.vector(1536);
  
  return query
    select
      d.id,
      d.source_file,
      d.title,
      d.content,
      (1 - (d.embedding::text::extensions.vector(1536) operator(extensions.<=>) query_vec))::float as similarity
    from public.rag_documents d
    where (1 - (d.embedding::text::extensions.vector(1536) operator(extensions.<=>) query_vec)) > match_threshold
    order by d.embedding::text::extensions.vector(1536) operator(extensions.<=>) query_vec
    limit match_count;
end;
$$;

-- RLS: authenticated users can read
alter table public.rag_documents enable row level security;

drop policy if exists "Authenticated users can read rag_documents" on public.rag_documents;
create policy "Authenticated users can read rag_documents"
  on public.rag_documents
  for select
  to authenticated
  using (true);

-- Service role can insert/update/delete (for ingestion)
drop policy if exists "Service role full access on rag_documents" on public.rag_documents;
create policy "Service role full access on rag_documents"
  on public.rag_documents
  for all
  to service_role
  using (true)
  with check (true);
