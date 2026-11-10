-- Gemini (Google) as an alternative AI provider. (The integrations function also self-creates this row.)
insert into public.integrations(provider, display_name, category, description, status) values
 ('gemini','Gemini (Google)','ai','AI research, discovery, signals and outreach using Grounding with Google Search. Free tier available.','not_configured')
on conflict (provider) do nothing;
insert into public.app_settings(key, value) values
 ('ai_provider', '{"provider":"auto"}'),
 ('gemini_model', '{"model":"gemini-flash-latest","max_tokens":8000}')
on conflict (key) do nothing;
