-- Cross-industry repositioning — PART 1 of 2.
-- Adds the "Distribution & Channel Management" function. Must run (and commit) BEFORE part 2,
-- because PostgreSQL cannot use a newly added enum value in the same transaction.
alter type department add value if not exists 'distribution_channel' before 'other';
