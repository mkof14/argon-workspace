// AGRON document templates: fill a short form, get a complete, ready-to-use document.
// Documents are in English (the working language with counsel, banks, vendors and authorities); the form is EN/RU.
// {{key}} = form field, {{today}} = today's date. `save` creates a record in the matching section.
// Legal documents are complete drafts that licensed counsel reviews before signature.
import type { T2 } from "./learn";

export type TplField = { key: string; label: T2; type?: "text" | "long" | "date" | "number" | "select"; options?: string[]; def?: string; req?: boolean; group?: T2 };
export type Tpl = {
  id: string; dept: string; icon: string; name: T2; desc: T2; counsel?: boolean; fields: TplField[]; body: string;
  save?: { section: string; title: string; status: string; data: Record<string, string> };
};

const F = (key: string, en: string, ru: string, type: TplField["type"] = "text", extra: Partial<TplField> = {}): TplField => ({ key, label: { en, ru }, type, ...extra });
const ENTITY = F("entity", "Company", "Компания", "select", { options: ["AGRON Inc., a Delaware corporation", "AGRON UAE"], def: "AGRON Inc., a Delaware corporation" });
const ADDRESS = F("address", "Company address", "Адрес компании", "text", { def: "[registered office address]" });
const DATE = F("date", "Date", "Дата", "date", { req: true });
const SIGNER = F("signer", "Signs for AGRON (name)", "Подписывает от AGRON (имя)", "text", { def: "Michael Kofman" });
const SIGNER_T = F("signer_title", "Title", "Должность", "text", { def: "Chief Executive Officer" });
const LAW = F("law", "Governing law", "Применимое право", "select", { options: ["the State of Delaware", "the State of New York", "the State of North Carolina", "the Dubai International Financial Centre (DIFC)", "the Abu Dhabi Global Market (ADGM)"], def: "the State of Delaware" });
const CONFIG = (def = "C20 Enhanced") => F("config", "StarDome configuration", "Конфигурация StarDome", "select", { options: ["C20 Base", "C20 Enhanced", "C40 Base", "C40 Advanced", "C40 HQ", "Sprinter", "Custom"], def });
const CUR = F("currency", "Currency", "Валюта", "select", { options: ["USD", "AED", "EUR"], def: "USD" });
const COUNSEL_NOTE = "\n\n---\n*Prepared in AGRON Workspace on {{today}}. Draft for review by licensed counsel before signature; not legal advice.*";
const SIG2 = (left: string, right: string) => `\n\n| ${left} | ${right} |\n|---|---|\n| By: ______________________ | By: ______________________ |\n| Name: | Name: |\n| Title: | Title: |\n| Date: | Date: |`;

export const TEMPLATES: Tpl[] = [
  /* =========================== Board & governance =========================== */
  { id: "board_notice", dept: "legal", icon: "calendar", counsel: true,
    name: { en: "Notice of board meeting", ru: "Уведомление о заседании совета" },
    desc: { en: "Formal notice with agenda, remote participation, materials and waiver form.", ru: "Официальное уведомление: повестка, участие онлайн, материалы, форма отказа от уведомления." },
    fields: [ENTITY, F("kind", "Meeting", "Заседание", "select", { options: ["Regular", "Special"], def: "Regular" }), F("due", "Meeting date", "Дата заседания", "date", { req: true }), F("time", "Time and time zone", "Время и часовой пояс", "text", { def: "10:00 a.m. Eastern Time" }), F("place", "Place", "Место", "text", { def: "the Company's offices" }), F("video", "Video link", "Ссылка на видеосвязь"), F("agenda", "Agenda (one item per line)", "Повестка (пункт на строку)", "long", { req: true, def: "Approval of the minutes of the previous meeting\nCEO report: StarDome pilot, pipeline and builds\nFinancial report and budget\nLegal and compliance report: export classification, UAE entity, trademark\nOther business" }), F("called_by", "Called by", "Созвал", "text", { def: "the Chair of the Board" }), F("secretary", "Secretary", "Секретарь", "text", { req: true })],
    body: `# Notice of {{kind}} Meeting of the Board of Directors

**{{entity}}** (the "Company")

**Date of notice:** {{today}}
**To:** Each member of the Board of Directors

NOTICE IS HEREBY GIVEN, pursuant to the Bylaws of the Company and the Delaware General Corporation Law ("DGCL"), that a {{kind}} meeting of the Board of Directors of the Company (the "Board") has been called by {{called_by}} and will be held as follows:

| | |
|---|---|
| **Date** | {{due}} |
| **Time** | {{time}} |
| **Place** | {{place}} |
| **Remote participation** | {{video}} |

## 1. Agenda
{{agenda}}

## 2. Remote participation
Pursuant to Section 141(i) of the DGCL, directors may participate in the meeting by conference telephone or other communications equipment by means of which all persons participating in the meeting can hear each other, and such participation shall constitute presence in person at the meeting.

## 3. Quorum and voting
A majority of the total number of directors constitutes a quorum for the transaction of business. Unless the Certificate of Incorporation or Bylaws require otherwise, the vote of a majority of the directors present at a meeting at which a quorum is present is the act of the Board.

## 4. Materials
Board materials, including draft resolutions and financial statements, will be circulated no later than two (2) business days before the meeting. Materials marked "Controlled" may contain technical data subject to U.S. export control laws and must not be shared with any foreign person without prior clearance from the Company.

## 5. Attendance and waiver
Please confirm your attendance to the Secretary. A director who cannot attend may sign the waiver below; attendance at the meeting also constitutes a waiver of notice, except where a director attends for the express purpose of objecting to the transaction of business because the meeting was not lawfully called or convened.

Sincerely,

______________________
{{secretary}}, Secretary
{{entity}}

---

### Waiver of notice

The undersigned director of {{entity}} hereby waives notice of the time, place and purposes of the {{kind}} meeting of the Board of Directors held on {{due}}, and consents to the transaction of any business that may come before the meeting.

Director: ______________________  Date: __________${COUNSEL_NOTE}`,
    save: { section: "legal.board", title: "{{kind}} board meeting · {{due}}", status: "Notice sent", data: { kind: "{{kind}} board meeting", due: "{{due}}", place: "{{place}} {{video}}", agenda: "{{agenda}}", secretary: "{{secretary}}" } } },

  { id: "board_minutes", dept: "legal", icon: "file", counsel: true,
    name: { en: "Minutes of board meeting", ru: "Протокол заседания совета" },
    desc: { en: "Complete minutes: attendance, quorum, reports, resolutions with votes, action items.", ru: "Полный протокол: присутствие, кворум, доклады, решения с голосованием, поручения." },
    fields: [ENTITY, F("kind", "Meeting", "Заседание", "select", { options: ["Regular", "Special"], def: "Regular" }), F("due", "Meeting date", "Дата заседания", "date", { req: true }), F("time", "Called to order at", "Начало", "text", { def: "10:00 a.m. ET" }), F("end", "Adjourned at", "Окончание", "text", { def: "11:30 a.m. ET" }), F("place", "Place / video", "Место / видеосвязь", "text", { def: "by videoconference" }), F("chair", "Chair", "Председатель", "text", { def: "Michael Kofman" }), F("secretary", "Secretary", "Секретарь", "text", { req: true }), F("attendees", "Directors present (one per line)", "Присутствующие директора", "long", { req: true, def: "Michael Kofman" }), F("absent", "Directors absent", "Отсутствующие директора", "text", { def: "None" }), F("others", "Also present (by invitation)", "Также присутствовали", "long"), F("reports", "Reports presented (CEO, finance, legal)", "Доклады (CEO, финансы, юристы)", "long", { def: "CEO report: status of the StarDome pilot, sales pipeline and container builds.\nFinance report: cash position, budget versus actual, runway.\nLegal and compliance report: export classification of AGRON 1, UAE entity options, AGRON trademark filings." }), F("resolutions", "Resolutions adopted (text of each)", "Принятые решения (текст)", "long", { req: true }), F("vote", "Vote", "Голосование", "text", { def: "unanimously, all directors present voting in favor" }), F("actions", "Action items (who — what — by when)", "Поручения (кто — что — срок)", "long")],
    body: `# Minutes of the {{kind}} Meeting of the Board of Directors

**{{entity}}** (the "Company")

| | |
|---|---|
| **Date** | {{due}} |
| **Place** | {{place}} |
| **Chair** | {{chair}} |
| **Secretary** | {{secretary}} |

**Directors present:**
{{attendees}}

**Directors absent:** {{absent}}

**Also present by invitation:**
{{others}}

## 1. Call to order
The meeting was called to order at {{time}} by {{chair}}, who acted as Chair. {{secretary}} acted as Secretary of the meeting and recorded the minutes.

## 2. Notice and quorum
The Secretary confirmed that notice of the meeting was duly given in accordance with the Bylaws, or that notice was waived by each director not present at the time the meeting was called to order, and that a quorum of the Board was present throughout the meeting. Directors participating remotely could hear and be heard by all participants.

## 3. Approval of prior minutes
The minutes of the previous meeting of the Board, as circulated, were approved without amendment.

## 4. Reports
{{reports}}

Discussion followed. Questions from directors were answered by management.

## 5. Resolutions
Upon motion duly made and seconded, the following resolutions were adopted {{vote}}:

{{resolutions}}

**General authority.** RESOLVED FURTHER, that the officers of the Company are, and each of them hereby is, authorized and directed to take all such further actions, and to execute and deliver all such further agreements, instruments and documents, in the name and on behalf of the Company, as they deem necessary or advisable to carry out the purposes of the foregoing resolutions; and that all actions previously taken by any officer or director in connection with the matters contemplated by the foregoing resolutions are hereby ratified, confirmed and approved in all respects.

## 6. Action items
{{actions}}

## 7. Conflicts of interest
The Chair asked whether any director had a personal interest in any matter considered at the meeting. No interests were declared, except as recorded above.

## 8. Adjournment
There being no further business to come before the meeting, upon motion duly made and seconded, the meeting was adjourned at {{end}}.

Respectfully submitted,

______________________
{{secretary}}, Secretary of the Meeting

Approved:

______________________
{{chair}}, Chair${COUNSEL_NOTE}`,
    save: { section: "legal.board", title: "Board meeting · {{due}}", status: "Minutes drafted", data: { kind: "{{kind}} board meeting", due: "{{due}}", place: "{{place}}", attendees: "{{attendees}}", resolutions: "{{resolutions}}", actions: "{{actions}}", secretary: "{{secretary}}", quorum: "true" } } },

  { id: "written_consent", dept: "legal", icon: "stamp", counsel: true,
    name: { en: "Unanimous written consent of the board", ru: "Единогласное письменное согласие совета" },
    desc: { en: "Board decisions without a meeting under DGCL §141(f), with recitals and signature table.", ru: "Решения совета без заседания по DGCL §141(f): обоснование и таблица подписей." },
    fields: [ENTITY, DATE, F("subject", "Subject", "Предмет", "text", { req: true }), F("whereas", "Background (each WHEREAS on its own line)", "Обоснование (каждое WHEREAS с новой строки)", "long", { req: true }), F("resolved", "Resolutions (each RESOLVED on its own line)", "Решения (каждое RESOLVED с новой строки)", "long", { req: true }), F("directors", "Directors (one per line)", "Директора (по строке)", "long", { req: true, def: "Michael Kofman" })],
    body: `# Action by Unanimous Written Consent of the Board of Directors

**{{entity}}** (the "Company")

**Subject:** {{subject}}
**Effective date:** {{date}}

The undersigned, being all of the members of the Board of Directors of the Company (the "Board"), acting pursuant to Section 141(f) of the General Corporation Law of the State of Delaware and the Bylaws of the Company, hereby waive any and all requirements of notice and hereby adopt the following resolutions by unanimous written consent, with the same force and effect as if such resolutions had been duly adopted at a meeting of the Board duly called and held at which all directors were present and voting.

## Recitals

WHEREAS:
{{whereas}}

## Resolutions

NOW, THEREFORE, BE IT RESOLVED:
{{resolved}}

## General authority
RESOLVED FURTHER, that the officers of the Company are, and each of them hereby is, authorized and directed, in the name and on behalf of the Company, to take or cause to be taken any and all such further actions, to execute and deliver all such further agreements, certificates, instruments and documents, to make all such filings and to pay all such fees and expenses as in their judgment shall be necessary, appropriate or advisable to carry out fully the intent and accomplish the purposes of the foregoing resolutions; and

RESOLVED FURTHER, that any and all actions heretofore taken by any director, officer or agent of the Company in connection with the matters contemplated by the foregoing resolutions are hereby ratified, confirmed and approved in all respects.

## Execution
This Written Consent may be executed in one or more counterparts, including by electronic signature (including DocuSign or a similar service) and by PDF, each of which shall be deemed an original and all of which together shall constitute one and the same instrument. This Written Consent shall be effective as of the effective date above when signed by all directors, and shall be filed with the minutes of the proceedings of the Board.

| Director | Signature | Date |
|---|---|---|
| {{directors}} | ______________________ | __________ |${COUNSEL_NOTE}`,
    save: { section: "legal.governance", title: "Board consent · {{subject}}", status: "Draft", data: { type: "Board consent", date: "{{date}}", summary: "{{resolved}}" } } },

  { id: "officer_appointment", dept: "legal", icon: "userplus", counsel: true,
    name: { en: "Election of officers and signing authority", ru: "Назначение должностных лиц и право подписи" },
    desc: { en: "Board consent electing officers, setting their authority and bank signatories.", ru: "Согласие совета: назначение должностных лиц, их полномочия и подписанты в банке." },
    fields: [ENTITY, DATE, F("officers", "Officers (Name — Title, one per line)", "Должностные лица (Имя — должность, по строке)", "long", { req: true, def: "Michael Kofman — Chief Executive Officer and President\n[Name] — Secretary\n[Name] — Treasurer" }), F("bank", "Bank", "Банк", "text", { def: "[Bank name]" }), F("signatories", "Bank signatories", "Подписанты в банке", "text", { def: "the Chief Executive Officer" }), F("limit", "Contract limit without board approval, USD", "Лимит договора без совета, USD", "number", { def: "100000" }), F("directors", "Directors (one per line)", "Директора (по строке)", "long", { req: true, def: "Michael Kofman" })],
    body: `# Action by Unanimous Written Consent of the Board of Directors — Election of Officers and Signing Authority

**{{entity}}** (the "Company")
**Effective date:** {{date}}

The undersigned, being all of the directors of the Company, acting by unanimous written consent pursuant to Section 141(f) of the Delaware General Corporation Law, hereby adopt the following resolutions:

## 1. Election of officers
RESOLVED, that each of the following persons is hereby elected to the office or offices of the Company set forth opposite his or her name, to serve at the pleasure of the Board until his or her successor is duly elected and qualified, or until his or her earlier death, resignation or removal:

{{officers}}

## 2. Powers and duties
RESOLVED FURTHER, that each officer shall have the powers and perform the duties customarily associated with such office and as set forth in the Bylaws, subject to the direction of the Board.

## 3. Signing authority
RESOLVED FURTHER, that the Chief Executive Officer is authorized to execute, in the name and on behalf of the Company, contracts, purchase orders, proposals and other instruments in the ordinary course of business with a value of up to USD {{limit}} per transaction; transactions above that amount, any borrowing, any guarantee, any grant of security interests, any issuance of equity, and any transaction with a director or officer require prior approval of the Board.

## 4. Bank accounts
RESOLVED FURTHER, that the Company is authorized to open and maintain deposit and operating accounts with {{bank}}; that {{signatories}} is designated as authorized signatory on such accounts; and that the standard form of banking resolutions required by such bank is hereby adopted and incorporated by reference.

## 5. Export-control access
RESOLVED FURTHER, that no officer shall release or give access to technical data or source code that may be controlled under the Export Administration Regulations or the International Traffic in Arms Regulations to any foreign person except in compliance with the Company's Technology Control Plan and applicable law.

## 6. General authority
RESOLVED FURTHER, that the officers of the Company are authorized to take all actions and to sign all documents necessary or advisable to carry out the foregoing resolutions.

This consent may be signed in counterparts and electronically and shall be filed with the minutes of the Board.

| Director | Signature | Date |
|---|---|---|
| {{directors}} | ______________________ | __________ |${COUNSEL_NOTE}`,
    save: { section: "legal.governance", title: "Officers and signing authority · {{date}}", status: "Draft", data: { type: "Officer appointment", date: "{{date}}", summary: "{{officers}}" } } },

  { id: "stockholder_consent", dept: "legal", icon: "users", counsel: true,
    name: { en: "Stockholder written consent", ru: "Письменное согласие акционеров" },
    desc: { en: "Stockholder approval without a meeting under DGCL §228, with notice to non-consenting holders.", ru: "Решение акционеров без собрания по DGCL §228 с уведомлением несогласных." },
    fields: [ENTITY, DATE, F("subject", "Subject", "Предмет", "text", { req: true }), F("resolved", "Resolutions (each on its own line)", "Решения (каждое с новой строки)", "long", { req: true }), F("holders", "Stockholders signing (Name — number and class of shares)", "Подписывающие акционеры (Имя — количество и класс акций)", "long", { req: true }), F("outstanding", "Total shares outstanding and entitled to vote", "Всего голосующих акций в обращении", "number")],
    body: `# Action by Written Consent of the Stockholders

**{{entity}}** (the "Company")
**Effective date:** {{date}}
**Subject:** {{subject}}

The undersigned stockholders of the Company, holding of record shares of the Company's capital stock having not less than the minimum number of votes that would be necessary to authorize or take the following actions at a meeting at which all shares entitled to vote thereon were present and voted, acting pursuant to Section 228 of the General Corporation Law of the State of Delaware and the Bylaws of the Company, hereby consent to, approve and adopt the following resolutions:

## Resolutions
{{resolved}}

RESOLVED FURTHER, that the officers of the Company are authorized and directed to take all actions and to execute all documents necessary or advisable to carry out the foregoing resolutions.

## Shares outstanding
Total shares outstanding and entitled to vote on the date of this consent: {{outstanding}}.

## Notice to non-consenting stockholders
In accordance with Section 228(e) of the DGCL, prompt notice of the taking of this corporate action without a meeting by less than unanimous written consent shall be given to those stockholders who have not consented in writing and who, if the action had been taken at a meeting, would have been entitled to notice of the meeting if the record date for notice of such meeting had been the date that written consents signed by a sufficient number of holders were delivered to the Company.

## Execution
This consent may be executed in counterparts and delivered by electronic transmission, each of which shall be deemed an original. Each signature shall be dated, and this consent shall be effective upon delivery to the Company of signed consents of holders of the requisite number of shares within sixty (60) days of the earliest dated consent.

| Stockholder (shares, class) | Signature | Date |
|---|---|---|
| {{holders}} | ______________________ | __________ |${COUNSEL_NOTE}`,
    save: { section: "legal.governance", title: "Stockholder consent · {{subject}}", status: "Draft", data: { type: "Shareholder consent", date: "{{date}}", summary: "{{resolved}}" } } },

  { id: "poa", dept: "legal", icon: "key", counsel: true,
    name: { en: "Limited power of attorney", ru: "Ограниченная доверенность" },
    desc: { en: "Specific authority for one matter, with limits, third-party reliance, revocation and notary block.", ru: "Полномочия на конкретный вопрос: лимиты, доверие третьих лиц, отзыв, нотариальный блок." },
    fields: [ENTITY, ADDRESS, DATE, F("holder", "Attorney-in-fact (full name)", "Представитель (ФИО)", "text", { req: true }), F("holder_id", "Passport / ID number and country", "Паспорт / ID и страна"), F("holder_addr", "Attorney's address", "Адрес представителя"), F("scope", "Powers granted (one per line, exactly what may be done)", "Полномочия (по строке, что именно можно делать)", "long", { req: true, def: "Represent the Company before [authority] in connection with [matter]\nSign and submit application forms and supporting documents for [permit / registration]\nReceive correspondence, certificates and approvals issued in that matter" }), F("limit", "Monetary limit", "Денежный лимит", "text", { def: "No authority to commit the Company to any payment above USD 5,000" }), F("expires", "Valid until", "Действует до", "date", { req: true }), F("country", "Country of use", "Страна использования", "text", { def: "United Arab Emirates" }), SIGNER, SIGNER_T],
    body: `# Limited Power of Attorney

**KNOW ALL PERSONS BY THESE PRESENTS** that **{{entity}}**, having its registered office at {{address}} (the "Company"), acting through its duly authorized officer {{signer}}, {{signer_title}}, hereby appoints:

**{{holder}}**, holder of passport / identification no. {{holder_id}}, residing at {{holder_addr}} (the "Attorney"),

as its true and lawful attorney-in-fact, to act in the name and on behalf of the Company solely for the purposes set out below.

## 1. Powers granted
The Attorney is authorized only to:
{{scope}}

## 2. Limitations
2.1 {{limit}}.
2.2 The Attorney shall not, under this power of attorney: borrow money or grant any security interest; sell, lease or encumber any asset of the Company; settle, compromise or waive any claim; sign any contract on behalf of the Company except as expressly listed in Section 1; open or operate bank accounts; or appoint a substitute or delegate any authority.
2.3 The Attorney shall comply with all applicable laws, including export control and sanctions laws, and shall not provide any technical data of the Company to any third party without the Company's prior written consent.

## 3. Term and revocation
This power of attorney is effective from {{date}} and shall automatically expire on **{{expires}}**, unless revoked earlier. The Company may revoke it at any time by written notice to the Attorney. Revocation shall be effective against a third party upon that third party's receipt of written notice of revocation.

## 4. Reliance by third parties
Any third party may rely on this power of attorney until it receives written notice of its expiry or revocation. The Company ratifies and confirms all acts lawfully done by the Attorney within the scope and limits of this power of attorney.

## 5. Duties of the Attorney
The Attorney shall act in good faith and in the best interests of the Company, keep the Company informed of all actions taken, and return all original documents to the Company upon completion of the matter or upon expiry or revocation.

## 6. Governing law
This power of attorney is governed by the laws of the place where it is used ({{country}}), and otherwise by the laws of the State of Delaware.

IN WITNESS WHEREOF, the Company has caused this power of attorney to be executed by its duly authorized officer on {{date}}.

**{{entity}}**

By: ______________________
Name: {{signer}}
Title: {{signer_title}}

Accepted by the Attorney: ______________________ {{holder}}

---

### Notarial acknowledgment
State / Country of ____________ )
County / City of ____________ ) ss.

On ____________, before me, the undersigned notary public, personally appeared {{signer}}, proved to me on the basis of satisfactory evidence to be the person whose name is subscribed to the within instrument, and acknowledged that he/she executed the same in his/her authorized capacity on behalf of the Company.

______________________ Notary Public    My commission expires: __________

*For use in {{country}}: apostille or consular legalization and certified translation may be required.*${COUNSEL_NOTE}`,
    save: { section: "legal.authority", title: "POA · {{holder}}", status: "Draft", data: { holder: "{{holder}}", kind: "Power of attorney", scope: "{{scope}}", expires: "{{expires}}" } } },

  { id: "counsel_brief", dept: "legal", icon: "headset",
    name: { en: "Instruction to outside counsel", ru: "Задание внешнему юристу" },
    desc: { en: "Privileged instruction: facts, parties for conflict check, questions, deliverables, fees.", ru: "Конфиденциальное задание: факты, стороны для проверки конфликта, вопросы, результат, гонорар." },
    fields: [F("firm", "Law firm / counsel", "Юрфирма / юрист", "text", { req: true }), F("topic", "Matter", "Вопрос", "text", { req: true }), F("jurisdiction", "Jurisdiction", "Юрисдикция", "select", { options: ["United States", "United Arab Emirates", "United States and UAE", "Other"], def: "United States and UAE" }), F("parties", "Parties involved (for conflict check)", "Участники (для проверки конфликта)", "long", { def: "AGRON Inc. (Delaware)\n[Counterparty / authority]" }), F("background", "Background (facts only)", "Контекст (только факты)", "long", { req: true }), F("questions", "Questions (one per line)", "Вопросы (по строке)", "long", { req: true }), F("docs", "Documents enclosed (one per line)", "Приложенные документы (по строке)", "long"), F("due", "Answer needed by", "Ответ нужен к", "date"), F("budget", "Fee cap / budget", "Лимит гонорара", "text", { def: "Fixed fee or cap to be agreed before work starts" }), F("contact", "AGRON contact", "Контакт в AGRON", "text", { def: "Michael Kofman, CEO, info@agron1.com" })],
    body: `**PRIVILEGED AND CONFIDENTIAL — ATTORNEY-CLIENT COMMUNICATION — PREPARED IN ANTICIPATION OF LEGAL ADVICE**

# Instruction to Outside Counsel

| | |
|---|---|
| **To** | {{firm}} |
| **From** | AGRON Inc. — {{contact}} |
| **Date** | {{today}} |
| **Matter** | {{topic}} |
| **Jurisdiction** | {{jurisdiction}} |
| **Response requested by** | {{due}} |

## 1. Conflict check
Please confirm that your firm has no conflict of interest in acting for AGRON Inc. in relation to the following persons:
{{parties}}

## 2. About AGRON
AGRON Inc. is a Delaware corporation that designs, assembles and supplies **StarDome** containerized security and monitoring systems and the **AGRON 1** monitoring and operator-assistance software for superyachts, marinas, ports, private islands, offshore and industrial sites and commercial vessels, including in the Gulf region. Systems are built to order and sold, leased or financed; the Company does not provide armed personnel. Assembly takes place in the United States or the UAE. Owners include a U.S. citizen and non-U.S. persons.

## 3. Background
{{background}}

## 4. Questions
{{questions}}

## 5. Documents enclosed
{{docs}}

## 6. Deliverables
For each question please provide:
1. A short answer (yes / no / it depends, and on what).
2. The applicable laws and regulations, with citations to the official sources.
3. Licences, registrations, filings or approvals required, with the competent authority, the applicant, the typical timeline and fees.
4. Key risks, including export control, sanctions, foreign-ownership and liability issues, and how to mitigate them.
5. Your recommended next step and any information you still need from us.

Please keep the advice concise; a memo of no more than five pages plus a summary table is preferred.

## 7. Scope and fees
Before starting work, please confirm the scope, the team, your estimated fees and the timeline in an engagement letter. Budget: {{budget}}. Please do not exceed the agreed amount without our prior written approval.

## 8. Confidentiality
This instruction and all related communications are confidential and are provided for the purpose of obtaining legal advice. Some enclosed materials may contain technical data subject to U.S. export controls; please do not share them with foreign persons without our prior written consent.

Thank you,
{{contact}}`,
    save: { section: "legal.requests", title: "Outside counsel · {{topic}}", status: "New", data: { request: "{{questions}}", due: "{{due}}", jurisdiction: "{{jurisdiction}}", priority: "Medium", owner: "{{contact}}" } } },

  { id: "nda", dept: "legal", icon: "lock", counsel: true,
    name: { en: "Mutual non-disclosure agreement", ru: "Взаимное соглашение о неразглашении (NDA)" },
    desc: { en: "Complete mutual NDA: definitions, use limits, export control, remedies, return, governing law.", ru: "Полное взаимное NDA: определения, ограничения, экспортный контроль, защита, возврат, право." },
    fields: [ENTITY, ADDRESS, DATE, F("counterparty", "Counterparty (legal name)", "Контрагент (юр. название)", "text", { req: true }), F("cp_type", "Counterparty is a", "Контрагент — это", "text", { def: "company organized under the laws of [country]" }), F("cp_address", "Counterparty address", "Адрес контрагента", "text", { req: true }), F("purpose", "Purpose", "Цель", "text", { def: "evaluating, negotiating and implementing a potential business relationship concerning StarDome security systems and related services" }), F("term", "Agreement term (years)", "Срок соглашения (лет)", "number", { def: "2" }), F("survival", "Confidentiality survives (years after end)", "Конфиденциальность сохраняется (лет)", "number", { def: "5" }), LAW, F("venue", "Courts / venue", "Суд / место споров", "text", { def: "the state and federal courts located in the State of Delaware" }), F("notice_agron", "Notices to AGRON (email)", "Уведомления AGRON (email)", "text", { def: "info@agron1.com" }), F("notice_cp", "Notices to counterparty (email)", "Уведомления контрагенту (email)"), SIGNER, SIGNER_T],
    body: `# Mutual Non-Disclosure Agreement

This Mutual Non-Disclosure Agreement (the "Agreement") is entered into as of **{{date}}** (the "Effective Date") by and between:

**{{entity}}**, with its principal office at {{address}} ("AGRON"); and

**{{counterparty}}**, a {{cp_type}}, with its principal office at {{cp_address}} (the "Counterparty").

AGRON and the Counterparty are each referred to as a "Party" and together as the "Parties". A Party disclosing Confidential Information is the "Disclosing Party" and a Party receiving it is the "Receiving Party".

## 1. Purpose
The Parties wish to exchange Confidential Information solely for the purpose of {{purpose}} (the "Purpose").

## 2. Confidential Information
2.1 "Confidential Information" means all non-public information disclosed by or on behalf of the Disclosing Party to the Receiving Party, before or after the Effective Date, in any form (written, electronic, oral, visual or by inspection), that is marked or identified as confidential or that a reasonable person would understand to be confidential given its nature and the circumstances of disclosure, including: technical data, designs, specifications, configurations, drawings, source and object code, algorithms, test results, equipment lists, supplier and pricing information, business plans, financial information, customer and site information, security assessments, vessel and site layouts, and the terms of this Agreement.
2.2 Information about a customer's site, vessel, security arrangements or personnel is Confidential Information whether or not marked.

## 3. Exclusions
Confidential Information does not include information that the Receiving Party can demonstrate by written records: (a) is or becomes publicly available through no breach of this Agreement; (b) was lawfully known to it without restriction before receipt from the Disclosing Party; (c) is lawfully received from a third party without a duty of confidentiality; or (d) is independently developed by it without use of or reference to the Disclosing Party's Confidential Information.

## 4. Obligations of the Receiving Party
The Receiving Party shall: (a) use Confidential Information only for the Purpose; (b) not disclose it to any third party except as permitted in Section 5; (c) protect it using at least the same degree of care it uses to protect its own confidential information of a similar nature, and in no event less than reasonable care; (d) not copy or reproduce it except as reasonably necessary for the Purpose; (e) not reverse engineer, decompile or disassemble any samples, prototypes, software or equipment provided; and (f) promptly notify the Disclosing Party in writing of any actual or suspected unauthorized use or disclosure.

## 5. Permitted disclosure
5.1 The Receiving Party may disclose Confidential Information to its and its affiliates' directors, officers, employees, professional advisers, financiers and contractors ("Representatives") who need to know it for the Purpose and who are bound by written or professional obligations of confidentiality no less protective than this Agreement. The Receiving Party is responsible for any breach by its Representatives.
5.2 If the Receiving Party is required by law, regulation or order of a competent court or authority to disclose Confidential Information, it shall (to the extent legally permitted) give the Disclosing Party prompt written notice, cooperate with any effort to obtain a protective order, and disclose only the minimum information legally required.

## 6. Export control and sanctions
6.1 Confidential Information, including technical data and software, may be subject to the U.S. Export Administration Regulations (EAR), the International Traffic in Arms Regulations (ITAR), U.S. sanctions administered by OFAC, and the export control and strategic goods laws of the United Arab Emirates and other countries.
6.2 The Receiving Party shall not export, re-export, transfer or release any Confidential Information, directly or indirectly, to any country, entity or person, or for any end use, prohibited under those laws, and shall not give access to technical data to any foreign person (as defined in the applicable regulations) without the Disclosing Party's prior written consent and any required government authorization.
6.3 Each Party represents that neither it nor any of its owners, directors or officers is a person listed on, or owned 50% or more by persons listed on, any U.S., United Nations, European Union, United Kingdom or UAE sanctions list.

## 7. No licence; no warranty
All Confidential Information remains the property of the Disclosing Party. No licence or other right under any patent, copyright, trade secret, trademark or other intellectual property is granted by this Agreement, except the limited right to use Confidential Information for the Purpose. CONFIDENTIAL INFORMATION IS PROVIDED "AS IS", WITHOUT ANY WARRANTY OF ANY KIND.

## 8. No obligation
Nothing in this Agreement obliges either Party to disclose any particular information, to proceed with any transaction, or to refrain from entering into discussions with third parties, provided that it does not use or disclose the other Party's Confidential Information.

## 9. Return and destruction
Upon the Disclosing Party's written request, or upon termination of this Agreement, the Receiving Party shall promptly return or destroy all Confidential Information and confirm destruction in writing, except that it may retain copies (a) required to be kept by law or regulation, or (b) in automatic electronic backups that are not readily accessible, in each case subject to continuing confidentiality.

## 10. Term
This Agreement takes effect on the Effective Date and continues for {{term}} years, unless terminated earlier by either Party on thirty (30) days' written notice. The obligations under Sections 4 to 7, 9 and 11 survive for {{survival}} years after expiry or termination, and indefinitely for trade secrets for so long as they remain trade secrets under applicable law.

## 11. Remedies
The Receiving Party acknowledges that unauthorized use or disclosure of Confidential Information may cause irreparable harm for which damages would not be an adequate remedy. The Disclosing Party is entitled to seek injunctive relief and specific performance, without the need to post a bond, in addition to any other remedies available at law or in equity.

## 12. Defend Trade Secrets Act notice
Pursuant to 18 U.S.C. § 1833(b), an individual shall not be held criminally or civilly liable under any federal or state trade secret law for the disclosure of a trade secret that is made in confidence to a government official or to an attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a complaint or other document filed under seal in a lawsuit or other proceeding.

## 13. Governing law and disputes
This Agreement is governed by the laws of {{law}}, without regard to its conflict-of-laws rules. Each Party submits to the exclusive jurisdiction of {{venue}}, provided that either Party may seek injunctive relief in any court of competent jurisdiction.

## 14. Notices
Notices under this Agreement shall be in writing and delivered by email with confirmation of receipt, by courier or by registered mail: to AGRON at {{notice_agron}}; to the Counterparty at {{notice_cp}}.

## 15. General
15.1 This Agreement is the entire agreement between the Parties regarding its subject matter and supersedes all prior understandings. 15.2 It may be amended only in writing signed by both Parties. 15.3 Neither Party may assign it without the other's prior written consent, except to a successor of all or substantially all of its business that agrees to be bound. 15.4 If any provision is held unenforceable, the remainder stays in effect. 15.5 No failure or delay in exercising a right is a waiver. 15.6 This Agreement may be signed in counterparts and electronically.

IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date.
${SIG2("**{{entity}}**", "**{{counterparty}}**")}${COUNSEL_NOTE}`,
    save: { section: "legal.contracts", title: "NDA · {{counterparty}}", status: "Drafting", data: { type: "NDA", counterparty: "{{counterparty}}", jurisdiction: "{{law}}", end_user_clause: "true" } } },

  { id: "end_user", dept: "legal", icon: "flag", counsel: true,
    name: { en: "End-user and end-use certificate", ru: "Сертификат конечного пользователя" },
    desc: { en: "Customer assurances on end use, no re-export, sanctions and post-shipment checks, on letterhead.", ru: "Гарантии клиента: назначение, запрет реэкспорта, санкции, проверка после поставки." },
    fields: [F("customer", "End user (legal name)", "Конечный пользователь (название)", "text", { req: true }), F("cust_addr", "End user address", "Адрес", "text", { req: true }), F("cust_reg", "Registration number", "Регистрационный номер"), F("country", "Country of end use", "Страна использования", "text", { req: true }), F("site", "Installation site / vessel (name, IMO, flag)", "Объект / судно (название, IMO, флаг)", "text", { req: true }), F("consignee", "Intermediate consignee (if any)", "Промежуточный грузополучатель (если есть)", "text", { def: "None" }), CONFIG("C20 Enhanced"), F("qty", "Quantity", "Количество", "number", { def: "1" }), F("contract", "Contract / PO reference", "Номер договора / заказа"), F("use", "Specific end use", "Конкретное назначение", "long", { def: "Passive detection, monitoring, recording and lawful communications for the physical security of the site / vessel named above. The system will not be used for jamming, interception of communications, or any offensive purpose." }), F("signer_name", "Signatory (name, title)", "Подписант (имя, должность)", "text", { req: true })],
    body: `*[To be printed on the end user's letterhead, signed by an authorized officer and stamped]*

# End-User and End-Use Certificate

**To:** AGRON Inc., Delaware, United States of America
**Date:** {{today}}
**Contract / order reference:** {{contract}}

## 1. End user
| | |
|---|---|
| **Legal name** | {{customer}} |
| **Address** | {{cust_addr}} |
| **Registration no.** | {{cust_reg}} |
| **Country of end use** | {{country}} |
| **Installation site / vessel** | {{site}} |
| **Intermediate consignee** | {{consignee}} |

## 2. Items
| Item | Quantity | Supplier |
|---|---|---|
| StarDome {{config}} containerized security and monitoring system, including AGRON 1 software, sensors and accessories as specified in the contract | {{qty}} | AGRON Inc. |

## 3. End use
{{use}}

## 4. Assurances
We, the undersigned end user, certify and undertake that:
1. We are the end user of the items, which will be installed and used only at the site / on the vessel stated above and only for the end use stated in Section 3.
2. The items will not be used, directly or indirectly, in connection with the design, development, production, stockpiling or use of nuclear, chemical or biological weapons or missiles capable of delivering such weapons.
3. The items will not be used for any military end use or by or for any military end user, nor for any purpose connected with human rights violations, unlawful surveillance or interception of communications.
4. The items, and any technical data or software provided with them, will not be resold, re-exported, transferred, leased, lent or otherwise disposed of to any other person, entity or country, or moved to another site or vessel, without the prior written consent of AGRON Inc. and any authorization required from the competent authorities of the United States, the United Arab Emirates and the country of origin.
5. Neither we nor our owners (direct or indirect, 50% or more), directors, officers, nor the vessel or its registered owner, manager or charterer, are listed on or owned or controlled by persons listed on any sanctions or restricted-party list of the United States (including the OFAC SDN List and the BIS Entity List), the United Nations, the European Union, the United Kingdom or the United Arab Emirates.
6. The items will not be used in, or delivered to, any comprehensively sanctioned country or territory.
7. We will inform AGRON Inc. promptly if any of the above information changes.
8. We will allow AGRON Inc. or the competent authorities, upon request, to carry out pre-licence and post-shipment verification of the location and use of the items.

We understand that the supply of the items depends on the accuracy of this certificate and that any export, import or operating licence may be suspended or revoked if it is untrue.

______________________
{{signer_name}}
for and on behalf of {{customer}}

Company stamp:${COUNSEL_NOTE}` },

  /* =========================== Executive =========================== */
  { id: "decision_memo", dept: "company", icon: "check",
    name: { en: "Decision memo", ru: "Записка для принятия решения" },
    desc: { en: "One page to decide: context, options compared, recommendation, impact, next steps.", ru: "Одна страница для решения: контекст, сравнение вариантов, рекомендация, влияние, шаги." },
    fields: [F("topic", "Decision needed", "Какое решение нужно", "text", { req: true }), F("owner", "Prepared by", "Подготовил", "text", { req: true }), F("due", "Decide by", "Решить до", "date"), F("context", "Context and why now", "Контекст и почему сейчас", "long", { req: true }), F("opt_a", "Option A (what, cost, risk)", "Вариант A (что, цена, риск)", "long", { req: true }), F("opt_b", "Option B (what, cost, risk)", "Вариант B (что, цена, риск)", "long", { req: true }), F("opt_c", "Option C (optional)", "Вариант C (необязательно)", "long", { def: "Do nothing: keep the current approach." }), F("recommendation", "Recommendation and why", "Рекомендация и почему", "long", { req: true }), F("impact", "Budget / cash impact", "Влияние на бюджет", "text"), F("compliance", "Legal / compliance check", "Юридическая проверка", "text", { def: "No export-control or sanctions issues identified; counsel review not required." }), F("next", "Next steps if approved", "Шаги после одобрения", "long")],
    body: `# Decision memo: {{topic}}

| | |
|---|---|
| **Prepared by** | {{owner}} |
| **Date** | {{today}} |
| **Decision needed by** | {{due}} |
| **Budget impact** | {{impact}} |

## 1. Context
{{context}}

## 2. Options
| | Description, cost and risk |
|---|---|
| **A** | {{opt_a}} |
| **B** | {{opt_b}} |
| **C** | {{opt_c}} |

## 3. Recommendation
{{recommendation}}

## 4. Legal and compliance
{{compliance}}

## 5. Next steps if approved
{{next}}

## 6. Decision
☐ Approved as recommended  ☐ Approved with changes  ☐ Rejected  ☐ More information needed

Comments: ________________________________________________

Decided by: ______________________  Date: __________`,
    save: { section: "company.decisions", title: "{{topic}}", status: "Proposed", data: { date: "{{due}}", decision: "{{recommendation}}", rationale: "{{context}}", owner: "{{owner}}" } } },

  { id: "ceo_weekly", dept: "company", icon: "trend",
    name: { en: "Weekly executive update", ru: "Еженедельный отчёт руководителя" },
    desc: { en: "Wins, numbers, risks, decisions needed and next week, read in five minutes.", ru: "Успехи, цифры, риски, нужные решения и план — читается за 5 минут." },
    fields: [F("week", "Week of", "Неделя", "date", { req: true }), F("headline", "Headline of the week", "Главное за неделю", "text", { req: true }), F("wins", "Wins (one per line)", "Успехи (по строке)", "long"), F("pipeline", "Open pipeline, USD", "Воронка, USD", "number"), F("orders", "New orders this week", "Новые заказы за неделю", "number"), F("builds", "Containers in build", "Контейнеры в сборке", "number"), F("cash", "Cash on hand, USD", "Деньги на счетах, USD", "number"), F("runway", "Runway, months", "Запас, месяцев", "number"), F("risks", "Risks and blockers (one per line)", "Риски и блокеры (по строке)", "long"), F("decisions", "Decisions needed from leadership", "Нужные решения руководства", "long"), F("next", "Focus next week", "Фокус следующей недели", "long")],
    body: `# AGRON weekly update — week of {{week}}

**{{headline}}**

## Key numbers
| Metric | Value |
|---|---|
| Open pipeline | USD {{pipeline}} |
| New orders this week | {{orders}} |
| Containers in build | {{builds}} |
| Cash on hand | USD {{cash}} |
| Runway | {{runway}} months |

## Wins
{{wins}}

## Risks and blockers
{{risks}}

## Decisions needed
{{decisions}}

## Focus next week
{{next}}

*Internal and confidential. Source: AGRON Workspace reports.*` },

  { id: "investor_update", dept: "finance", icon: "trend",
    name: { en: "Monthly investor update", ru: "Ежемесячный отчёт инвесторам" },
    desc: { en: "Highlights, KPI table, cash and runway, challenges, asks, with forward-looking disclaimer.", ru: "Главное, таблица KPI, деньги и запас, сложности, просьбы, оговорка о прогнозах." },
    fields: [F("month", "Month", "Месяц", "text", { req: true }), F("tldr", "Summary in one sentence", "Итог одним предложением", "text", { req: true }), F("highlights", "Highlights (one per line)", "Главное (по строке)", "long", { req: true }), F("revenue", "Revenue this month, USD", "Выручка за месяц, USD", "number"), F("pipeline", "Qualified pipeline, USD", "Квалифицированная воронка, USD", "number"), F("orders", "Signed orders (units)", "Подписанные заказы (шт.)", "number"), F("burn", "Net burn, USD", "Чистый расход, USD", "number"), F("cash", "Cash, USD", "Деньги, USD", "number"), F("runway", "Runway, months", "Запас, месяцев", "number"), F("lowlights", "Challenges and what we are doing", "Сложности и что делаем", "long"), F("asks", "How investors can help (one per line)", "Чем инвесторы могут помочь (по строке)", "long")],
    body: `# AGRON Inc. — Investor update, {{month}}

**In short:** {{tldr}}

## Highlights
{{highlights}}

## Key metrics
| Metric | {{month}} |
|---|---|
| Revenue | USD {{revenue}} |
| Qualified pipeline | USD {{pipeline}} |
| Signed orders | {{orders}} units |
| Net burn | USD {{burn}} |
| Cash at month end | USD {{cash}} |
| Runway | {{runway}} months |

## Challenges
{{lowlights}}

## Asks
{{asks}}

Thank you for your support. Questions are welcome at info@agron1.com.

Best regards,
AGRON Inc.

---
*Confidential — for the recipient investor only; please do not forward. This update contains forward-looking statements that reflect current expectations and involve risks and uncertainties; actual results may differ materially. Figures are unaudited.*` },

  { id: "meeting_agenda", dept: "company", icon: "calendar",
    name: { en: "Meeting agenda and notes", ru: "Повестка и протокол встречи" },
    desc: { en: "Timed agenda before, decisions and owned action items after.", ru: "Повестка с таймингом до встречи, решения и задачи с ответственными после." },
    fields: [DATE, F("title", "Meeting", "Встреча", "text", { req: true }), F("time", "Time and duration", "Время и длительность", "text", { def: "10:00–11:00 ET" }), F("participants", "Participants", "Участники", "text", { req: true }), F("goal", "Goal of the meeting", "Цель встречи", "text", { req: true }), F("agenda", "Agenda (item — owner — minutes, one per line)", "Повестка (пункт — кто — минуты, по строке)", "long", { req: true }), F("decisions", "Decisions made", "Принятые решения", "long"), F("actions", "Action items (who — what — by when)", "Задачи (кто — что — срок)", "long"), F("owner", "Organizer", "Организатор")],
    body: `# {{title}}

| | |
|---|---|
| **Date** | {{date}}, {{time}} |
| **Organizer** | {{owner}} |
| **Participants** | {{participants}} |
| **Goal** | {{goal}} |

## Agenda
{{agenda}}

## Decisions
{{decisions}}

## Action items
{{actions}}

*Notes circulated within 24 hours; corrections to the organizer.*`,
    save: { section: "company.meetings", title: "{{title}} · {{date}}", status: "Done", data: { date: "{{date}}", participants: "{{participants}}", agenda: "{{agenda}}", decisions: "{{decisions}}", actions: "{{actions}}", owner: "{{owner}}" } } },

  /* =========================== Finance =========================== */
  { id: "payment_request", dept: "finance", icon: "receipt",
    name: { en: "Payment request and approval", ru: "Заявка на оплату и согласование" },
    desc: { en: "Who, what, how much, budget line, bank details, checks and approval signatures.", ru: "Кому, за что, сколько, статья, реквизиты, проверки и подписи." },
    fields: [F("vendor", "Pay to (legal name)", "Получатель (юр. название)", "text", { req: true }), F("invoice", "Invoice number and date", "Номер и дата счёта"), F("amount", "Amount", "Сумма", "number", { req: true }), CUR, F("category", "Category", "Категория", "select", { options: ["Equipment", "Travel", "Software", "Services", "Marketing", "Legal", "Other"], def: "Services" }), F("budget_line", "Budget line / project", "Статья бюджета / проект"), F("purpose", "What it is for", "За что", "long", { req: true }), F("due", "Pay by", "Оплатить до", "date"), F("bank", "Beneficiary bank, account / IBAN, SWIFT", "Банк, счёт / IBAN, SWIFT", "long", { def: "As per the attached invoice (verify by phone before first payment)" }), F("requester", "Requested by", "Запросил", "text", { req: true })],
    body: `# Payment request

| | |
|---|---|
| **Request date** | {{today}} |
| **Requested by** | {{requester}} |
| **Pay to** | {{vendor}} |
| **Invoice** | {{invoice}} |
| **Amount** | **{{amount}} {{currency}}** |
| **Category / budget line** | {{category}} / {{budget_line}} |
| **Pay by** | {{due}} |

## Purpose
{{purpose}}

## Payment details
{{bank}}

## Pre-payment checks
- ☐ Invoice matches the purchase order / contract and goods or services were received
- ☐ Payee screened against sanctions lists (OFAC, UN, EU, UK, UAE) — result: ________
- ☐ Bank details verified by call-back to a known number (required for new payees and any change of details)
- ☐ Within approved budget; if not, budget variance approved
- ☐ Tax forms on file (W-9 / W-8BEN-E) where required

## Approvals
| Amount | Approver | Signature | Date |
|---|---|---|---|
| Up to USD 10,000 | Department head | ______________ | ________ |
| Above USD 10,000 | Chief Executive Officer | ______________ | ________ |

Paid on: __________  Reference: __________`,
    save: { section: "finance.expenses", title: "{{vendor}} · {{amount}} {{currency}}", status: "Submitted", data: { requester: "{{requester}}", category: "{{category}}", amount: "{{amount}}", currency: "{{currency}}", notes: "{{purpose}}" } } },

  /* =========================== Operations =========================== */
  { id: "purchase_order", dept: "operations", icon: "cart",
    name: { en: "Purchase order with terms", ru: "Заказ поставщику с условиями" },
    desc: { en: "PO with lines, delivery, inspection, warranty, export classification and standard terms.", ru: "Заказ: позиции, поставка, приёмка, гарантия, экспортная классификация и условия." },
    fields: [F("po", "PO number", "Номер заказа", "text", { req: true, def: "PO-2026-" }), F("vendor", "Vendor (legal name)", "Поставщик (юр. название)", "text", { req: true }), F("vendor_addr", "Vendor address and contact", "Адрес и контакт поставщика", "text"), F("item", "Item: manufacturer, model / part no.", "Позиция: производитель, модель / артикул", "text", { req: true }), F("spec", "Specification / quote reference", "Спецификация / номер КП", "text"), F("qty", "Quantity", "Количество", "number", { def: "1" }), F("unit", "Unit price", "Цена за единицу", "number", { req: true }), CUR, F("incoterms", "Delivery terms (Incoterms 2020)", "Условия поставки (Инкотермс 2020)", "select", { options: ["EXW", "FCA", "CPT", "CIP", "DAP", "DDP"], def: "DAP" }), F("ship_to", "Ship to", "Адрес доставки", "text", { req: true }), F("eta", "Required delivery date", "Требуемая дата поставки", "date", { req: true }), F("payment", "Payment terms", "Условия оплаты", "text", { def: "Net 30 days after receipt and acceptance" }), F("warranty", "Warranty", "Гарантия", "text", { def: "24 months from acceptance" }), F("build", "For build / project", "Для сборки / проекта"), SIGNER, SIGNER_T],
    body: `# Purchase Order {{po}}

| Buyer | Vendor |
|---|---|
| AGRON Inc., Delaware, USA · info@agron1.com | {{vendor}} · {{vendor_addr}} |

**PO date:** {{today}} · **Project:** {{build}} · **Delivery:** {{incoterms}} {{ship_to}} (Incoterms 2020) · **Required by:** {{eta}}

| # | Item | Specification | Qty | Unit price | Currency |
|---|---|---|---|---|---|
| 1 | {{item}} | {{spec}} | {{qty}} | {{unit}} | {{currency}} |

**Payment terms:** {{payment}} · **Warranty:** {{warranty}}

## Terms and conditions
1. **Acceptance.** This PO is accepted by the Vendor's written confirmation or by shipment, whichever is earlier. Only these terms apply; the Vendor's terms are excluded unless agreed in writing.
2. **Order confirmation.** Within three (3) business days the Vendor shall confirm price, delivery date and, for each item, the **export control classification** (ECCN, USML category or "EAR99"), the **HS code** and the **country of origin**.
3. **Delivery.** Time of delivery is of the essence. The Vendor shall notify AGRON immediately of any expected delay. Goods shall be packed for international transport and marked with the PO number. Title and risk pass per the Incoterm stated.
4. **Documents.** Each shipment shall include a commercial invoice, packing list, certificate of origin, datasheets, user manuals, firmware version, test or calibration certificates where applicable, and any declaration of conformity (FCC, CE, RoHS).
5. **Inspection and acceptance.** AGRON may inspect goods within fifteen (15) business days of receipt and reject non-conforming goods at the Vendor's cost. Payment does not constitute acceptance.
6. **Warranty.** The Vendor warrants that goods are new, free from defects in design, materials and workmanship, conform to the specification and are fit for marine and outdoor use where so specified, for the warranty period stated. Defective goods shall be repaired or replaced promptly at the Vendor's cost, including shipping.
7. **Export control and sanctions.** The Vendor shall comply with all applicable export control and sanctions laws, obtain any licence it requires to supply the goods, and inform AGRON in writing of any licence requirement or restriction affecting the goods. The Vendor represents that it is not a restricted or sanctioned party.
8. **Changes of design.** The Vendor shall not change the form, fit, function, firmware or components of the goods without AGRON's prior written consent.
9. **Intellectual property.** The Vendor warrants that the goods do not infringe third-party rights and shall indemnify AGRON against any such claim.
10. **Invoicing.** Invoices shall quote the PO number and be sent to info@agron1.com.
11. **Cancellation.** AGRON may cancel all or part of this PO for convenience before shipment, paying only the documented costs reasonably incurred, or at any time for the Vendor's material breach.
12. **Confidentiality.** Specifications, drawings and project information are AGRON's confidential information.
13. **Governing law.** This PO is governed by the laws of the State of Delaware and, where applicable, excludes the UN Convention on Contracts for the International Sale of Goods.

Authorized for AGRON Inc.: ______________________ {{signer}}, {{signer_title}}

Vendor acceptance: ______________________ Name / title / date`,
    save: { section: "operations.procurement", title: "{{po}} · {{item}}", status: "Draft", data: { vendor: "{{vendor}}", item: "{{item}}", qty: "{{qty}}", amount: "{{unit}}", currency: "{{currency}}", eta: "{{eta}}", build: "{{build}}" } } },

  { id: "acceptance", dept: "operations", icon: "anchor",
    name: { en: "Delivery and acceptance certificate", ru: "Акт сдачи-приёмки" },
    desc: { en: "StarDome handover: serials, tests, training, documents handed over, punch list, warranty start.", ru: "Передача StarDome: серийные номера, тесты, обучение, документы, замечания, начало гарантии." },
    fields: [F("client", "Client (legal name)", "Клиент (юр. название)", "text", { req: true }), F("contract", "Contract / PO reference", "Номер договора / заказа"), F("site", "Site / vessel", "Объект / судно", "text", { req: true }), CONFIG(), F("serials", "Serial numbers (container and main equipment)", "Серийные номера (контейнер и основное оборудование)", "long"), F("software", "AGRON 1 software version", "Версия ПО AGRON 1"), F("tests", "Site acceptance tests passed (one per line)", "Пройденные испытания (по строке)", "long", { def: "Power-up and UPS changeover\nRadar and camera alignment and coverage check\nAGRON 1 connectivity, user accounts and time sync\nAlarm chain from detection to operator notification\nRecording and playback\nRemote diagnostics link" }), F("trained", "Operators trained (names)", "Обучены операторы (имена)", "long"), F("punch", "Open items (punch list)", "Замечания (punch list)", "long", { def: "None" }), DATE, F("warranty", "Warranty period", "Гарантийный срок", "text", { def: "24 months" })],
    body: `# Delivery and Acceptance Certificate

| | |
|---|---|
| **Supplier** | AGRON Inc., Delaware, USA |
| **Client** | {{client}} |
| **Contract / PO** | {{contract}} |
| **Site / vessel** | {{site}} |
| **System** | StarDome {{config}} |
| **AGRON 1 version** | {{software}} |
| **Date of acceptance** | {{date}} |

## 1. Equipment delivered
{{serials}}

## 2. Site acceptance tests
The following tests were performed jointly by the Supplier and the Client and passed:
{{tests}}

## 3. Training
The following operators completed training on system operation, alarm handling and daily checks:
{{trained}}

## 4. Documentation handed over
☐ As-built drawings and cable schedule ☐ Operation and maintenance manual ☐ Spare parts list ☐ Test records ☐ User accounts and password handover (sealed) ☐ Warranty certificate ☐ Export / import documents copy

## 5. Open items
{{punch}}

Open items do not prevent acceptance and will be closed by the Supplier within thirty (30) days unless otherwise agreed.

## 6. Acceptance
The Client confirms that the system described above has been delivered, installed and tested and is accepted as of the date above. The warranty period of {{warranty}} starts on that date. Risk in the system has passed to the Client in accordance with the contract. The Client confirms that the system will be used only at the site / on the vessel stated above and in accordance with the end-user certificate.
${SIG2("**AGRON Inc.**", "**{{client}}**")}`,
    save: { section: "operations.installation", title: "Acceptance · {{site}}", status: "Commissioned", data: { site: "{{site}}", notes: "{{punch}}", due: "{{date}}" } } },

  /* =========================== Sales =========================== */
  { id: "proposal_cover", dept: "sales", icon: "file",
    name: { en: "Commercial proposal (cover letter)", ru: "Коммерческое предложение (письмо)" },
    desc: { en: "StarDome proposal letter: need, solution, scope, price, terms, validity, next steps.", ru: "Письмо-КП StarDome: задача, решение, объём, цена, условия, срок, шаги." },
    fields: [F("client", "Client (company)", "Клиент (компания)", "text", { req: true }), F("contact", "Contact person", "Контактное лицо", "text", { req: true }), F("site", "Site / vessel", "Объект / судно", "text", { req: true }), F("need", "Client's need in their words", "Задача клиента его словами", "long", { req: true }), CONFIG(), F("scope", "Scope included (one per line)", "Что входит (по строке)", "long", { def: "StarDome container with sensors and AGRON 1 software\nSite survey and system design\nDelivery to site, installation and commissioning\nOperator training (2 days)\n24-month warranty and remote support" }), F("value", "Total price", "Цена", "number", { req: true }), CUR, F("options", "Commercial options", "Коммерческие варианты", "text", { def: "Purchase, operating lease (36–60 months) or financing" }), F("lead", "Lead time", "Срок поставки", "text", { def: "12–16 weeks from order and approvals" }), F("valid", "Valid until", "Действует до", "date", { req: true }), F("sender", "From (name, title)", "От (имя, должность)", "text", { def: "Michael Kofman, Chief Executive Officer" })],
    body: `**AGRON Inc.** · info@agron1.com · agron1.com
{{today}}

**{{client}}**
Attn: {{contact}}

**Subject: Proposal — StarDome {{config}} for {{site}}**

Dear {{contact}},

Thank you for the opportunity to propose a security solution for {{site}}.

## Your need
{{need}}

## Our solution
We propose **StarDome {{config}}**: a self-contained security and monitoring unit that combines detection sensors, cameras, communications and the **AGRON 1** monitoring and operator-assistance software in one container. It is built to order, delivered ready to work and installed in days, with minimal construction at the site.

## Scope
{{scope}}

## Commercial terms
| | |
|---|---|
| **Total price** | {{value}} {{currency}} |
| **Options** | {{options}} |
| **Lead time** | {{lead}} |
| **Payment** | 40% on order, 50% before shipment, 10% on acceptance (for purchase) |
| **Validity** | until {{valid}} |

Prices exclude taxes, duties and site works unless stated. Delivery is subject to the applicable export, import and site approvals and to completion of our end-user and sanctions screening; our team will guide you through the documents required.

## Next steps
1. A 30-minute call to confirm requirements.
2. Site survey and final configuration.
3. Contract, end-user certificate and order.

We would be glad to walk you through the proposal at your convenience.

Best regards,

{{sender}}
AGRON Inc.`,
    save: { section: "sales.proposals", title: "{{client}} · StarDome {{config}}", status: "Draft", data: { client: "{{client}}", config: "{{config}}", value: "{{value}}", currency: "{{currency}}", valid_until: "{{valid}}" } } },

  { id: "call_report", dept: "sales", icon: "headset",
    name: { en: "Client meeting report", ru: "Отчёт о встрече с клиентом" },
    desc: { en: "Who, what they need, budget and timing, objections, next step, compliance flags.", ru: "Кто, что нужно, бюджет и сроки, возражения, следующий шаг, комплаенс." },
    fields: [F("client", "Client", "Клиент", "text", { req: true }), DATE, F("type", "Format", "Формат", "select", { options: ["Call", "Video call", "Meeting", "Demo", "Site visit"], def: "Call" }), F("people", "Their participants (name, role)", "Участники с их стороны (имя, роль)", "text"), F("outcome", "What we learned", "Что узнали", "long", { req: true }), F("budget", "Budget and decision process", "Бюджет и как принимают решение", "text"), F("timing", "Timing", "Сроки", "text"), F("objections", "Objections / concerns", "Возражения / сомнения", "long"), F("flags", "Compliance flags (country, vessel, owner, end use)", "Комплаенс (страна, судно, владелец, назначение)", "text", { def: "None noted; screening to be run before proposal" }), F("next_step", "Next step (who, when)", "Следующий шаг (кто, когда)", "text", { req: true }), F("owner", "AGRON owner", "Ответственный в AGRON", "text", { req: true })],
    body: `# Meeting report — {{client}}

| | |
|---|---|
| **Date / format** | {{date}} · {{type}} |
| **Their participants** | {{people}} |
| **AGRON owner** | {{owner}} |

## What we learned
{{outcome}}

## Budget and decision process
{{budget}}

## Timing
{{timing}}

## Objections and concerns
{{objections}}

## Compliance flags
{{flags}}

## Next step
**{{next_step}}**`,
    save: { section: "sales.activities", title: "{{type}} · {{client}}", status: "Done", data: { client: "{{client}}", type: "{{type}}", date: "{{date}}", outcome: "{{outcome}}", next_step: "{{next_step}}", owner: "{{owner}}" } } },

  /* =========================== HR =========================== */
  { id: "offer_letter", dept: "hr", icon: "userplus", counsel: true,
    name: { en: "Offer letter (US employee)", ru: "Оффер (сотрудник в США)" },
    desc: { en: "Full at-will offer: role, pay, benefits, PTO, equity, contingencies, export-control condition.", ru: "Полный оффер at-will: роль, оплата, льготы, отпуск, опционы, условия, экспортный контроль." },
    fields: [F("name", "Candidate full name", "Кандидат (ФИО)", "text", { req: true }), F("cand_addr", "Candidate address", "Адрес кандидата"), F("position", "Position", "Должность", "text", { req: true }), F("manager", "Reports to", "Руководитель", "text", { def: "Michael Kofman, Chief Executive Officer" }), F("location", "Work location", "Место работы", "text", { def: "Remote, based in North Carolina, with travel as required" }), F("start", "Start date", "Дата начала", "date", { req: true }), F("salary", "Annual base salary, USD", "Годовая зарплата, USD", "number", { req: true }), F("classification", "Classification", "Классификация", "select", { options: ["Full-time, exempt", "Full-time, non-exempt", "Part-time, non-exempt"], def: "Full-time, exempt" }), F("bonus", "Bonus", "Бонус", "text", { def: "Eligible for an annual discretionary bonus of up to 10% of base salary" }), F("equity", "Equity", "Опционы", "text", { def: "Subject to Board approval, an option to purchase [number] shares of common stock under the Company's equity plan, vesting over four years with a one-year cliff" }), F("pto", "Paid time off", "Оплачиваемый отпуск", "text", { def: "15 days per year plus Company holidays" }), F("expires", "Offer expires", "Оффер действует до", "date", { req: true }), SIGNER, SIGNER_T],
    body: `**AGRON Inc.**
{{today}}

{{name}}
{{cand_addr}}

**Re: Offer of employment**

Dear {{name}},

On behalf of AGRON Inc. (the "Company"), I am pleased to offer you employment on the terms below.

**1. Position.** You will be employed as **{{position}}**, reporting to {{manager}}. Your work location will be {{location}}. You will perform the duties customarily associated with this position and such other duties as the Company may assign.

**2. Start date.** Your employment will begin on **{{start}}**, or another date we agree in writing.

**3. Compensation.** You will receive an annual base salary of **USD {{salary}}**, paid in accordance with the Company's regular payroll practices and subject to required withholdings and deductions. This position is classified as {{classification}}. Your compensation will be reviewed periodically.

**4. Bonus.** {{bonus}}. Any bonus is determined by the Company in its sole discretion and requires that you be employed on the payment date.

**5. Equity.** {{equity}}. All equity awards are governed by the applicable plan and award agreement.

**6. Benefits.** You will be eligible to participate in the employee benefit plans the Company offers to similarly situated employees, subject to the terms of those plans, which the Company may amend from time to time. Paid time off: {{pto}}.

**7. At-will employment.** Your employment with the Company is "at will": either you or the Company may terminate it at any time, with or without cause or advance notice. This at-will relationship can be changed only by a written agreement signed by you and the Chief Executive Officer.

**8. Conditions of this offer.** This offer is contingent on:
(a) your signing the Company's Confidential Information and Invention Assignment Agreement before your start date;
(b) satisfactory completion of a background check, conducted in compliance with applicable law with your written authorization;
(c) proof of your identity and authorization to work in the United States, as required by the Immigration Reform and Control Act, within three (3) business days of your start date (Form I-9); and
(d) **export control:** because your role may involve access to technology, technical data or software controlled under the Export Administration Regulations or the International Traffic in Arms Regulations, the Company must confirm before access whether you are a U.S. person (U.S. citizen, lawful permanent resident, or protected individual) or whether an export authorization is required. If an authorization is required, access to controlled items will be deferred until it is obtained; your start date or duties may be adjusted accordingly.

**9. Company policies.** You agree to comply with the Company's policies, including its code of conduct, information security, export compliance, anti-bribery and sanctions policies.

**10. Prior obligations.** You confirm that you are not bound by any agreement that would prevent you from performing your duties, and you agree not to bring to the Company or use any confidential information of a former employer.

**11. Entire agreement.** This letter, together with the Confidential Information and Invention Assignment Agreement, is the entire agreement regarding your employment terms and supersedes any prior representations. This letter is governed by the laws of the State of North Carolina.

Please sign and return this letter by **{{expires}}**, after which this offer will lapse.

We are excited about the prospect of you joining AGRON.

Sincerely,

______________________
{{signer}}, {{signer_title}}
AGRON Inc.

**Acceptance**
I accept this offer of employment on the terms above.

______________________ {{name}}    Date: __________    Start date: __________${COUNSEL_NOTE}`,
    save: { section: "hr.hiring", title: "{{position}} · offer to {{name}}", status: "Offer", data: { owner: "{{manager}}", location: "{{location}}", notes: "Salary {{salary}} USD, start {{start}}, offer expires {{expires}}" } } },

  { id: "ciiaa", dept: "hr", icon: "lock", counsel: true,
    name: { en: "Confidentiality and invention assignment agreement", ru: "Соглашение о конфиденциальности и передаче прав" },
    desc: { en: "Employee CIIAA: confidentiality, assignment of inventions and code, export control, return of property.", ru: "Соглашение с сотрудником: конфиденциальность, передача прав на изобретения и код, экспортный контроль." },
    fields: [F("name", "Employee / contractor full name", "Сотрудник / подрядчик (ФИО)", "text", { req: true }), F("role", "Role", "Роль", "text"), DATE, F("prior", "Prior inventions excluded (or None)", "Исключённые ранее созданные разработки (или None)", "long", { def: "None" }), F("nonsolicit", "Non-solicitation period (months)", "Срок запрета переманивания (мес.)", "number", { def: "12" }), SIGNER, SIGNER_T],
    body: `# Confidential Information and Invention Assignment Agreement

This Agreement is made on {{date}} between **AGRON Inc.**, a Delaware corporation (the "Company"), and **{{name}}** ("I", "me"), in consideration of my employment or engagement as {{role}} and the compensation paid to me.

## 1. Confidential Information
1.1 I will hold in strict confidence and will not disclose or use, except as required for my work for the Company, any Confidential Information of the Company, during and after my employment or engagement.
1.2 "Confidential Information" means any non-public information of the Company or its customers, suppliers or partners, including technical data, designs, configurations of StarDome systems, the AGRON 1 software and its source code, algorithms, equipment lists, test results, customer and site information, security assessments, pricing, business plans and financial information.
1.3 I will not access or use controlled technical data unless I have been cleared to do so under the Company's Technology Control Plan.

## 2. Inventions
2.1 "Inventions" means all inventions, discoveries, designs, developments, software (including source and object code), documentation, improvements, works of authorship and know-how that I make, conceive or reduce to practice, alone or jointly, during my employment or engagement and that relate to the Company's business or result from my work for the Company or the use of its resources.
2.2 I hereby assign, and agree to assign, to the Company all my right, title and interest in and to all Inventions and all intellectual property rights in them worldwide. Works of authorship are "works made for hire" to the extent permitted by law.
2.3 I will promptly disclose all Inventions to the Company and, during and after my employment or engagement, sign all documents and do all things reasonably requested to perfect and enforce the Company's rights, at the Company's expense.
2.4 **Excluded inventions.** This Agreement does not apply to an invention that qualifies fully for protection under applicable state law (including N.C. Gen. Stat. § 66-57.1 and Cal. Labor Code § 2870, where applicable), namely one that I developed entirely on my own time without using the Company's equipment, supplies, facilities or trade secrets, and that does not relate to the Company's business or anticipated research or result from work I performed for the Company.
2.5 **Prior inventions** that I own and exclude from this Agreement: {{prior}}

## 3. Open-source and third-party materials
I will not incorporate any open-source or third-party code or materials into Company products without prior approval under the Company's open-source policy.

## 4. Export control
I understand that the Company's technology may be subject to U.S. export control and sanctions laws. I will not export, re-export or release any technology, technical data or software, including by giving access to a foreign person or by travelling abroad with it, except in compliance with those laws and the Company's instructions.

## 5. Return of property
When my employment or engagement ends, or earlier on request, I will return all Company property, documents, devices and data, and permanently delete Company information from personal devices and accounts, and will confirm this in writing.

## 6. Non-solicitation
For {{nonsolicit}} months after my employment or engagement ends, I will not, directly or indirectly, solicit any employee or contractor of the Company to leave the Company, to the extent permitted by applicable law.

## 7. Permitted disclosures
Nothing in this Agreement prohibits me from reporting possible violations of law to any government agency or from making other disclosures protected by whistleblower law. Under 18 U.S.C. § 1833(b), I will not be held liable under any trade secret law for disclosure of a trade secret made in confidence to a government official or an attorney solely for the purpose of reporting or investigating a suspected violation of law, or in a filing made under seal.

## 8. General
This Agreement does not create a right to continued employment; employment remains at will. It is governed by the laws of the State of North Carolina. If any provision is unenforceable, it shall be limited to the minimum extent necessary and the rest remains in effect. This Agreement survives the end of my employment or engagement and binds my heirs and successors.
${SIG2("**AGRON Inc.**", "**{{name}}**")}${COUNSEL_NOTE}` },

  { id: "onboarding", dept: "hr", icon: "rocket",
    name: { en: "Onboarding plan", ru: "План онбординга" },
    desc: { en: "Before day 1, week 1, first 30-60-90 days, with owners and compliance steps.", ru: "До первого дня, первая неделя, 30-60-90 дней — с ответственными и комплаенсом." },
    fields: [F("person", "New team member", "Новый сотрудник", "text", { req: true }), F("role", "Role", "Роль", "text", { req: true }), F("start", "Start date", "Дата начала", "date", { req: true }), F("manager", "Manager", "Руководитель", "text", { req: true }), F("buddy", "Buddy", "Наставник"), F("goals", "30-60-90 day goals", "Цели на 30-60-90 дней", "long", { def: "30 days: knows StarDome configurations and AGRON 1, completed all trainings\n60 days: owns first deliverable end to end\n90 days: fully independent in the role, agreed goals for the year" })],
    body: `# Onboarding plan — {{person}}

| | |
|---|---|
| **Role** | {{role}} |
| **Start date** | {{start}} |
| **Manager** | {{manager}} |
| **Buddy** | {{buddy}} |

## Before day 1 (HR and IT)
- ☐ Offer letter and Confidential Information and Invention Assignment Agreement signed
- ☐ Background check completed
- ☐ U.S.-person status confirmed or export authorization assessed before access to controlled data
- ☐ Google Workspace account; AGRON Workspace invite with the correct role
- ☐ Laptop and equipment issued, logged in "Company equipment issued"
- ☐ Payroll, tax forms (W-4 / state) and benefits enrollment pack sent

## Day 1
- ☐ Form I-9 section 1 (day 1) and section 2 (within 3 business days)
- ☐ Welcome by the manager: role, team, how we work, first week plan
- ☐ Security setup: password manager, two-factor authentication, device encryption

## Week 1
- ☐ Export control and sanctions briefing (mandatory)
- ☐ Information security and data protection rules
- ☐ Code of conduct, anti-bribery and whistleblowing policy
- ☐ Product introduction: StarDome configurations, AGRON 1, typical sites and vessels
- ☐ Meet key colleagues in operations, sales, legal and finance

## 30-60-90 day goals
{{goals}}

## Sign-off
Manager: ______________ Date: ______  Employee: ______________ Date: ______`,
    save: { section: "hr.onboarding", title: "Onboarding · {{person}}", status: "To do", data: { person: "{{person}}", checklist: "Offer + CIIAA · Background check · US-person check · Accounts · Equipment · I-9 · Security setup · Export briefing · Policies · Product intro" } } },

  { id: "job_description", dept: "hr", icon: "file",
    name: { en: "Job description", ru: "Описание вакансии" },
    desc: { en: "Role purpose, responsibilities, requirements, export-control note, compensation range, EEO statement.", ru: "Цель роли, обязанности, требования, экспортный контроль, вилка оплаты, EEO." },
    fields: [F("position", "Position", "Должность", "text", { req: true }), F("department", "Department", "Отдел", "text", { req: true }), F("manager", "Reports to", "Руководитель", "text", { def: "Chief Executive Officer" }), F("location", "Location", "Место работы", "text", { def: "Remote (US), travel to the UAE as required" }), F("type", "Employment type", "Тип занятости", "select", { options: ["Full-time", "Part-time", "Contract"], def: "Full-time" }), F("purpose", "Role purpose (2–3 sentences)", "Цель роли (2–3 предложения)", "long", { req: true }), F("duties", "Responsibilities (one per line)", "Обязанности (по строке)", "long", { req: true }), F("must", "Requirements (one per line)", "Требования (по строке)", "long", { req: true }), F("nice", "Nice to have (one per line)", "Будет плюсом (по строке)", "long"), F("range", "Salary range, USD", "Вилка, USD", "text", { def: "[min] – [max] per year, plus bonus and equity" }), F("us_person", "US-person requirement", "Требование US person", "select", { options: ["Required: access to export-controlled technology", "Preferred", "Not required"], def: "Required: access to export-controlled technology" })],
    body: `# {{position}}

| | |
|---|---|
| **Company** | AGRON Inc. |
| **Department** | {{department}} |
| **Reports to** | {{manager}} |
| **Location** | {{location}} |
| **Employment type** | {{type}} |
| **Compensation** | {{range}} |

## About AGRON
AGRON Inc. builds StarDome, containerized security and monitoring systems with the AGRON 1 operator-assistance software, for superyachts, marinas, ports, private islands, offshore and industrial sites and commercial vessels in the United States, the UAE and beyond.

## Role purpose
{{purpose}}

## Responsibilities
{{duties}}

## Requirements
{{must}}

## Nice to have
{{nice}}

## Export control
{{us_person}}. This position may involve access to technology and technical data subject to U.S. export control laws (EAR / ITAR). If you are not a U.S. person, the Company may need to obtain a government authorization before granting access, and employment may be conditioned on such authorization.

## Equal opportunity
AGRON Inc. is an equal opportunity employer. We consider all qualified applicants without regard to race, color, religion, sex, sexual orientation, gender identity, national origin, disability, veteran status or any other characteristic protected by law, consistent with applicable export control requirements.

**To apply:** send your CV to info@agron1.com with "{{position}}" in the subject.`,
    save: { section: "hr.hiring", title: "{{position}}", status: "Open", data: { department: "{{department}}", location: "{{location}}", notes: "{{purpose}}" } } },

  { id: "interview_scorecard", dept: "hr", icon: "check",
    name: { en: "Interview scorecard", ru: "Карта оценки кандидата" },
    desc: { en: "Structured interview: competencies scored 1–5, evidence, red flags, recommendation.", ru: "Структурированное интервью: компетенции 1–5, факты, риски, рекомендация." },
    fields: [F("candidate", "Candidate", "Кандидат", "text", { req: true }), F("position", "Position", "Вакансия", "text", { req: true }), DATE, F("interviewer", "Interviewer", "Интервьюер", "text", { req: true }), F("s_skill", "Role skills (1–5) and evidence", "Профессиональные навыки (1–5) и факты", "text"), F("s_problem", "Problem solving (1–5) and evidence", "Решение задач (1–5) и факты", "text"), F("s_comm", "Communication (1–5) and evidence", "Коммуникация (1–5) и факты", "text"), F("s_own", "Ownership and reliability (1–5)", "Ответственность (1–5)", "text"), F("s_fit", "Values and team fit (1–5)", "Ценности и команда (1–5)", "text"), F("strengths", "Strengths", "Сильные стороны", "long"), F("concerns", "Concerns / red flags", "Сомнения / риски", "long"), F("rec", "Recommendation", "Рекомендация", "select", { options: ["Strong hire", "Hire", "No hire", "Strong no hire"], def: "Hire" })],
    body: `# Interview scorecard

| | |
|---|---|
| **Candidate** | {{candidate}} |
| **Position** | {{position}} |
| **Date** | {{date}} |
| **Interviewer** | {{interviewer}} |

## Competencies (score 1–5, with specific evidence)
| Competency | Score and evidence |
|---|---|
| Role skills | {{s_skill}} |
| Problem solving | {{s_problem}} |
| Communication | {{s_comm}} |
| Ownership and reliability | {{s_own}} |
| Values and team fit | {{s_fit}} |

Scale: 1 = well below the bar, 3 = meets the bar, 5 = exceptional.

## Strengths
{{strengths}}

## Concerns
{{concerns}}

## Recommendation: **{{rec}}**

*Base the assessment only on job-related evidence. Do not record questions or notes about age, family status, religion, national origin, health or other protected characteristics. US-person status is checked by HR only, not in the interview.*` },

  { id: "separation_letter", dept: "hr", icon: "logout", counsel: true,
    name: { en: "Separation letter", ru: "Письмо об окончании работы" },
    desc: { en: "Confirms last day, final pay, benefits, return of property and continuing obligations.", ru: "Подтверждает последний день, расчёт, льготы, возврат имущества и обязательства." },
    fields: [F("name", "Employee", "Сотрудник", "text", { req: true }), F("address", "Employee address", "Адрес сотрудника"), F("reason", "Separation type", "Тип увольнения", "select", { options: ["resignation", "end of contract", "termination of employment", "mutual agreement"], def: "resignation" }), F("last_day", "Last working day", "Последний рабочий день", "date", { req: true }), F("final_pay", "Final paycheck date", "Дата окончательного расчёта", "date"), F("pto", "Accrued unused paid time off (days)", "Неиспользованный отпуск (дней)", "number"), F("benefits_end", "Health coverage ends", "Медстраховка до", "date"), F("property", "Property to return", "Что вернуть", "text", { def: "laptop, phone, access badges, documents and any Company data" }), SIGNER, SIGNER_T],
    body: `**AGRON Inc.**
{{today}}

{{name}}
{{address}}

**Re: Confirmation of separation of employment**

Dear {{name}},

This letter confirms that your employment with AGRON Inc. (the "Company") will end by {{reason}}, with your last working day on **{{last_day}}**.

**1. Final pay.** You will receive your final paycheck, including wages earned through your last working day, on or before {{final_pay}}, in accordance with applicable state law. Accrued unused paid time off: {{pto}} days, which will be paid out where required by law or Company policy.

**2. Benefits.** Your Company health coverage ends on {{benefits_end}}. Information on continuation coverage under COBRA (if applicable) will be sent to you separately. Your rights under any retirement or equity plan are governed by the terms of those plans.

**3. Return of Company property.** Please return all Company property, including {{property}}, no later than your last working day, and permanently delete any Company information from personal devices and accounts. Please confirm in writing when this is done.

**4. Continuing obligations.** Your obligations under the Confidential Information and Invention Assignment Agreement you signed continue after your employment ends, including your duties to keep Company information confidential and not to export or disclose controlled technical data.

**5. Access.** Your access to Company systems will end at the close of your last working day.

**6. Expenses.** Please submit any outstanding business expense claims, with receipts, within five (5) business days after your last working day.

**7. References and contact.** Questions about pay, benefits or documents can be sent to info@agron1.com.

We thank you for your contributions to AGRON and wish you every success.

Sincerely,

______________________
{{signer}}, {{signer_title}}
AGRON Inc.

Acknowledged: ______________________ {{name}}  Date: __________${COUNSEL_NOTE}`,
    save: { section: "hr.offboarding", title: "Offboarding · {{name}}", status: "Planned", data: { person: "{{name}}", due: "{{last_day}}" } } },

  /* =========================== Security =========================== */
  { id: "incident_report", dept: "security", icon: "alert",
    name: { en: "Security incident report", ru: "Отчёт об инциденте безопасности" },
    desc: { en: "Classification, timeline, impact, containment, root cause, notifications, corrective actions.", ru: "Классификация, хронология, последствия, меры, причина, уведомления, корректирующие действия." },
    fields: [F("ref", "Incident reference", "Номер инцидента", "text", { def: "INC-2026-" }), DATE, F("type", "Type", "Тип", "select", { options: ["Cyber / data", "Physical / site", "Equipment failure", "Unauthorized access to technical data", "Lost or stolen device", "Health and safety", "Other"], def: "Cyber / data" }), F("severity", "Severity", "Серьёзность", "select", { options: ["Low", "Medium", "High", "Critical"], def: "Medium" }), F("location", "Location / system", "Место / система", "text", { req: true }), F("timeline", "Timeline (time — event, one per line)", "Хронология (время — событие, по строке)", "long", { req: true }), F("impact", "Impact (people, data, systems, clients)", "Последствия (люди, данные, системы, клиенты)", "long", { req: true }), F("containment", "Containment actions taken", "Принятые меры по локализации", "long", { req: true }), F("cause", "Root cause (known or suspected)", "Причина (известная или предполагаемая)", "long"), F("corrective", "Corrective actions (what — who — by when)", "Корректирующие действия (что — кто — срок)", "long"), F("owner", "Reported by", "Сообщил", "text", { req: true })],
    body: `# Security incident report {{ref}}

| | |
|---|---|
| **Date** | {{date}} |
| **Type** | {{type}} |
| **Severity** | **{{severity}}** |
| **Location / system** | {{location}} |
| **Reported by** | {{owner}} |
| **Status** | Open |

## 1. Timeline
{{timeline}}

## 2. Impact
{{impact}}

## 3. Containment
{{containment}}

## 4. Root cause
{{cause}}

## 5. Notification assessment
| Who | Required? | Deadline | Done |
|---|---|---|---|
| Client(s) affected | ☐ Yes ☐ No | per contract | ☐ |
| Insurer | ☐ Yes ☐ No | per policy | ☐ |
| Law enforcement / site authority | ☐ Yes ☐ No | | ☐ |
| Data-protection regulator / individuals (personal data breach) | ☐ Yes ☐ No | per applicable law | ☐ |
| BIS / DDTC voluntary disclosure (unauthorized export or access to controlled technical data) | ☐ Yes ☐ No | consult counsel | ☐ |

## 6. Corrective and preventive actions
{{corrective}}

## 7. Evidence
Logs, recordings, photos and device images are preserved and attached. Chain of custody maintained by the Security lead.

## 8. Closure
Closed by: ______________ Date: ______  Lessons learned shared with the team: ☐`,
    save: { section: "security.incidents", title: "{{ref}} · {{type}}", status: "Reported", data: { severity: "{{severity}}", date: "{{date}}", description: "{{impact}}", owner: "{{owner}}" } } },

  /* =========================== Technical =========================== */
  { id: "test_report", dept: "technical", icon: "check",
    name: { en: "Test report", ru: "Протокол испытаний" },
    desc: { en: "Purpose, setup, procedure, results against criteria, deviations, verdict and sign-off.", ru: "Цель, стенд, методика, результаты против критериев, отклонения, вывод, подписи." },
    fields: [F("ref", "Test report number", "Номер протокола", "text", { def: "TR-2026-" }), F("equipment", "Equipment / system under test", "Объект испытаний", "text", { req: true }), F("type", "Test type", "Вид испытаний", "select", { options: ["Lab", "Bench", "Field", "Sea trial", "EMC", "Environmental", "Cyber"], def: "Bench" }), CONFIG(), DATE, F("location", "Location", "Место", "text"), F("purpose", "Purpose", "Цель", "long", { req: true }), F("setup", "Setup and instruments (with calibration)", "Стенд и приборы (с поверкой)", "long"), F("procedure", "Procedure (steps)", "Методика (шаги)", "long"), F("results", "Results (criterion — required — measured — pass/fail, one per line)", "Результаты (критерий — требуется — измерено — да/нет, по строке)", "long", { req: true }), F("deviations", "Deviations and observations", "Отклонения и замечания", "long", { def: "None" }), F("verdict", "Verdict", "Вывод", "select", { options: ["Passed", "Failed", "Blocked"], def: "Passed" }), F("owner", "Test engineer", "Инженер", "text", { req: true }), F("approver", "Approved by", "Утвердил")],
    body: `# Test report {{ref}}

| | |
|---|---|
| **Item under test** | {{equipment}} |
| **Configuration** | StarDome {{config}} |
| **Test type** | {{type}} |
| **Date / location** | {{date}} · {{location}} |
| **Test engineer** | {{owner}} |

## 1. Purpose
{{purpose}}

## 2. Setup and instruments
{{setup}}

## 3. Procedure
{{procedure}}

## 4. Results
{{results}}

## 5. Deviations and observations
{{deviations}}

## 6. Verdict
**{{verdict}}**

## 7. Sign-off
| Role | Name | Signature | Date |
|---|---|---|---|
| Test engineer | {{owner}} | ______________ | ______ |
| Approved | {{approver}} | ______________ | ______ |

*If this report contains performance parameters of items that may be export-controlled, mark the record "Controlled" (U.S. persons only).*`,
    save: { section: "technical.testing", title: "{{ref}} · {{equipment}}", status: "{{verdict}}", data: { type: "{{type}}", config: "{{config}}", equipment: "{{equipment}}", date: "{{date}}", result: "{{results}}", owner: "{{owner}}" } } },

  { id: "ecr", dept: "technical", icon: "git",
    name: { en: "Engineering change request", ru: "Запрос на инженерное изменение" },
    desc: { en: "Change, reason, affected items, cost and schedule impact, compliance re-review, approvals.", ru: "Изменение, причина, затронутые позиции, цена и сроки, повторная проверка комплаенса, согласования." },
    fields: [F("ref", "ECR number", "Номер ECR", "text", { def: "ECR-2026-" }), F("change", "Change (short title)", "Изменение (кратко)", "text", { req: true }), CONFIG(), F("current", "Current design / item", "Текущее решение / позиция", "long", { req: true }), F("proposed", "Proposed design / item", "Предлагаемое решение / позиция", "long", { req: true }), F("reason", "Reason", "Причина", "long", { req: true }), F("affected", "Affected items (BOM lines, drawings, software, builds)", "Затронуто (BOM, чертежи, ПО, сборки)", "long"), F("cost", "Cost impact per unit", "Влияние на цену за единицу", "text"), F("schedule", "Schedule impact", "Влияние на сроки", "text"), F("impact", "Main impact", "Основное влияние", "select", { options: ["Cost", "Schedule", "Compliance", "Safety", "Performance"], def: "Performance" }), F("due", "Needed by", "Нужно к", "date"), F("owner", "Requested by", "Запросил", "text", { req: true })],
    body: `# Engineering change request {{ref}}: {{change}}

| | |
|---|---|
| **Configuration** | StarDome {{config}} |
| **Requested by** | {{owner}} |
| **Date** | {{today}} |
| **Needed by** | {{due}} |
| **Main impact** | {{impact}} |

## 1. Current
{{current}}

## 2. Proposed
{{proposed}}

## 3. Reason
{{reason}}

## 4. Affected items
{{affected}}

## 5. Impact
| | |
|---|---|
| Cost per unit | {{cost}} |
| Schedule | {{schedule}} |
| Builds in progress affected | ☐ Yes ☐ No |

## 6. Required reviews
- ☐ Engineering review — design, interfaces, power and weight
- ☐ **Compliance re-review (Project Rule 15: every substitution needs a new review)** — update the Equipment compliance matrix: ECCN / USML, HS code, FCC / TDRA, UAE import and operating approvals
- ☐ Safety review (electrical, fire, laser, batteries) where applicable
- ☐ Procurement — lead time, supplier screening
- ☐ BOM, costing and documentation updated

## 7. Approval
| Role | Name | Decision | Date |
|---|---|---|---|
| Engineering lead | | ☐ Approve ☐ Reject | |
| Legal / compliance | | ☐ Approve ☐ Reject | |
| CEO (if cost or compliance impact) | | ☐ Approve ☐ Reject | |`,
    save: { section: "technical.changes", title: "{{ref}} · {{change}}", status: "Requested", data: { config: "{{config}}", impact: "{{impact}}", reason: "{{reason}}", owner: "{{owner}}", due: "{{due}}", priority: "Medium" } } },
];

export const TPL_DEPTS = ["legal", "company", "finance", "operations", "sales", "hr", "security", "technical"];
const today = () => new Date().toISOString().slice(0, 10);
/** Fills {{fields}}. In documents: empty → […]; multi-line answers become a list when they stand on their own line,
 *  line breaks inside table cells, and kept line breaks elsewhere. Titles and record fields get plain values. */
export const fillTpl = (s: string, v: Record<string, string>) => {
  const val = (k: string) => (k === "today" ? today() : String(v[k] ?? "").trim());
  if (s.length <= 300) return s.replace(/\{\{(\w+)\}\}/g, (_, k) => val(k));
  return s.split("\n").map((line) => {
    const alone = line.match(/^\{\{(\w+)\}\}$/);
    if (alone) {
      const x = val(alone[1]); if (!x) return "[…]";
      const items = x.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      if (items.length < 2) return x;
      return items.map((l) => (/^([-*•☐]|\d+[.)])\s/.test(l) ? l.replace(/^•\s*/, "- ") : `- ${l}`)).join("\n");
    }
    const inTable = line.trimStart().startsWith("|");
    return line.replace(/\{\{(\w+)\}\}/g, (_, k) => { const x = val(k); if (!x) return "[…]"; return inTable ? x.replace(/\|/g, "/").replace(/\n+/g, "<br>") : x.replace(/\n/g, "  \n"); });
  }).reduce((out: string[], line, i, arr) => { // keep the author's line structure: single line breaks stay line breaks
    const next = arr[i + 1] ?? "";
    const plain = (l: string) => l.trim() !== "" && !/^\s*(\||#|- |\* |\d+\. |---)/.test(l);
    out.push(plain(line) && plain(next) && !line.endsWith("  ") ? line + "  " : line); return out;
  }, []).join("\n");
};
