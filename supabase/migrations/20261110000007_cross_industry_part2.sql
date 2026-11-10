-- Cross-industry repositioning — PART 2 of 2.
-- Audience: Sales, Trade Marketing, Distribution & Channel Management professionals across industries.
-- Segments become open "sector groups" (no fixed FMCG/FMCD/Related list).

alter table public.industries drop constraint if exists industries_segment_check;
alter table public.industries drop constraint if exists industries_segment_not_blank;
alter table public.industries add constraint industries_segment_not_blank check (length(trim(segment)) > 0);
alter table public.companies drop constraint if exists companies_industry_segment_check;
alter table public.industries add column if not exists sort_order smallint not null default 100;

-- Re-home the former "Related" group into two clearer sector groups
update public.industries set segment = 'Retail & E-commerce'
 where segment = 'Related' and name in ('Retail Chains','Modern Trade','Supermarkets & Hypermarkets','E-commerce Retail');
update public.industries set segment = 'Distribution & Wholesale'
 where segment = 'Related' and name in ('Wholesale Distribution','FMCG Distributors');
update public.industries set segment = 'FMCG' where segment = 'Related' and name = 'Consumer Goods Manufacturing';
update public.industries set segment = 'Distribution & Wholesale' where name = 'Electronics Distribution';
update public.industries set segment = 'Retail & E-commerce' where segment = 'Related';

-- Sector groups and industries (relevance = how channel/sales-intensive the sector typically is)
insert into public.industries(name, segment, relevance, keywords) values
 -- FMCG additions
 ('Alcoholic Beverages','FMCG',0.9,'{alcobev,spirits,beer,wine}'),
 ('Baby & Infant Care','FMCG',0.95,'{baby care,infant nutrition,diapers}'),
 ('Pet Care','FMCG',0.85,'{pet food,pet care}'),
 ('Stationery & Office Supplies','FMCG',0.8,'{stationery,office supplies,writing instruments}'),
 -- Retail & E-commerce
 ('Quick Commerce','Retail & E-commerce',0.75,'{quick commerce,q-commerce,instant delivery}'),
 ('Specialty Retail','Retail & E-commerce',0.8,'{specialty retail,category specialist}'),
 ('Fashion & Lifestyle Retail','Retail & E-commerce',0.8,'{fashion retail,lifestyle retail,department store}'),
 ('Pharmacy Retail Chains','Retail & E-commerce',0.8,'{pharmacy chain,drugstore}'),
 ('Consumer Electronics Retail','Retail & E-commerce',0.8,'{electronics retail,electronics store}'),
 -- Distribution & Wholesale
 ('Pharma Distribution','Distribution & Wholesale',0.85,'{pharmaceutical distribution,pharma wholesaler}'),
 ('Industrial Distribution','Distribution & Wholesale',0.8,'{industrial distributor,MRO distribution}'),
 ('IT & Technology Distribution','Distribution & Wholesale',0.85,'{IT distribution,technology distributor,value added distributor}'),
 ('Trading & Import Houses','Distribution & Wholesale',0.75,'{trading company,import export,trading house}'),
 ('Cash & Carry','Distribution & Wholesale',0.8,'{cash and carry,B2B wholesale}'),
 -- Pharma & Healthcare
 ('Pharmaceuticals','Pharma & Healthcare',0.95,'{pharmaceuticals,branded generics,pharma}'),
 ('OTC & Consumer Healthcare','Pharma & Healthcare',0.95,'{OTC,consumer healthcare,self care}'),
 ('Medical Devices','Pharma & Healthcare',0.85,'{medical devices,medtech}'),
 ('Diagnostics','Pharma & Healthcare',0.75,'{diagnostics,in vitro diagnostics,labs}'),
 ('Nutraceuticals & Supplements','Pharma & Healthcare',0.9,'{nutraceuticals,dietary supplements,vitamins}'),
 ('Animal Health','Pharma & Healthcare',0.85,'{animal health,veterinary}'),
 ('Hospitals & Healthcare Services','Pharma & Healthcare',0.5,'{hospital,healthcare services}'),
 -- Automotive & Mobility
 ('Passenger Vehicles','Automotive & Mobility',0.95,'{automobile,passenger vehicles,car manufacturer}'),
 ('Two-Wheelers','Automotive & Mobility',0.95,'{two wheeler,motorcycle,scooter}'),
 ('Commercial Vehicles','Automotive & Mobility',0.9,'{commercial vehicles,trucks,buses}'),
 ('Tractors & Farm Equipment','Automotive & Mobility',0.9,'{tractors,farm equipment}'),
 ('Auto Components & Aftermarket','Automotive & Mobility',0.9,'{auto components,aftermarket,spare parts}'),
 ('Tyres','Automotive & Mobility',0.95,'{tyres,tires}'),
 ('Lubricants','Automotive & Mobility',0.95,'{lubricants,engine oil}'),
 ('Electric Vehicles & Batteries','Automotive & Mobility',0.85,'{electric vehicles,EV,EV charging}'),
 ('Automotive Dealer Groups','Automotive & Mobility',0.8,'{car dealership,dealer group}'),
 -- Building Materials & Construction
 ('Cement','Building Materials & Construction',0.95,'{cement}'),
 ('Paints & Coatings','Building Materials & Construction',1.0,'{paints,coatings}'),
 ('Tiles, Sanitaryware & Bath','Building Materials & Construction',0.95,'{tiles,sanitaryware,bath fittings,faucets}'),
 ('Pipes & Fittings','Building Materials & Construction',0.95,'{pipes,fittings,PVC pipes}'),
 ('Plywood, Laminates & Panels','Building Materials & Construction',0.95,'{plywood,laminates,MDF}'),
 ('Wires & Cables','Building Materials & Construction',0.95,'{wires,cables}'),
 ('Steel & Roofing Brands','Building Materials & Construction',0.85,'{TMT steel,roofing,steel brands}'),
 ('Home Improvement Retail','Building Materials & Construction',0.8,'{home improvement,DIY retail}'),
 ('Real Estate Developers','Building Materials & Construction',0.5,'{real estate,property developer}'),
 -- Industrial & Engineering
 ('Industrial Machinery & Equipment','Industrial & Engineering',0.75,'{industrial machinery,capital equipment}'),
 ('Electrical Equipment & Automation','Industrial & Engineering',0.8,'{electrical equipment,switchgear,industrial automation}'),
 ('Pumps, Valves & Motors','Industrial & Engineering',0.85,'{pumps,valves,motors}'),
 ('Tools & Hardware','Industrial & Engineering',0.85,'{power tools,hand tools,hardware,fasteners}'),
 ('HVAC & Refrigeration','Industrial & Engineering',0.85,'{HVAC,air conditioning,refrigeration}'),
 ('Packaging','Industrial & Engineering',0.7,'{packaging,containers}'),
 ('Office Equipment & Printing','Industrial & Engineering',0.8,'{printers,office equipment,imaging}'),
 -- Chemicals & Materials
 ('Specialty Chemicals','Chemicals & Materials',0.75,'{specialty chemicals}'),
 ('Adhesives & Sealants','Chemicals & Materials',0.9,'{adhesives,sealants,waterproofing}'),
 ('Plastics & Polymers','Chemicals & Materials',0.7,'{plastics,polymers}'),
 ('Industrial Gases','Chemicals & Materials',0.6,'{industrial gases}'),
 -- Agriculture & Agri-inputs
 ('Seeds','Agriculture & Agri-inputs',0.95,'{seeds,hybrid seeds}'),
 ('Fertilisers','Agriculture & Agri-inputs',0.95,'{fertilizers,fertilisers,crop nutrition}'),
 ('Crop Protection & Agrochemicals','Agriculture & Agri-inputs',0.95,'{agrochemicals,crop protection,pesticides}'),
 ('Animal Feed & Nutrition','Agriculture & Agri-inputs',0.85,'{animal feed,poultry feed,cattle feed}'),
 ('Irrigation & Agri-tech','Agriculture & Agri-inputs',0.8,'{irrigation,micro irrigation,agritech}'),
 -- Technology & Telecom
 ('Telecom Operators','Technology & Telecom',0.95,'{telecom operator,mobile network,telco}'),
 ('IT Hardware & Peripherals','Technology & Telecom',0.85,'{IT hardware,computers,peripherals}'),
 ('Software & SaaS','Technology & Telecom',0.6,'{software,SaaS}'),
 ('Networking & Security','Technology & Telecom',0.75,'{networking,cybersecurity,channel partners}'),
 ('Consumer Internet & Platforms','Technology & Telecom',0.6,'{consumer internet,marketplace,platform}'),
 -- Financial Services & Insurance
 ('Retail Banking','Financial Services & Insurance',0.8,'{retail banking,bank}'),
 ('Insurance','Financial Services & Insurance',0.9,'{insurance,life insurance,general insurance}'),
 ('NBFC & Consumer Finance','Financial Services & Insurance',0.85,'{NBFC,consumer finance,microfinance}'),
 ('Payments & Fintech','Financial Services & Insurance',0.75,'{payments,fintech,merchant acquiring}'),
 ('Asset & Wealth Management','Financial Services & Insurance',0.75,'{mutual funds,asset management,wealth management}'),
 -- Energy & Utilities
 ('Fuel Retail & Oil Marketing','Energy & Utilities',0.85,'{oil marketing,fuel retail,petrol pumps}'),
 ('LPG & Gas Distribution','Energy & Utilities',0.85,'{LPG,city gas distribution}'),
 ('Solar & Renewables','Energy & Utilities',0.8,'{solar,rooftop solar,renewable energy}'),
 ('Batteries & Inverters','Energy & Utilities',0.9,'{batteries,inverters,power backup}'),
 ('Power & Utilities','Energy & Utilities',0.5,'{power utility,electricity distribution}'),
 -- Logistics & Supply Chain
 ('Logistics & 3PL','Logistics & Supply Chain',0.65,'{logistics,3PL,warehousing}'),
 ('Express & Courier','Logistics & Supply Chain',0.7,'{express delivery,courier,parcel}'),
 ('Cold Chain','Logistics & Supply Chain',0.65,'{cold chain,temperature controlled}'),
 -- Textiles, Apparel & Lifestyle
 ('Apparel & Fashion Brands','Textiles, Apparel & Lifestyle',0.9,'{apparel,fashion brand,clothing}'),
 ('Footwear','Textiles, Apparel & Lifestyle',0.9,'{footwear,shoes}'),
 ('Jewellery & Watches','Textiles, Apparel & Lifestyle',0.85,'{jewellery,jewelry,watches}'),
 ('Eyewear','Textiles, Apparel & Lifestyle',0.85,'{eyewear,optical}'),
 ('Luggage, Bags & Accessories','Textiles, Apparel & Lifestyle',0.85,'{luggage,bags,accessories}'),
 ('Home Textiles','Textiles, Apparel & Lifestyle',0.85,'{home textiles,bed linen,towels}'),
 ('Sporting Goods','Textiles, Apparel & Lifestyle',0.85,'{sporting goods,sportswear,fitness equipment}'),
 ('Toys & Games','Textiles, Apparel & Lifestyle',0.85,'{toys,games}'),
 -- Media, Hospitality & Services
 ('Media & Entertainment','Media, Hospitality & Services',0.6,'{media,broadcasting,entertainment}'),
 ('Hotels & Hospitality','Media, Hospitality & Services',0.65,'{hotels,hospitality}'),
 ('QSR & Food Service','Media, Hospitality & Services',0.8,'{QSR,quick service restaurant,food service,HoReCa}'),
 ('Travel & Tourism','Media, Hospitality & Services',0.6,'{travel,tourism,airlines}'),
 ('Education & EdTech','Media, Hospitality & Services',0.6,'{education,edtech}'),
 ('Business Services & Staffing','Media, Hospitality & Services',0.55,'{business services,staffing,facility management}')
on conflict (name) do nothing;

update public.industries set sort_order = case segment
  when 'FMCG' then 1 when 'FMCD' then 2 when 'Pharma & Healthcare' then 3 when 'Automotive & Mobility' then 4
  when 'Building Materials & Construction' then 5 when 'Agriculture & Agri-inputs' then 6 when 'Technology & Telecom' then 7
  when 'Retail & E-commerce' then 8 when 'Distribution & Wholesale' then 9 when 'Industrial & Engineering' then 10
  when 'Chemicals & Materials' then 11 when 'Financial Services & Insurance' then 12 when 'Energy & Utilities' then 13
  when 'Textiles, Apparel & Lifestyle' then 14 when 'Logistics & Supply Chain' then 15 when 'Media, Hospitality & Services' then 16
  else 50 end;

-- Keep existing company records consistent with the new grouping
update public.companies c set industry_segment = i.segment from public.industries i
 where i.name = c.industry and c.industry_segment is distinct from i.segment;
update public.companies set industry_segment = 'Retail & E-commerce' where industry_segment = 'Related';

-- Distribution & Channel Management decision-makers (priority 3, alongside Sales leadership)
insert into public.designations(title,department,seniority,priority,aliases) values
 ('Head of Distribution','distribution_channel','head',3,'{Distribution Head,Head - Distribution,GM Distribution}'),
 ('Distribution Director','distribution_channel','director',3,'{Director Distribution,Director of Distribution}'),
 ('VP Distribution','distribution_channel','vp',3,'{Vice President Distribution,VP - Distribution}'),
 ('National Distribution Manager','distribution_channel','head',3,'{NDM,National Distribution Head}'),
 ('Head of Channel Sales','distribution_channel','head',3,'{Channel Sales Head,Head - Channel Sales}'),
 ('Channel Sales Director','distribution_channel','director',3,'{Director Channel Sales,Director of Channel}'),
 ('Head of Channel Partnerships','distribution_channel','head',3,'{Head of Partner Sales,Partner Channel Head,Head of Alliances & Channels}'),
 ('Head of Dealer Network','distribution_channel','head',3,'{Dealer Development Head,Head of Dealer Development,Network Development Head}'),
 ('Head of Route-to-Market','distribution_channel','head',3,'{RTM Head,Head RTM,Route to Market Director}'),
 ('Head of General Trade','distribution_channel','head',3,'{GT Head,General Trade Head}'),
 ('Head of Modern Trade','distribution_channel','head',3,'{MT Head,Modern Trade Head,Head of Organised Retail}'),
 ('Head of Key Accounts','sales','head',3,'{Key Account Head,National Key Account Manager,Head of KAM}'),
 ('Head of Sales Operations','sales','head',3,'{Sales Ops Head,Head of Commercial Operations}'),
 ('Head of Business Development','sales','head',3,'{BD Head,Business Development Head}')
on conflict (title) do nothing;

alter table public.campaigns alter column departments set default '{learning_development,human_resources,sales,distribution_channel,trade_marketing}';

-- Make the new function visible in dashboards immediately
notify pgrst, 'reload schema';

select count(*) as industries, count(distinct segment) as sector_groups from public.industries where is_active;
