-- Diagnostics for the "1-100 of 100" pagination question. Run in Supabase SQL editor.

-- 1. Total threads in the Corofy workspace, broken down by status.
select status, count(*) as n
from threads
where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'
group by status
order by n desc;

-- 2. Same breakdown by source so we can see EB vs Instantly.
select source_provider, status, count(*) as n
from threads
where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'
group by source_provider, status
order by source_provider, n desc;

-- 3. Exactly what the "All Email" tab uses (status='open').
select count(*) as open_threads
from threads
where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'
  and status = 'open';

-- 4. Sanity: a few open threads ordered the same way the UI orders them,
--    to confirm last_message_at is set (a NULL there pushes rows to the end).
select id, source_provider, status, last_message_at, last_message_preview
from threads
where workspace_id = '8c097b98-7f6e-440a-8987-32e110563b8c'
  and status = 'open'
order by last_message_at desc nulls last
limit 5;
