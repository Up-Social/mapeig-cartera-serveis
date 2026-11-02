-- Several codes represent distinct source-backed concert units, not extra
-- alternatives for one global match. Keep the documented-unit guard.
do $$ declare original text;patched text;begin
 original:=pg_get_functiondef('public.persist_analysis(uuid,text,jsonb,jsonb,jsonb)'::regprocedure);
 patched:=replace(original,
  'p_result->''rule_audit''->>''version'' is distinct from ''concert-program-lines-v2''',
  'coalesce(p_result->''rule_audit''->>''version'','''') not in (''concert-program-lines-v2'',''concert-reconciled-annex-v1'')');
 if patched=original then raise exception 'Expected multi-service guard not found';end if;
 execute patched;
end $$;
