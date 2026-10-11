-- AGRON Workspace v0.4: full Legal department. Safe to run more than once.
-- 1) Access for the new legal sections (does not touch custom rules of other sections)
insert into public.section_access(section,role,can_write,external)
select split_part(sec,'=',1), split_part(x,'~',1), x like '%~w', x like '%~e'
from unnest(string_to_array('legal.desks=management~w,engineering~w,operations~w,finance~w,sales~w,marketing~w,hr~w,legal~w,security~w;legal.requests=management~w,engineering~w,operations~w,finance~w,sales~w,marketing~w,hr~w,legal~w,security~w;legal.obligations=management~w,legal~w,security,finance,engineering,operations,sales;legal.programs=management~w,legal~w,security,finance,engineering,operations,sales;legal.governance=management~w,legal~w,finance;legal.ip=management~w,legal~w,security,finance,engineering,operations,sales;legal.privacy=management~w,legal~w,security,finance,engineering,operations,sales;legal.hse=management~w,legal~w,security,finance,engineering,operations,sales',';')) sec,
     unnest(string_to_array(split_part(sec,'=',2),',')) x
on conflict (section, role) do nothing;

-- 2) Matrix: new fields from the Master Equipment List (§23) default to Pending; existing values are kept
alter table public.records disable trigger records_log;
update public.records set data = jsonb_build_object(
  'subcategory', split_part(title,' · ',2), 'ear99','Pending', 'us_authority','Pending', 'encryption','Pending',
  'uae_import_permit','Pending', 'restricted_goods','Pending', 'install_auth','Pending', 'freq_auth','Pending',
  'operator_license','Pending', 'testing_perm','Pending', 'channel','Pending', 'uncertainty','High') || data
where section = 'legal.matrix';
update public.records set data = data || jsonb_build_object('next_action',
  'Do not purchase, import, install, activate or test. Separate legal review; only the government-authorised pathway (§4, §24 rules 7–9).')
where section = 'legal.matrix' and data->>'risk' in ('Restricted','Prohibited') and coalesce(data->>'next_action','') = '';

-- 3) Starter records: compliance calendar, programmes, more regulators
insert into public.records (section, title, status, data)
select s, t, st, d::jsonb from (values
('legal.obligations','Delaware franchise tax & annual report','Upcoming','{"jurisdiction":"Delaware","area":"Corporate","frequency":"Annual","due":"2027-03-01","basis":"Delaware franchise tax; due 1 March for corporations"}'),
('legal.obligations','Federal income tax return (Form 1120)','Upcoming','{"jurisdiction":"US federal","area":"Tax","frequency":"Annual","due":"2027-04-15","basis":"Calendar-year C-corporation: 15th day of 4th month (confirm with CPA)"}'),
('legal.obligations','Delaware registered agent','Verify','{"jurisdiction":"Delaware","area":"Corporate","frequency":"Annual","basis":"Keep a registered agent in Delaware at all times"}'),
('legal.obligations','FinCEN beneficial ownership report','Verify','{"jurisdiction":"US federal","area":"Corporate","frequency":"One-time","basis":"Corporate Transparency Act; 2025 interim rule exempted US-formed companies — confirm current status"}'),
('legal.obligations','Export records retention (5 years)','In progress','{"jurisdiction":"US federal","area":"Export control","frequency":"Per event","basis":"EAR Part 762; ITAR 22 CFR 122.5"}'),
('legal.obligations','EEI filing in AES for each export','Upcoming','{"jurisdiction":"US federal","area":"Customs","frequency":"Per shipment","basis":"15 CFR Part 30: generally over USD 2,500 per Schedule B number or when a licence is required"}'),
('legal.obligations','Restricted-party screening before each deal and shipment','In progress','{"jurisdiction":"International","area":"Export control","frequency":"Per event","basis":"OFAC; EAR Part 744; UAE sanctions lists"}'),
('legal.obligations','DDTC registration (only if ITAR applies)','Verify','{"jurisdiction":"US federal","area":"Export control","frequency":"Annual","basis":"22 CFR Part 122 — required for US manufacturers/exporters of defense articles"}'),
('legal.obligations','TDRA type approval per telecom model','Upcoming','{"jurisdiction":"UAE federal","area":"Telecom","frequency":"Per event","basis":"TDRA type approval before import or sale of telecom/radio equipment"}'),
('legal.obligations','UAE trade licence renewal','Verify','{"jurisdiction":"Abu Dhabi","area":"Corporate","frequency":"Annual","basis":"Applies once the UAE entity is licensed"}'),
('legal.obligations','UAE VAT registration and returns','Verify','{"jurisdiction":"UAE federal","area":"Tax","frequency":"Quarterly","basis":"Decree-Law 8/2017; mandatory registration above AED 375,000 taxable supplies"}'),
('legal.obligations','UAE corporate tax registration and return','Verify','{"jurisdiction":"UAE federal","area":"Tax","frequency":"Annual","basis":"Decree-Law 47/2022; return within 9 months after financial year end"}'),
('legal.obligations','UAE beneficial owner register','Verify','{"jurisdiction":"UAE federal","area":"Corporate","frequency":"Per event","basis":"UAE UBO procedures — keep register and file with licensing authority"}'),
('legal.obligations','USPTO maintenance (Section 8 declaration)','Upcoming','{"jurisdiction":"US federal","area":"IP","frequency":"One-time","basis":"Between 5th and 6th year after registration"}'),
('legal.obligations','Insurance renewals','Upcoming','{"jurisdiction":"International","area":"Insurance","frequency":"Annual","basis":"Product liability, marine cargo, cyber, D&O"}'),
('legal.programs','Export compliance programme (ECP)','To draft','{"program":"Export compliance (ECP)","jurisdiction":"US + UAE","elements":"BIS elements: management commitment, risk assessment, export authorization, recordkeeping, training, audits, handling violations, maintaining the programme"}'),
('legal.programs','Sanctions compliance programme','To draft','{"program":"Sanctions compliance","jurisdiction":"US + UAE","elements":"OFAC framework: management commitment, risk assessment, internal controls, testing and auditing, training"}'),
('legal.programs','Technology control plan','To draft','{"program":"Technology control plan","jurisdiction":"US","elements":"US-person access, marking of controlled data, IT access controls, visitors, licences for foreign-person access if required"}'),
('legal.programs','Anti-bribery policy','To draft','{"program":"Anti-bribery (FCPA / UAE)","jurisdiction":"US + UAE","elements":"Gifts and hospitality, agents and distributors due diligence, government officials, books and records"}'),
('legal.programs','Privacy & data protection policy','To draft','{"program":"Privacy & data protection","jurisdiction":"US + UAE","elements":"Video and audio data, retention, notices and signage, transfers, processor contracts"}'),
('legal.programs','Information security policy','To draft','{"program":"Information security","jurisdiction":"US + UAE","elements":"Access control, MFA, encryption, backups, patching, incident response for AGRON 1 and company systems"}'),
('legal.programs','Records retention policy','To draft','{"program":"Records retention","jurisdiction":"US + UAE","elements":"Export 5 years, tax, corporate, contracts, video data limits"}'),
('legal.programs','Code of conduct','To draft','{"program":"Code of conduct","jurisdiction":"US + UAE"}'),
('legal.programs','Open-source policy','To draft','{"program":"Open-source policy","jurisdiction":"US","elements":"Approved licences, copyleft review, attribution, inventory in Patents, software & licences"}'),
('legal.regulators','Census Bureau — AES / EEI','Reference','{"jurisdiction":"US","role":"Export filing (EEI) under the Foreign Trade Regulations","website":"https://www.census.gov/foreign-trade"}'),
('legal.regulators','FDA CDRH — laser products','Reference','{"jurisdiction":"US","role":"Laser product performance standard and product reports (21 CFR 1040)","website":"https://www.fda.gov/radiation-emitting-products"}'),
('legal.regulators','NTIA','Reference','{"jurisdiction":"US","role":"Federal spectrum management","website":"https://www.ntia.gov"}'),
('legal.regulators','USPTO','Reference','{"jurisdiction":"US","role":"Trademarks","website":"https://www.uspto.gov"}'),
('legal.regulators','IRS','Reference','{"jurisdiction":"US","role":"Federal tax","website":"https://www.irs.gov"}'),
('legal.regulators','Delaware Division of Corporations','Reference','{"jurisdiction":"US","role":"Corporate filings, franchise tax","website":"https://corp.delaware.gov"}'),
('legal.regulators','OSHA','Reference','{"jurisdiction":"US","role":"Workplace safety","website":"https://www.osha.gov"}'),
('legal.regulators','ICP — Federal Authority for Identity, Citizenship, Customs & Port Security','Reference','{"jurisdiction":"UAE","role":"Federal customs policy and ports","website":"https://icp.gov.ae"}'),
('legal.regulators','Ministry of Economy','Reference','{"jurisdiction":"UAE","role":"Commercial companies, trademarks, foreign investment","website":"https://www.moec.gov.ae"}'),
('legal.regulators','Ministry of Industry and Advanced Technology','Reference','{"jurisdiction":"UAE","role":"Product conformity and standards","website":"https://moiat.gov.ae"}'),
('legal.regulators','Federal Tax Authority','Reference','{"jurisdiction":"UAE","role":"VAT and corporate tax","website":"https://tax.gov.ae"}'),
('legal.regulators','UAE Data Office','Reference','{"jurisdiction":"UAE","role":"Personal data protection (PDPL)"}'),
('legal.regulators','Abu Dhabi Department of Economic Development','Reference','{"jurisdiction":"UAE","role":"Mainland trade licences in Abu Dhabi","website":"https://added.gov.ae"}'),
('legal.regulators','Dubai Civil Aviation Authority','Reference','{"jurisdiction":"UAE","role":"UAV operations in Dubai","website":"https://www.dcaa.gov.ae"}'),
('legal.regulators','Civil Defence (UAE)','Reference','{"jurisdiction":"UAE","role":"Fire and life safety approvals"}'),
('legal.regulators','Environment Agency – Abu Dhabi','Reference','{"jurisdiction":"UAE","role":"Environmental permits in Abu Dhabi","website":"https://www.ead.gov.ae"}'),
('legal.regulators','ADGM / DIFC','Reference','{"jurisdiction":"UAE","role":"Financial free zones: own company and data protection laws, courts"}')
) v(s,t,st,d)
where not exists (select 1 from public.records r where r.section = v.s and r.title = v.t);
alter table public.records enable trigger records_log;
select section, count(*) from public.records where section like 'legal.%' group by 1 order by 1;
