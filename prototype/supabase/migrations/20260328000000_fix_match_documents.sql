-- Fix: match_documents RPC using set search_path to resolve operator
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
set search_path = public, extensions
as $$
begin
  return query
    select
      d.id,
      d.source_file,
      d.title,
      d.content,
      (1 - (d.embedding <=> query_embedding::vector(1536)))::float as similarity
    from public.rag_documents d
    where (1 - (d.embedding <=> query_embedding::vector(1536))) > match_threshold
    order by d.embedding <=> query_embedding::vector(1536)
    limit match_count;
end;
$$;
