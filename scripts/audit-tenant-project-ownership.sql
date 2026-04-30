SELECT
	t.id,
	t.slug,
	t.account_id AS tenant_account,
	p.account_id AS project_account
FROM tenants t
LEFT JOIN projects p ON p.id = t.project_id
WHERE t.account_id IS DISTINCT FROM p.account_id;
