-- =====================================================================
-- Reference data (configuration only — NOT prospect data)
-- =====================================================================
insert into public.industries(name, segment, relevance, keywords) values
 ('Food & Beverages','FMCG',1.0,'{food,beverage,drinks,snacks}'),
 ('Packaged Food','FMCG',1.0,'{packaged food,confectionery,biscuits,noodles}'),
 ('Dairy Products','FMCG',1.0,'{dairy,milk,cheese,yogurt}'),
 ('Personal Care','FMCG',1.0,'{personal care,hygiene,oral care,hair care}'),
 ('Beauty & Cosmetics','FMCG',0.95,'{beauty,cosmetics,skincare,fragrance}'),
 ('Home Care','FMCG',1.0,'{home care,detergent,cleaning}'),
 ('Household Products','FMCG',0.95,'{household,consumer products}'),
 ('Consumer Health & Wellness','FMCG',0.9,'{otc,consumer health,wellness,nutrition}'),
 ('Tobacco & Related','FMCG',0.6,'{tobacco,nicotine}'),
 ('Packaged Consumer Products','FMCG',0.95,'{consumer goods,cpg}'),
 ('Fast-moving Retail Brands','FMCG',0.85,'{retail brand}'),
 ('Consumer Electronics','FMCD',1.0,'{consumer electronics,tv,audio}'),
 ('Home Appliances','FMCD',1.0,'{home appliances,appliances}'),
 ('Kitchen Appliances','FMCD',0.95,'{kitchen appliances,cookware}'),
 ('Mobile Phones & Accessories','FMCD',0.95,'{smartphones,mobile,accessories}'),
 ('Consumer Durables','FMCD',1.0,'{consumer durables}'),
 ('Furniture & Furnishings','FMCD',0.8,'{furniture,furnishings,mattress}'),
 ('Electrical Goods','FMCD',0.85,'{electricals,lighting,fans,switches}'),
 ('Electronics Distribution','FMCD',0.8,'{electronics distribution}'),
 ('White Goods','FMCD',1.0,'{white goods,refrigerators,washing machines,air conditioners}'),
 ('Consumer Technology Products','FMCD',0.85,'{consumer technology,wearables}'),
 ('Retail Chains','Related',0.85,'{retail chain}'),
 ('Modern Trade','Related',0.85,'{modern trade}'),
 ('Supermarkets & Hypermarkets','Related',0.85,'{supermarket,hypermarket,grocery retail}'),
 ('Wholesale Distribution','Related',0.75,'{wholesale,cash and carry}'),
 ('E-commerce Retail','Related',0.7,'{e-commerce,quick commerce,online retail}'),
 ('FMCG Distributors','Related',0.8,'{fmcg distributor,distribution}'),
 ('Consumer Goods Manufacturing','Related',0.9,'{consumer goods manufacturer}')
on conflict (name) do nothing;

insert into public.countries(code,name,region,is_focus,cities) values
 ('IN','India','South Asia',true,'{Mumbai,Delhi NCR,Bengaluru,Gurugram,Pune,Chennai,Hyderabad,Kolkata,Ahmedabad}'),
 ('AE','United Arab Emirates','Middle East',true,'{Dubai,Abu Dhabi,Sharjah}'),
 ('SA','Saudi Arabia','Middle East',true,'{Riyadh,Jeddah,Dammam}'),
 ('QA','Qatar','Middle East',true,'{Doha}'),
 ('KW','Kuwait','Middle East',true,'{Kuwait City}'),
 ('SG','Singapore','Southeast Asia',true,'{Singapore}'),
 ('MY','Malaysia','Southeast Asia',true,'{Kuala Lumpur,Petaling Jaya,Penang}'),
 ('ID','Indonesia','Southeast Asia',true,'{Jakarta,Surabaya,Tangerang}'),
 ('TH','Thailand','Southeast Asia',true,'{Bangkok}'),
 ('VN','Vietnam','Southeast Asia',true,'{Ho Chi Minh City,Hanoi}'),
 ('PH','Philippines','Southeast Asia',true,'{Manila,Makati,Taguig,Pasig}'),
 ('GB','United Kingdom','Europe',true,'{London,Manchester,Birmingham}'),
 ('DE','Germany','Europe',true,'{Berlin,Munich,Hamburg,Frankfurt,Düsseldorf}'),
 ('FR','France','Europe',true,'{Paris,Lyon}'),
 ('NL','Netherlands','Europe',true,'{Amsterdam,Rotterdam,Utrecht}'),
 ('CH','Switzerland','Europe',true,'{Zurich,Geneva,Vevey,Basel}'),
 ('ZA','South Africa','Africa',true,'{Johannesburg,Cape Town,Durban}'),
 ('AU','Australia','Oceania',true,'{Sydney,Melbourne,Brisbane}'),
 ('NZ','New Zealand','Oceania',true,'{Auckland,Wellington}'),
 ('US','United States','North America',true,'{New York,Chicago,Cincinnati,Atlanta,Los Angeles}')
on conflict (code) do nothing;

insert into public.designations(title,department,seniority,priority,aliases) values
 -- Priority 1: L&D
 ('Chief Learning Officer','learning_development','cxo',1,'{CLO,Chief Learning & Development Officer}'),
 ('Head of Learning & Development','learning_development','head',1,'{Head L&D,Head - L&D,L&D Head,Head of L&D,Head Learning}'),
 ('Director of Learning & Development','learning_development','director',1,'{L&D Director,Learning Director,Director L&D}'),
 ('Head of Learning and Talent Development','learning_development','head',1,'{Head Learning & Talent}'),
 ('VP Learning & Development','learning_development','vp',1,'{Vice President L&D,VP L&D,AVP Learning}'),
 ('Head of Corporate Training','learning_development','head',1,'{Training Head,Head of Training,Corporate Training Head}'),
 ('Head of Leadership Development','learning_development','head',1,'{Leadership Development Lead}'),
 ('Head of Capability Development','learning_development','head',1,'{Capability Head,Head of Capability Building,Capability Lead}'),
 ('Head of Sales Capability Development','learning_development','head',1,'{Sales Capability Head,Head Sales Capability,Sales Academy Head}'),
 ('Learning Business Partner','learning_development','senior',1,'{L&D Business Partner,Learning Partner}'),
 -- Priority 2: HR
 ('Chief Human Resources Officer','human_resources','cxo',2,'{CHRO,Chief People Officer,CPO People,Chief HR Officer}'),
 ('HR Director','human_resources','director',2,'{Director HR,Director Human Resources,People Director}'),
 ('Head of HR','human_resources','head',2,'{HR Head,Head Human Resources,Head of People}'),
 ('VP Human Resources','human_resources','vp',2,'{Vice President HR,VP HR,VP People}'),
 ('Head of Talent Management','human_resources','head',2,'{Talent Management Head,Talent Head}'),
 ('Head of Organisational Development','human_resources','head',2,'{Head OD,OD Head,Head of Organizational Development}'),
 ('Head of Talent Development','human_resources','head',2,'{Talent Development Head}'),
 -- Priority 3: Sales
 ('Chief Sales Officer','sales','cxo',3,'{CSO,Chief Commercial Officer,CCO}'),
 ('Sales Director','sales','director',3,'{Director Sales,Director of Sales}'),
 ('Head of Sales','sales','head',3,'{Sales Head}'),
 ('VP Sales','sales','vp',3,'{Vice President Sales,VP - Sales,SVP Sales}'),
 ('National Sales Head','sales','head',3,'{National Sales Manager,NSM,Head National Sales}'),
 ('Regional Sales Director','sales','director',3,'{Regional Sales Head,Zonal Sales Head}'),
 ('Commercial Director','sales','director',3,'{Director Commercial}'),
 ('Head of Commercial Excellence','sales','head',3,'{Commercial Excellence Head,Commercial Excellence Director}'),
 ('Head of Sales Excellence','sales','head',3,'{Sales Excellence Head,Sales Excellence Director}'),
 ('Head of Sales Training','sales','head',3,'{Sales Training Head,Sales Training Manager}'),
 -- Priority 4: Trade Marketing & Category
 ('Head of Trade Marketing','trade_marketing','head',4,'{Trade Marketing Head}'),
 ('Trade Marketing Director','trade_marketing','director',4,'{Director Trade Marketing}'),
 ('VP Trade Marketing','trade_marketing','vp',4,'{Vice President Trade Marketing}'),
 ('National Trade Marketing Manager','trade_marketing','manager',4,'{NTMM}'),
 ('Head of Category Management','trade_marketing','head',4,'{Category Management Head}'),
 ('Category Director','trade_marketing','director',4,'{Director Category}'),
 ('Head of Shopper Marketing','trade_marketing','head',4,'{Shopper Marketing Head}'),
 ('Head of Channel Development','trade_marketing','head',4,'{Channel Development Head}'),
 ('Head of Revenue Growth Management','trade_marketing','head',4,'{RGM Head,Head RGM,Revenue Growth Management Director}'),
 ('Head of Commercial Strategy','trade_marketing','head',4,'{Commercial Strategy Head}')
on conflict (title) do nothing;

insert into public.app_settings(key, value) values
 ('scoring_weights', '{"industry":20,"company_size":15,"seniority":20,"training_relevance":20,"growth_signals":10,"contact_quality":10,"geography":5}'),
 ('priority_bands', '{"A":85,"B":70,"C":50}'),
 ('ai_model', '{"model":"claude-sonnet-5-5","max_tokens":4000}'),
 ('outreach_defaults', '{"sender_company":"World of Trade","website":"https://worldoftrade.pro/","tone":"consultative"}')
on conflict (key) do nothing;

insert into public.integrations(provider, display_name, category, description, status) values
 ('anthropic','Claude (Anthropic)','ai','AI research, contact relevance, score explanations and outreach. Uses Claude web search for grounded research.','not_configured'),
 ('apollo','Apollo.io','enrichment','Organization search, people search and contact enrichment.','not_configured'),
 ('hunter','Hunter.io','enrichment','Domain search for professional emails and email verification.','not_configured'),
 ('pdl','People Data Labs','company_data','Company and person search/enrichment.','not_configured'),
 ('google_cse','Google Programmable Search','search','Authorised web search for company sources, news and buying signals.','not_configured'),
 ('website','Company website reader','builtin','Reads public company homepages (robots.txt respected).','builtin'),
 ('gmail','Gmail','email','Planned: send approved emails from Gmail.','planned'),
 ('outlook','Microsoft Outlook','email','Planned: send approved emails from Outlook.','planned'),
 ('hubspot','HubSpot','crm','Planned: sync leads and activities.','planned'),
 ('zoho','Zoho CRM','crm','Planned: sync leads and activities.','planned'),
 ('salesforce','Salesforce','crm','Planned: sync leads and activities.','planned')
on conflict (provider) do nothing;
