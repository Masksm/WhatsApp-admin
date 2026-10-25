-- Enable pg_cron for scheduled guest-history expiry.
create extension if not exists pg_cron with schema pg_catalog;
