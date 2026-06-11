-- New "Interview Scheduled" pipeline stage, mirroring the existing
-- "Phone Screen Scheduled" pattern: a step that captures the gap
-- between booking an interview and actually conducting it.
--
-- Inserts BEFORE the existing 'interview' value in the pipeline_stage
-- enum so the workflow ordering reads:
--   introduction → phone_screen_scheduled → phone_screen
--   → interview_scheduled → interview → hired
--
-- Postgres allows extending an enum non-destructively; no rows are
-- rewritten and existing per-client stage_label_overrides (jsonb on
-- clients) keep their values. Clients that have already customised
-- "Interview" → "In-Person Meeting" continue to render that label,
-- and Interview Scheduled comes through with its default name until
-- they edit it.

alter type pipeline_stage add value if not exists 'interview_scheduled' before 'interview';
