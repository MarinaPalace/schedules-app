-- No deletions anywhere in business data, no updates on history tables,
-- and a hash-chained audit trail for every insert/update.
-- The acting user is read from the transaction setting `app.actor_id` (see src/lib/actor.ts).

-- Timestamp is rendered in UTC so the hash does not depend on the session time zone.
CREATE FUNCTION app_audit_hash(
  p_prev text, p_at timestamptz, p_actor text, p_table text, p_op text, p_row text, p_old jsonb, p_new jsonb
) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to(
    coalesce(p_prev, '') || '|' || to_char(p_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    coalesce(p_actor, '') || '|' || p_table || '|' || p_op || '|' || coalesce(p_row, '') || '|' ||
    coalesce(p_old::text, '') || '|' || coalesce(p_new::text, ''),
  'UTF8')), 'hex')
$$;
--> statement-breakpoint
-- Returns the id of the first audit row whose hash or link is wrong, or NULL if the chain is intact.
CREATE FUNCTION app_verify_audit_chain() RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT min(id) FROM (
    SELECT id, hash, prev_hash, lag(hash) OVER (ORDER BY id) AS expected_prev,
      app_audit_hash(prev_hash, at, actor_id, table_name, operation, row_id, old_data, new_data) AS recomputed
    FROM audit_events
  ) c
  WHERE hash <> recomputed OR prev_hash IS DISTINCT FROM expected_prev
$$;
--> statement-breakpoint

CREATE FUNCTION app_block_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Deleting from % is not allowed', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_block_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows in % are history and cannot be changed; insert a new row instead', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION app_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END;
  v_new jsonb := to_jsonb(NEW);
  v_actor text := nullif(current_setting('app.actor_id', true), '');
  v_row text;
  v_prev text;
  v_at timestamptz := clock_timestamp();
BEGIN
  -- Never copy secrets into the audit log.
  v_old := v_old - 'password' - 'token';
  v_new := v_new - 'password' - 'token';
  IF TG_OP = 'UPDATE' AND v_old = v_new THEN
    RETURN NEW;
  END IF;
  v_row := coalesce(v_new->>'id', v_new->>'key', (v_new->>'user_id') || ':' || (v_new->>'department_id'));

  -- Serialise writers so the hash chain stays linear.
  PERFORM pg_advisory_xact_lock(727274);
  SELECT hash INTO v_prev FROM audit_events ORDER BY id DESC LIMIT 1;

  INSERT INTO audit_events (at, actor_id, table_name, operation, row_id, old_data, new_data, prev_hash, hash)
  VALUES (
    v_at, v_actor, TG_TABLE_NAME, TG_OP, v_row, v_old, v_new, v_prev,
    app_audit_hash(v_prev, v_at, v_actor, TG_TABLE_NAME, TG_OP, v_row, v_old, v_new)
  );
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE
  t text;
BEGIN
  -- Block DELETE on every business table (session/verification are auth housekeeping).
  FOREACH t IN ARRAY ARRAY[
    'user', 'account', 'departments', 'department_managers', 'employees', 'employee_rates',
    'shift_templates', 'schedule_entries', 'timesheet_entries', 'correction_requests',
    'correction_decisions', 'budgets', 'advance_requests', 'advance_decisions', 'settings', 'audit_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION app_block_delete()',
      t || '_no_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION app_block_delete()',
      t || '_no_truncate', t);
  END LOOP;

  -- History tables: insert only.
  FOREACH t IN ARRAY ARRAY[
    'employee_rates', 'schedule_entries', 'timesheet_entries', 'correction_requests',
    'correction_decisions', 'budgets', 'advance_requests', 'advance_decisions', 'audit_events'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app_block_update()',
      t || '_no_update', t);
  END LOOP;

  -- Audit every insert/update.
  FOREACH t IN ARRAY ARRAY[
    'user', 'account', 'departments', 'department_managers', 'employees', 'employee_rates',
    'shift_templates', 'schedule_entries', 'timesheet_entries', 'correction_requests',
    'correction_decisions', 'budgets', 'advance_requests', 'advance_decisions', 'settings'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION app_audit()',
      t || '_audit', t);
  END LOOP;

  -- Logins.
  CREATE TRIGGER session_audit AFTER INSERT ON session FOR EACH ROW EXECUTE FUNCTION app_audit();
END;
$$;
--> statement-breakpoint
INSERT INTO settings (key, value) VALUES ('employer_cost_factor', '1.19'), ('hotel_name', 'Hotel');
