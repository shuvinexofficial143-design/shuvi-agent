-- Shuvi remote relay: dedicated database only. Never run in Instagram/Open Chet DB.
-- All Data API access is service_role only; RLS and privileges fail closed.
CREATE TABLE IF NOT EXISTS public.shuvi_remote_journals (
  scope text PRIMARY KEY CHECK (char_length(scope) BETWEEN 33 AND 193),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  state jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shuvi_remote_journals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.shuvi_remote_journals FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.shuvi_remote_journals TO service_role;
-- CAS update is one atomic Postgres transaction; never read-modify-write in Vercel.
CREATE OR REPLACE FUNCTION public.shuvi_remote_cas(
  p_scope text, p_expected bigint, p_state jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF p_scope IS NULL OR char_length(p_scope) NOT BETWEEN 33 AND 193
     OR p_expected < 0 OR p_state IS NULL OR pg_catalog.pg_column_size(p_state) > 1000000
  THEN
    RAISE EXCEPTION 'Invalid journal CAS input';
  END IF;
  INSERT INTO public.shuvi_remote_journals (scope,revision,state)
    VALUES (p_scope,0,'null'::jsonb)
    ON CONFLICT (scope) DO NOTHING;
  UPDATE public.shuvi_remote_journals
    SET revision=revision+1, state=p_state, updated_at=now()
    WHERE scope=p_scope AND revision=p_expected;
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.shuvi_remote_cas(text,bigint,jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.shuvi_remote_cas(text,bigint,jsonb) TO service_role;
-- No anon/authenticated policies deliberately: browser must never directly read commands.
