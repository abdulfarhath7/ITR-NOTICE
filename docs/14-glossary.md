# 14 — Glossary

For a developer with no Indian tax background. Terms appear in code and UI.

| Term | Meaning |
|---|---|
| **PAN** | Permanent Account Number. Ten characters, the taxpayer's unique tax id. `AABCV1234K`. |
| **GSTIN** | Goods and Services Tax identification number, 15 characters. Structure: 2-digit state code, then the 10-character PAN, then entity code, then `Z`, then a checksum. So PAN is characters 3 to 12 — derivable, no lookup needed. |
| **AY** | Assessment Year. The year in which income of the previous year is assessed. AY 2024-25 assesses FY 2023-24. |
| **FY** | Financial Year, 1 April to 31 March. Some portal services key on FY, most on AY, so both are stored. |
| **Assessee** | The taxpayer whose affairs are in question. May differ from our "client" when the firm acts for a related entity. |
| **e-Proceedings** | The portal area where the department issues notices and the taxpayer responds. |
| **DIN** | Document Identification Number. Unique id on every departmental communication. Our primary natural key. |
| **Scrutiny** | Detailed examination of a filed return. Notice issued under section 143(2) of the 1961 Act. |
| **Intimation** | Automated processing result, section 143(1). May raise a demand. |
| **Defective return** | Return with an error, section 139(9). Must be corrected within a window. |
| **Rectification** | Application to correct a mistake apparent from the record, section 154. |
| **Outstanding demand** | An amount the department says is payable. The taxpayer may agree, disagree, or partly disagree. |
| **Challan** | Proof of a tax payment. Carries a CIN and a BSR code. |
| **CIN** | Challan Identification Number. |
| **BSR code** | Bank branch code appearing on a challan. |
| **Pre-deposit** | Partial payment required before an appeal can be heard. Relates to both the appeal and the underlying demand — see Q03. |
| **First appeal** | Appeal to the Commissioner (Appeals), filed on Form 35. |
| **CIT(A)** | Commissioner of Income Tax (Appeals). The first appellate authority. |
| **Appellate authority** | Whoever hears the appeal at a given stage. |
| **Adjournment** | A request to postpone a hearing or extend a response date. The portal treats it as a distinct action, so we model it as its own object. |
| **Limitation date** | The statutory deadline by which an action must be taken or the right is lost. **Not** the response due date. The more important of the two. |
| **ITR-V** | Acknowledgement of a filed income tax return. |
| **Form 26AS / AIS / TIS** | Consolidated statements of tax credits and reported transactions. Out of scope for this build. |
| **ERI** | e-Return Intermediary. A registered intermediary that can access client data through official APIs instead of the web portal. Each client must individually authorise the firm. |
| **AR** | Authorised Representative. A portal role letting a practitioner see clients' proceedings from their own login — which is why most of a firm's book needs no client password. |
| **1961 Act / 2025 Act** | The Income-tax Act, 1961 and its 2025 replacement. The portal now labels some things under the new Act. Sections are stored as a pair and displayed as `new (old)`. |
| **CA** | Chartered Accountant. |
| **Assessment** | The department's determination of taxable income and tax due. |
