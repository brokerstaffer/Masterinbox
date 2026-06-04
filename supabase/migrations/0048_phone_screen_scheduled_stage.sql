-- 0048: add 'phone_screen_scheduled' to the pipeline_stage enum.
--
-- Client portal asked for a stage between "Introduction" and "Phone
-- Screen" to mark candidates whose phone screen has been booked but
-- not yet held. Today "Phone Screen" itself ambiguously covers both
-- scheduled AND completed (the stage descriptions even share copy
-- verbatim) — the split cleans that up.
--
-- ALTER TYPE ... ADD VALUE is metadata-only on Postgres: the enum
-- gets a new label, no existing rows are rewritten. `BEFORE
-- 'phone_screen'` places the new value second in the enum's
-- intrinsic ordering so anything that iterates enum_range gets it
-- in the right slot.

alter type pipeline_stage add value if not exists 'phone_screen_scheduled' before 'phone_screen';
